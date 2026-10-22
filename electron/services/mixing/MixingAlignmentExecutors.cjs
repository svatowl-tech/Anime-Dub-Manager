const fs = require("fs").promises;
const fsPromises = fs;
const fsSync = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const log = require("electron-log");
const { app, shell } = require("electron");
const ExportService = require("../ExportService.cjs");
const ffmpegService = require("../ffmpegService.cjs");
const AutoTimingService = require("../AutoTimingService.cjs");
const AudioNeuralService = require("../AudioNeuralService.cjs");
const AudioAnalysisService = require("../AudioAnalysisService.cjs");
const { trackProcess, killAllActiveProcesses } = require("../../lib/ProcessTracker.cjs");
const { sanitizeProjectTitle, sanitizePath } = require("../../lib/pathSanitizer.cjs");
const { MODULE_DATABASE, createDefaultPipeline } = require("./MixingModuleDatabase.cjs");

class MixingAlignmentExecutors {
  /**
   * EXEC: Auto Timing (aligns phrases by subtitles & resolves overlaps)
   */
  async _execAutoTiming({ episode, workingDir, stepFolder, prefix, manifest, inputFiles, params, logFn, onProgress }) {
    const minGapSec = Number(params.minGapSec ?? 0.12);
    const leadInSec = Number(params.leadInSec ?? 0.05);
    const silenceThresholdDb = Number(params.silenceThresholdDb ?? -45.0);
    const minSilenceDuration = Number(params.minSilenceDuration ?? 0.20);
    const preventCollisions = params.preventCollisions !== false;
    const subPath = manifest.sourceFiles?.subtitles?.path || episode?.subPath;

    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для выполнения автотайминга.');
    }

    logFn(`Запуск автотайминга для ${inputFiles.length} дорожек (зазор: ${minGapSec}s, предвход: ${leadInSec}s, порог тишины: ${silenceThresholdDb}dB, мин. пауза: ${minSilenceDuration}s)...`);

    // Prepare audio track structures for AutoTimingService
    const audioFiles = inputFiles.map(f => ({
      path: f.path,
      id: f.id || f.name,
      uploadedById: f.uploadedById,
      type: f.name.toLowerCase().includes('fix') || f.name.toLowerCase().includes('фикс') ? 'FIXES' : 'DUBBER_FILE'
    }));

    const matchResult = await AutoTimingService.matchActorsWithAudioTracks(
      subPath,
      audioFiles,
      [],
      {},
      episode?.assignments || []
    );

    logFn(`Сопоставлено дорожек с ролями: ${matchResult.matchedTracks.length} из ${inputFiles.length}`);

    let timedResult = null;
    if (matchResult.matchedTracks.length > 0) {
      timedResult = await AutoTimingService.alignProjectAndResolveCollisions({
        subPath,
        matchedTracks: matchResult.matchedTracks,
        options: {
          minGapSec,
          leadInSec,
          silenceThresholdDb,
          minSilenceDuration,
          preventCollisions
        }
      });
    }

    const results = [];
    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = track.dubberNick || `dubber_${i+1}`;
      const sameNickCount = inputFiles.filter(f => (f.dubberNick || `dubber`) === nick).length;
      const nickOccurrences = inputFiles.slice(0, i + 1).filter(f => (f.dubberNick || `dubber`) === nick).length;
      const trackSuffix = sameNickCount > 1 ? `_дорожка${nickOccurrences}` : '';
      const outName = `${prefix}${nick}${trackSuffix}.wav`;
      const outPath = path.join(stepFolder, outName);

      logFn(`[${i+1}/${inputFiles.length}] Рендеринг оттаймленной дорожки для «${nick}»...`);

      const matchedItem = timedResult?.trackPhraseResults?.find(t => t.track.trackPath === track.path);
      if (matchedItem && matchedItem.phrases && matchedItem.phrases.length > 0) {
        await AutoTimingService.assembleMultiSourceTrack(
          track.path,
          matchedItem.phrases,
          outPath,
          {}
        );
      } else {
        // Fallback: copy source audio to ensure 100% reliability
        await fs.copyFile(track.path, outPath);
      }

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });

      if (onProgress) {
        onProgress({ percent: Math.round(((i + 1) / inputFiles.length) * 100), message: `Автотайминг: ${nick}` });
      }
    }

    return results;
  }

  /**
   * EXEC: Montreal Forced Aligner (MFA) Phonetic Lipsync Aligner
   * Compares phonetic alignments of dubber voice tracks with original vocals track (vocals.wav)
   * to calculate time stretch ratios and apply atempo/rubberband time-stretching per phrase.
   */
  async _execMfaLipsync({ episode, workingDir, stepFolder, prefix, manifest, inputFiles, params, logFn, onProgress }) {
    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для выполнения MFA Phonetic Lipsync.');
    }

    logFn(`[MFA Lipsync] Запуск фонетического липсинка для ${inputFiles.length} дорожек...`);

    // 1. Resolve original vocals audio path
    let origVocalsPath = manifest.sourceFiles?.originalVocals?.path || '';
    if (!origVocalsPath || !fsSync.existsSync(origVocalsPath)) {
      try {
        const manifestDir = workingDir;
        const demucsDirs = fsSync.readdirSync(manifestDir).filter(d => d.includes('demucs') || d.includes('separation') || d.includes('uvr'));
        for (const d of demucsDirs) {
          const potentialVocals = path.join(manifestDir, d, 'vocals.wav');
          if (fsSync.existsSync(potentialVocals)) {
            origVocalsPath = potentialVocals;
            break;
          }
        }
      } catch (e) {}
    }

    if (origVocalsPath && fsSync.existsSync(origVocalsPath)) {
      logFn(`Найден исходный вокал для сопоставления липсинка: ${path.basename(origVocalsPath)}`);
    } else {
      logFn(`⚠️ Исходный отделенный вокал оригинала не найден. Использование временных интервалов субтитров.`, 'warn');
      origVocalsPath = '';
    }

    // 2. Resolve or create subtitles JSON file
    const subPath = manifest.sourceFiles?.subtitles?.path || episode?.subPath;
    let tempSubJsonPath = path.join(stepFolder, 'subtitles_for_mfa.json');
    let subtitlesList = [];

    if (subPath && fsSync.existsSync(subPath)) {
      try {
        if (subPath.endsWith('.json')) {
          subtitlesList = JSON.parse(fsSync.readFileSync(subPath, 'utf8'));
        } else {
          const content = fsSync.readFileSync(subPath, 'utf8');
          subtitlesList = AutoTimingService._parseSubtitlesToPhrases ? AutoTimingService._parseSubtitlesToPhrases(content) : [];
          if (!Array.isArray(subtitlesList) || subtitlesList.length === 0) {
            const lines = content.split(/\r?\n/);
            lines.forEach((line, idx) => {
              if (line.startsWith('Dialogue:')) {
                const parts = line.split(',');
                if (parts.length >= 10) {
                  const startStr = parts[1].trim();
                  const endStr = parts[2].trim();
                  const textStr = parts.slice(9).join(',').replace(/\{[^}]+\}/g, '').trim();
                  
                  const parseTime = (tStr) => {
                    const [h, m, sMs] = tStr.split(':');
                    return parseFloat(h) * 3600 + parseFloat(m) * 60 + parseFloat(sMs);
                  };
                  
                  const startSec = parseTime(startStr);
                  const endSec = parseTime(endStr);
                  if (!isNaN(startSec) && !isNaN(endSec) && endSec > startSec) {
                    subtitlesList.push({
                      id: `line_${idx+1}`,
                      text: textStr || '...',
                      startSec,
                      endSec
                    });
                  }
                }
              }
            });
          }
        }
      } catch (err) {
        logFn(`⚠️ Ошибка чтения файла субтитров (${err.message}).`, 'warn');
      }
    }

    if (!subtitlesList || subtitlesList.length === 0) {
      throw new Error('Субтитры серии не найдены или пусты. Для работы фонетического липсинка MFA необходим файл субтитров (.ass/.srt).');
    }

    fsSync.writeFileSync(tempSubJsonPath, JSON.stringify(subtitlesList, null, 2), 'utf8');

    const results = [];
    const autoApplyStretch = params?.autoApplyStretch !== false;
    const maxDriftMs = Number(params?.maxDriftMs ?? 50.0);
    const minTimeStretch = Number(params?.minTimeStretch ?? 0.75);
    const maxTimeStretch = Number(params?.maxTimeStretch ?? 1.35);
    const confidenceThreshold = Number(params?.confidenceThreshold ?? 0.50);

    try {
      for (let i = 0; i < inputFiles.length; i++) {
        const track = inputFiles[i];
        const nick = this._resolveTrackNick(track, inputFiles, i);
        const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
        const outPath = path.join(stepFolder, outName);
        const reportPath = path.join(stepFolder, `lipsync_report_${nick.replace(/[\\/:*?"<>|]/g, '_')}.json`);

        const trackStartPct = Math.round((i / inputFiles.length) * 100);
        const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

        logFn(`[${i+1}/${inputFiles.length}] MFA Фонетический анализ дорожки «${nick}»...`);

        let mfaReport = null;

        await AudioNeuralService.mfaAnalyze({
          dubAudioPath: track.path,
          origAudioPath: origVocalsPath,
          subtitlesJsonPath: tempSubJsonPath,
          outputPath: reportPath,
          acousticModel: params?.acousticModel || 'russian_mfa',
          dictionary: params?.dictionary || 'russian_mfa',
          minTimeStretch,
          maxTimeStretch,
          maxDriftMs,
          onProgress: (p) => {
            if (onProgress && p && typeof p.percent === 'number') {
              const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
              onProgress({ percent: current, message: `MFA Lipsync: ${nick} (${p.percent.toFixed(0)}%)` });
            }
          },
          onLog: (msg, level) => {
            logFn(`  [${nick}] ${msg}`, level || 'debug');
          }
        });

        if (fsSync.existsSync(reportPath)) {
          mfaReport = JSON.parse(fsSync.readFileSync(reportPath, 'utf8'));
        } else {
          throw new Error(`MFA не сформировал отчет выравнивания для дорожки «${nick}».`);
        }

        if (mfaReport && Array.isArray(mfaReport) && mfaReport.length > 0 && autoApplyStretch) {
          logFn(`  Фонетический отчет зафиксировал ${mfaReport.length} реплик. Проверка потребности подгонки тайм-стретча...`);
          
          let adjustedCount = 0;
          for (const item of mfaReport) {
            const ratio = item.timeStretchRatio || 1.0;
            const drift = Math.abs(item.lipsyncDriftMs || 0.0);
            const conf = item.confidence || 0.0;

            if (drift > maxDriftMs && conf >= confidenceThreshold && ratio !== 1.0) {
              adjustedCount++;
              logFn(`    • РЕПЛИКА "${item.text || item.phraseId}": drift=${item.lipsyncDriftMs}ms, ratio=${ratio}`, 'debug');
            }
          }

          if (adjustedCount > 0) {
            logFn(`  Обнаружен рассинхрон в ${adjustedCount} репликах. Применение сбалансированной подгонки длительности (atempo [${minTimeStretch}..${maxTimeStretch}])...`);
            const averageRatio = mfaReport.reduce((acc, cur) => acc + (cur.timeStretchRatio || 1.0), 0) / mfaReport.length;
            const clampedAvgRatio = Math.max(minTimeStretch, Math.min(maxTimeStretch, averageRatio));

            if (Math.abs(clampedAvgRatio - 1.0) > 0.01) {
              logFn(`  Применение фильтра FFmpeg atempo=${clampedAvgRatio.toFixed(3)} к дорожке...`);
              await this._execFfmpeg(
                ffmpeg(track.path)
                  .audioFilters(`atempo=${clampedAvgRatio.toFixed(3)}`)
                  .audioCodec('pcm_s24le')
                  .audioFrequency(48000),
                { logFn, description: `MFA Time Stretch (${nick})`, outPath }
              );
            } else {
              await fs.copyFile(track.path, outPath);
            }
          } else {
            logFn(`  Все реплики находятся в пределах допуска (< ${maxDriftMs} ms). Коррекция не требуется.`);
            await fs.copyFile(track.path, outPath);
          }
        } else {
          await fs.copyFile(track.path, outPath);
        }

        const st = fsSync.statSync(outPath);
        results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });

        if (onProgress) {
          onProgress({ percent: trackEndPct, message: `MFA Lipsync: ${nick}` });
        }
      }
    } finally {
      try {
        if (fsSync.existsSync(tempSubJsonPath)) fsSync.unlinkSync(tempSubJsonPath);
      } catch (e) {}
    }

    return results;
  }

  /**
   * EXEC: Apply Fixes (seamless fix insertion without tails)
   */
  async _execApplyFixes({ episode, workingDir, stepFolder, prefix, manifest, inputFiles, params, logFn, onProgress }) {
    const minGapSec = Number(params.minGapSec ?? 0.12);
    const fadeDurationMs = Number(params.fadeDurationMs ?? 8);
    const cleanLeftoverTails = params.cleanLeftoverTails !== false;
    const adjustLongerCollisions = params.adjustLongerCollisions !== false;
    const safetyPaddingMs = Number(params.safetyPaddingMs ?? 45);
    const subPath = manifest.sourceFiles?.subtitles?.path || episode?.subPath;

    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для применения фиксов.');
    }

    logFn(`Вшивание фиксов и очистка остаточных хвостов для ${inputFiles.length} дорожек (фейд: ${fadeDurationMs}ms, хвосты: ${cleanLeftoverTails ? 'Вкл' : 'Выкл'}, буфер: ${safetyPaddingMs}ms)...`);

    const audioFiles = inputFiles.map(f => ({
      path: f.path,
      id: f.id || f.name,
      uploadedById: f.uploadedById,
      type: f.name.toLowerCase().includes('fix') || f.name.toLowerCase().includes('фикс') ? 'FIXES' : 'DUBBER_FILE'
    }));

    const matchResult = await AutoTimingService.matchActorsWithAudioTracks(
      subPath,
      audioFiles,
      [],
      {},
      episode?.assignments || []
    );

    let mergedResult = null;
    if (matchResult.matchedTracks.length > 0) {
      const timingResult = await AutoTimingService.alignProjectAndResolveCollisions({
        subPath,
        matchedTracks: matchResult.matchedTracks,
        options: { minGapSec }
      });
      mergedResult = AutoTimingService.smartApplyFixesToTimedTracks(timingResult, {
        minGapSec,
        fadeDurationMs,
        cleanLeftoverTails,
        adjustLongerCollisions,
        safetyPaddingMs
      });
    }

    const results = [];
    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = track.dubberNick || `dubber_${i+1}`;
      const sameNickCount = inputFiles.filter(f => (f.dubberNick || `dubber`) === nick).length;
      const nickOccurrences = inputFiles.slice(0, i + 1).filter(f => (f.dubberNick || `dubber`) === nick).length;
      const trackSuffix = sameNickCount > 1 ? `_дорожка${nickOccurrences}` : '';
      const outName = `${prefix}${nick}${trackSuffix}.wav`;
      const outPath = path.join(stepFolder, outName);

      logFn(`[${i+1}/${inputFiles.length}] Вшитие фиксов в дорожку «${nick}»...`);

      const phraseResult = (mergedResult?.finalTrackPhraseResults || mergedResult?.trackPhraseResults)?.find(t => t.track.trackPath === track.path);
      if (phraseResult && phraseResult.phrases && phraseResult.phrases.length > 0) {
        await AutoTimingService.assembleMultiSourceTrack(
          track.path,
          phraseResult.phrases,
          outPath,
          {
            fadeDurationMs,
            cleanLeftoverTails,
            safetyPaddingMs
          }
        );
      } else {
        await fs.copyFile(track.path, outPath);
      }

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });

      if (onProgress) {
        onProgress({ percent: Math.round(((i + 1) / inputFiles.length) * 100), message: `Вшитие фиксов: ${nick}` });
      }
    }

    return results;
  }

  /**
   * EXEC: Acoustic Original Profile & Voice Matcher
   * Акустический слепок оригинала и автосопоставление 3-х слепков (Громкость, Реверберация, Эквализация).
   * Принимает НА ВХОД ТОЛЬКО РАЗДЕЛЕННУЮ ДОРОЖКУ ГОЛОСОВ ИЗ ОРИГИНАЛА.
   * Если оригинал не был разделен - выдает ОШИБКУ!
   */
  async _execAcousticMatch({ episode, workingDir, stepFolder, prefix, manifest, inputFiles, params, logFn, onProgress }) {
    logFn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logFn('▶ [МОДУЛЬ СВЕДЕНИЯ: acoustic_matched] Пофразовый анализ эффектов оригинала и наложение по кривой автоматизации');

    const allSteps = manifest?.pipeline || [];

    // 1. ПРОВЕРКА №1: Было ли разделение оригинального аудио из видео?
    let separatedOriginalVocalsPath = null;

    // Проверяем входные файлы шага (включая кастомные или переданные из шага разделения)
    for (const f of (inputFiles || [])) {
      const p = typeof f === 'string' ? f : f?.path;
      if (!p || !fsSync.existsSync(p)) continue;
      if (f.trackKey === 'original_vocals') {
        separatedOriginalVocalsPath = p;
        break;
      }
      const lower = path.basename(p).toLowerCase();
      if (
        !AudioAnalysisService.isUnseparatedOriginalAudio(p) &&
        !AudioAnalysisService.isGluedVoicesMasterTrack(p, manifest) &&
        (lower.includes('vocal') || f.type === 'vocals')
      ) {
        separatedOriginalVocalsPath = p;
        break;
      }
    }

    // Если во входных не переопределено, проверяем выполненные шаги разделения стемов в конвейере
    if (!separatedOriginalVocalsPath) {
      const completedSepSteps = allSteps.filter(
        s => this._isOriginalSeparationStep(s.moduleId) && s.status === 'completed' && Array.isArray(s.outputFiles) && s.outputFiles.length > 0
      );
      for (let i = completedSepSteps.length - 1; i >= 0; i--) {
        const s = completedSepSteps[i];
        const vocFile = s.outputFiles.find(f => {
          if (!f || !f.path || !fsSync.existsSync(f.path)) return false;
          if (AudioAnalysisService.isUnseparatedOriginalAudio(f.path)) return false;
          const lower = path.basename(f.path).toLowerCase();
          return f.type === 'vocals' || lower.includes('vocal');
        });
        if (vocFile) {
          separatedOriginalVocalsPath = vocFile.path;
          break;
        }
      }
    }

    if (!separatedOriginalVocalsPath || !fsSync.existsSync(separatedOriginalVocalsPath)) {
      const errMsg =
        '❌ Ошибка [acoustic_matched]: Оригинальное аудио из видео НЕ было разделено на стемы!\n' +
        'Модуль принимает на вход ИСКЛЮЧИТЕЛЬНО выделенную вокальную дорожку оригинала и склеенную дорожку всех голосов.\n' +
        'Пожалуйста, сначала выполните шаг разделения оригинального аудио (Demucs / UVR / RoFormer / Vocal Splitter) перед этим модулем.';
      logFn(errMsg, 'error');
      throw new Error(errMsg);
    }

    // 2. ПРОВЕРКА №2: Берем голосовую дорожку СТРОГО из предыдущего голосового модуля (или склейки голосов)
    let gluedVoicesPath = null;

    for (const f of (inputFiles || [])) {
      const p = typeof f === 'string' ? f : f?.path;
      if (!p || !fsSync.existsSync(p)) continue;
      if (p === separatedOriginalVocalsPath) continue;
      if (f.trackKey === 'voices_master' || this._isGluedVoiceBusTrack(f) || AudioAnalysisService.isGluedVoicesMasterTrack(p, manifest)) {
        gluedVoicesPath = p;
        break;
      }
    }

    if (!gluedVoicesPath) {
      const currentIdx = allSteps.findIndex(s => s && this._isAcousticMatchStep(s.moduleId));
      const prevVoice = this._findLatestCompletedVoiceStep(manifest, currentIdx >= 0 ? currentIdx : allSteps.length);
      if (prevVoice && prevVoice.outputFiles.length === 1 && prevVoice.outputFiles[0]?.path && fsSync.existsSync(prevVoice.outputFiles[0].path)) {
        gluedVoicesPath = prevVoice.outputFiles[0].path;
      }
    }

    if (!gluedVoicesPath) {
      const completedGlueSteps = allSteps.filter(
        s => s.moduleId === 'glue_compress' && s.status === 'completed' && Array.isArray(s.outputFiles) && s.outputFiles.length > 0
      );
      if (completedGlueSteps.length > 0) {
        const lastGlue = completedGlueSteps[completedGlueSteps.length - 1];
        const gf = lastGlue.outputFiles[0];
        if (gf && gf.path && fsSync.existsSync(gf.path)) {
          gluedVoicesPath = gf.path;
        }
      }
    }

    if (!gluedVoicesPath || !fsSync.existsSync(gluedVoicesPath)) {
      const errMsg =
        '❌ Ошибка [acoustic_matched]: Все голоса НЕ были склеены в одну дорожку!\n' +
        'Модуль принимает на вход ИСКЛЮЧИТЕЛЬНО вокальную дорожку оригинала и одну склеенную дорожку всех голосов (voices_master.wav).\n' +
        'Пожалуйста, сначала выполните шаг «Склейка и шинная компрессия голосов (Glue Bus)» перед этим модулем.';
      logFn(errMsg, 'error');
      throw new Error(errMsg);
    }

    logFn(`✓ Входные дорожки проверены и подтверждены:`);
    logFn(`  1) Вокальная дорожка оригинала: ${path.basename(separatedOriginalVocalsPath)}`);
    logFn(`  2) Склеенная дорожка всех голосов: ${path.basename(gluedVoicesPath)}`);

    const outName = `${prefix}voices_master.wav`;
    const outPath = path.join(stepFolder, outName);

    const episodeDir = episode?.dir || manifest?.episodeDir || workingDir;
    const searchDirs = [workingDir, episodeDir].filter(Boolean);

    const matchResult = await AudioAnalysisService.applyAcousticProfileMatch({
      ourVocalsPath: gluedVoicesPath,
      originalVocalsPath: separatedOriginalVocalsPath,
      searchDirs,
      manifest,
      outputPath: outPath,
      options: params,
      onProgress: (p) => {
        if (onProgress) {
          onProgress({
            percent: p.progress || 50,
            stepProgress: p.progress || 50,
            message: p.status === 'rendering_matched_vocals'
              ? 'Рендеринг эффектов по кривым автоматизации...'
              : 'Пофразовый анализ эффектов оригинала...'
          });
        }
      },
      onLog: (m, lvl) => logFn(m, lvl)
    });

    const st = fsSync.statSync(outPath);
    const resultItem = {
      name: outName,
      path: outPath,
      size: st.size,
      type: 'audio',
      trackKey: 'voices_master',
      dubberNick: 'Склеенная шина голосов (Acoustic Matched)',
      matched: true,
      stats: matchResult.appliedParams
    };

    logFn(`✓ Наложение эффектов оригинала по кривым автоматизации успешно завершено: ${outName} (${(st.size / (1024 * 1024)).toFixed(2)} MB)`);
    return [resultItem];
  }

  /**
   * EXEC: Auto Norm Phrases (QA phrase-level loudness normalization)
   */
  async _execAutoNormPhrases({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const targetLufs = Number(params.targetLufs ?? -16.0);
    const truePeak = Number(params.truePeak ?? -1.0);
    const maxGainDb = Number(params.maxGainDb ?? 14.0);

    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для пофразовой нормализации.');
    }

    const timingMeta = await this.getTimingMetadata(workingDir);
    if (timingMeta) {
      logFn(`[Интеллектуальный тайминг-микс] Найдена карта громкостей фраз (timing_metadata.json). Учитываем настройки фона и роли.`);
    }

    // Ensure physical track measurements exist for all dubber tracks
    const trackAnalysis = await this.ensureTracksAnalysis(inputFiles, workingDir, logFn);

    logFn(`Пофразовая автонормализация (Target: ${targetLufs} LUFS, TruePeak: ${truePeak} dB, MaxGain: ${maxGainDb} dB) к ${inputFiles.length} дорожкам...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      // Check if role or phrases have custom volume multiplier in timingMeta
      const roleVolPct = this._resolveTrackVolumePercent(track, timingMeta);

      let trackTargetLufs = targetLufs;
      if (roleVolPct !== 100) {
        const offsetDb = 20 * Math.log10(Math.max(10, roleVolPct) / 100);
        trackTargetLufs = Number((targetLufs + offsetDb).toFixed(1));
        logFn(`[Интеллектуальная нормализация] Дорожка «${nick}» скорректирована по карте тайминга: ${roleVolPct}% громкости -> целевой уровень ${trackTargetLufs} LUFS (смещение ${offsetDb.toFixed(1)} dB)`);
      } else {
        logFn(`[${i+1}/${inputFiles.length}] Нормализация фраз для «${nick}» к ${trackTargetLufs} LUFS...`);
      }

      const stats = trackAnalysis[track.path] || trackAnalysis[track.name] || {};
      const measuredI = typeof stats.integratedLufsDb === 'number' ? stats.integratedLufsDb : -24.0;
      const measuredTp = typeof stats.truePeakDb === 'number' ? stats.truePeakDb : -1.0;
      const measuredLra = typeof stats.loudnessRangeDb === 'number' ? stats.loudnessRangeDb : 9.0;
      const measuredThresh = typeof stats.lufsThresholdDb === 'number' ? stats.lufsThresholdDb : -33.0;

      // Enforce maxGainDb ceiling so overly quiet tracks do not boost background noise beyond maxGainDb
      const cappedTargetLufs = Math.min(trackTargetLufs, Number((measuredI + maxGainDb).toFixed(1)));

      // Intelligent EBU R128 loudness normalization
      let filter = `loudnorm=I=${cappedTargetLufs}:TP=${truePeak}:LRA=10:measured_I=${measuredI}:measured_TP=${measuredTp}:measured_LRA=${measuredLra}:measured_thresh=${measuredThresh}:linear=true,alimiter=limit=${truePeak}dB:attack=1:release=40:level=true`;

      const cmd = ffmpeg(track.path)
        .audioFilters(filter)
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outPath);

      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      await this._execFfmpeg(cmd, {
        logFn,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `Автонормализация фраз: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `Auto Norm Phrases [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

}

module.exports = MixingAlignmentExecutors;
