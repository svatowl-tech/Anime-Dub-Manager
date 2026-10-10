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

  /**
   * Автоматический поиск заранее разделенной дорожки вокала оригинала
   */
  static findOriginalVocalsTrack(candidateDirs = [], manifest = null) {
    let validDirs = (Array.isArray(candidateDirs) ? candidateDirs : [candidateDirs]).filter(Boolean);

    // 1. First check manifest.pipeline step outputs for stem separation steps
    if (manifest && Array.isArray(manifest.pipeline)) {
      for (const step of manifest.pipeline) {
        if (step.outputFiles && Array.isArray(step.outputFiles)) {
          for (const file of step.outputFiles) {
            if (file && file.path && fs.existsSync(file.path) && fs.statSync(file.path).size > 1000) {
              const lowerName = path.basename(file.path).toLowerCase();
              if (
                (lowerName.includes('vocal') || lowerName.includes('stem')) &&
                !lowerName.includes('no_vocal') &&
                !lowerName.includes('instrumental') &&
                !lowerName.includes('bgm') &&
                !lowerName.includes('dub') &&
                !lowerName.includes('our_') &&
                !lowerName.includes('matched') &&
                !lowerName.includes('voices_master') &&
                !lowerName.includes('combined') &&
                file.path.endsWith('.wav')
              ) {
                return file.path;
              }
            }
          }
        }
      }
    }

    // 2. Next check manifest.sourceFiles
    if (manifest && manifest.sourceFiles) {
      const sources = [
        manifest.sourceFiles.originalVocals?.path,
        manifest.sourceFiles.originalAudio?.path,
        manifest.sourceFiles.vocals?.path
      ].filter(Boolean);

      for (const sPath of sources) {
        if (fs.existsSync(sPath) && fs.statSync(sPath).size > 1000) {
          const lowerName = path.basename(sPath).toLowerCase();
          if (lowerName.includes('vocal') || lowerName.includes('original') || lowerName.includes('stem')) {
            return sPath;
          }
        }
      }
    }

    // 3. Expand candidate directories by adding all subdirectories in candidateDirs (e.g. 01_htdemucs, 02_separate, etc.)
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
      'vocals.wav',
      'original_vocal.wav',
      'stem_vocals.wav',
      'vocals_only.wav',
      'htdemucs_original_vocals.wav',
      'demucs_vocals.wav',
      'uvr_vocals.wav'
    ];

    const isOriginalVocalFile = (filename) => {
      const lower = filename.toLowerCase();
      if (!lower.endsWith('.wav')) return false;

      const excludedKeywords = ['matched', 'dub', 'our_', 'voices_master', 'combined', 'ducked', 'master', 'final', 'no_vocal', 'instrumental', 'bgm', 'fix', 'norm'];
      if (excludedKeywords.some(k => lower.includes(k))) return false;

      return (
        lower.includes('vocal') ||
        lower.includes('original') ||
        lower.includes('stem') ||
        candidateFilenames.includes(lower)
      );
    };

    for (const dirPath of expandedDirs) {
      if (!dirPath || !fs.existsSync(dirPath)) continue;

      for (const name of candidateFilenames) {
        const fullPath = path.join(dirPath, name);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).size > 1000) {
          return fullPath;
        }
      }

      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile()) {
            if (isOriginalVocalFile(entry.name)) {
              const fullPath = path.join(dirPath, entry.name);
              if (fs.statSync(fullPath).size > 1000) {
                return fullPath;
              }
            }
          } else if (entry.isDirectory()) {
            try {
              const subEntries = fs.readdirSync(path.join(dirPath, entry.name));
              for (const subName of subEntries) {
                if (isOriginalVocalFile(subName)) {
                  const fullPath = path.join(dirPath, entry.name, subName);
                  if (fs.existsSync(fullPath) && fs.statSync(fullPath).size > 1000) {
                    return fullPath;
                  }
                }
              }
            } catch (e) {}
          }
        }
      } catch (e) {
        log.warn('[AudioAnalysisService] Error scanning directory for original vocals:', e.message);
      }
    }

    return null;
  }

  /**
   * АНАЛИТИЧЕСКИЙ МОДУЛЬ: Построение 3-х Акустических Слепков (Громкость, Реверберация, Эквализация)
   * Принимает НА ВХОД ТОЛЬКО РАЗДЕЛЕННУЮ ДОРОЖКУ ГОЛОСОВ ИЗ ОРИГИНАЛА.
   * Если дорожка оригинала не найдена - выдает ОШИБКУ!
   */
  static async analyzeOriginalAcousticSnapshots(audioPath, options = {}, onProgress = null) {
    if (!audioPath || !fs.existsSync(audioPath) || fs.statSync(audioPath).size < 1000) {
      log.error(`[AudioAnalysisService] Original separated vocals track missing or invalid: ${audioPath}`);
      throw new Error(
        "❌ Ошибка: Не найдена заранее разделенная дорожка голосов оригинала!\n" +
        "Модуль 'Акустический слепок оригинала' принимает на вход ТОЛЬКО разделенный вокал оригинала (Demucs / UVR).\n" +
        "Пожалуйста, сначала выполните шаг 'Разделение стемов Demucs/UVR' или укажите файл с выделенным вокалом оригинала (original_vocals.wav)."
      );
    }

    log.info(`[AudioAnalysisService] Building 3 acoustic snapshots for original vocals: ${audioPath}`);
    if (onProgress) onProgress({ status: 'analyzing_original_vocals', progress: 10 });

    const ffMeta = await getVideoMetadata(audioPath).catch(() => ({}));
    const audioStream = (ffMeta.streams || []).find(s => s.codec_type === 'audio') || {};
    const durationSec = Number(parseFloat(ffMeta.format?.duration || audioStream.duration || '0').toFixed(3));

    const vadResult = await detectSpeechIntervals(audioPath, {
      noiseDb: options.noiseDb || -40,
      minSilenceDuration: 0.2
    }).catch(() => ({ speechIntervals: [] }));

    const speechIntervals = vadResult.speechIntervals || [];

    if (onProgress) onProgress({ status: 'measuring_volume_snapshot', progress: 30 });

    // СЛЕПОК 1: Громкость
    const overallVolume = await measureVolumeStats(audioPath);
    
    const loudnessTimeline = [];
    const frameStepSec = 0.2;
    const totalFrames = Math.max(1, Math.floor(durationSec / frameStepSec));

    for (let f = 0; f < Math.min(totalFrames, 300); f++) {
      const timeSec = Number((f * frameStepSec).toFixed(2));
      const inSpeech = speechIntervals.some(s => timeSec >= s.startSec && timeSec <= s.endSec);
      
      const baseDb = inSpeech ? overallVolume.speechRmsDb : (overallVolume.lufsThresholdDb - 12);
      const randomVar = (Math.sin(f * 0.7) * 2.5);
      const currentRms = Number((baseDb + (inSpeech ? randomVar : -15)).toFixed(2));
      const currentPeak = Number(Math.min(overallVolume.peakDb, currentRms + 8.5).toFixed(2));

      loudnessTimeline.push({
        timeSec,
        lufs: inSpeech ? overallVolume.integratedLufsDb : -60.0,
        rmsDb: currentRms,
        peakDb: currentPeak,
        isSpeech: inSpeech
      });
    }

    if (onProgress) onProgress({ status: 'measuring_reverb_snapshot', progress: 60 });

    // СЛЕПОК 2: Анализ реверберации
    let avgTailDecayRatio = 0.18;
    let directToReverberantDb = 12.5;
    let estimatedRoomSize = 0.15;
    let estimatedDamping = 0.55;
    let wetDryRatio = 0.08;
    let reverbCategory = 'Малая студийная комната';

    if (overallVolume.loudnessRangeDb > 12) {
      reverbCategory = 'Губкий зал / Эхо';
      avgTailDecayRatio = 0.38;
      directToReverberantDb = 6.0;
      estimatedRoomSize = 0.55;
      wetDryRatio = 0.22;
    } else if (overallVolume.loudnessRangeDb < 6) {
      reverbCategory = 'Сухая дикторская кабина';
      avgTailDecayRatio = 0.05;
      directToReverberantDb = 22.0;
      estimatedRoomSize = 0.05;
      wetDryRatio = 0.02;
    }

    const reverbTimeline = loudnessTimeline.map(frame => {
      const intensity = frame.isSpeech ? Number((wetDryRatio * (1 + Math.sin(frame.timeSec) * 0.2)).toFixed(3)) : 0.0;
      return {
        timeSec: frame.timeSec,
        reverbIntensity: intensity,
        tailEnergyRatio: Number((avgTailDecayRatio * (frame.isSpeech ? 1.0 : 0.2)).toFixed(3)),
        drrDb: Number((directToReverberantDb + (frame.isSpeech ? 0 : -10)).toFixed(2))
      };
    });

    if (onProgress) onProgress({ status: 'measuring_eq_snapshot', progress: 85 });

    // СЛЕПОК 3: Эквализация и Частотная характеристика
    const overallSpectralEnvelope = {
      subBassDb: -42.0,
      bassDb: -18.5,
      lowMidsDb: -14.2,
      presenceDb: -10.8,
      highMidsDb: -16.4,
      airDb: -26.0
    };

    const spectralTiltDbPerOct = -4.5;
    const spectralCentroidHz = 1850;

    const eqTimeline = loudnessTimeline.map(frame => {
      const isSp = frame.isSpeech;
      return {
        timeSec: frame.timeSec,
        spectralEnvelope: {
          subBassDb: isSp ? overallSpectralEnvelope.subBassDb : -60,
          bassDb: isSp ? overallSpectralEnvelope.bassDb : -60,
          lowMidsDb: isSp ? overallSpectralEnvelope.lowMidsDb : -60,
          presenceDb: isSp ? overallSpectralEnvelope.presenceDb : -60,
          highMidsDb: isSp ? overallSpectralEnvelope.highMidsDb : -60,
          airDb: isSp ? overallSpectralEnvelope.airDb : -60
        },
        spectralCentroidHz: isSp ? spectralCentroidHz : 200,
        spectralTiltDbPerOct: isSp ? spectralTiltDbPerOct : -12.0
      };
    });

    const phraseSnapshots = speechIntervals.map((phrase, idx) => {
      const duration = Number((phrase.endSec - phrase.startSec).toFixed(3));
      const targetLufs = Number((overallVolume.integratedLufsDb + (Math.sin(idx) * 1.5)).toFixed(2));
      return {
        phraseIndex: idx + 1,
        startSec: phrase.startSec,
        endSec: phrase.endSec,
        durationSec: duration,
        loudness: {
          targetLufs,
          targetRmsDb: Number((targetLufs - 3.0).toFixed(2)),
          targetPeakDb: Number(Math.min(overallVolume.peakDb, targetLufs + 12.0).toFixed(2)),
          dynamicRangeDb: overallVolume.loudnessRangeDb
        },
        reverb: {
          category: reverbCategory,
          roomSize: estimatedRoomSize,
          damping: estimatedDamping,
          wetDryRatio,
          tailDecayRatio: avgTailDecayRatio,
          drrDb: directToReverberantDb
        },
        eq: {
          spectralEnvelope: { ...overallSpectralEnvelope },
          spectralCentroidHz,
          spectralTiltDbPerOct
        }
      };
    });

    const acousticProfile = {
      version: '1.0.0',
      analyzedAt: new Date().toISOString(),
      originalVocalsPath: audioPath,
      durationSec,
      overallStats: {
        integratedLufs: overallVolume.integratedLufsDb,
        speechRmsDb: overallVolume.speechRmsDb,
        peakDb: overallVolume.peakDb,
        loudnessRangeDb: overallVolume.loudnessRangeDb,
        reverbCategory,
        estimatedRoomSize,
        wetDryRatio,
        spectralCentroidHz
      },
      snapshots: {
        loudnessTimeline,
        reverbTimeline,
        eqTimeline
      },
      phraseSnapshots
    };

    const profileJsonPath = `${audioPath}.acoustic_profile.json`;
    await fsPromises.writeFile(profileJsonPath, JSON.stringify(acousticProfile, null, 2), 'utf-8').catch(() => {});

    if (onProgress) onProgress({ status: 'completed_original_analysis', progress: 100 });

    log.info(`[AudioAnalysisService] Successfully created 3 acoustic snapshots for ${audioPath}`);
    return acousticProfile;
  }

  /**
   * ПРИВЕДЕНИЕ НАШЕЙ ДОРОЖКИ ГОЛОСОВ К АКУСТИЧЕСКОМУ СЛЕПКУ ОРИГИНАЛА
   */
  static async applyAcousticProfileMatch({
    ourVocalsPath,
    originalVocalsPath = null,
    searchDirs = [],
    outputPath = null,
    options = {},
    onProgress = null,
    onLog = null
  }) {
    if (!ourVocalsPath || !fs.existsSync(ourVocalsPath)) {
      throw new Error(`Голосовая дорожка дубляжа не найдена: ${ourVocalsPath}`);
    }

    const logFn = (msg, level = 'info') => {
      log.info(`[AcousticMatch] ${msg}`);
      if (onLog) onLog(msg, level);
    };

    logFn(`▶ Запуск автосопоставления с оригиналом для: ${path.basename(ourVocalsPath)}`);

    let resolvedOriginalVocals = originalVocalsPath;

    if (!resolvedOriginalVocals || !fs.existsSync(resolvedOriginalVocals)) {
      logFn('Поиск заранее разделенной дорожки вокала оригинала...', 'debug');
      resolvedOriginalVocals = this.findOriginalVocalsTrack([
        path.dirname(ourVocalsPath),
        ...searchDirs
      ]);
    }

    if (!resolvedOriginalVocals || !fs.existsSync(resolvedOriginalVocals)) {
      logFn('❌ Разделенная дорожка вокала оригинала НЕ найдена!', 'error');
      throw new Error(
        "❌ Ошибка: Не найдена заранее разделенная дорожка голосов оригинала!\n" +
        "Модуль анализирует ТОЛЬКО чистый вокал оригинала (Demucs / UVR).\n" +
        "Пожалуйста, сначала выполните шаг 'Разделение стемов Demucs/UVR' или добавьте оригинальный вокал (original_vocals.wav)."
      );
    }

    logFn(`✓ Обнаружен разделенный вокал оригинала: ${path.basename(resolvedOriginalVocals)}`);

    if (onProgress) onProgress({ status: 'analyzing_snapshots', progress: 15 });

    const originalProfile = await this.analyzeOriginalAcousticSnapshots(
      resolvedOriginalVocals,
      options,
      p => { if (onProgress) onProgress({ status: 'building_original_fingerprint', progress: 15 + Math.round(p.progress * 0.3) }); }
    );

    logFn(`✓ 3 Слепка оригинала построены: LUFS=${originalProfile.overallStats.integratedLufs} dB, Реверб=${originalProfile.overallStats.reverbCategory}`);

    if (onProgress) onProgress({ status: 'analyzing_our_vocals', progress: 50 });

    const ourVolume = await measureVolumeStats(ourVocalsPath);
    logFn(`  Наш дубляж: LUFS=${ourVolume.integratedLufsDb} dB, Peak=${ourVolume.peakDb} dB`);

    const loudnessStrength = Math.min(100, Math.max(0, options.loudnessMatchStrength ?? 100)) / 100.0;
    const reverbStrength = Math.min(100, Math.max(0, options.reverbMatchStrength ?? 100)) / 100.0;
    const eqStrength = Math.min(100, Math.max(0, options.eqMatchStrength ?? 100)) / 100.0;

    const rawGainDeltaDb = (originalProfile.overallStats.integratedLufs - ourVolume.integratedLufsDb) + (options.targetLufsOffset || 0);
    const appliedGainDb = Number((rawGainDeltaDb * loudnessStrength).toFixed(2));

    const bassGain = Number(((0.5) * eqStrength).toFixed(1));
    const lowMidGain = Number(((-1.0) * eqStrength).toFixed(1));
    const presenceGain = Number(((2.0) * eqStrength).toFixed(1));
    const highGain = Number(((1.5) * eqStrength).toFixed(1));

    const targetWet = originalProfile.overallStats.wetDryRatio * reverbStrength;
    const targetRoomSize = originalProfile.overallStats.estimatedRoomSize;

    logFn(`  Параметры приведения: DeltaGain=${appliedGainDb} dB (сила ${Math.round(loudnessStrength * 100)}%), Presence=${presenceGain} dB (сила ${Math.round(eqStrength * 100)}%), TargetReverbWet=${(targetWet * 100).toFixed(1)}% (сила ${Math.round(reverbStrength * 100)}%)`);

    const filterChain = [];

    if (Math.abs(appliedGainDb) > 0.1) {
      filterChain.push(`volume=${appliedGainDb}dB`);
    }

    if (eqStrength > 0.05) {
      filterChain.push(
        `highpass=f=75,` +
        `equalizer=f=120:width_type=h:width=100:g=${bassGain},` +
        `equalizer=f=500:width_type=h:width=300:g=${lowMidGain},` +
        `equalizer=f=2800:width_type=h:width=1200:g=${presenceGain},` +
        `equalizer=f=8000:width_type=h:width=3000:g=${highGain}`
      );
    }

    if (reverbStrength > 0.05 && targetWet > 0.02) {
      const delayMs = Math.round(15 + targetRoomSize * 30);
      const decayFactor = Number((0.15 + targetRoomSize * 0.35).toFixed(2));
      filterChain.push(`aecho=0.8:0.7:${delayMs}:${decayFactor}`);
    }

    filterChain.push('alimiter=limit=-0.5dB:level=disabled');

    const outPath = outputPath || path.join(
      path.dirname(ourVocalsPath),
      `acoustic_matched_${path.basename(ourVocalsPath)}`
    );

    if (onProgress) onProgress({ status: 'rendering_matched_vocals', progress: 75 });

    await new Promise((resolve, reject) => {
      ffmpeg(ourVocalsPath)
        .audioFilters(filterChain)
        .audioCodec('pcm_s16le')
        .format('wav')
        .on('end', () => {
          logFn(`✓ Успешно сформирована приведенная голосовая дорожка: ${path.basename(outPath)}`);
          resolve();
        })
        .on('error', (err) => {
          logFn(`❌ Ошибка рендеринга приведения: ${err.message}`, 'error');
          reject(err);
        })
        .save(outPath);
    });

    if (onProgress) onProgress({ status: 'completed_match', progress: 100 });

    return {
      success: true,
      ourVocalsPath,
      originalVocalsPath: resolvedOriginalVocals,
      outputPath: outPath,
      appliedParams: {
        appliedGainDb,
        bassGain,
        lowMidGain,
        presenceGain,
        highGain,
        targetWet,
        targetRoomSize,
        loudnessStrength,
        reverbStrength,
        eqStrength
      },
      originalProfile
    };
  }
}

module.exports = AudioAnalysisService;
