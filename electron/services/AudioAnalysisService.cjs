const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const log = require('electron-log');
const { app } = require('electron');
const { getVideoMetadata, detectSpeechIntervals } = require('./ffmpegService.cjs');
const { getRawSubtitles } = require('./subtitleService.cjs');
const { trackProcess } = require('../lib/ProcessTracker.cjs');

let WhisperService = null;
try {
  WhisperService = require('./WhisperService.cjs');
} catch (e) {}

let whisperInstance = null;
const pendingAnalyses = new Map();

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

    // 4. Пакетная транскрибация Whisper (по умолчанию отключена, запускается только по явной просьбе)
    const shouldRunWhisper = options.skipWhisper === false && options.runWhisper === true;
    if (shouldRunWhisper && phrases.length > 0) {
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

    const normPath = path.resolve(audioPath);

    // Если анализ данного файла уже выполняется в данный момент - подсоединяемся к текущему промису
    if (pendingAnalyses.has(normPath)) {
      log.info(`[AudioAnalysisService] Deduplicating active analysis for ${normPath}`);
      return await pendingAnalyses.get(normPath);
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

    const analysisPromise = this.analyzeTrack(audioPath, options, onProgress).finally(() => {
      pendingAnalyses.delete(normPath);
    });

    pendingAnalyses.set(normPath, analysisPromise);
    return await analysisPromise;
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

  /**
   * Проверка, является ли файл неразделенным исходным аудио из видео (а не выделенным вокалом)
   */
  static isUnseparatedOriginalAudio(filePath) {
    if (!filePath) return true;
    const base = path.basename(filePath).toLowerCase();
    if (
      base === '00_original_audio.wav' ||
      base === 'original_audio.wav' ||
      base === 'source_audio.wav' ||
      base === 'raw_audio.wav' ||
      base.includes('original_audio') ||
      base.includes('no_vocal') ||
      base.includes('instrumental') ||
      base.includes('_inst') ||
      base.includes('_me.wav') ||
      base.includes('bgm') ||
      base.includes('ducked')
    ) {
      return true;
    }
    return false;
  }

  /**
   * Проверка, является ли файл склеенной дорожкой всех голосов (voices_master)
   */
  static isGluedVoicesMasterTrack(filePath, manifest = null) {
    if (!filePath || !fs.existsSync(filePath)) return false;
    const resolved = path.resolve(filePath).toLowerCase();
    const base = path.basename(resolved);

    // Не может быть уже обработанным acoustic_matched или оригиналом
    if (base.startsWith('acoustic_matched_') || base.includes('original') || base.includes('ducked')) {
      return false;
    }

    if (manifest && Array.isArray(manifest.pipeline)) {
      const glueStep = manifest.pipeline.find(
        s => (s.moduleId === 'glue_compress' || s.moduleId === 'mix_voices') && s.status === 'completed' && Array.isArray(s.outputFiles) && s.outputFiles.length > 0
      );
      if (glueStep) {
        const matchGlue = glueStep.outputFiles.some(
          f => f && f.path && path.resolve(f.path).toLowerCase() === resolved
        );
        if (matchGlue) return true;
      }
    }

    return (
      base.includes('voices_master') ||
      base.includes('mix_voices') ||
      base.includes('glue_') ||
      base.includes('glued_voices') ||
      base.includes('all_voices')
    );
  }

  /**
   * Автоматический поиск склеенной дорожки всех голосов (результат шага mix_voices / glue_compress)
   */
  static findGluedVoicesTrack(candidateDirs = [], manifest = null, options = {}) {
    const strict = options.strict !== false;

    // 1. Приоритетно ищем завершенный шаг mix_voices / glue_compress в конвейере
    if (manifest && Array.isArray(manifest.pipeline)) {
      for (let i = manifest.pipeline.length - 1; i >= 0; i--) {
        const step = manifest.pipeline[i];
        if (step && (step.moduleId === 'mix_voices' || step.moduleId === 'glue_compress') && Array.isArray(step.outputFiles)) {
          for (const file of step.outputFiles) {
            if (file && file.path && fs.existsSync(file.path) && fs.statSync(file.path).size > 1000) {
              return file.path;
            }
          }
        }
      }
    }

    // 2. Поиск файла *voices_master.wav в директориях проекта (исключая acoustic_matched_)
    const validDirs = (Array.isArray(candidateDirs) ? candidateDirs : [candidateDirs]).filter(Boolean);
    const expandedDirs = [...validDirs];
    for (const dirPath of validDirs) {
      if (!dirPath || !fs.existsSync(dirPath)) continue;
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const fullSub = path.join(dirPath, entry.name);
            if (!expandedDirs.includes(fullSub)) {
              expandedDirs.push(fullSub);
            }
          }
        }
      } catch (e) {}
    }

    const foundCandidates = [];
    for (const dirPath of expandedDirs) {
      if (!dirPath || !fs.existsSync(dirPath)) continue;
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const lower = entry.name.toLowerCase();
          if (!lower.endsWith('.wav')) continue;
          if (lower.startsWith('acoustic_matched_') || lower.includes('ducked') || lower.includes('master_mix')) continue;
          if (lower.includes('voices_master') || lower.includes('mix_voices') || lower.includes('glued_voices')) {
            const fullPath = path.join(dirPath, entry.name);
            const st = fs.statSync(fullPath);
            if (st.size > 1000) {
              foundCandidates.push({ path: fullPath, mtimeMs: st.mtimeMs });
            }
          }
        }
      } catch (e) {}
    }

    if (foundCandidates.length > 0) {
      foundCandidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
      return foundCandidates[0].path;
    }

    if (strict) {
      throw new Error(
        '❌ Ошибка [acoustic_matched]: Голоса дабберов НЕ были склеены в единую дорожку (voices_master.wav)!\n' +
        'Модуль наложения эффектов принимает на вход ИСКЛЮЧИТЕЛЬНО вокальную дорожку оригинала и склеенную дорожку всех голосов.\n' +
        'Сначала выполните шаг «Склеивание голосов в одну дорожку» (mix_voices / glue_compress).'
      );
    }

    return null;
  }

  /**
   * Автоматический поиск заранее разделенной дорожки вокала оригинала (СТРОГО после разделения стемов)
   */
  static findOriginalVocalsTrack(candidateDirs = [], manifest = null, ourVocalsPath = null, options = {}) {
    const validDirs = (Array.isArray(candidateDirs) ? candidateDirs : [candidateDirs]).filter(Boolean);
    const resolvedOurPath = ourVocalsPath ? path.resolve(ourVocalsPath).toLowerCase() : '';

    const isExcluded = (fullPath) => {
      if (!fullPath) return true;
      const resolved = path.resolve(fullPath).toLowerCase();
      if (resolvedOurPath && resolved === resolvedOurPath) return true;
      if (this.isUnseparatedOriginalAudio(resolved)) return true;
      const name = path.basename(resolved);
      const excludedKeywords = [
        'matched', 'dub', 'our_', 'voices_master', 'combined', 'ducked', 'master',
        'final', 'no_vocal', 'instrumental', '_inst', '_me.wav', 'bgm', 'fix', 'norm', 'dubber',
        '00_original_audio', 'original_audio'
      ];
      return excludedKeywords.some(k => name.includes(k));
    };

    const stemSeparationMods = [
      'htdemucs', 'htdemucs_ft', 'htdemucs_vocals_bgm', 'uvr_mdx_inst_hq3',
      'uvr_mdx_voc_ft', 'kim_vocal_2', 'mdx23c_8step', 'hp_karaoke_uvr',
      'mel_band_roformer_vocals', 'bs_roformer_viperx', 'bs_roformer_cinema',
      'separate', 'separate_stems', 'demucs', 'ffmpeg_vocal_remover'
    ];

    // 1. Check manifest.pipeline step outputs for completed original stem separation steps
    if (manifest && Array.isArray(manifest.pipeline)) {
      for (let i = manifest.pipeline.length - 1; i >= 0; i--) {
        const step = manifest.pipeline[i];
        const mod = (step?.moduleId || '').toLowerCase();
        const isSepStep = stemSeparationMods.includes(mod) || mod.includes('roformer') || mod.includes('demucs') || mod.startsWith('uvr_mdx');
        if (!isSepStep) continue;
        if (step.outputFiles && Array.isArray(step.outputFiles)) {
          for (const file of step.outputFiles) {
            if (file && file.path && fs.existsSync(file.path) && fs.statSync(file.path).size > 1000) {
              if (isExcluded(file.path)) continue;
              const lowerName = path.basename(file.path).toLowerCase();
              if (
                file.type === 'vocals' ||
                ((lowerName.includes('vocal') || lowerName.includes('voc_')) && lowerName.endsWith('.wav'))
              ) {
                return file.path;
              }
            }
          }
        }
      }
    }

    if (options.strictStepOnly && manifest && Array.isArray(manifest.pipeline)) {
      return null;
    }

    // 2. Check manifest.sourceFiles.originalVocals (НЕ originalAudio!)
    if (manifest && manifest.sourceFiles) {
      const sources = [
        manifest.sourceFiles.originalVocals?.path,
        manifest.sourceFiles.vocals?.path
      ].filter(Boolean);

      for (const sPath of sources) {
        if (fs.existsSync(sPath) && fs.statSync(sPath).size > 1000 && !isExcluded(sPath)) {
          const lowerName = path.basename(sPath).toLowerCase();
          if (lowerName.includes('vocal')) {
            return sPath;
          }
        }
      }
    }

    // 3. Scan candidate directories for separated vocal stem files
    const expandedDirs = [...validDirs];
    for (const dirPath of validDirs) {
      if (!dirPath || !fs.existsSync(dirPath)) continue;
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const fullSub = path.join(dirPath, entry.name);
            if (!expandedDirs.includes(fullSub)) {
              expandedDirs.push(fullSub);
            }
          }
        }
      } catch (e) {}
    }

    const candidateFilenames = [
      'original_vocals.wav',
      'original_vocal.wav',
      'orig_vocals.wav',
      'bs_roformer_original_vocals.wav',
      'htdemucs_original_vocals.wav',
      'uvr_original_vocals.wav',
      'stem_original_vocals.wav',
      'vocals.wav'
    ];

    const isOriginalVocalFile = (filename) => {
      const lower = filename.toLowerCase();
      if (!lower.endsWith('.wav')) return false;
      if (this.isUnseparatedOriginalAudio(lower)) return false;
      const excludedKeywords = [
        'matched', 'dub', 'our_', 'voices_master', 'combined', 'ducked', 'master',
        'final', 'no_vocal', 'instrumental', '_inst', '_me.wav', 'bgm', 'fix', 'norm', 'dubber',
        '00_original_audio', 'original_audio'
      ];
      if (excludedKeywords.some(k => lower.includes(k))) return false;

      return (
        lower.includes('vocal') ||
        candidateFilenames.includes(lower)
      );
    };

    for (const dirPath of expandedDirs) {
      if (!dirPath || !fs.existsSync(dirPath)) continue;

      for (const name of candidateFilenames) {
        const fullPath = path.join(dirPath, name);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).size > 1000 && !isExcluded(fullPath)) {
          return fullPath;
        }
      }

      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile()) {
            const fullPath = path.join(dirPath, entry.name);
            if (isOriginalVocalFile(entry.name) && !isExcluded(fullPath) && fs.statSync(fullPath).size > 1000) {
              return fullPath;
            }
          }
        }
      } catch (e) {
        log.warn('[AudioAnalysisService] Error scanning directory for original vocals:', e.message);
      }
    }

    if (options.strict) {
      throw new Error(
        '❌ Ошибка [acoustic_matched]: Оригинальное аудио из видео НЕ было разделено на стемы (вокал и фон)!\n' +
        'Модуль наложения эффектов принимает на вход ИСКЛЮЧИТЕЛЬНО разделенную вокальную дорожку оригинала (01_vocals.wav) и склеенную дорожку всех голосов.\n' +
        'Сначала выполните шаг разделения оригинального аудио из видео (Demucs / UVR / RoFormer / FFmpeg).'
      );
    }

    return null;
  }

  /**
   * Быстрое in-place Radix-2 FFT (N=1024) для спектрального анализа фреймов
   */
  static _computeFftMagnitude1024(signalSlice, offset = 0) {
    const N = 1024;
    if (!this._fftWindow1024) {
      this._fftWindow1024 = new Float32Array(N);
      this._fftBitRev1024 = new Uint16Array(N);
      for (let i = 0; i < N; i++) {
        this._fftWindow1024[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
        let x = i;
        let y = 0;
        for (let b = 0; b < 10; b++) {
          y = (y << 1) | (x & 1);
          x >>= 1;
        }
        this._fftBitRev1024[i] = y;
      }
      this._fftCosTable = new Float32Array(N / 2);
      this._fftSinTable = new Float32Array(N / 2);
      for (let i = 0; i < N / 2; i++) {
        const angle = (-2 * Math.PI * i) / N;
        this._fftCosTable[i] = Math.cos(angle);
        this._fftSinTable[i] = Math.sin(angle);
      }
    }

    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    const win = this._fftWindow1024;
    const rev = this._fftBitRev1024;
    const avail = signalSlice.length - offset;

    for (let i = 0; i < N; i++) {
      const sample = i < avail ? signalSlice[offset + i] : 0;
      real[rev[i]] = sample * win[i];
    }

    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1;
      const step = N / size;
      for (let i = 0; i < N; i += size) {
        for (let j = 0; j < half; j++) {
          const k = j * step;
          const wr = this._fftCosTable[k];
          const wi = this._fftSinTable[k];
          const evenIdx = i + j;
          const oddIdx = i + j + half;
          const tr = wr * real[oddIdx] - wi * imag[oddIdx];
          const ti = wr * imag[oddIdx] + wi * real[oddIdx];
          real[oddIdx] = real[evenIdx] - tr;
          imag[oddIdx] = imag[evenIdx] - ti;
          real[evenIdx] += tr;
          imag[evenIdx] += ti;
        }
      }
    }

    const mag = new Float32Array(N >> 1);
    const invN = 2.0 / N;
    for (let k = 0; k < (N >> 1); k++) {
      mag[k] = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]) * invN;
    }
    return mag;
  }

  /**
   * Полный покадровый (шаг 100 мс) физический DSP-анализ аудиофайла:
   * - Измерение RMS, Peak, Crest Factor, LUFS в каждый момент времени
   * - Измерение 6-полосного спектра (SubBass, Bass, LowMids, Presence, HighMids, Air) через 1024-pt FFT
   * - Детекция частот среза фильтров: High-Pass (рация/телефон/отдаление) и Low-Pass (из-за стены/шлем/под водой)
   * - Детекция эха/дилэя через автокорреляцию 10мс огибающей (60–420 мс)
   * - Детекция реверберации (RT60 по спаду хвостов Шрёдера, DRR, Room Size, Damping, Wet/Dry)
   * - Детекция стерео-панорамы (L/R) и стерео-ширины (Mid/Side)
   */
  static async _analyzeAudioFramesPhysical(audioPath, onProgress = null) {
    const analysisSr = 24000; // Покрывает до 12 кГц (все вокальные форманты, сибилянты и фильтры)
    const frameSamples = 2400; // 100 мс на фрейм (10 Гц сетка автоматизации)
    const bytesPerFrame = frameSamples * 2 * 2; // stereo * int16 (9600 байт)
    const binHz = analysisSr / 1024; // 23.4375 Hz/bin

    const frames = [];
    const subEnvHistory = []; // 10ms энергетическая огибающая для автокорреляции эха
    let prevSpectrum = null;

    await new Promise((resolve, reject) => {
      let leftover = Buffer.alloc(0);
      let frameIndex = 0;

      const cmd = ffmpeg(audioPath)
        .noVideo()
        .audioChannels(2)
        .audioFrequency(analysisSr)
        .audioCodec('pcm_s16le')
        .format('s16le')
        .on('start', () => {
          if (cmd.ffmpegProc) {
            trackProcess(cmd.ffmpegProc, `AcousticFrameAnalyze [${path.basename(audioPath)}]`);
          }
        })
        .on('error', (err) => reject(err));

      const stream = cmd.pipe();

      const processFrameBuffer = (buf, fIdx) => {
        const left = new Float32Array(frameSamples);
        const right = new Float32Array(frameSamples);
        const mid = new Float32Array(frameSamples);

        let sumL = 0;
        let sumR = 0;
        let sumMid = 0;
        let sumSide = 0;
        let peak = 0;

        // 10ms sub-windows (240 samples each) for Echo/Delay autocorrelation
        const subStepSamples = 240;
        for (let s = 0; s < 10; s++) {
          let subSum = 0;
          const baseIdx = s * subStepSamples;
          for (let i = 0; i < subStepSamples; i++) {
            const sampleIdx = baseIdx + i;
            const byteOffset = sampleIdx * 4;
            const l = buf.readInt16LE(byteOffset) / 32768.0;
            const r = buf.readInt16LE(byteOffset + 2) / 32768.0;
            const m = 0.5 * (l + r);
            const sd = 0.5 * (l - r);

            left[sampleIdx] = l;
            right[sampleIdx] = r;
            mid[sampleIdx] = m;

            sumL += l * l;
            sumR += r * r;
            sumMid += m * m;
            sumSide += sd * sd;
            subSum += m * m;

            const absMax = Math.max(Math.abs(l), Math.abs(r));
            if (absMax > peak) peak = absMax;
          }
          subEnvHistory.push(Math.sqrt(subSum / subStepSamples));
        }

        const rmsL = Math.sqrt(sumL / frameSamples);
        const rmsR = Math.sqrt(sumR / frameSamples);
        const rmsMid = Math.sqrt(sumMid / frameSamples);
        const rmsSide = Math.sqrt(sumSide / frameSamples);
        const rmsTotal = Math.sqrt(0.5 * (sumL + sumR) / frameSamples);

        const rmsDb = Number((20 * Math.log10(Math.max(rmsTotal, 1e-5))).toFixed(2));
        const peakDb = Number((20 * Math.log10(Math.max(peak, 1e-5))).toFixed(2));
        const crestFactorDb = Number(Math.max(0, peakDb - rmsDb).toFixed(2));

        // Панорама (-1.0 Left .. +1.0 Right) и стерео-ширина (Side/Mid)
        const panPosition = Number(((rmsR - rmsL) / (rmsR + rmsL + 1e-6)).toFixed(3));
        const sideToMidRatio = Number(Math.min(2.0, rmsSide / (rmsMid + 1e-6)).toFixed(3));

        // Спектральный анализ (усреднение двух 1024-точечных окон внутри 2400 сэмплов)
        const mag1 = this._computeFftMagnitude1024(mid, 0);
        const mag2 = this._computeFftMagnitude1024(mid, 1152);
        const mag = new Float32Array(512);
        for (let k = 0; k < 512; k++) {
          mag[k] = 0.5 * (mag1[k] + mag2[k]);
        }

        const bandEnergyDb = (binStart, binEnd) => {
          let sumSq = 0;
          const count = Math.max(1, binEnd - binStart + 1);
          for (let k = binStart; k <= binEnd && k < 512; k++) {
            sumSq += mag[k] * mag[k];
          }
          return Number((10 * Math.log10(Math.max(sumSq / count, 1e-12))).toFixed(2));
        };

        // 6 полос: SubBass (23-100Hz), Bass (100-280Hz), LowMids (280-900Hz), Presence (900-3200Hz), HighMids (3200-6500Hz), Air (6500-12000Hz)
        const subBassDb = bandEnergyDb(1, 4);
        const bassDb = bandEnergyDb(5, 12);
        const lowMidsDb = bandEnergyDb(13, 38);
        const presenceDb = bandEnergyDb(39, 136);
        const highMidsDb = bandEnergyDb(137, 277);
        const airDb = bandEnergyDb(278, 511);

        // Spectral Centroid & 90% Spectral Rolloff
        let weightedFreqSum = 0;
        let totalMagSum = 0;
        let totalPowerSum = 0;
        for (let k = 1; k < 512; k++) {
          const f = k * binHz;
          weightedFreqSum += f * mag[k];
          totalMagSum += mag[k];
          totalPowerSum += mag[k] * mag[k];
        }
        const spectralCentroidHz = totalMagSum > 1e-7 ? Math.round(weightedFreqSum / totalMagSum) : 300;

        let cumPower = 0;
        let rollOff90Hz = 10000;
        const targetPower90 = totalPowerSum * 0.90;
        for (let k = 1; k < 512; k++) {
          cumPower += mag[k] * mag[k];
          if (cumPower >= targetPower90) {
            rollOff90Hz = Math.round(k * binHz);
            break;
          }
        }

        // Spectral Flux (размытие транзиентов реверберацией снижает флюкс)
        let spectralFlux = 0;
        if (prevSpectrum && totalMagSum > 1e-6) {
          let diffSum = 0;
          for (let k = 4; k < 300; k++) {
            const d = (mag[k] / totalMagSum) - prevSpectrum[k];
            diffSum += d * d;
          }
          spectralFlux = Math.sqrt(diffSum);
        }
        prevSpectrum = new Float32Array(300);
        if (totalMagSum > 1e-6) {
          for (let k = 4; k < 300; k++) prevSpectrum[k] = mag[k] / totalMagSum;
        }

        // Spectral Tilt (наклон спектра дБ/октаву от ~200 Гц до ~6400 Гц, 5 октав)
        const lowRef = 0.5 * (bassDb + lowMidsDb);
        const highRef = 0.5 * (highMidsDb + airDb);
        const spectralTiltDbPerOct = Number(((highRef - lowRef) / 4.5).toFixed(2));

        // Определение реальных частот среза фильтров (High-Pass и Low-Pass)
        const coreMidPeakDb = Math.max(lowMidsDb, presenceDb);
        let effectiveHighpassHz = 75;
        if (rmsDb > -48) {
          const bassDrop = presenceDb - bassDb;
          const subDrop = presenceDb - subBassDb;
          if (bassDrop > 14 && presenceDb - lowMidsDb > 4) {
            effectiveHighpassHz = Math.min(680, Math.round(280 + (bassDrop - 14) * 18));
          } else if (bassDrop > 8 || subDrop > 22) {
            effectiveHighpassHz = Math.min(320, Math.round(90 + Math.max(0, bassDrop - 6) * 14));
          }
        }

        let effectiveLowpassHz = 16500;
        if (rmsDb > -48) {
          const coreOrBassPeakDb = Math.max(bassDb, lowMidsDb, presenceDb);
          const highDrop = coreOrBassPeakDb - highMidsDb;
          const airDrop = coreOrBassPeakDb - airDb;
          const presDrop = Math.max(bassDb, lowMidsDb) - presenceDb;
          if (rollOff90Hz < 1200 && presDrop > 8) {
            effectiveLowpassHz = Math.max(380, Math.min(1200, Math.round(rollOff90Hz * 1.15)));
          } else if (rollOff90Hz < 3800 && highDrop > 11) {
            effectiveLowpassHz = Math.max(1100, Math.min(3800, rollOff90Hz));
          } else if (rollOff90Hz < 6500 && airDrop > 16) {
            effectiveLowpassHz = Math.max(3200, Math.min(7500, rollOff90Hz));
          }
        }

        // Оценка перегруза / мегафонной сатурации
        let saturationDrive = 0;
        if (rmsDb > -36 && crestFactorDb < 8.5 && presenceDb > lowMidsDb + 2) {
          saturationDrive = Number(Math.min(0.75, (8.5 - crestFactorDb) * 0.12).toFixed(2));
        }

        // Центрированная автокорреляция огибающей для поиска дискретного Эха / Дилэя (лаги 8..40 = 80..400 мс)
        let echoDelayMs = 0;
        let echoStrength = 0;
        const envLen = subEnvHistory.length;
        if (envLen >= 50 && rmsTotal > 0.005) {
          const winLen = 45;
          const startEnv = envLen - winLen;
          let meanEnv = 0;
          for (let i = 0; i < winLen; i++) {
            meanEnv += subEnvHistory[startEnv + i];
          }
          meanEnv /= winLen;

          const centered = new Float32Array(winLen);
          let zeroLag = 0;
          for (let i = 0; i < winLen; i++) {
            const c = subEnvHistory[startEnv + i] - meanEnv;
            centered[i] = c;
            zeroLag += c * c;
          }
          // Требуем реальную модуляцию огибающей (не плоский синус)
          if (zeroLag > winLen * 1e-4) {
            const corrs = new Float32Array(42);
            for (let lag = 7; lag <= 40; lag++) {
              let cross = 0;
              for (let i = lag; i < winLen; i++) {
                cross += centered[i] * centered[i - lag];
              }
              corrs[lag] = cross / zeroLag;
            }
            let bestCorr = 0;
            let bestLag = 0;
            for (let lag = 9; lag <= 38; lag++) {
              const c = corrs[lag];
              if (c > 0.25 && c > bestCorr && c > corrs[lag - 2] + 0.03 && c >= corrs[lag + 2]) {
                bestCorr = c;
                bestLag = lag;
              }
            }
            if (bestLag >= 9 && bestCorr > 0.25) {
              echoDelayMs = bestLag * 10;
              echoStrength = Number(Math.min(0.55, (bestCorr - 0.18) * 0.85).toFixed(3));
            }
          }
        }

        frames.push({
          frameIndex: fIdx,
          timeSec: Number((fIdx * 0.10).toFixed(2)),
          rmsDb,
          peakDb,
          crestFactorDb,
          panPosition,
          sideToMidRatio,
          spectralCentroidHz,
          rollOff90Hz,
          spectralTiltDbPerOct,
          effectiveHighpassHz,
          effectiveLowpassHz,
          saturationDrive,
          spectralFlux,
          echoDelayMs,
          echoStrength,
          spectralEnvelope: {
            subBassDb,
            bassDb,
            lowMidsDb,
            presenceDb,
            highMidsDb,
            airDb
          }
        });
      };

      stream.on('data', (chunk) => {
        leftover = Buffer.concat([leftover, chunk]);
        while (leftover.length >= bytesPerFrame) {
          const frameBuf = leftover.subarray(0, bytesPerFrame);
          leftover = leftover.subarray(bytesPerFrame);
          processFrameBuffer(frameBuf, frameIndex++);
        }
      });

      stream.on('end', () => {
        if (leftover.length >= 1024) {
          const padded = Buffer.alloc(bytesPerFrame);
          leftover.copy(padded);
          processFrameBuffer(padded, frameIndex++);
        }
        resolve();
      });

      stream.on('error', (err) => reject(err));
    });

    if (frames.length === 0) {
      throw new Error(`Не удалось декодировать аудиофреймы из файла: ${audioPath}`);
    }

    // Определение адаптивного порога тишины и речевых фреймов (включая глухие фразы «за стеной»)
    const sortedRms = frames.map(f => f.rmsDb).slice().sort((a, b) => a - b);
    const noiseFloorDb = sortedRms[Math.floor(sortedRms.length * 0.15)] ?? -55.0;
    const peakTrackRmsDb = sortedRms[Math.floor(sortedRms.length * 0.92)] ?? -18.0;
    const speechThreshDb = Math.max(noiseFloorDb + 8.5, Math.min(-42.0, peakTrackRmsDb - 22.0));

    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const maxVocalBandDb = Math.max(
        f.spectralEnvelope.bassDb,
        f.spectralEnvelope.lowMidsDb,
        f.spectralEnvelope.presenceDb
      );
      const voiceBandActive = maxVocalBandDb > noiseFloorDb - 6;
      f.isSpeech = f.rmsDb >= speechThreshDb && voiceBandActive;
    }

    // Сглаживание коротких разрывов внутри фраз (<= 200 мс = 2 фрейма)
    for (let i = 1; i < frames.length - 2; i++) {
      if (!frames[i].isSpeech && frames[i - 1].isSpeech && (frames[i + 1].isSpeech || frames[i + 2].isSpeech)) {
        frames[i].isSpeech = true;
      }
    }

    // Расчет физической реверберации (RT60, DRR, Room Size, Wet/Dry, Damping) по спадам энергии (хвостам Шрёдера) и M/S диффузии
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      // Смотрим спад энергии за пиками речи на окне 100..400 мс вперед
      let decayRateDbPerSec = 95.0; // по умолчанию студийный сухой спад
      let hfDecayFaster = 0.55;
      if (i >= 1 && i + 3 < frames.length) {
        const prevDb = frames[i - 1].rmsDb;
        const next1Db = frames[i + 1].rmsDb;
        const next2Db = frames[i + 2].rmsDb;
        const next3Db = frames[i + 3].rmsDb;
        // Если мы на спаде слога или конце фразы
        if (prevDb > speechThreshDb + 4 && next2Db < prevDb - 2.0 && next3Db > noiseFloorDb + 3.0) {
          const dropOver300ms = Math.max(1.5, prevDb - next3Db);
          decayRateDbPerSec = Math.max(14.0, Math.min(160.0, dropOver300ms / 0.30));

          // Сравнение скорости затухания ВЧ (HighMids) и СЧ (LowMids) в хвосте для оценки Damping
          const hfDrop = Math.max(0, frames[i - 1].spectralEnvelope.highMidsDb - frames[i + 2].spectralEnvelope.highMidsDb);
          const mfDrop = Math.max(0.5, frames[i - 1].spectralEnvelope.lowMidsDb - frames[i + 2].spectralEnvelope.lowMidsDb);
          hfDecayFaster = Math.max(0.15, Math.min(0.88, hfDrop / (mfDrop + hfDrop + 0.1)));
        }
      }

      // RT60 = 60 / decayRateDbPerSec
      const rawRt60 = Number(Math.max(0.14, Math.min(3.2, 60.0 / decayRateDbPerSec)).toFixed(2));
      // Вклад стерео-диффузии (Side/Mid) и сглаженности спектрального флюкса
      const stereoDiffusion = Math.min(0.45, f.sideToMidRatio * 0.42);
      const tailFactor = Math.max(0, (rawRt60 - 0.20) / 1.8);

      const wetDry = f.isSpeech || (i > 0 && frames[i - 1].isSpeech)
        ? Number(Math.min(0.62, Math.max(0.02, tailFactor * 0.38 + stereoDiffusion * 0.45)).toFixed(3))
        : 0.0;

      const roomSize = Number(Math.min(0.95, Math.max(0.05, tailFactor * 0.65 + stereoDiffusion * 0.35)).toFixed(2));
      const drrDb = Number(Math.max(2.0, Math.min(24.0, 22.0 - wetDry * 32.0)).toFixed(1));
      const preDelayMs = Math.round(12 + roomSize * 45);

      f.rt60Sec = rawRt60;
      f.wetDryRatio = wetDry;
      f.roomSize = roomSize;
      f.damping = Number(hfDecayFaster.toFixed(2));
      f.drrDb = drrDb;
      f.preDelayMs = preDelayMs;
    }

    // Пофразовая сегментация и классификация наложенных эффектов на каждую фразу
    const phrases = [];
    let inPhrase = false;
    let pStartIdx = 0;

    for (let i = 0; i < frames.length; i++) {
      if (frames[i].isSpeech && !inPhrase) {
        inPhrase = true;
        pStartIdx = i;
      } else if ((!frames[i].isSpeech || i === frames.length - 1) && inPhrase) {
        const endIdx = frames[i].isSpeech ? i : i - 1;
        inPhrase = false;
        if (endIdx - pStartIdx + 1 >= 2) {
          phrases.push({ startIdx: pStartIdx, endIdx });
        }
      }
    }

    return {
      frames,
      phrases,
      noiseFloorDb: Number(noiseFloorDb.toFixed(2)),
      speechThreshDb: Number(speechThreshDb.toFixed(2)),
      durationSec: Number((frames.length * 0.10).toFixed(2))
    };
  }

  /**
   * Классификация эффектов, наложенных на конкретную фразу оригинала
   */
  static _classifyPhraseEffects(phraseFrames, postTailFrames = [], globalMedianRms = -20.0) {
    const n = Math.max(1, phraseFrames.length);
    const avg = (fn) => phraseFrames.reduce((acc, f) => acc + fn(f), 0) / n;

    const avgRmsDb = Number(avg(f => f.rmsDb).toFixed(2));
    const maxPeakDb = Number(Math.max(...phraseFrames.map(f => f.peakDb)).toFixed(2));
    const avgCrestDb = Number(avg(f => f.crestFactorDb).toFixed(2));
    const avgHpHz = Math.round(avg(f => f.effectiveHighpassHz));
    const avgLpHz = Math.round(avg(f => f.effectiveLowpassHz));
    const avgCentroidHz = Math.round(avg(f => f.spectralCentroidHz));
    const avgTilt = Number(avg(f => f.spectralTiltDbPerOct).toFixed(2));
    const avgPan = Number(avg(f => f.panPosition).toFixed(2));
    const avgStereoWidth = Number(avg(f => f.sideToMidRatio).toFixed(2));
    const avgSatDrive = Number(avg(f => f.saturationDrive).toFixed(2));

    // Учитываем и хвост сразу после фразы (postTailFrames) для точного замера реверба и эха
    const allReverbFrames = postTailFrames.length > 0 ? [...phraseFrames, ...postTailFrames] : phraseFrames;
    const rn = Math.max(1, allReverbFrames.length);
    const avgWet = Number((allReverbFrames.reduce((a, f) => a + f.wetDryRatio, 0) / rn).toFixed(3));
    const maxWet = Number(Math.max(...allReverbFrames.map(f => f.wetDryRatio)).toFixed(3));
    const effectiveWet = Number((0.6 * avgWet + 0.4 * maxWet).toFixed(3));
    const avgRoomSize = Number((allReverbFrames.reduce((a, f) => a + f.roomSize, 0) / rn).toFixed(2));
    const avgRt60 = Number((allReverbFrames.reduce((a, f) => a + f.rt60Sec, 0) / rn).toFixed(2));
    const avgDamping = Number((allReverbFrames.reduce((a, f) => a + f.damping, 0) / rn).toFixed(2));
    const avgDrrDb = Number((allReverbFrames.reduce((a, f) => a + f.drrDb, 0) / rn).toFixed(1));
    const avgPreDelayMs = Math.round(allReverbFrames.reduce((a, f) => a + f.preDelayMs, 0) / rn);

    // Эхо / Дилэй
    const echoFrames = allReverbFrames.filter(f => f.echoDelayMs > 0 && f.echoStrength > 0.08);
    const echoDetected = echoFrames.length >= Math.max(1, Math.floor(allReverbFrames.length * 0.25));
    const echoDelayMs = echoDetected
      ? Math.round(echoFrames.reduce((a, f) => a + f.echoDelayMs, 0) / echoFrames.length)
      : 0;
    const echoWet = echoDetected
      ? Number((echoFrames.reduce((a, f) => a + f.echoStrength, 0) / echoFrames.length).toFixed(2))
      : 0;
    const echoFeedback = echoDetected ? Number(Math.min(0.55, 0.20 + echoWet * 0.65).toFixed(2)) : 0;

    const spectralEnvelope = {
      subBassDb: Number(avg(f => f.spectralEnvelope.subBassDb).toFixed(2)),
      bassDb: Number(avg(f => f.spectralEnvelope.bassDb).toFixed(2)),
      lowMidsDb: Number(avg(f => f.spectralEnvelope.lowMidsDb).toFixed(2)),
      presenceDb: Number(avg(f => f.spectralEnvelope.presenceDb).toFixed(2)),
      highMidsDb: Number(avg(f => f.spectralEnvelope.highMidsDb).toFixed(2)),
      airDb: Number(avg(f => f.spectralEnvelope.airDb).toFixed(2))
    };

    // Детекция всех наложенных эффектов на фразу
    const activeEffects = [];
    let primaryEffectType = 'clean';
    let primaryEffectLabel = '🎙 Сухой голос (Ближний план)';
    let reverbCategory = 'Сухая студия';

    // 1. Проверка полосовых фильтров (Телефон / Рация / Громкоговоритель / Из-за стены / Под водой)
    const isTelephoneBandpass = avgHpHz >= 250 && avgLpHz <= 4600 && (spectralEnvelope.presenceDb - spectralEnvelope.bassDb > 9);
    const isMuffledLowpass = avgLpHz <= 3500 && avgHpHz < 240 && (spectralEnvelope.lowMidsDb - spectralEnvelope.highMidsDb > 10);
    const isDistantVoice = avgHpHz >= 190 && avgRmsDb < globalMedianRms - 4.5 && effectiveWet >= 0.14;

    if (isTelephoneBandpass) {
      activeEffects.push(`📞 Телефон / Рация (${avgHpHz}–${avgLpHz} Гц)`);
      primaryEffectType = 'telephone_radio';
      primaryEffectLabel = `📞 Телефон / Рация (Bandpass ${avgHpHz}–${avgLpHz} Гц)`;
    } else if (isMuffledLowpass) {
      activeEffects.push(`🧱 Из-за стены / Приглушенно (LPF ${avgLpHz} Гц)`);
      primaryEffectType = 'muffled_wall';
      primaryEffectLabel = `🧱 Из-за стены / В шлеме (LPF ${avgLpHz} Гц)`;
    } else if (isDistantVoice) {
      activeEffects.push(`📢 Отдаленный план (HPF ${avgHpHz} Гц)`);
      primaryEffectType = 'distant_voice';
      primaryEffectLabel = `📢 Отдаленный голос (${avgHpHz} Гц, Wet ${Math.round(effectiveWet * 100)}%)`;
    }

    // 2. Проверка Реверберации и Пространства
    if (effectiveWet >= 0.24 || avgRoomSize >= 0.52 || avgRt60 >= 1.15) {
      reverbCategory = 'Большой зал / Пещера';
      activeEffects.push(`🏛 Зал / Пещера (Wet ${Math.round(effectiveWet * 100)}%, RT60 ${avgRt60}с)`);
      if (primaryEffectType === 'clean') {
        primaryEffectType = 'hall_cave_reverb';
        primaryEffectLabel = `🏛 Большой зал / Пещера (Wet ${Math.round(effectiveWet * 100)}%, RT60 ${avgRt60}с)`;
      }
    } else if (effectiveWet >= 0.10 || avgRoomSize >= 0.22 || avgRt60 >= 0.48) {
      reverbCategory = 'Комната / Интерьер';
      activeEffects.push(`🏠 Комната (Wet ${Math.round(effectiveWet * 100)}%, Room ${Math.round(avgRoomSize * 100)}%)`);
      if (primaryEffectType === 'clean') {
        primaryEffectType = 'room_reverb';
        primaryEffectLabel = `🏠 Комната / Интерьер (Wet ${Math.round(effectiveWet * 100)}%)`;
      }
    } else {
      reverbCategory = 'Сухая студия';
    }

    // 3. Проверка Эха / Дилэя (Флешбэк / Мысли / Каньон)
    if (echoDetected && echoDelayMs >= 80) {
      activeEffects.push(`🌀 Эхо / Дилэй (${echoDelayMs} мс, ${Math.round(echoWet * 100)}%)`);
      if (primaryEffectType === 'clean' || primaryEffectType === 'room_reverb') {
        primaryEffectType = 'echo_delay';
        primaryEffectLabel = `🌀 Эхо / Флешбэк (${echoDelayMs} мс, Wet ${Math.round(echoWet * 100)}%)`;
      }
    }

    // 4. Проверка Стерео-панорамы и Ширины (Хорус / Даблинг / Телепатия)
    if (Math.abs(avgPan) >= 0.18) {
      const dir = avgPan < 0 ? `L${Math.round(Math.abs(avgPan) * 100)}%` : `R${Math.round(avgPan * 100)}%`;
      activeEffects.push(`↔️ Панорама ${dir}`);
    }
    if (avgStereoWidth >= 0.38) {
      activeEffects.push(`🌌 Стерео-расширение / Даблинг (${Math.round(avgStereoWidth * 100)}%)`);
      if (primaryEffectType === 'clean') {
        primaryEffectType = 'stereo_chorus';
        primaryEffectLabel = `🌌 Стерео-эффект / Внутренний голос`;
      }
    }

    // 5. Проверка перегруза / крика / шепота
    if (avgSatDrive >= 0.18) {
      activeEffects.push(`🔥 Сатурация / Мегафон (${Math.round(avgSatDrive * 100)}%)`);
    }
    if (avgRmsDb <= globalMedianRms - 8.0 && primaryEffectType === 'clean') {
      activeEffects.push(`🤫 Шепот / Тихий план (${avgRmsDb} dB)`);
      primaryEffectType = 'whisper_close';
      primaryEffectLabel = `🤫 Шепот / Интимный план (${avgRmsDb} dB)`;
    }

    if (activeEffects.length === 0) {
      activeEffects.push('🎙 Чистый студийный голос');
    }

    return {
      effectType: primaryEffectType,
      effectLabel: primaryEffectLabel,
      activeEffects,
      loudness: {
        targetLufs: Number((avgRmsDb - 1.5).toFixed(2)),
        targetRmsDb: avgRmsDb,
        targetPeakDb: maxPeakDb,
        crestFactorDb: avgCrestDb
      },
      reverb: {
        category: reverbCategory,
        roomSize: avgRoomSize,
        damping: avgDamping,
        wetDryRatio: effectiveWet,
        rt60Sec: avgRt60,
        drrDb: avgDrrDb,
        preDelayMs: avgPreDelayMs
      },
      echo: {
        detected: echoDetected,
        delayMs: echoDelayMs,
        feedback: echoFeedback,
        wet: echoWet
      },
      eq: {
        effectiveHighpassHz: avgHpHz,
        effectiveLowpassHz: avgLpHz,
        spectralCentroidHz: avgCentroidHz,
        spectralTiltDbPerOct: avgTilt,
        spectralEnvelope
      },
      spatial: {
        panPosition: avgPan,
        stereoWidth: avgStereoWidth,
        saturationDrive: avgSatDrive
      }
    };
  }

  /**
   * АНАЛИТИЧЕСКИЙ МОДУЛЬ: Полный пофразовый и покадровый анализ эффектов дорожки голосов оригинала
   * Принимает НА ВХОД ИСКЛЮЧИТЕЛЬНО РАЗДЕЛЕННУЮ ДОРОЖКУ ГОЛОСОВ ОРИГИНАЛА.
   */
  static async analyzeOriginalAcousticSnapshots(audioPath, options = {}, onProgress = null) {
    if (!audioPath || !fs.existsSync(audioPath) || fs.statSync(audioPath).size < 1000) {
      log.error(`[AudioAnalysisService] Original separated vocals track missing or invalid: ${audioPath}`);
      throw new Error(
        "❌ Ошибка: Не найдена заранее разделенная дорожка голосов оригинала!\n" +
        "Модуль 'acoustic_matched' принимает на вход ИСКЛЮЧИТЕЛЬНО разделенный вокал оригинала (после Demucs / UVR / RoFormer).\n" +
        "Пожалуйста, сначала выполните шаг разделения оригинального аудио из видео."
      );
    }

    if (this.isUnseparatedOriginalAudio(audioPath)) {
      throw new Error(
        `❌ Ошибка: Указанный файл «${path.basename(audioPath)}» является неразделенной общей дорожкой видео или инструменталом!\n` +
        "Модуль 'acoustic_matched' требует предварительного разделения оригинального аудио на стемы и принимает только чистую дорожку вокала оригинала."
      );
    }

    log.info(`[AudioAnalysisService] Performing full physical effect & automation analysis on original vocals: ${audioPath}`);
    if (onProgress) onProgress({ status: 'analyzing_original_vocals', progress: 10 });

    const overallVolume = await measureVolumeStats(audioPath);
    if (onProgress) onProgress({ status: 'measuring_volume_snapshot', progress: 25 });

    const frameAnalysis = await this._analyzeAudioFramesPhysical(audioPath, onProgress);
    const { frames, phrases, durationSec } = frameAnalysis;

    if (onProgress) onProgress({ status: 'measuring_reverb_snapshot', progress: 65 });

    const speechFrames = frames.filter(f => f.isSpeech);
    const activeFrames = speechFrames.length > 0 ? speechFrames : frames;

    const sortedSpeechRms = activeFrames.map(f => f.rmsDb).slice().sort((a, b) => a - b);
    const medianSpeechRms = sortedSpeechRms[Math.floor(sortedSpeechRms.length * 0.5)] ?? overallVolume.speechRmsDb;

    const formatTimecode = (sec) => {
      const m = Math.floor(sec / 60);
      const s = (sec % 60).toFixed(1).padStart(4, '0');
      return `${String(m).padStart(2, '0')}:${s}`;
    };

    const effectCounts = {
      telephone: 0,
      muffled_wall: 0,
      reverb_space: 0,
      echo_delay: 0,
      megaphone_dist: 0,
      stereo_pan: 0,
      stereo_wide: 0,
      whisper_intimate: 0,
      shout_intense: 0,
      clean_studio: 0
    };

    // Построение детальных пофразовых паспортов эффектов
    const phraseSnapshots = phrases.map((p, idx) => {
      const pFrames = frames.slice(p.startIdx, p.endIdx + 1);
      const postTailFrames = frames.slice(p.endIdx + 1, Math.min(frames.length, p.endIdx + 5));
      const startSec = Number((p.startIdx * 0.10).toFixed(2));
      const endSec = Number(((p.endIdx + 1) * 0.10).toFixed(2));
      const duration = Number(Math.max(0.10, endSec - startSec).toFixed(2));

      const classified = this._classifyPhraseEffects(pFrames, postTailFrames, medianSpeechRms);

      // Унифицированные коды эффектов для UI и отчетов
      const detectedEffects = [];
      if (classified.effectType === 'telephone_radio' || (classified.eq.effectiveHighpassHz >= 250 && classified.eq.effectiveLowpassHz <= 4600)) {
        detectedEffects.push('telephone');
      }
      if (classified.effectType === 'muffled_wall' || (classified.eq.effectiveLowpassHz <= 3500 && classified.eq.effectiveHighpassHz < 240)) {
        detectedEffects.push('muffled_wall');
      }
      if (classified.reverb.wetDryRatio >= 0.10 || classified.reverb.roomSize >= 0.22 || classified.reverb.rt60Sec >= 0.48) {
        detectedEffects.push('reverb_space');
      }
      if (classified.echo.detected && classified.echo.delayMs >= 80) {
        detectedEffects.push('echo_delay');
      }
      if (classified.spatial.saturationDrive >= 0.18) {
        detectedEffects.push('megaphone_dist');
      }
      if (Math.abs(classified.spatial.panPosition) >= 0.16) {
        detectedEffects.push('stereo_pan');
      }
      if (classified.spatial.stereoWidth >= 0.36) {
        detectedEffects.push('stereo_wide');
      }
      if (classified.effectType === 'whisper_close') {
        detectedEffects.push('whisper_intimate');
      }
      if (classified.loudness.targetRmsDb >= medianSpeechRms + 5.5) {
        detectedEffects.push('shout_intense');
      }
      if (detectedEffects.length === 0) {
        detectedEffects.push('clean_studio');
      }

      for (const eff of detectedEffects) {
        if (effectCounts[eff] !== undefined) effectCounts[eff]++;
      }

      return {
        index: idx + 1,
        phraseIndex: idx + 1,
        startSec,
        endSec,
        startFormatted: formatTimecode(startSec),
        endFormatted: formatTimecode(endSec),
        durationSec: duration,
        effectType: classified.effectType,
        effectLabel: classified.effectLabel,
        activeEffects: classified.activeEffects,
        detectedEffects,
        detectedEffectLabels: classified.activeEffects,
        loudnessLufs: classified.loudness.targetLufs,
        hpfCutoffHz: classified.eq.effectiveHighpassHz,
        lpfCutoffHz: classified.eq.effectiveLowpassHz,
        reverbRt60Sec: classified.reverb.rt60Sec,
        reverbWetMix: classified.reverb.wetDryRatio,
        echoDelayMs: classified.echo.delayMs,
        echoWetMix: classified.echo.wet,
        pan: classified.spatial.panPosition,
        stereoWidth: Number((1.0 + classified.spatial.stereoWidth).toFixed(2)),
        saturationDrive: classified.spatial.saturationDrive,
        loudness: classified.loudness,
        reverb: classified.reverb,
        echo: classified.echo,
        eq: classified.eq,
        spatial: classified.spatial
      };
    });

    if (onProgress) onProgress({ status: 'measuring_eq_snapshot', progress: 85 });

    // Построение непрерывных кривых времени (100 мс шаг)
    const loudnessTimeline = frames.map(f => ({
      timeSec: f.timeSec,
      lufs: f.isSpeech ? Number((f.rmsDb - 1.5).toFixed(2)) : -60.0,
      rmsDb: f.rmsDb,
      peakDb: f.peakDb,
      crestFactorDb: f.crestFactorDb,
      isSpeech: f.isSpeech
    }));

    const reverbTimeline = frames.map(f => ({
      timeSec: f.timeSec,
      reverbIntensity: f.wetDryRatio,
      roomSize: f.roomSize,
      rt60Sec: f.rt60Sec,
      damping: f.damping,
      drrDb: f.drrDb,
      preDelayMs: f.preDelayMs,
      echoDelayMs: f.echoDelayMs,
      echoWet: f.echoStrength
    }));

    const eqTimeline = frames.map(f => ({
      timeSec: f.timeSec,
      spectralEnvelope: f.spectralEnvelope,
      spectralCentroidHz: f.spectralCentroidHz,
      spectralTiltDbPerOct: f.spectralTiltDbPerOct,
      effectiveHighpassHz: f.effectiveHighpassHz,
      effectiveLowpassHz: f.effectiveLowpassHz,
      panPosition: f.panPosition,
      stereoWidth: f.sideToMidRatio,
      saturationDrive: f.saturationDrive
    }));

    // Глобальная сводка по фразам и эффектам
    const effectSummary = {
      totalPhrases: phraseSnapshots.length,
      cleanPhrases: phraseSnapshots.filter(p => p.effectType === 'clean').length,
      roomReverbPhrases: phraseSnapshots.filter(p => p.effectType === 'room_reverb').length,
      hallCavePhrases: phraseSnapshots.filter(p => p.effectType === 'hall_cave_reverb').length,
      echoDelayPhrases: phraseSnapshots.filter(p => p.effectType === 'echo_delay' || p.echo.detected).length,
      telephoneRadioPhrases: phraseSnapshots.filter(p => p.effectType === 'telephone_radio').length,
      muffledWallPhrases: phraseSnapshots.filter(p => p.effectType === 'muffled_wall').length,
      distantPhrases: phraseSnapshots.filter(p => p.effectType === 'distant_voice').length,
      stereoPannedPhrases: phraseSnapshots.filter(p => Math.abs(p.spatial.panPosition) >= 0.18 || p.spatial.stereoWidth >= 0.38).length
    };

    const phrasesWithSpecialEffects = phraseSnapshots.filter(
      p => p.detectedEffects.some(e => e !== 'clean_studio')
    ).length;

    const avgAll = (fn) => activeFrames.reduce((a, f) => a + fn(f), 0) / Math.max(1, activeFrames.length);
    const avgWetDry = Number(avgAll(f => f.wetDryRatio).toFixed(3));
    const avgRoomSize = Number(avgAll(f => f.roomSize).toFixed(2));
    const avgRt60 = Number(avgAll(f => f.rt60Sec).toFixed(2));
    const avgDrrDb = Number(avgAll(f => f.drrDb).toFixed(1));
    const avgCentroid = Math.round(avgAll(f => f.spectralCentroidHz));
    const avgTilt = Number(avgAll(f => f.spectralTiltDbPerOct).toFixed(2));

    const spectralBandsDb = {
      lowCut100Hz: Number(avgAll(f => f.spectralEnvelope.subBassDb).toFixed(1)),
      warmth250Hz: Number(avgAll(f => f.spectralEnvelope.bassDb).toFixed(1)),
      boxiness500Hz: Number(avgAll(f => f.spectralEnvelope.lowMidsDb).toFixed(1)),
      nasal1200Hz: Number(avgAll(f => f.spectralEnvelope.presenceDb).toFixed(1)),
      presence3500Hz: Number(avgAll(f => f.spectralEnvelope.highMidsDb).toFixed(1)),
      air10000Hz: Number(avgAll(f => f.spectralEnvelope.airDb).toFixed(1))
    };

    let overallReverbCategory = 'Сухая студия / Ближний план';
    if (effectSummary.hallCavePhrases > 0 || avgWetDry >= 0.22) {
      overallReverbCategory = 'Переменное пространство (Зал / Комната)';
    } else if (effectSummary.roomReverbPhrases > 0 || avgWetDry >= 0.09) {
      overallReverbCategory = 'Естественная комната / Интерьер';
    }

    const acousticProfile = {
      version: '2.0.0',
      analyzedAt: new Date().toISOString(),
      originalVocalsPath: audioPath,
      durationSec,
      phrasesCount: phraseSnapshots.length,
      framesCount: frames.length,
      overallStats: {
        integratedLufs: overallVolume.integratedLufsDb,
        speechRmsDb: Number(medianSpeechRms.toFixed(2)),
        peakDb: overallVolume.peakDb,
        truePeakDb: overallVolume.peakDb,
        loudnessRangeDb: overallVolume.loudnessRangeDb,
        loudnessRangeLu: overallVolume.loudnessRangeDb,
        activeRatio: Number((activeFrames.length / Math.max(1, frames.length)).toFixed(2)),
        reverbCategory: overallReverbCategory,
        estimatedRoomSize: avgRoomSize,
        wetDryRatio: avgWetDry,
        avgReverbWetMix: avgWetDry,
        rt60Sec: avgRt60,
        avgReverbRt60: avgRt60,
        drrDb: avgDrrDb,
        spectralCentroidHz: avgCentroid,
        spectralTiltDbPerOct: avgTilt,
        spectralBandsDb,
        effectCounts,
        phrasesWithSpecialEffects
      },
      effectSummary,
      snapshots: {
        loudnessTimeline,
        reverbTimeline,
        eqTimeline
      },
      phrases: phraseSnapshots,
      phraseSnapshots
    };

    const profileJsonPath = `${audioPath}.acoustic_profile.json`;
    await fsPromises.writeFile(profileJsonPath, JSON.stringify(acousticProfile, null, 2), 'utf-8').catch(() => {});

    if (onProgress) onProgress({ status: 'completed_original_analysis', progress: 100 });
    log.info(`[AudioAnalysisService] Completed full phrase & timeline effect analysis for ${audioPath} (${phraseSnapshots.length} phrases, ${frames.length} time frames)`);
    return acousticProfile;
  }

  /**
   * Построение непрерывных кривых автоматизации (100 мс шаг) для всех обработчиков эффектов,
   * сопоставляющих каждую фразу и каждый момент времени нашей склеенной дорожки голосов с оригиналом.
   */
  static _buildTimeAlignedAutomationCurves(originalProfile, dubFrameData, options = {}) {
    const loudnessStrength = Math.min(100, Math.max(0, options.loudnessMatchStrength ?? 100)) / 100.0;
    const reverbStrength = Math.min(100, Math.max(0, options.reverbMatchStrength ?? 100)) / 100.0;
    const eqStrength = Math.min(100, Math.max(0, options.eqMatchStrength ?? 100)) / 100.0;
    const targetLufsOffset = Number(options.targetLufsOffset || 0);

    const dubFrames = dubFrameData.frames;
    const dubPhrases = dubFrameData.phrases;
    const origPhrases = originalProfile.phraseSnapshots || [];
    const origLoud = originalProfile.snapshots?.loudnessTimeline || [];
    const origRev = originalProfile.snapshots?.reverbTimeline || [];
    const origEq = originalProfile.snapshots?.eqTimeline || [];

    const totalFrames = dubFrames.length;

    // Вычисляем медианный спектр и RMS нашего дубляжа на речевых участках (эталон сухого микрофона дабберов)
    const dubSpeechFrames = dubFrames.filter(f => f.isSpeech);
    const refDubFrames = dubSpeechFrames.length > 0 ? dubSpeechFrames : dubFrames;
    const avgDub = (fn) => refDubFrames.reduce((a, f) => a + fn(f), 0) / Math.max(1, refDubFrames.length);
    const globalDubRms = avgDub(f => f.rmsDb);

    // Относительный профиль спектра даббера (относительно его собственного СЧ центра)
    const dubRefMid = 0.5 * (avgDub(f => f.spectralEnvelope.lowMidsDb) + avgDub(f => f.spectralEnvelope.presenceDb));
    const globalDubRelSpectrum = {
      subBass: avgDub(f => f.spectralEnvelope.subBassDb) - dubRefMid,
      bass: avgDub(f => f.spectralEnvelope.bassDb) - dubRefMid,
      lowMids: avgDub(f => f.spectralEnvelope.lowMidsDb) - dubRefMid,
      presence: avgDub(f => f.spectralEnvelope.presenceDb) - dubRefMid,
      highMids: avgDub(f => f.spectralEnvelope.highMidsDb) - dubRefMid,
      air: avgDub(f => f.spectralEnvelope.airDb) - dubRefMid
    };

    // Сырые массивы точек автоматизации (шаг 100 мс)
    const gainDbCurve = new Float32Array(totalFrames);
    const hpHzCurve = new Float32Array(totalFrames);
    const lpHzCurve = new Float32Array(totalFrames);
    const eqBassDb = new Float32Array(totalFrames);
    const eqLowMidDb = new Float32Array(totalFrames);
    const eqMidDb = new Float32Array(totalFrames);
    const eqPresenceDb = new Float32Array(totalFrames);
    const eqHighMidDb = new Float32Array(totalFrames);
    const eqAirDb = new Float32Array(totalFrames);
    const reverbWetCurve = new Float32Array(totalFrames);
    const roomSizeCurve = new Float32Array(totalFrames);
    const dampingCurve = new Float32Array(totalFrames);
    const preDelayMsCurve = new Float32Array(totalFrames);
    const echoWetCurve = new Float32Array(totalFrames);
    const echoDelayMsCurve = new Float32Array(totalFrames);
    const echoFeedbackCurve = new Float32Array(totalFrames);
    const panCurve = new Float32Array(totalFrames);
    const stereoWidthCurve = new Float32Array(totalFrames);
    const satDriveCurve = new Float32Array(totalFrames);

    // Инициализируем нейтральными значениями
    for (let k = 0; k < totalFrames; k++) {
      hpHzCurve[k] = 75.0;
      lpHzCurve[k] = 18000.0;
      roomSizeCurve[k] = originalProfile.overallStats?.estimatedRoomSize || 0.18;
      dampingCurve[k] = 0.50;
      preDelayMsCurve[k] = 20.0;
      echoDelayMsCurve[k] = 180.0;
      echoFeedbackCurve[k] = 0.25;
      stereoWidthCurve[k] = 1.0;
    }

    // Сопоставляем каждую фразу нашего дубляжа с фразой (или окном) оригинала
    const matchedPhraseReports = [];

    for (let pIdx = 0; pIdx < dubPhrases.length; pIdx++) {
      const dp = dubPhrases[pIdx];
      const dpStartSec = dp.startIdx * 0.10;
      const dpEndSec = (dp.endIdx + 1) * 0.10;
      const dpMidSec = 0.5 * (dpStartSec + dpEndSec);

      // 1. Ищем все пересекающиеся фразы оригинала или ближайшую фразу в радиусе +-2.0 сек
      let bestOrigPhrase = null;
      let bestOverlap = -Infinity;

      for (const op of origPhrases) {
        const overlapStart = Math.max(dpStartSec, op.startSec);
        const overlapEnd = Math.min(dpEndSec, op.endSec);
        const overlap = overlapEnd - overlapStart;
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestOrigPhrase = op;
        }
      }

      if (!bestOrigPhrase || bestOverlap < -2.0) {
        // Если фраза слишком далеко, ищем ближайшую по центру времени в пределах 2.5с
        let minDist = 2.5;
        for (const op of origPhrases) {
          const opMid = 0.5 * (op.startSec + op.endSec);
          const dist = Math.abs(dpMidSec - opMid);
          if (dist < minDist) {
            minDist = dist;
            bestOrigPhrase = op;
          }
        }
      }

      // Вычисляем среднюю громкость нашей фразы
      const dpFrames = dubFrames.slice(dp.startIdx, dp.endIdx + 1);
      const dpAvgRms = dpFrames.reduce((a, f) => a + f.rmsDb, 0) / Math.max(1, dpFrames.length);
      const dpRefMid = 0.5 * (
        dpFrames.reduce((a, f) => a + f.spectralEnvelope.lowMidsDb, 0) / Math.max(1, dpFrames.length) +
        dpFrames.reduce((a, f) => a + f.spectralEnvelope.presenceDb, 0) / Math.max(1, dpFrames.length)
      );

      // Расширяем зону действия автоматизации фразы на +2 фрейма до и +4 фрейма после (для плавного входа и хвоста)
      const applyStart = Math.max(0, dp.startIdx - 1);
      const applyEnd = Math.min(totalFrames - 1, dp.endIdx + 3);
      const dpSpan = Math.max(1, dp.endIdx - dp.startIdx);

      for (let k = applyStart; k <= applyEnd; k++) {
        // Относительная позиция внутри фразы u in [0, 1]
        const u = Math.max(0, Math.min(1, (k - dp.startIdx) / dpSpan));

        // Находим соответствующий индекс кадра в оригинале (внутри сопоставленной фразы оригинала или по прямому таймингу)
        let origFrameIdx = Math.min(origLoud.length - 1, k);
        if (bestOrigPhrase) {
          const origStartFrame = Math.floor(bestOrigPhrase.startSec * 10);
          const origEndFrame = Math.max(origStartFrame, Math.floor(bestOrigPhrase.endSec * 10) - 1);
          origFrameIdx = Math.min(
            origLoud.length - 1,
            Math.max(0, Math.round(origStartFrame + u * (origEndFrame - origStartFrame)))
          );
        }

        const oL = origLoud[origFrameIdx] || {};
        const oR = origRev[origFrameIdx] || {};
        const oE = origEq[origFrameIdx] || {};
        const dF = dubFrames[k];

        // 1. Автоматизация Громкости (сочетание уровня фразы и микродинамики момента u)
        const targetPhraseRms = bestOrigPhrase ? bestOrigPhrase.loudness.targetRmsDb : (originalProfile.overallStats?.speechRmsDb || -20.0);
        const instantOrigRms = oL.isSpeech && typeof oL.rmsDb === 'number' ? oL.rmsDb : targetPhraseRms;
        const blendedTargetRms = 0.65 * targetPhraseRms + 0.35 * instantOrigRms;
        const blendedDubRms = 0.70 * dpAvgRms + 0.30 * (dF.isSpeech ? dF.rmsDb : dpAvgRms);
        const rawDeltaGain = (blendedTargetRms - blendedDubRms) + targetLufsOffset;
        gainDbCurve[k] = Math.max(-16.0, Math.min(16.0, rawDeltaGain * loudnessStrength));

        // 2. Автоматизация частот среза High-Pass и Low-Pass (Телефон / Рация / Из-за стены / Отдаление)
        const phraseHp = bestOrigPhrase ? bestOrigPhrase.eq.effectiveHighpassHz : 75;
        const frameHp = oE.effectiveHighpassHz || phraseHp;
        const targetHp = Math.max(phraseHp, frameHp);
        hpHzCurve[k] = 75.0 + (targetHp - 75.0) * eqStrength;

        const phraseLp = bestOrigPhrase ? bestOrigPhrase.eq.effectiveLowpassHz : 17500;
        const frameLp = oE.effectiveLowpassHz || phraseLp;
        const targetLp = Math.min(phraseLp, frameLp);
        lpHzCurve[k] = 18000.0 - (18000.0 - targetLp) * eqStrength;

        // 3. Автоматизация 6-полосного Match EQ (разность спектральной формы оригинала и нашей дорожки в момент k)
        const origSpec = (oE.spectralEnvelope && oL.isSpeech) ? oE.spectralEnvelope : (bestOrigPhrase?.eq?.spectralEnvelope || oE.spectralEnvelope);
        if (origSpec) {
          const origRefMid = 0.5 * (origSpec.lowMidsDb + origSpec.presenceDb);
          const dubSpec = dF.isSpeech ? dF.spectralEnvelope : null;
          const curDubRef = dubSpec ? 0.5 * (dubSpec.lowMidsDb + dubSpec.presenceDb) : dpRefMid;

          const relOrigBass = origSpec.bassDb - origRefMid;
          const relOrigLowMid = origSpec.lowMidsDb - origRefMid;
          const relOrigPresence = origSpec.presenceDb - origRefMid;
          const relOrigHighMid = origSpec.highMidsDb - origRefMid;
          const relOrigAir = origSpec.airDb - origRefMid;

          const relDubBass = dubSpec ? (dubSpec.bassDb - curDubRef) : globalDubRelSpectrum.bass;
          const relDubLowMid = dubSpec ? (dubSpec.lowMidsDb - curDubRef) : globalDubRelSpectrum.lowMids;
          const relDubPresence = dubSpec ? (dubSpec.presenceDb - curDubRef) : globalDubRelSpectrum.presence;
          const relDubHighMid = dubSpec ? (dubSpec.highMidsDb - curDubRef) : globalDubRelSpectrum.highMids;
          const relDubAir = dubSpec ? (dubSpec.airDb - curDubRef) : globalDubRelSpectrum.air;

          const clampEq = (v) => Math.max(-11.0, Math.min(11.0, v * eqStrength));
          eqBassDb[k] = clampEq(relOrigBass - relDubBass);
          eqLowMidDb[k] = clampEq(relOrigLowMid - relDubLowMid);
          // Полоса 1200 Гц подчеркивает телефонный/мегафонный резонанс если активен bandpass
          const midResonanceBoost = (targetHp >= 250 && targetLp <= 4600) ? 4.5 : 0.0;
          eqMidDb[k] = clampEq((relOrigPresence - relDubPresence) * 0.6 + midResonanceBoost);
          eqPresenceDb[k] = clampEq(relOrigPresence - relDubPresence);
          eqHighMidDb[k] = clampEq(relOrigHighMid - relDubHighMid);
          eqAirDb[k] = clampEq((relOrigAir - relDubAir) * 0.85);
        }

        // 4. Автоматизация Реверберации (Wet/Dry, Room Size, Damping, Pre-Delay)
        const phraseWet = bestOrigPhrase ? bestOrigPhrase.reverb.wetDryRatio : (originalProfile.overallStats?.wetDryRatio || 0.08);
        const frameWet = typeof oR.reverbIntensity === 'number' ? oR.reverbIntensity : phraseWet;
        const targetWet = Math.max(phraseWet * 0.85, frameWet);
        // Вычитаем собственную комнату даббера, чтобы не перемылить уже гулкий исходник
        const dubOwnWet = dF.wetDryRatio || 0.02;
        const netWet = Math.max(0, targetWet - dubOwnWet * 0.5) * reverbStrength;

        reverbWetCurve[k] = Math.min(0.68, netWet);
        roomSizeCurve[k] = bestOrigPhrase ? bestOrigPhrase.reverb.roomSize : (oR.roomSize || 0.22);
        dampingCurve[k] = bestOrigPhrase ? bestOrigPhrase.reverb.damping : (oR.damping || 0.50);
        preDelayMsCurve[k] = bestOrigPhrase ? bestOrigPhrase.reverb.preDelayMs : (oR.preDelayMs || 20);

        // 5. Автоматизация Эха / Дилэя
        const phraseEchoWet = bestOrigPhrase?.echo?.detected ? bestOrigPhrase.echo.wet : 0;
        const frameEchoWet = oR.echoWet || 0;
        const targetEchoWet = Math.max(phraseEchoWet, frameEchoWet) * reverbStrength;
        echoWetCurve[k] = Math.min(0.50, targetEchoWet);
        if (bestOrigPhrase?.echo?.delayMs > 0) {
          echoDelayMsCurve[k] = bestOrigPhrase.echo.delayMs;
          echoFeedbackCurve[k] = bestOrigPhrase.echo.feedback;
        } else if (oR.echoDelayMs > 0) {
          echoDelayMsCurve[k] = oR.echoDelayMs;
          echoFeedbackCurve[k] = 0.30;
        }

        // 6. Автоматизация Панорамы, Стерео-ширины и Сатурации
        const targetPan = bestOrigPhrase ? bestOrigPhrase.spatial.panPosition : (oE.panPosition || 0);
        panCurve[k] = Math.max(-0.85, Math.min(0.85, targetPan * eqStrength));

        const origWidth = bestOrigPhrase ? bestOrigPhrase.spatial.stereoWidth : (oE.stereoWidth || 0.15);
        stereoWidthCurve[k] = Math.max(0.8, Math.min(2.2, 1.0 + (origWidth - 0.15) * reverbStrength * 1.4));

        const origSat = bestOrigPhrase ? bestOrigPhrase.spatial.saturationDrive : (oE.saturationDrive || 0);
        satDriveCurve[k] = Math.max(0, Math.min(0.75, origSat * eqStrength));
      }

      matchedPhraseReports.push({
        dubPhraseIndex: pIdx + 1,
        startSec: Number(dpStartSec.toFixed(2)),
        endSec: Number(dpEndSec.toFixed(2)),
        matchedOriginalPhraseIndex: bestOrigPhrase ? bestOrigPhrase.phraseIndex : null,
        effectType: bestOrigPhrase ? bestOrigPhrase.effectType : 'clean',
        effectLabel: bestOrigPhrase ? bestOrigPhrase.effectLabel : '🎙 Базовый баланс оригинала',
        activeEffects: bestOrigPhrase ? bestOrigPhrase.activeEffects : ['🎙 Базовый баланс'],
        appliedAutomation: {
          gainDb: Number(gainDbCurve[dp.startIdx].toFixed(2)),
          highpassHz: Math.round(hpHzCurve[dp.startIdx]),
          lowpassHz: Math.round(lpHzCurve[dp.startIdx]),
          reverbWetPct: Math.round(reverbWetCurve[dp.startIdx] * 100),
          roomSizePct: Math.round(roomSizeCurve[dp.startIdx] * 100),
          echoDelayMs: echoWetCurve[dp.startIdx] > 0.04 ? Math.round(echoDelayMsCurve[dp.startIdx]) : 0,
          echoWetPct: Math.round(echoWetCurve[dp.startIdx] * 100),
          pan: Number(panCurve[dp.startIdx].toFixed(2))
        }
      });
    }

    // Сглаживание кривых автоматизации во времени (3-точечное гауссово сглаживание без резких ступенек)
    const smoothCurve = (arr, passes = 2) => {
      let cur = Float32Array.from(arr);
      const next = new Float32Array(arr.length);
      for (let p = 0; p < passes; p++) {
        for (let i = 0; i < cur.length; i++) {
          const prev = cur[Math.max(0, i - 1)];
          const self = cur[i];
          const nxt = cur[Math.min(cur.length - 1, i + 1)];
          next[i] = 0.25 * prev + 0.50 * self + 0.25 * nxt;
        }
        cur.set(next);
      }
      return cur;
    };

    return {
      totalFrames,
      frameStepSec: 0.10,
      gainDbCurve: smoothCurve(gainDbCurve, 2),
      hpHzCurve: smoothCurve(hpHzCurve, 2),
      lpHzCurve: smoothCurve(lpHzCurve, 2),
      eqBassDb: smoothCurve(eqBassDb, 2),
      eqLowMidDb: smoothCurve(eqLowMidDb, 2),
      eqMidDb: smoothCurve(eqMidDb, 2),
      eqPresenceDb: smoothCurve(eqPresenceDb, 2),
      eqHighMidDb: smoothCurve(eqHighMidDb, 2),
      eqAirDb: smoothCurve(eqAirDb, 2),
      reverbWetCurve: smoothCurve(reverbWetCurve, 2),
      roomSizeCurve: smoothCurve(roomSizeCurve, 3),
      dampingCurve: smoothCurve(dampingCurve, 3),
      preDelayMsCurve: smoothCurve(preDelayMsCurve, 3),
      echoWetCurve: smoothCurve(echoWetCurve, 2),
      echoDelayMsCurve,
      echoFeedbackCurve: smoothCurve(echoFeedbackCurve, 2),
      panCurve: smoothCurve(panCurve, 2),
      stereoWidthCurve: smoothCurve(stereoWidthCurve, 2),
      satDriveCurve: smoothCurve(satDriveCurve, 2),
      matchedPhraseReports,
      globalDubRms: Number(globalDubRms.toFixed(2))
    };
  }

  /**
   * Расчет коэффициентов биквадратного фильтра (Direct Form II Transposed)
   */
  static _computeBiquadCoeffs(type, freqHz, sr, q = 0.7071, gainDb = 0.0) {
    const f = Math.max(20.0, Math.min(sr * 0.47, freqHz));
    const w0 = (2.0 * Math.PI * f) / sr;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / (2.0 * Math.max(0.1, q));

    let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

    if (type === 'highpass') {
      b0 = (1 + cosW0) * 0.5;
      b1 = -(1 + cosW0);
      b2 = (1 + cosW0) * 0.5;
      a0 = 1 + alpha;
      a1 = -2 * cosW0;
      a2 = 1 - alpha;
    } else if (type === 'lowpass') {
      b0 = (1 - cosW0) * 0.5;
      b1 = 1 - cosW0;
      b2 = (1 - cosW0) * 0.5;
      a0 = 1 + alpha;
      a1 = -2 * cosW0;
      a2 = 1 - alpha;
    } else if (type === 'peaking') {
      if (Math.abs(gainDb) < 0.05) {
        return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
      }
      const A = Math.pow(10.0, gainDb / 40.0);
      b0 = 1 + alpha * A;
      b1 = -2 * cosW0;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cosW0;
      a2 = 1 - alpha / A;
    } else if (type === 'highshelf') {
      if (Math.abs(gainDb) < 0.05) {
        return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
      }
      const A = Math.pow(10.0, gainDb / 40.0);
      const sqA = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cosW0 + sqA);
      b1 = -2 * A * ((A - 1) + (A + 1) * cosW0);
      b2 = A * ((A + 1) + (A - 1) * cosW0 - sqA);
      a0 = (A + 1) - (A - 1) * cosW0 + sqA;
      a1 = 2 * ((A - 1) - (A + 1) * cosW0);
      a2 = (A + 1) - (A - 1) * cosW0 - sqA;
    }

    const invA0 = 1.0 / a0;
    return {
      b0: b0 * invA0,
      b1: b1 * invA0,
      b2: b2 * invA0,
      a1: a1 * invA0,
      a2: a2 * invA0
    };
  }

  /**
   * Потоковый рендеринг аудиодорожки голосов через процессор кривых автоматизации (48 кГц Stereo):
   * - Автоматизация Gain (громкость каждой фразы и слога)
   * - Автоматизация High-Pass & Low-Pass (эффекты рации, телефона, из-за стены, шлема, отдаления)
   * - Автоматизация 6-полосного динамического Match EQ
   * - Автоматизация гармонической сатурации (мегафон / крик)
   * - Автоматизация стерео-панорамы (L/R) и Mid/Side стерео-ширины
   * - Автоматизация стерео-дилэя / эха с естественным затуханием хвостов в паузах
   * - Автоматизация стерео-ревербератора Шрёдера/Мyрера (8 параллельных comb + 4 каскадных all-pass на канал + pre-delay)
   * - True-Peak Soft Limiter (-0.5 dBFS)
   */
  static async _renderAutomatedDspAudio(inputPath, outputPath, automation, durationSec, onProgress = null) {
    const sr = 48000;
    const frameSamples = 4800; // 100 мс при 48 кГц

    // Состояния биквадратных фильтров (по 8 каскадов на Левый и Правый канал: HPF, LPF, 6 полос EQ)
    const numStages = 8;
    const z1L = new Float64Array(numStages);
    const z2L = new Float64Array(numStages);
    const z1R = new Float64Array(numStages);
    const z2R = new Float64Array(numStages);
    const coeffs = new Array(numStages).fill(null).map(() => ({ b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }));

    // Линия задержки для Эха / Slapback Delay (до 600 мс = 28800 сэмплов)
    const maxEchoSamples = 28800;
    const echoBufL = new Float32Array(maxEchoSamples);
    const echoBufR = new Float32Array(maxEchoSamples);
    let echoWriteIdx = 0;
    let echoLpStateL = 0.0;
    let echoLpStateR = 0.0;

    // Линия Pre-Delay для Ревербератора (до 100 мс = 4800 сэмплов)
    const maxPreDelaySamples = 4800;
    const preDelayBufL = new Float32Array(maxPreDelaySamples);
    const preDelayBufR = new Float32Array(maxPreDelaySamples);
    let preDelayWriteIdx = 0;

    // Стерео-ревербератор Freeverb / Moorer (8 параллельных Comb-фильтров + 4 последовательных Allpass на канал)
    const combTuningsL = [1209, 1291, 1383, 1482, 1545, 1636, 1711, 1782]; // при 48 кГц
    const stereoSpread = 25;
    const combTuningsR = combTuningsL.map(t => t + stereoSpread);

    const combBufsL = combTuningsL.map(len => new Float32Array(len));
    const combBufsR = combTuningsR.map(len => new Float32Array(len));
    const combIdxL = new Int32Array(8);
    const combIdxR = new Int32Array(8);
    const combFilterL = new Float32Array(8);
    const combFilterR = new Float32Array(8);

    const allpassTuningsL = [605, 480, 371, 245];
    const allpassTuningsR = allpassTuningsL.map(t => t + stereoSpread);
    const allpassBufsL = allpassTuningsL.map(len => new Float32Array(len));
    const allpassBufsR = allpassTuningsR.map(len => new Float32Array(len));
    const allpassIdxL = new Int32Array(4);
    const allpassIdxR = new Int32Array(4);

    // Плавные сглаженные параметры внутри аудиопотока
    let curGainLin = 1.0;
    let curWetSend = 0.0;
    let curRoomFeedback = 0.76;
    let curDamp = 0.40;
    let curPreDelaySamples = 960;
    let curEchoSend = 0.0;
    let curEchoDelaySamples = 8640;
    let curEchoFeedback = 0.25;
    let curPan = 0.0;
    let curWidth = 1.0;
    let curSatDrive = 0.0;

    let totalSamplesWritten = 0;
    let globalSampleCounter = 0;

    // Создаем стандартный 44-байтный RIFF WAV заголовок (обновим размер при закрытии файла)
    const createWavHeader = (dataBytes) => {
      const header = Buffer.alloc(44);
      header.write('RIFF', 0);
      header.writeUInt32LE(36 + dataBytes, 4);
      header.write('WAVE', 8);
      header.write('fmt ', 12);
      header.writeUInt32LE(16, 16); // PCM chunk size
      header.writeUInt16LE(1, 20);  // PCM format = 1
      header.writeUInt16LE(2, 22);  // 2 channels (Stereo)
      header.writeUInt32LE(sr, 24); // 48000 Hz
      header.writeUInt32LE(sr * 2 * 2, 28); // Byte rate
      header.writeUInt16LE(4, 32);  // Block align
      header.writeUInt16LE(16, 34); // 16-bit
      header.write('data', 36);
      header.writeUInt32LE(dataBytes, 40);
      return header;
    };

    await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });
    const fileHandle = await fsPromises.open(outputPath, 'w+');
    await fileHandle.write(createWavHeader(0), 0, 44, 0);
    let writePosition = 44;

    const interpCurve = (curve, fPos) => {
      const len = curve.length;
      if (len === 0) return 0;
      const i0 = Math.max(0, Math.min(len - 1, Math.floor(fPos)));
      const i1 = Math.min(len - 1, i0 + 1);
      const frac = fPos - i0;
      return curve[i0] * (1.0 - frac) + curve[i1] * frac;
    };

    try {
      await new Promise((resolve, reject) => {
        let leftover = Buffer.alloc(0);

        const cmd = ffmpeg(inputPath)
          .noVideo()
          .audioChannels(2)
          .audioFrequency(sr)
          .audioCodec('pcm_s16le')
          .format('s16le')
          .on('start', () => {
            if (cmd.ffmpegProc) {
              trackProcess(cmd.ffmpegProc, `AcousticRenderDSP [${path.basename(inputPath)}]`);
            }
          })
          .on('error', (err) => reject(err));

        const stream = cmd.pipe();

        // Обработка чанка сэмплов
        stream.on('data', (chunk) => {
          stream.pause();
          leftover = Buffer.concat([leftover, chunk]);
          const usableBytes = leftover.length - (leftover.length % 4);
          if (usableBytes <= 0) {
            stream.resume();
            return;
          }

          const inBuf = leftover.subarray(0, usableBytes);
          leftover = leftover.subarray(usableBytes);

          const numStereoSamples = usableBytes >> 2;
          const outBuf = Buffer.allocUnsafe(usableBytes);

          for (let s = 0; s < numStereoSamples; s++) {
            // Каждые 64 сэмпла (1.33 мс) обновляем интерполированные значения кривых автоматизации и коэффициенты фильтров
            if ((globalSampleCounter & 63) === 0) {
              const fPos = globalSampleCounter / frameSamples;

              const targetGainDb = interpCurve(automation.gainDbCurve, fPos);
              const targetGainLin = Math.pow(10.0, targetGainDb / 20.0);
              curGainLin = curGainLin * 0.82 + targetGainLin * 0.18;

              const hpHz = interpCurve(automation.hpHzCurve, fPos);
              const lpHz = interpCurve(automation.lpHzCurve, fPos);
              const gBass = interpCurve(automation.eqBassDb, fPos);
              const gLowMid = interpCurve(automation.eqLowMidDb, fPos);
              const gMid = interpCurve(automation.eqMidDb, fPos);
              const gPres = interpCurve(automation.eqPresenceDb, fPos);
              const gHighMid = interpCurve(automation.eqHighMidDb, fPos);
              const gAir = interpCurve(automation.eqAirDb, fPos);

              coeffs[0] = this._computeBiquadCoeffs('highpass', hpHz, sr, 0.7071);
              coeffs[1] = this._computeBiquadCoeffs('lowpass', lpHz, sr, 0.7071);
              coeffs[2] = this._computeBiquadCoeffs('peaking', 130.0, sr, 0.9, gBass);
              coeffs[3] = this._computeBiquadCoeffs('peaking', 420.0, sr, 1.0, gLowMid);
              coeffs[4] = this._computeBiquadCoeffs('peaking', 1200.0, sr, 1.2, gMid);
              coeffs[5] = this._computeBiquadCoeffs('peaking', 2800.0, sr, 1.1, gPres);
              coeffs[6] = this._computeBiquadCoeffs('peaking', 5200.0, sr, 1.2, gHighMid);
              coeffs[7] = this._computeBiquadCoeffs('highshelf', 9000.0, sr, 0.7071, gAir);

              const targetWet = interpCurve(automation.reverbWetCurve, fPos);
              curWetSend = curWetSend * 0.85 + targetWet * 0.15;

              const targetRoom = interpCurve(automation.roomSizeCurve, fPos);
              // В алгоритме Мурера/Freeverb feedback лежит в диапазоне [0.68 .. 0.93]
              const targetFeedback = Math.min(0.93, Math.max(0.65, 0.66 + targetRoom * 0.27));
              curRoomFeedback = curRoomFeedback * 0.90 + targetFeedback * 0.10;

              const targetDamp = interpCurve(automation.dampingCurve, fPos);
              curDamp = curDamp * 0.90 + Math.min(0.82, Math.max(0.12, targetDamp * 0.75)) * 0.10;

              const targetPreDelayMs = interpCurve(automation.preDelayMsCurve, fPos);
              curPreDelaySamples = Math.min(maxPreDelaySamples - 2, Math.max(48, Math.round((targetPreDelayMs / 1000.0) * sr)));

              const targetEchoWet = interpCurve(automation.echoWetCurve, fPos);
              curEchoSend = curEchoSend * 0.85 + targetEchoWet * 0.15;

              const targetEchoMs = interpCurve(automation.echoDelayMsCurve, fPos);
              curEchoDelaySamples = Math.min(maxEchoSamples - 4, Math.max(1920, Math.round((targetEchoMs / 1000.0) * sr)));
              curEchoFeedback = interpCurve(automation.echoFeedbackCurve, fPos);

              curPan = curPan * 0.88 + interpCurve(automation.panCurve, fPos) * 0.12;
              curWidth = curWidth * 0.88 + interpCurve(automation.stereoWidthCurve, fPos) * 0.12;
              curSatDrive = curSatDrive * 0.88 + interpCurve(automation.satDriveCurve, fPos) * 0.12;
            }

            const byteOff = s << 2;
            let xL = (inBuf.readInt16LE(byteOff) / 32768.0) * curGainLin;
            let xR = (inBuf.readInt16LE(byteOff + 2) / 32768.0) * curGainLin;

            // 1. Каскад из 8 автоматизированных биквадратных фильтров (HPF + LPF + 6-Band Match EQ)
            for (let st = 0; st < numStages; st++) {
              const c = coeffs[st];
              const yL = c.b0 * xL + z1L[st];
              z1L[st] = c.b1 * xL - c.a1 * yL + z2L[st];
              z2L[st] = c.b2 * xL - c.a2 * yL;
              xL = yL;

              const yR = c.b0 * xR + z1R[st];
              z1R[st] = c.b1 * xR - c.a1 * yR + z2R[st];
              z2R[st] = c.b2 * xR - c.a2 * yR;
              xR = yR;
            }

            // 2. Автоматизированная сатурация (рация / мегафон / крик)
            if (curSatDrive > 0.03) {
              const driveGain = 1.0 + curSatDrive * 3.5;
              const normSat = 1.0 / Math.tanh(driveGain);
              xL = Math.tanh(xL * driveGain) * normSat;
              xR = Math.tanh(xR * driveGain) * normSat;
            }

            // 3. Автоматизированная стерео-панорама и Mid/Side ширина
            if (Math.abs(curPan) > 0.01 || Math.abs(curWidth - 1.0) > 0.02) {
              const midSig = 0.5 * (xL + xR);
              const sideSig = 0.5 * (xL - xR) * curWidth;
              xL = midSig + sideSig;
              xR = midSig - sideSig;

              if (curPan < 0) {
                xR *= (1.0 + curPan);
              } else if (curPan > 0) {
                xL *= (1.0 - curPan);
              }
            }

            // 4. Автоматизированный Стерео-Дилэй / Эхо (с полосовой фильтрацией обратной связи)
            let echoReadIdx = echoWriteIdx - curEchoDelaySamples;
            if (echoReadIdx < 0) echoReadIdx += maxEchoSamples;
            const delayedL = echoBufL[echoReadIdx];
            const delayedR = echoBufR[echoReadIdx];

            // Мягкий LPF в петле эха (~3.2 кГц), чтобы повторы звучали естественно и кинематографично
            echoLpStateL = echoLpStateL * 0.68 + (xL * curEchoSend + delayedR * curEchoFeedback) * 0.32;
            echoLpStateR = echoLpStateR * 0.68 + (xR * curEchoSend + delayedL * curEchoFeedback) * 0.32;
            echoBufL[echoWriteIdx] = echoLpStateL;
            echoBufR[echoWriteIdx] = echoLpStateR;
            if (++echoWriteIdx >= maxEchoSamples) echoWriteIdx = 0;

            // 5. Автоматизированный Стерео-Ревербератор Шрёдера/Мурера (с линией Pre-Delay)
            const monoInputSend = 0.5 * (xL + xR) * curWetSend;
            preDelayBufL[preDelayWriteIdx] = monoInputSend;
            preDelayBufR[preDelayWriteIdx] = monoInputSend;

            let pdReadIdx = preDelayWriteIdx - curPreDelaySamples;
            if (pdReadIdx < 0) pdReadIdx += maxPreDelaySamples;
            const revInL = preDelayBufL[pdReadIdx] * 0.035;
            const revInR = preDelayBufR[pdReadIdx] * 0.035;
            if (++preDelayWriteIdx >= maxPreDelaySamples) preDelayWriteIdx = 0;

            let revOutL = 0.0;
            let revOutR = 0.0;
            const damp1 = curDamp;
            const damp2 = 1.0 - damp1;
            const fb = curRoomFeedback;

            for (let c = 0; c < 8; c++) {
              // Left Comb
              const bufL = combBufsL[c];
              const idxL = combIdxL[c];
              const cOutL = bufL[idxL];
              combFilterL[c] = cOutL * damp2 + combFilterL[c] * damp1;
              bufL[idxL] = revInL + combFilterL[c] * fb;
              combIdxL[c] = (idxL + 1 === bufL.length) ? 0 : idxL + 1;
              revOutL += cOutL;

              // Right Comb
              const bufR = combBufsR[c];
              const idxR = combIdxR[c];
              const cOutR = bufR[idxR];
              combFilterR[c] = cOutR * damp2 + combFilterR[c] * damp1;
              bufR[idxR] = revInR + combFilterR[c] * fb;
              combIdxR[c] = (idxR + 1 === bufR.length) ? 0 : idxR + 1;
              revOutR += cOutR;
            }

            // 4 последовательных Allpass диффузора
            for (let a = 0; a < 4; a++) {
              const abL = allpassBufsL[a];
              const aiL = allpassIdxL[a];
              const bOutL = abL[aiL];
              const nextL = -revOutL + bOutL;
              abL[aiL] = revOutL + bOutL * 0.5;
              allpassIdxL[a] = (aiL + 1 === abL.length) ? 0 : aiL + 1;
              revOutL = nextL;

              const abR = allpassBufsR[a];
              const aiR = allpassIdxR[a];
              const bOutR = abR[aiR];
              const nextR = -revOutR + bOutR;
              abR[aiR] = revOutR + bOutR * 0.5;
              allpassIdxR[a] = (aiR + 1 === abR.length) ? 0 : aiR + 1;
              revOutR = nextR;
            }

            // Суммирование прямого сигнала (с легкой аттенюацией при сильном погружении в реверб), эха и реверберации
            const dryScale = Math.max(0.65, 1.0 - curWetSend * 0.35);
            let outL = xL * dryScale + delayedL + revOutL * 1.6;
            let outR = xR * dryScale + delayedR + revOutR * 1.6;

            // 6. True-Peak Soft Limiter (-0.5 dBFS = 0.944)
            const limit = 0.944;
            if (Math.abs(outL) > 0.80) {
              outL = limit * Math.tanh(outL / limit);
            }
            if (Math.abs(outR) > 0.80) {
              outR = limit * Math.tanh(outR / limit);
            }

            const intL = Math.max(-32768, Math.min(32767, Math.round(outL * 32767.0)));
            const intR = Math.max(-32768, Math.min(32767, Math.round(outR * 32767.0)));
            outBuf.writeInt16LE(intL, byteOff);
            outBuf.writeInt16LE(intR, byteOff + 2);

            globalSampleCounter++;
          }

          fileHandle.write(outBuf, 0, outBuf.length, writePosition).then(() => {
            writePosition += outBuf.length;
            totalSamplesWritten += numStereoSamples;
            if (onProgress && durationSec > 0 && (totalSamplesWritten % 240000 < numStereoSamples)) {
              const pct = Math.min(98, 60 + Math.round(((totalSamplesWritten / sr) / durationSec) * 38));
              onProgress({ status: 'rendering_matched_vocals', progress: pct });
            }
            stream.resume();
          }).catch(reject);
        });

        stream.on('end', () => {
          resolve();
        });
      });

      // Финализируем RIFF WAV заголовок с точным размером записанных аудиоданных
      const totalDataBytes = writePosition - 44;
      const finalHeader = createWavHeader(totalDataBytes);
      await fileHandle.write(finalHeader, 0, 44, 0);
    } finally {
      await fileHandle.close();
    }
  }

  /**
   * ПРИВЕДЕНИЕ СКЛЕЕННОЙ ДОРОЖКИ ГОЛОСОВ К ЭФФЕКТАМ ОРИГИНАЛА В КАЖДЫЙ МОМЕНТ ВРЕМЕНИ (ПО КРИВОЙ АВТОМАТИЗАЦИИ)
   * Строго проверяет:
   * 1. Было ли выполнено разделение оригинального аудио из видео (наличие выделенного вокала оригинала)
   * 2. Было ли выполнено склеивание всех голосов в одну дорожку (наличие склеенной дорожки voices_master)
   */
  static async applyAcousticProfileMatch(arg1, arg2 = null, arg3 = {}, arg4 = null) {
    let ourVocalsPath;
    let originalVocalsPath = null;
    let searchDirs = [];
    let manifest = null;
    let outputPath = null;
    let options = {};
    let onProgress = null;
    let onLog = null;

    if (arg1 && typeof arg1 === 'object' && !Array.isArray(arg1)) {
      ourVocalsPath = arg1.ourVocalsPath;
      originalVocalsPath = arg1.originalVocalsPath || null;
      searchDirs = arg1.searchDirs || [];
      manifest = arg1.manifest || null;
      outputPath = arg1.outputPath || null;
      options = arg1.options || {};
      onProgress = arg1.onProgress || null;
      onLog = arg1.onLog || null;
    } else {
      ourVocalsPath = arg1;
      originalVocalsPath = arg2;
      options = arg3 || {};
      searchDirs = options.searchDirs || [];
      manifest = options.manifest || null;
      outputPath = options.outputPath || null;
      onProgress = arg4 || options.onProgress || null;
      onLog = options.onLog || null;
    }

    const logFn = (msg, level = 'info') => {
      log.info(`[AcousticMatch] ${msg}`);
      if (onLog) onLog(msg, level);
    };

    logFn('▶ [acoustic_matched] Проверка входных дорожек и этапов предварительной подготовки...');

    // 1. СТРОГАЯ ПРОВЕРКА №1: Разделено ли оригинальное аудио из видео на вокал и фон?
    let resolvedOriginalVocals = originalVocalsPath;
    if (!resolvedOriginalVocals || !fs.existsSync(resolvedOriginalVocals)) {
      resolvedOriginalVocals = this.findOriginalVocalsTrack(
        [
          ourVocalsPath ? path.dirname(ourVocalsPath) : null,
          ...searchDirs
        ].filter(Boolean),
        manifest,
        ourVocalsPath,
        { strict: false }
      );
    }

    if (!resolvedOriginalVocals || !fs.existsSync(resolvedOriginalVocals) || fs.statSync(resolvedOriginalVocals).size < 1000) {
      const errMsg =
        '❌ Ошибка [acoustic_matched]: Оригинальное аудио из видео НЕ было разделено на стемы!\n' +
        'Модуль наложения эффектов принимает на вход ИСКЛЮЧИТЕЛЬНО выделенную вокальную дорожку оригинала и склеенную дорожку всех голосов.\n' +
        'Пожалуйста, сначала выполните шаг разделения оригинального аудио (Demucs / UVR / RoFormer / Vocal Splitter).';
      logFn(errMsg, 'error');
      throw new Error(errMsg);
    }

    if (this.isUnseparatedOriginalAudio(resolvedOriginalVocals)) {
      const errMsg =
        `❌ Ошибка [acoustic_matched]: Вместо разделенного вокала оригинала подана неразделенная дорожка «${path.basename(resolvedOriginalVocals)}»!\n` +
        'Сначала разделите оригинальное аудио из видео на вокал и фон (Demucs / UVR / RoFormer).';
      logFn(errMsg, 'error');
      throw new Error(errMsg);
    }

    // 2. СТРОГАЯ ПРОВЕРКА №2: Склеены ли все голоса дабберов в одну общую дорожку (voices_master)?
    let resolvedGluedVoices = ourVocalsPath;
    if (!resolvedGluedVoices || !fs.existsSync(resolvedGluedVoices) || !this.isGluedVoicesMasterTrack(resolvedGluedVoices, manifest)) {
      const foundGlued = this.findGluedVoicesTrack(
        [
          ourVocalsPath ? path.dirname(ourVocalsPath) : null,
          ...searchDirs
        ].filter(Boolean),
        manifest,
        { strict: false }
      );
      if (foundGlued && fs.existsSync(foundGlued)) {
        resolvedGluedVoices = foundGlued;
      }
    }

    if (!resolvedGluedVoices || !fs.existsSync(resolvedGluedVoices) || fs.statSync(resolvedGluedVoices).size < 1000) {
      const errMsg =
        '❌ Ошибка [acoustic_matched]: Голосовые дорожки дабберов НЕ склеены в одну дорожку!\n' +
        'Модуль принимает на вход ИСКЛЮЧИТЕЛЬНО вокальную дорожку оригинала и склеенную дорожку всех голосов (voices_master.wav).\n' +
        'Пожалуйста, сначала выполните шаг «Склеивание голосов в одну дорожку» (mix_voices / glue_compress).';
      logFn(errMsg, 'error');
      throw new Error(errMsg);
    }

    if (options.strictGluedVoicesRequired !== false && !this.isGluedVoicesMasterTrack(resolvedGluedVoices, manifest)) {
      const errMsg =
        `❌ Ошибка [acoustic_matched]: На вход подана несклеенная дорожка «${path.basename(resolvedGluedVoices)}»!\n` +
        'Необходимо сначала выполнить склеивание всех голосов в одну дорожку (шаг «Склеивание голосов в одну дорожку» -> voices_master.wav).';
      logFn(errMsg, 'error');
      throw new Error(errMsg);
    }

    logFn(`✓ Проверка пройдена:`);
    logFn(`  • [Вход 1 — Вокал оригинала]: ${path.basename(resolvedOriginalVocals)}`);
    logFn(`  • [Вход 2 — Склеенная дорожка всех голосов]: ${path.basename(resolvedGluedVoices)}`);

    if (onProgress) onProgress({ status: 'analyzing_snapshots', progress: 15 });

    // 3. ПОЛНЫЙ ПОФРАЗОВЫЙ И ПОКАДРОВЫЙ АНАЛИЗ ОРИГИНАЛЬНОГО ВОКАЛА
    logFn('▶ Этап 1/3: Полный пофразовый и покадровый анализ эффектов вокальной дорожки оригинала (шаг 100 мс)...');
    const originalProfile = await this.analyzeOriginalAcousticSnapshots(
      resolvedOriginalVocals,
      options,
      p => { if (onProgress) onProgress({ status: 'building_original_fingerprint', progress: 15 + Math.round((p.progress || 0) * 0.25) }); }
    );

    const es = originalProfile.effectSummary || {};
    logFn(
      `✓ Анализ оригинала завершен: проанализировано ${es.totalPhrases || 0} фраз (длительность ${originalProfile.durationSec}с). ` +
      `Обнаружено эффектов: Комната=${es.roomReverbPhrases || 0}, Зал/Пещера=${es.hallCavePhrases || 0}, ` +
      `Эхо/Дилэй=${es.echoDelayPhrases || 0}, Телефон/Рация=${es.telephoneRadioPhrases || 0}, ` +
      `Из-за стены/LPF=${es.muffledWallPhrases || 0}, Отдаление=${es.distantPhrases || 0}, Стерео/Панорама=${es.stereoPannedPhrases || 0}.`
    );

    // 4. ПОКАДРОВЫЙ АНАЛИЗ СКЛЕЕННОЙ ДОРОЖКИ ГОЛОСОВ И ГЕНЕРАЦИЯ КРИВЫХ АВТОМАТИЗАЦИИ
    if (onProgress) onProgress({ status: 'analyzing_our_vocals', progress: 45 });
    logFn('▶ Этап 2/3: Построение кривых автоматизации под тайминги фраз склеенной дорожки голосов...');
    const dubFrameData = await this._analyzeAudioFramesPhysical(resolvedGluedVoices);

    const automation = this._buildTimeAlignedAutomationCurves(originalProfile, dubFrameData, options);

    logFn(`✓ Сформировано ${automation.totalFrames} точек кривой автоматизации (разрешение 100 мс) для ${automation.matchedPhraseReports.length} фраз дубляжа:`);
    const previewPhrases = automation.matchedPhraseReports.slice(0, 12);
    for (const pr of previewPhrases) {
      logFn(
        `  • Фраза #${pr.dubPhraseIndex} [${pr.startSec}s–${pr.endSec}s]: ${pr.effectLabel} | ` +
        `Gain=${pr.appliedAutomation.gainDb >= 0 ? '+' : ''}${pr.appliedAutomation.gainDb}dB, ` +
        `Фильтр=${pr.appliedAutomation.highpassHz}..${pr.appliedAutomation.lowpassHz}Hz, ` +
        `Reverb=${pr.appliedAutomation.reverbWetPct}% (Room ${pr.appliedAutomation.roomSizePct}%)` +
        (pr.appliedAutomation.echoDelayMs > 0 ? `, Echo=${pr.appliedAutomation.echoDelayMs}ms (${pr.appliedAutomation.echoWetPct}%)` : ''),
        'debug'
      );
    }
    if (automation.matchedPhraseReports.length > 12) {
      logFn(`  ... и еще ${automation.matchedPhraseReports.length - 12} фраз с индивидуальной кривой автоматизации.`, 'debug');
    }

    // 5. ПОТОКОВЫЙ РЕНДЕРИНГ ЧЕРЕЗ MULTI-FX ПРОЦЕССОР АВТОМАТИЗАЦИИ (48 кГц Stereo)
    if (onProgress) onProgress({ status: 'rendering_matched_vocals', progress: 60 });
    const outPath = outputPath || path.join(
      path.dirname(resolvedGluedVoices),
      `acoustic_matched_${path.basename(resolvedGluedVoices)}`
    );

    logFn(`▶ Этап 3/3: Наложение эффектов по кривым автоматизации и рендеринг в «${path.basename(outPath)}»...`);
    await this._renderAutomatedDspAudio(
      resolvedGluedVoices,
      outPath,
      automation,
      dubFrameData.durationSec || originalProfile.durationSec,
      onProgress
    );

    // Сохранение детального отчета автоматизации рядом с выходным файлом
    const reportPath = `${outPath}.automation_report.json`;
    const automationReport = {
      generatedAt: new Date().toISOString(),
      originalVocalsPath: resolvedOriginalVocals,
      gluedVoicesPath: resolvedGluedVoices,
      outputPath: outPath,
      effectSummary: originalProfile.effectSummary,
      matchedPhrasesCount: automation.matchedPhraseReports.length,
      matchedPhraseReports: automation.matchedPhraseReports
    };
    await fsPromises.writeFile(reportPath, JSON.stringify(automationReport, null, 2), 'utf-8').catch(() => {});

    if (onProgress) onProgress({ status: 'completed_match', progress: 100 });
    logFn(`✓ Дорожка всех голосов успешно обработана по кривым автоматизации оригинала: ${path.basename(outPath)}`);

    const loudnessStrength = Math.min(100, Math.max(0, options.loudnessMatchStrength ?? 100)) / 100.0;
    const reverbStrength = Math.min(100, Math.max(0, options.reverbMatchStrength ?? 100)) / 100.0;
    const eqStrength = Math.min(100, Math.max(0, options.eqMatchStrength ?? 100)) / 100.0;

    let avgGainDeltaDb = 0;
    if (automation.gainDbCurve && automation.gainDbCurve.length > 0) {
      let s = 0;
      for (let i = 0; i < automation.gainDbCurve.length; i++) s += automation.gainDbCurve[i];
      avgGainDeltaDb = Number((s / automation.gainDbCurve.length).toFixed(2));
    }

    const appliedParameters = {
      loudnessEnvelope: {
        gainDeltaDb: avgGainDeltaDb,
        automationPointsCount: automation.totalFrames
      },
      reverbSpace: {
        originalCategory: originalProfile.overallStats?.reverbCategory || 'Естественная комната',
        avgRt60Sec: originalProfile.overallStats?.avgReverbRt60 || 0.35,
        avgWetMix: originalProfile.overallStats?.avgReverbWetMix || 0.08
      },
      detectedEffectsSummary: {
        phrasesCount: originalProfile.phrasesCount || 0,
        phrasesWithSpecialEffects: originalProfile.overallStats?.phrasesWithSpecialEffects || 0,
        effectCounts: originalProfile.overallStats?.effectCounts || {}
      }
    };

    return {
      success: true,
      ourVocalsPath: resolvedGluedVoices,
      originalVocalsPath: resolvedOriginalVocals,
      outputPath: outPath,
      automationReportPath: reportPath,
      appliedParameters,
      appliedParams: {
        automationFramesCount: automation.totalFrames,
        matchedPhrasesCount: automation.matchedPhraseReports.length,
        effectSummary: originalProfile.effectSummary,
        loudnessStrength,
        reverbStrength,
        eqStrength
      },
      matchedPhraseReports: automation.matchedPhraseReports,
      originalProfile
    };
  }
}

module.exports = AudioAnalysisService;

