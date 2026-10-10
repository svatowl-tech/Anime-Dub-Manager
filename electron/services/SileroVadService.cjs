const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ort = require('onnxruntime-node');
const log = require('electron-log');
const { app } = require('electron');

let sessionCache = null;

/**
 * Определение пути к файлу модели Silero VAD v5 ONNX
 */
function getSileroVadModelPath() {
  const candidatePaths = [
    path.resolve(process.cwd(), 'assets', 'models', 'silero_vad.onnx'),
    path.join(__dirname, '..', '..', 'assets', 'models', 'silero_vad.onnx'),
    path.join(__dirname, '..', 'assets', 'models', 'silero_vad.onnx')
  ];

  if (app) {
    if (app.isPackaged) {
      const resourcesPath = process.resourcesPath || '';
      candidatePaths.unshift(path.join(resourcesPath, 'assets', 'models', 'silero_vad.onnx'));
      candidatePaths.unshift(path.join(resourcesPath, 'models', 'silero_vad.onnx'));
    }
    try {
      const userData = app.getPath('userData');
      candidatePaths.unshift(path.join(userData, 'models', 'silero_vad.onnx'));
    } catch (e) {}
  }

  for (const p of candidatePaths) {
    if (p && fs.existsSync(p)) return p;
  }

  return null;
}

/**
 * Получение синглтона ONNX InferenceSession для Silero VAD v5
 */
async function getInferenceSession() {
  if (sessionCache) return sessionCache;

  const modelPath = getSileroVadModelPath();
  if (!modelPath) {
    throw new Error('Модель Silero VAD (silero_vad.onnx) не найдена в ресурсах приложения');
  }

  log.info(`[SileroVAD] Загрузка ONNX модели из: ${modelPath}`);
  sessionCache = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu']
  });

  return sessionCache;
}

/**
 * Потоковое декодирование любого аудиофайла в PCM 16-бит 16 кГц Моно Float32 массивы
 */
function decodeAudioTo16kMonoPcm(filePath, ffmpegExec = 'ffmpeg') {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`Аудиофайл не найден: ${filePath}`));
    }

    let execPath = (ffmpegExec && typeof ffmpegExec === 'string' && fs.existsSync(ffmpegExec)) ? ffmpegExec : null;
    if (!execPath) {
      try {
        const { getFfmpegPath } = require('./ffmpegService.cjs');
        const p = getFfmpegPath();
        if (p && fs.existsSync(p)) execPath = p;
      } catch (e) {}
    }
    if (!execPath) execPath = 'ffmpeg';

    const ffProcess = spawn(execPath, [
      '-i', filePath,
      '-vn',
      '-acodec', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '1',
      '-f', 's16le',
      '-'
    ]);

    const chunks = [];
    let stderrMsg = '';

    ffProcess.stdout.on('data', chunk => chunks.push(chunk));
    ffProcess.stderr.on('data', chunk => { stderrMsg += chunk.toString(); });

    ffProcess.on('close', code => {
      const rawBuf = Buffer.concat(chunks);
      if (rawBuf.length === 0) {
        return reject(new Error(`Не удалось декодировать PCM с помощью FFmpeg (exit code ${code}): ${stderrMsg}`));
      }

      const totalSamples = Math.floor(rawBuf.length / 2);
      const float32 = new Float32Array(totalSamples);
      for (let i = 0; i < totalSamples; i++) {
        const int16 = rawBuf.readInt16LE(i * 2);
        float32[i] = int16 < 0 ? int16 / 32768.0 : int16 / 32767.0;
      }
      resolve(float32);
    });

    ffProcess.on('error', err => reject(err));
  });
}

/**
 * Высокоточная детекция речевых интервалов с помощью Silero VAD v5 ONNX
 * 
 * @param {string} filePath Путь к аудиофайлу
 * @param {object} options Настройки детекции (threshold, negThreshold, minSilenceDurationMs)
 * @param {string} ffmpegExec Путь к бинарнику FFmpeg
 * @returns {Promise<{duration: number, silences: Array<{start: number, end: number}>, speechIntervals: Array<{startSec: number, endSec: number, durationSec: number, confidence: number}>}>}
 */
async function detectSpeechWithSileroVad(filePath, options = {}, ffmpegExec = 'ffmpeg') {
  const session = await getInferenceSession();
  const samples = await decodeAudioTo16kMonoPcm(filePath, ffmpegExec);
  const totalDuration = Number((samples.length / 16000).toFixed(3));

  if (samples.length === 0) {
    return {
      duration: 0,
      silences: [],
      speechIntervals: []
    };
  }

  const chunkSize = 512; // 512 сэмплов = 32 мс при 16000 Гц
  let state = new Float32Array(2 * 1 * 128); // 256 значений Float32
  const sr = new BigInt64Array([16000n]);

  const threshold = options.threshold !== undefined ? options.threshold : 0.40;
  const negThreshold = options.negThreshold !== undefined ? options.negThreshold : (threshold - 0.15);
  const minSilenceDurationMs = options.minSilenceDurationMs !== undefined ? options.minSilenceDurationMs : 250;

  const frameProbabilities = [];

  for (let i = 0; i < samples.length; i += chunkSize) {
    const chunk = new Float32Array(chunkSize);
    const sub = samples.subarray(i, Math.min(i + chunkSize, samples.length));
    chunk.set(sub);

    const inputTensor = new ort.Tensor('float32', chunk, [1, chunkSize]);
    const stateTensor = new ort.Tensor('float32', state, [2, 1, 128]);
    const srTensor = new ort.Tensor('int64', sr, [1]);

    const results = await session.run({
      input: inputTensor,
      state: stateTensor,
      sr: srTensor
    });

    const prob = results.output.data[0];
    state = new Float32Array(results.stateN.data);
    const timeSec = i / 16000;
    frameProbabilities.push({ timeSec, prob });
  }

  // Сегментация речевых кадров
  let inSpeech = false;
  let speechStart = 0;
  let maxConf = 0;
  const rawSegments = [];

  for (const frame of frameProbabilities) {
    if (frame.prob >= threshold) {
      if (!inSpeech) {
        inSpeech = true;
        speechStart = frame.timeSec;
        maxConf = frame.prob;
      } else {
        if (frame.prob > maxConf) maxConf = frame.prob;
      }
    } else if (frame.prob < negThreshold) {
      if (inSpeech) {
        inSpeech = false;
        rawSegments.push({
          startSec: speechStart,
          endSec: frame.timeSec,
          confidence: Number(maxConf.toFixed(3))
        });
      }
    }
  }

  if (inSpeech) {
    rawSegments.push({
      startSec: speechStart,
      endSec: totalDuration,
      confidence: Number(maxConf.toFixed(3))
    });
  }

  // Защита границ реплик: адаптивный pre-roll +80 мс и post-roll +150 мс
  const paddedSegments = rawSegments.map(seg => {
    const s = Math.max(0, seg.startSec - 0.08); // pre-roll +80ms
    const e = Math.min(totalDuration, seg.endSec + 0.15); // post-roll +150ms
    return {
      startSec: Number(s.toFixed(3)),
      endSec: Number(e.toFixed(3)),
      durationSec: Number((e - s).toFixed(3)),
      confidence: seg.confidence
    };
  });

  // Склеивание близко стоящих интервалов, если пауза между ними < minSilenceDurationMs (250 мс)
  const minSilenceGapSec = minSilenceDurationMs / 1000;
  const speechIntervals = [];

  for (const interval of paddedSegments) {
    if (speechIntervals.length === 0) {
      speechIntervals.push({ ...interval });
    } else {
      const last = speechIntervals[speechIntervals.length - 1];
      if (interval.startSec - last.endSec < minSilenceGapSec) {
        last.endSec = Math.max(last.endSec, interval.endSec);
        last.durationSec = Number((last.endSec - last.startSec).toFixed(3));
        last.confidence = Math.max(last.confidence, interval.confidence);
      } else {
        speechIntervals.push({ ...interval });
      }
    }
  }

  // Расчет пауз тишины между сегментами
  const silences = [];
  let curPos = 0;
  for (const sp of speechIntervals) {
    if (sp.startSec > curPos) {
      silences.push({
        start: Number(curPos.toFixed(3)),
        end: Number(sp.startSec.toFixed(3))
      });
    }
    curPos = sp.endSec;
  }
  if (curPos < totalDuration) {
    silences.push({
      start: Number(curPos.toFixed(3)),
      end: Number(totalDuration.toFixed(3))
    });
  }

  log.info(`[SileroVAD] Найдено ${speechIntervals.length} речевых сегментов в ${filePath} (длительность: ${totalDuration}с)`);

  return {
    duration: totalDuration,
    silences,
    speechIntervals
  };
}

module.exports = {
  detectSpeechWithSileroVad,
  getSileroVadModelPath
};
