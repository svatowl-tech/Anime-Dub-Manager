const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const log = require('electron-log');
const { app } = require('electron');
const { getVideoMetadata, detectSpeechIntervals } = require('./ffmpegService.cjs');
const { getRawSubtitles } = require('./subtitleService.cjs');

let WhisperService = null;
try {
  WhisperService = require('./WhisperService.cjs');
} catch (e) {}

let whisperInstance = null;
function getWhisperService() {
  if (!whisperInstance && WhisperService) {
    try {
      const userData = app?.getPath ? app.getPath('userData') : path.join(process.cwd(), 'mock_user_data');
      whisperInstance = new WhisperService(userData);
    } catch (e) {
      log.warn('[AudioAnalysisService] Could not instantiate WhisperService:', e.message);
    }
  }
  return whisperInstance;
}

/**
 * Замер совокупных уровней RMS, пиков и EBU R128 громкости аудиофайла через FFmpeg
 */
function measureVolumeStats(audioPath) {
  return new Promise((resolve) => {
    let meanVolume = -24.0;
    let maxVolume = -1.0;
    let integratedLufs = -23.0;
    let loudnessRange = 9.0;
    let truePeak = -1.0;
    let lufsThreshold = -33.0;

    if (!audioPath || !fs.existsSync(audioPath)) {
      return resolve({
        speechRmsDb: meanVolume,
        peakDb: maxVolume,
        integratedLufsDb: integratedLufs,
        loudnessRangeDb: loudnessRange,
        truePeakDb: truePeak,
        lufsThresholdDb: lufsThreshold
      });
    }

    ffmpeg(audioPath)
      .audioFilters(['volumedetect', 'ebur128=peak=true'])
      .format('null')
      .output('-')
      .on('stderr', (stderrChunk) => {
        const lines = stderrChunk.split('\n');
        for (const line of lines) {
          const meanMatch = line.match(/mean_volume:\s*(-?[0-9.]+)\s*dB/i);
          if (meanMatch) {
            meanVolume = parseFloat(meanMatch[1]);
          }
          const maxMatch = line.match(/max_volume:\s*(-?[0-9.]+)\s*dB/i);
          if (maxMatch) {
            maxVolume = parseFloat(maxMatch[1]);
          }
          const iMatch = line.match(/I:\s*(-?[0-9.]+)\s*LUFS/i);
          if (iMatch) {
            integratedLufs = parseFloat(iMatch[1]);
          }
          const lraMatch = line.match(/LRA:\s*([0-9.]+)\s*LU/i);
          if (lraMatch) {
            loudnessRange = parseFloat(lraMatch[1]);
          }
          const tpMatch = line.match(/Peak:\s*(-?[0-9.]+)\s*dBFS/i);
          if (tpMatch) {
            truePeak = parseFloat(tpMatch[1]);
          }
          const thMatch = line.match(/Threshold:\s*(-?[0-9.]+)\s*LUFS/i);
          if (thMatch) {
            lufsThreshold = parseFloat(thMatch[1]);
          }
        }
      })
      .on('end', () => {
        resolve({
          speechRmsDb: Number(meanVolume.toFixed(2)),
          peakDb: Number(maxVolume.toFixed(2)),
          integratedLufsDb: Number(integratedLufs.toFixed(2)),
          loudnessRangeDb: Number(loudnessRange.toFixed(2)),
          truePeakDb: Number(truePeak.toFixed(2)),
          lufsThresholdDb: Number(lufsThreshold.toFixed(2))
        });
      })
      .on('error', (err) => {
        log.warn(`[AudioAnalysisService] volume/ebur128 warning for ${audioPath}:`, err.message);
        resolve({
          speechRmsDb: meanVolume,
          peakDb: maxVolume,
          integratedLufsDb: integratedLufs,
          loudnessRangeDb: loudnessRange,
          truePeakDb: truePeak,
          lufsThresholdDb: lufsThreshold
        });
      })
      .run();
  });
}

/**
 * Определение уровня шума в пазах тишины
 */
async function measureNoiseFloor(audioPath, silences = []) {
  if (!silences || silences.length === 0) {
    return -52.0;
  }

  const validSilence = silences.find(s => (s.end - s.start) >= 0.25);
  if (!validSilence) {
    return -52.0;
  }

  const startSec = validSilence.start + 0.05;
  const durSec = Math.min(0.8, (validSilence.end - validSilence.start) - 0.1);
  if (durSec <= 0.05) return -52.0;

  return new Promise((resolve) => {
    let measuredNoise = -52.0;
    ffmpeg(audioPath)
      .setStartTime(startSec)
      .setDuration(durSec)
      .audioFilters('volumedetect')
      .format('null')
      .output('-')
      .on('stderr', (stderrChunk) => {
        const lines = stderrChunk.split('\n');
        for (const line of lines) {
          const meanMatch = line.match(/mean_volume:\s*(-?[0-9.]+)\s*dB/i);
          if (meanMatch) {
            measuredNoise = parseFloat(meanMatch[1]);
          }
        }
      })
      .on('end', () => {
        resolve(Number(measuredNoise.toFixed(2)));
      })
      .on('error', () => {
        resolve(-52.0);
      })
      .run();
  });
}

class AudioAnalysisService {

  /**
   * Быстрый физический замер характеристик громкости аудиодорожки:
   * speechRmsDb, peakDb, integratedLufsDb, loudnessRangeDb, truePeakDb, noiseFloorDb
   */
  static async measureTrackStats(audioPath) {
    const volumeStats = await measureVolumeStats(audioPath);
    return {
      speechRmsDb: volumeStats.speechRmsDb ?? -24.0,
      peakDb: volumeStats.peakDb ?? -1.0,
      integratedLufsDb: volumeStats.integratedLufsDb ?? -23.0,
      loudnessRangeDb: volumeStats.loudnessRangeDb ?? 9.0,
      truePeakDb: volumeStats.truePeakDb ?? -1.0,
      lufsThresholdDb: volumeStats.lufsThresholdDb ?? -33.0,
      noiseFloorDb: -52.0
    };
  }

  /**
   * Выполняет полный физический анализ аудиодорожки:
   * - Замер метаданных (длительность, samplerate, channels, fileSize, mtimeMs)
   * - Вычисление энергии (noiseFloorDb, speechRmsDb, peakDb, suggestedGateThresholdDb)
   * - Выделение фраз с VAD атаками (+80ms) и затуханиями (+150ms)
   * - Пакетное транскрибирование Whisper
   * - Сопоставление с субтитрами
   * - Сохранение в .analysis.json
   */
  static async analyzeTrack(audioPath, options = {}, onProgress = null) {
    if (!audioPath || !fs.existsSync(audioPath)) {
      throw new Error(`Audio file does not exist: ${audioPath}`);
    }

    log.info(`[AudioAnalysisService] Starting full audio track analysis: ${audioPath}`);
    if (onProgress) onProgress({ status: 'analyzing_meta', progress: 5 });

    const stats = fs.statSync(audioPath);
    const mtimeMs = stats.mtimeMs;
    const fileSize = stats.size;

    // 1. Метаданные через ffprobe
    let meta = { durationSec: 0, sampleRate: 48000, channels: 2 };
    try {
      const ffMeta = await getVideoMetadata(audioPath);
      const audioStream = (ffMeta.streams || []).find(s => s.codec_type === 'audio') || {};
      meta.durationSec = Number(parseFloat(ffMeta.format?.duration || audioStream.duration || '0').toFixed(3));
      meta.sampleRate = parseInt(audioStream.sample_rate || '48000', 10);
      meta.channels = parseInt(audioStream.channels || '2', 10);
    } catch (err) {
      log.warn(`[AudioAnalysisService] Error probing video metadata for ${audioPath}:`, err.message);
    }

    if (onProgress) onProgress({ status: 'measuring_volume', progress: 20 });

    // 2. Громкость и энергитический профиль
    const volumeStats = await measureVolumeStats(audioPath);
    
    // VAD & Silences
    if (onProgress) onProgress({ status: 'detecting_speech', progress: 35 });
    const vadResult = await detectSpeechIntervals(audioPath, {
      noiseDb: options.noiseDb || -42,
      minSilenceDuration: options.minSilenceDuration || 0.25
    });

    const silences = vadResult.silences || [];
    const noiseFloorDb = await measureNoiseFloor(audioPath, silences);

    // Автоматический рекомендованный порог гейта
    const rawGate = Math.round(noiseFloorDb + 8);
    const suggestedGateThresholdDb = Math.min(-28, Math.max(-55, rawGate));

    const energyProfile = {
      noiseFloorDb,
      speechRmsDb: volumeStats.speechRmsDb,
      peakDb: volumeStats.peakDb,
      suggestedGateThresholdDb
    };

    // 3. Формирование списка фраз (VAD: +80ms attack, +150ms decay)
    if (onProgress) onProgress({ status: 'segmenting_phrases', progress: 50 });
    const rawSpeech = vadResult.speechIntervals || [];
    const totalDuration = meta.durationSec || 0;

    const baseName = path.basename(audioPath).toLowerCase();
    const isFixFile = baseName.includes('fix') || baseName.includes('фикс') || options.isFix === true;

    let subLines = options.subLines || [];
    if (!subLines.length && options.subPath && fs.existsSync(options.subPath)) {
      try {
        const parsed = await getRawSubtitles(options.subPath);
        subLines = parsed.lines || [];
      } catch (e) {}
    }

    const phrases = [];
    for (let i = 0; i < rawSpeech.length; i++) {
      const seg = rawSpeech[i];
      const startSec = Number(Math.max(0, seg.startSec - 0.08).toFixed(3));
      const endSec = Number(Math.min(totalDuration > 0 ? totalDuration : seg.endSec + 0.15, seg.endSec + 0.15).toFixed(3));
      const durationSec = Number(Math.max(0.1, endSec - startSec).toFixed(3));

      // Сопоставление с субтитрами по времени
      let matchedSubtitleId = null;
      if (subLines.length > 0) {
        const matched = subLines.find((line) => {
          const lStart = line.startSec || 0;
          const lEnd = line.endSec || 0;
          return (startSec < lEnd && endSec > lStart);
        });
        if (matched) {
          matchedSubtitleId = String(matched.id || matched.index || '');
        }
      }

      phrases.push({
        id: `phrase_${i}_${Math.floor(startSec * 1000)}`,
        startSec,
        endSec,
        durationSec,
        rmsDb: volumeStats.speechRmsDb,
        peakDb: volumeStats.peakDb,
        whisperText: '',
        matchedSubtitleId,
        targetStartSec: startSec,
        targetEndSec: endSec,
        isFix: isFixFile
      });
    }

    // 4. Пакетная транскрибация Whisper (если не отключена)
    if (!options.skipWhisper && phrases.length > 0) {
      if (onProgress) onProgress({ status: 'transcribing_whisper', progress: 65 });
      const whisperService = getWhisperService();
      const lang = options.language || 'ru';
      const model = options.model || 'tiny';

      if (whisperService && typeof whisperService.transcribeSlice === 'function') {
        for (let i = 0; i < phrases.length; i++) {
          const phrase = phrases[i];
          try {
            const text = await whisperService.transcribeSlice(
              audioPath,
              phrase.startSec,
              phrase.durationSec,
              lang,
              model
            );
            phrase.whisperText = text || '';
          } catch (wErr) {
            log.warn(`[AudioAnalysisService] Whisper slice ${phrase.id} error:`, wErr.message);
          }
          if (onProgress) {
            const whisperProgress = 65 + Math.round(((i + 1) / phrases.length) * 30);
            onProgress({ status: 'transcribing_whisper', progress: whisperProgress, current: i + 1, total: phrases.length });
          }
        }
      }
    }

    const audioMeta = {
      durationSec: meta.durationSec,
      sampleRate: meta.sampleRate,
      channels: meta.channels,
      fileSize,
      mtimeMs
    };

    const analysisData = {
      version: '1.0.0',
      audioPath,
      updatedAt: new Date().toISOString(),
      audioMeta,
      energyProfile,
      phrases
    };

    // 5. Сохранение .analysis.json строго рядом с аудиофайлом
    const jsonPath = path.join(path.dirname(audioPath), `${path.basename(audioPath, path.extname(audioPath))}.analysis.json`);
    try {
      await fsPromises.writeFile(jsonPath, JSON.stringify(analysisData, null, 2), 'utf-8');
      log.info(`[AudioAnalysisService] Successfully saved passport: ${jsonPath}`);
    } catch (saveErr) {
      log.error(`[AudioAnalysisService] Failed to write analysis JSON to ${jsonPath}:`, saveErr);
    }

    if (onProgress) onProgress({ status: 'completed', progress: 100 });
    return analysisData;
  }

  /**
   * Чтение/создание паспорта .analysis.json с мгновенной проверкой кэша по mtime
   */
  static async getOrRunAnalysis(audioPath, force = false, options = {}, onProgress = null) {
    if (!audioPath || !fs.existsSync(audioPath)) {
      throw new Error(`Audio file does not exist: ${audioPath}`);
    }

    const jsonPath = path.join(path.dirname(audioPath), `${path.basename(audioPath, path.extname(audioPath))}.analysis.json`);
    const currentMtimeMs = fs.statSync(audioPath).mtimeMs;

    if (!force && fs.existsSync(jsonPath)) {
      try {
        const raw = await fsPromises.readFile(jsonPath, 'utf-8');
        const data = JSON.parse(raw);
        if (data && data.audioMeta && typeof data.audioMeta.mtimeMs === 'number') {
          // Если дата изменения совпадает с точностью до 100мс
          if (Math.abs(data.audioMeta.mtimeMs - currentMtimeMs) < 100) {
            log.info(`[AudioAnalysisService] Cache HIT for ${audioPath}. Instant read from ${jsonPath}`);
            if (onProgress) onProgress({ status: 'completed', progress: 100, cached: true });
            return data;
          } else {
            log.info(`[AudioAnalysisService] Cache EXPIRED for ${audioPath} (mtime changed). Re-running analysis.`);
          }
        }
      } catch (e) {
        log.warn(`[AudioAnalysisService] Corrupted cache file ${jsonPath}, re-analyzing:`, e.message);
      }
    }

    return await this.analyzeTrack(audioPath, options, onProgress);
  }

  /**
   * Сохранение итогового файла серии (timing_project.analysis.json)
   */
  static async saveTimingAnalysis(episodeDir, data) {
    if (!episodeDir) {
      throw new Error('Episode directory path is required');
    }

    const timingSubDir = path.join(episodeDir, 'Тайминг');
    if (!fs.existsSync(timingSubDir)) {
      try {
        fs.mkdirSync(timingSubDir, { recursive: true });
      } catch (e) {}
    }

    const payload = {
      version: '1.0.0',
      savedAt: new Date().toISOString(),
      episodeDir,
      ...data
    };

    const targetFileSub = path.join(timingSubDir, 'timing_project.analysis.json');
    const targetFileRoot = path.join(episodeDir, 'timing_project.analysis.json');

    await fsPromises.writeFile(targetFileSub, JSON.stringify(payload, null, 2), 'utf-8');
    await fsPromises.writeFile(targetFileRoot, JSON.stringify(payload, null, 2), 'utf-8').catch(() => {});

    log.info(`[AudioAnalysisService] Saved episode timing project passport: ${targetFileSub}`);
    return targetFileSub;
  }

  /**
   * Получение итоговой карты тайминга серии
   */
  static async getTimingAnalysis(episodeDir) {
    if (!episodeDir) return null;

    const candidates = [
      path.join(episodeDir, 'Тайминг', 'timing_project.analysis.json'),
      path.join(episodeDir, 'timing_project.analysis.json'),
      path.join(episodeDir, 'project_timing.analysis.json'),
      path.join(episodeDir, 'Тайминг', 'project_timing.analysis.json')
    ];

    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        try {
          const raw = await fsPromises.readFile(cand, 'utf-8');
          return JSON.parse(raw);
        } catch (e) {
          log.warn(`[AudioAnalysisService] Failed to parse timing analysis at ${cand}:`, e.message);
        }
      }
    }

    return null;
  }
}

module.exports = AudioAnalysisService;
