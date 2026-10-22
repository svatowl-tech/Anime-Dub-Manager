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

class MixingMasterExecutors {
  /**
   * EXEC: Sidechain Ducking (STANDALONE MODULE)
   */
  async _execDucking({ episode, workingDir, stepFolder, prefix, manifest, inputFiles, params, logFn, onProgress }) {
    const duckingAmountDb = Number(params.duckingAmountDb ?? -14.0);
    const attackMs = Number(params.attackMs ?? 40);
    const releaseMs = Number(params.releaseMs ?? 320);
    const threshold = Number(params.threshold ?? 0.08);

    const epDir = this.getEpisodeDir(episode);
    const parentDir = path.dirname(workingDir);
    const rawDir = path.join(workingDir, '00_исходные');

    let origAudioPath = manifest.sourceFiles?.originalAudio?.path;
    if (!origAudioPath || !fsSync.existsSync(origAudioPath)) {
      const candidates = [
        path.join(rawDir, '00_original_audio.wav'),
        path.join(workingDir, '00_original_audio.wav'),
        path.join(workingDir, 'original_audio.wav'),
        path.join(parentDir, '00_original_audio.wav'),
        path.join(parentDir, 'original_audio.wav'),
        path.join(epDir, '00_original_audio.wav'),
        path.join(epDir, 'original_audio.wav')
      ];
      origAudioPath = candidates.find(c => c && fsSync.existsSync(c)) || null;
    }

    if (!origAudioPath || !fsSync.existsSync(origAudioPath)) {
      let vPath = manifest.sourceFiles?.video?.path || episode?.rawPath;
      if (!vPath || !fsSync.existsSync(vPath)) {
        const videoExtRegex = /\.(mp4|mkv|mov|avi|webm)$/i;
        const searchDirs = [workingDir, rawDir, parentDir, epDir].filter(d => d && fsSync.existsSync(d));
        for (const dir of searchDirs) {
          try {
            const files = fsSync.readdirSync(dir);
            const vid = files.find(f => videoExtRegex.test(f) && !f.includes('[СВЕДЕНО]') && !f.includes('video_mux'));
            if (vid) {
              vPath = path.join(dir, vid);
              break;
            }
          } catch (e) {}
        }
      }

      if (!vPath || !fsSync.existsSync(vPath)) {
        throw new Error('Оригинальное видео или аудио не найдено для даккинга (проверьте наличие видеофайла серии).');
      }

      origAudioPath = path.join(rawDir, '00_original_audio.wav');
      await fs.mkdir(path.dirname(origAudioPath), { recursive: true });
      logFn(`Извлечение аудиодорожки оригинала из видео «${path.basename(vPath)}» для даккинга...`);
      await this._extractAudioFromVideo(vPath, origAudioPath, logFn);
      manifest.sourceFiles.originalAudio = { name: '00_original_audio.wav', path: origAudioPath, size: fsSync.statSync(origAudioPath).size, exists: true };
    }

    // Управляющая голосовая дорожка сайдчейна: СТРОГО из входных файлов шага (результат последнего предыдущего голосового модуля)
    let voicePath = null;
    const voiceInputCandidate = (inputFiles || []).find(
      f => f && f.path && fsSync.existsSync(f.path) && f.trackKey !== 'background_audio' && path.resolve(f.path) !== path.resolve(origAudioPath)
    );
    if (voiceInputCandidate) {
      voicePath = voiceInputCandidate.path;
      logFn(`Управляющая голосовая дорожка для даккинга (${voiceInputCandidate.sourceLabel || 'предыдущий голосовой шаг'}): ${path.basename(voicePath)}`);
    }
    if (!voicePath) {
      const duckStepIdx = (manifest.pipeline || []).findIndex(s => s && s.moduleId === 'ducking');
      const prevVoice = this._findLatestCompletedVoiceStep(manifest, duckStepIdx >= 0 ? duckStepIdx : (manifest.pipeline || []).length);
      if (prevVoice && prevVoice.outputFiles[0]?.path && fsSync.existsSync(prevVoice.outputFiles[0].path)) {
        voicePath = prevVoice.outputFiles[0].path;
        logFn(`Управляющая голосовая дорожка для даккинга (из шага #${prevVoice.stepNumber} ${prevVoice.step.moduleId}): ${path.basename(voicePath)}`);
      }
    }
    if (!voicePath) {
      throw new Error('Голосовая дорожка отсутствует. Сначала выполните предыдущий голосовой модуль.');
    }

    const outName = `${prefix}ducked_original.wav`;
    const outPath = path.join(stepFolder, outName);

    const filterMusicOnly = params.filterMusicOnly !== false;
    const absDuckDb = Math.max(1, Math.min(36, Math.abs(duckingAmountDb)));
    const scRatio = Math.max(1.5, Math.min(20, Number((1.0 + absDuckDb / 3.0).toFixed(1))));
    const scKnee = Math.max(1.0, Math.min(8.0, Number((absDuckDb / 4.0).toFixed(1))));
    const safeThreshold = Math.max(0.001, Math.min(0.5, threshold));

    logFn(`Сайдчейн-даккинг оригинального звука (приглушение: -${absDuckDb} dB [Ratio ${scRatio}:1], Атака: ${attackMs}ms, Спад: ${releaseMs}ms, Только СЧ-полоса речи: ${filterMusicOnly ? 'Вкл' : 'Выкл'})...`);

    const filter = filterMusicOnly
      ? `[0:a]volume=0.95,asplit=2[bg_sub][bg_main];[bg_sub]lowpass=f=220[sub_keep];[bg_main]highpass=f=220[mid_hi];[mid_hi][1:a]sidechaincompress=threshold=${safeThreshold}:ratio=${scRatio}:attack=${attackMs}:release=${releaseMs}:knee=${scKnee}:makeup=1[mid_ducked];[sub_keep][mid_ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[ducked]`
      : `[0:a]volume=0.95[orig];[orig][1:a]sidechaincompress=threshold=${safeThreshold}:ratio=${scRatio}:attack=${attackMs}:release=${releaseMs}:knee=${scKnee}:makeup=1[ducked]`;

    const duckCmd = ffmpeg()
      .input(origAudioPath)
      .input(voicePath)
      .complexFilter(filter, ['ducked'])
      .audioCodec('pcm_s16le')
      .audioChannels(2)
      .audioFrequency(48000)
      .output(outPath);

    await this._execFfmpeg(duckCmd, {
      logFn,
      onProgress: (p) => {
        if (onProgress && p && p.percent) onProgress({ percent: Math.round(p.percent), message: 'Сайдчейн-даккинг...' });
      },
      outPath,
      description: 'Сайдчейн-даккинг оригинального звука под голос'
    });

    const st = fsSync.statSync(outPath);
    logFn(`Даккинг завершен. Обработанный фоновый звук сохранен: ${outName} (${(st.size / (1024*1024)).toFixed(2)} MB)`);
    return [{ name: outName, path: outPath, size: st.size }];
  }

  /**
   * EXEC: Master Audio Mix (STANDALONE MODULE)
   */
  async _execMasterMix({ episode, workingDir, stepFolder, prefix, manifest, inputFiles, params, logFn, onProgress }) {
    const voiceVolume = Number(params.voiceVolume ?? 1.0);
    const bgVolume = Number(params.bgVolume ?? 0.85);
    const stereoWidth = Number(params.stereoWidth ?? 1.15);
    const ceilingDb = Number(params.limiterCeilingDb ?? -0.5);
    const limiterReleaseMs = Number(params.limiterReleaseMs ?? 40);

    const epDir = this.getEpisodeDir(episode);
    const parentDir = path.dirname(workingDir);
    const rawDir = path.join(workingDir, '00_исходные');

    // 1. Поиск фоновой / оригинальной дорожки (Background / Instrumental)
    let duckedAudioPath = null;
    const explicitBgInput = (inputFiles || []).find(f => f && f.trackKey === 'background_audio' && f.path && fsSync.existsSync(f.path));
    if (explicitBgInput) {
      duckedAudioPath = explicitBgInput.path;
      logFn(`Использована фоновая дорожка (${explicitBgInput.sourceLabel || 'фон'}): ${path.basename(duckedAudioPath)}`);
    }

    if (!duckedAudioPath) {
      const duckingStep = [...(manifest.pipeline || [])].reverse().find(s => s && s.enabled && s.moduleId === 'ducking' && s.outputFiles?.length > 0);
      if (duckingStep && duckingStep.outputFiles[0] && fsSync.existsSync(duckingStep.outputFiles[0].path)) {
        duckedAudioPath = duckingStep.outputFiles[0].path;
        logFn(`Использован результат даккинга как фон: ${path.basename(duckedAudioPath)}`);
      }
    }

    // 2. Проверяем готовый инструментал из разделения стемов (Demucs / UVR / MDX / RoFormer)
    if (!duckedAudioPath || !fsSync.existsSync(duckedAudioPath)) {
      const stemSteps = (manifest.pipeline || []).filter(s => s && s.enabled && this._isOriginalSeparationStep(s.moduleId) && s.outputFiles?.length > 0);
      for (let i = stemSteps.length - 1; i >= 0; i--) {
        const stStep = stemSteps[i];
        const instFile = (stStep.outputFiles || []).find(f => f.type === 'instrumental' || f.name?.includes('no_vocals') || f.name?.includes('instrumental') || f.name?.includes('_ME'));
        if (instFile && fsSync.existsSync(instFile.path)) {
          duckedAudioPath = instFile.path;
          logFn(`Использован инструментальный стем этапа «${stStep.moduleId}» в качестве фона: ${instFile.name}`);
          break;
        }
      }
    }

    if ((!duckedAudioPath || !fsSync.existsSync(duckedAudioPath)) && manifest.sourceFiles?.originalAudio?.path && fsSync.existsSync(manifest.sourceFiles.originalAudio.path)) {
      duckedAudioPath = manifest.sourceFiles.originalAudio.path;
      logFn(`Использована оригинальная аудиодорожка из манифеста: ${path.basename(duckedAudioPath)}`);
    }

    // 3. Проверяем наличие аудиофайлов на диске
    if (!duckedAudioPath || !fsSync.existsSync(duckedAudioPath)) {
      const candidates = [
        path.join(rawDir, '00_original_audio.wav'),
        path.join(workingDir, '00_original_audio.wav'),
        path.join(workingDir, 'original_audio.wav'),
        path.join(parentDir, '00_original_audio.wav'),
        path.join(parentDir, 'original_audio.wav'),
        path.join(rawDir, 'original_audio.wav'),
        path.join(epDir, '00_original_audio.wav'),
        path.join(epDir, 'original_audio.wav')
      ];
      duckedAudioPath = candidates.find(c => c && fsSync.existsSync(c)) || null;
      if (duckedAudioPath) {
        logFn(`Найдена фоновая аудиодорожка: ${path.basename(duckedAudioPath)}`);
      }
    }

    // 4. Если аудио нет, но есть видео — извлекаем на лету!
    if (!duckedAudioPath || !fsSync.existsSync(duckedAudioPath)) {
      let vPath = manifest.sourceFiles?.video?.path || episode?.rawPath;
      if (!vPath || !fsSync.existsSync(vPath)) {
        const videoExtRegex = /\.(mp4|mkv|mov|avi|webm)$/i;
        const searchDirs = [workingDir, rawDir, parentDir, epDir].filter(d => d && fsSync.existsSync(d));
        for (const dir of searchDirs) {
          try {
            const files = fsSync.readdirSync(dir);
            const vid = files.find(f => videoExtRegex.test(f) && !f.includes('[СВЕДЕНО]') && !f.includes('video_mux'));
            if (vid) {
              vPath = path.join(dir, vid);
              break;
            }
          } catch (e) {}
        }
      }

      if (vPath && fsSync.existsSync(vPath)) {
        logFn(`Извлечение фонового аудио из видеоряда «${path.basename(vPath)}» для мастер-микса...`);
        const outAudio = path.join(rawDir, '00_original_audio.wav');
        try {
          if (!fsSync.existsSync(path.dirname(outAudio))) {
            fsSync.mkdirSync(path.dirname(outAudio), { recursive: true });
          }
          await this._extractAudioFromVideo(vPath, outAudio, logFn);
          if (fsSync.existsSync(outAudio)) {
            duckedAudioPath = outAudio;
            const st = fsSync.statSync(outAudio);
            manifest.sourceFiles.originalAudio = { name: '00_original_audio.wav', path: outAudio, size: st.size, exists: true };
            manifest.sourceFiles.video = { name: path.basename(vPath), path: vPath, size: fsSync.statSync(vPath).size, exists: true };
            logFn('✓ Оригинальное аудио успешно извлечено и подключено как фон.');
          }
        } catch (extractErr) {
          log.warn('[Mixing] Could not extract background audio from video:', extractErr.message);
        }
      }
    }

    if (!duckedAudioPath || !fsSync.existsSync(duckedAudioPath)) {
      throw new Error('Фоновое аудио не найдено для сведения (проверьте наличие видеофайла серии или аудио оригинала в 00_исходные).');
    }

    // 5. Поиск мастер-дорожки голосов (Vocals Master)
    // СТРОГОЕ ПРАВИЛО: Берем результат последнего предшествующего голосового модуля (например, 10-го этапа),
    // а НЕ перепрыгиваем назад на этап первой склейки (glue_compress), если после склейки шли другие голосовые модули!
    let voicePath = null;
    const timingMeta = await this.getTimingMetadata(workingDir);

    const voiceInputs = (inputFiles || []).filter(
      f => f && f.path && fsSync.existsSync(f.path) &&
           f.trackKey !== 'background_audio' &&
           path.resolve(f.path) !== path.resolve(duckedAudioPath) &&
           !(f.name || '').toLowerCase().includes('ducked')
    );

    if (voiceInputs.length === 1) {
      voicePath = voiceInputs[0].path;
      logFn(`Использована голосовая дорожка (${voiceInputs[0].sourceLabel || 'предыдущий голосовой этап'}): ${path.basename(voicePath)}`);
    } else if (voiceInputs.length > 1) {
      logFn(`Склейка ${voiceInputs.length} входных голосовых дорожек с учетом громкости ролей для мастер-микса...`);
      const tempVoicePath = path.join(stepFolder, 'temp_combined_voices.wav');
      let joinCmd = ffmpeg();
      voiceInputs.forEach(t => { joinCmd = joinCmd.input(t.path); });

      const filterParts = [];
      const mixInputs = [];
      for (let i = 0; i < voiceInputs.length; i++) {
        const tr = voiceInputs[i];
        const roleVolPct = this._resolveTrackVolumePercent(tr, timingMeta);
        const userVolGainDb = roleVolPct !== 100 ? (20 * Math.log10(Math.max(10, roleVolPct) / 100)) : 0;
        if (userVolGainDb !== 0) {
          filterParts.push(`[${i}:a]volume=${userVolGainDb.toFixed(1)}dB[vol_${i}]`);
          mixInputs.push(`[vol_${i}]`);
        } else {
          mixInputs.push(`[${i}:a]`);
        }
      }
      filterParts.push(`${mixInputs.join('')}amix=inputs=${voiceInputs.length}:dropout_transition=0:normalize=0[mixout]`);

      joinCmd
        .complexFilter(filterParts.join(';'), ['mixout'])
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(tempVoicePath);
      await this._execFfmpeg(joinCmd, { logFn, outPath: tempVoicePath, description: 'Склейка голосов для мастера' });
      if (fsSync.existsSync(tempVoicePath)) {
        voicePath = tempVoicePath;
      }
    }

    // Фоллбэк: если во входных файлах не оказалось голосовых дорожек, ищем последний выполненный голосовой шаг перед master_audio_mix
    if (!voicePath) {
      const mixStepIdx = (manifest.pipeline || []).findIndex(s => s && s.moduleId === 'master_audio_mix');
      const prevVoice = this._findLatestCompletedVoiceStep(manifest, mixStepIdx >= 0 ? mixStepIdx : (manifest.pipeline || []).length);
      if (prevVoice && prevVoice.outputFiles[0]?.path && fsSync.existsSync(prevVoice.outputFiles[0].path)) {
        voicePath = prevVoice.outputFiles[0].path;
        logFn(`Использован результат последнего голосового шага #${prevVoice.stepNumber} (${prevVoice.step.moduleId}): ${path.basename(voicePath)}`);
      }
    }

    if (!voicePath || !fsSync.existsSync(voicePath)) {
      throw new Error('Голосовой мастер-файл не найден для сведения.');
    }

    if (path.resolve(voicePath) === path.resolve(duckedAudioPath)) {
      throw new Error('Конфликт сведения: дорожка голоса совпадает с фоновой дорожкой.');
    }

    const outName = `${prefix}master_audio.wav`;
    const outPath = path.join(stepFolder, outName);

    logFn(`Сведение мастер-аудио: голос «${path.basename(voicePath)}» (${voiceVolume}x), фон «${path.basename(duckedAudioPath)}» (${bgVolume}x, стереобаза: ${stereoWidth}x, потолок: ${ceilingDb}dB)...`);

    const filter = `[0:a]volume=${bgVolume},extrastereo=m=${stereoWidth}[bg];[1:a]volume=${voiceVolume}[voc];[bg][voc]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=${ceilingDb}dB:attack=5:release=${limiterReleaseMs}[mixout]`;

    const masterCmd = ffmpeg()
      .input(duckedAudioPath)
      .input(voicePath)
      .complexFilter(filter, ['mixout'])
      .audioCodec('pcm_s16le')
      .audioChannels(2)
      .audioFrequency(48000)
      .output(outPath);

    await this._execFfmpeg(masterCmd, {
      logFn,
      onProgress: (p) => {
        if (onProgress && p && p.percent) onProgress({ percent: Math.round(p.percent), message: 'Сведение мастер-аудио...' });
      },
      outPath,
      description: 'Финальный мастер-микс аудиодорожек'
    });

    const st = fsSync.statSync(outPath);
    logFn(`Финальный мастер-аудиофайл готов: ${outName} (${(st.size / (1024*1024)).toFixed(2)} MB)`);
    return [{ name: outName, path: outPath, size: st.size }];
  }

  /**
   * EXEC: Final Video Mux (STANDALONE MODULE)
   */
  async _execVideoMux({ episode, workingDir, stepFolder, prefix, manifest, inputFiles, params, logFn, onProgress }) {
    const audioBitrate = params.audioBitrate || '320k';
    const videoCodec = params.videoCodec || 'copy';

    let masterAudioPath = null;
    const mixStep = manifest.pipeline.find(s => s.moduleId === 'master_audio_mix' && s.outputFiles?.length > 0);
    if (mixStep && mixStep.outputFiles[0]) {
      masterAudioPath = mixStep.outputFiles[0].path;
    } else if (inputFiles.length > 0) {
      masterAudioPath = inputFiles[0].path;
    }

    if (!masterAudioPath || !fsSync.existsSync(masterAudioPath)) {
      throw new Error('Мастер-аудиодорожка отсутствует. Сначала выполните модуль «Мастер-микс аудио».');
    }

    const videoPath = manifest.sourceFiles.video?.path || episode?.rawPath;
    if (!videoPath || !fsSync.existsSync(videoPath)) {
      throw new Error('Видеофайл серии не найден.');
    }

    const projectTitle = sanitizeProjectTitle(episode?.project?.title || 'Project');
    const epNum = episode?.number !== undefined ? episode.number : 1;
    const finalVideoName = `${prefix}${projectTitle}_Серия_${epNum}_[СВЕДЕНО].mp4`;
    const finalVideoPath = path.join(stepFolder, finalVideoName);

    logFn(`Вшивание звука «${path.basename(masterAudioPath)}» в видеоряд «${path.basename(videoPath)}» (${videoCodec === 'copy' ? 'быстрое копирование потока' : 'транскодирование'})...`);

    const muxCmd = ffmpeg()
      .input(videoPath)
      .input(masterAudioPath);

    const outputOpts = [
      '-map 0:v:0',
      '-map 1:a:0'
    ];

    if (videoCodec === 'copy') {
      outputOpts.push('-c:v copy');
    } else {
      outputOpts.push(
        '-c:v libx264',
        `-crf ${params.crf || 18}`,
        '-preset fast',
        '-pix_fmt yuv420p'
      );
    }

    if (audioBitrate === 'flac') {
      outputOpts.push('-c:a flac');
    } else {
      outputOpts.push('-c:a aac', `-b:a ${audioBitrate || '320k'}`);
    }

    if (finalVideoPath.toLowerCase().endsWith('.mp4') && params.fastStart !== false) {
      outputOpts.push('-movflags +faststart');
    }

    outputOpts.push('-max_muxing_queue_size 1024');

    muxCmd
      .outputOptions(outputOpts)
      .output(finalVideoPath);

    await this._execFfmpeg(muxCmd, {
      logFn,
      onProgress: (p) => {
        if (onProgress && p && p.percent) onProgress({ percent: Math.round(p.percent), message: 'Сборка видео...' });
      },
      outPath: finalVideoPath,
      description: `Сведение видео ${finalVideoName}`
    });

    const st = fsSync.statSync(finalVideoPath);
    const finalVideoObj = { name: finalVideoName, path: finalVideoPath, size: st.size };

    const rootCopyPath = path.join(workingDir, `${projectTitle}_Серия_${epNum}_[СВЕДЕНО].mp4`);
    try {
      if (path.resolve(rootCopyPath) !== path.resolve(finalVideoPath)) {
        await fs.copyFile(finalVideoPath, rootCopyPath);
      }
    } catch (e) {}

    logFn(`Готовая сведенная серия создана: ${finalVideoName} (${(st.size / (1024*1024)).toFixed(2)} MB)`);
    return [finalVideoObj];
  }

  async runAllSteps({ episode, targetDir, baseDir, onProgress, onLog }) {
    this.isAborted = false;
    const workingDir = this.resolveWorkingDir(targetDir, episode, baseDir);
    const statusData = await this.getStatus({ episode, targetDir: workingDir, baseDir });
    const manifest = statusData.manifest;

    const enabledSteps = manifest.pipeline.filter(s => s.enabled);
    if (enabledSteps.length === 0) {
      throw new Error('Все шаги конвейера отключены. Включите хотя бы один модуль.');
    }

    const logFn = (msg, level = 'info', meta = null) => {
      const tag = '[Mixing:Pipeline]';
      if (level === 'error') {
        console.error(`${tag} ❌ ${msg}`, meta || '');
        log.error(`${tag} ${msg}`);
      } else if (level === 'warn') {
        console.warn(`${tag} ⚠️ ${msg}`, meta || '');
        log.warn(`${tag} ${msg}`);
      } else {
        console.log(`${tag} ${msg}`, meta || '');
        log.info(`${tag} ${msg}`);
      }
      if (onLog) onLog(msg, level, { meta });
    };

    const startTime = Date.now();
    logFn(`=======================================================`);
    logFn(`🎬 НАЧАЛО ПОЛНОГО КОНВЕЙЕРА СВЕДЕНИЯ ВИДЕО`);
    logFn(`  Серия: ${episode?.project?.title || 'Проект'} — Эпизод #${episode?.number || 1}`);
    logFn(`  Рабочая директория: ${workingDir}`);
    logFn(`  Всего активных модулей: ${enabledSteps.length}`);
    enabledSteps.forEach((s, idx) => {
      logFn(`    [${idx + 1}/${enabledSteps.length}] ${s.moduleId} (${s.title || ''})`);
    });
    logFn(`=======================================================`);

    for (let i = 0; i < enabledSteps.length; i++) {
      if (this.isAborted) {
        logFn(`⏹ Выполнение цепочки остановлено пользователем.`, 'warn');
        throw new Error('Процесс сведения остановлен пользователем.');
      }

      const step = enabledSteps[i];
      const stepPctStart = Math.round((i / enabledSteps.length) * 100);
      const stepPctEnd = Math.round(((i + 1) / enabledSteps.length) * 100);

      logFn(`--- Запуск этапа ${i + 1}/${enabledSteps.length}: ${step.moduleId} ---`);
      if (onProgress) {
        onProgress({ percent: stepPctStart, message: `Шаг ${i+1}/${enabledSteps.length}: ${step.moduleId}...` });
      }

      await this.runStep({
        episode,
        targetDir: workingDir,
        baseDir,
        stepId: step.stepId,
        _fromChain: true,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const overall = stepPctStart + Math.round((p.percent / 100) * (stepPctEnd - stepPctStart));
            onProgress({ percent: overall, message: p.message });
          }
        },
        onLog
      });
    }

    const totalSec = ((Date.now() - startTime) / 1000).toFixed(2);
    if (onProgress) onProgress({ percent: 100, message: 'Все модули конвейера успешно выполнены!' });
    logFn(`🎉 Полный конвейер сведения успешно завершен за ${totalSec}s!`);
    logFn(`=======================================================`);

    return await this.getStatus({ episode, targetDir: workingDir, baseDir });
  }

  /**
   * Saves timing metadata and phrase volume map JSON into the mixing directory
   */
  async saveTimingMetadata({ episode, targetDir, baseDir, timingMetadata }) {
    const workingDir = this.resolveWorkingDir(targetDir, episode, baseDir);
    await this.ensureDirectory(workingDir);

    const timingFileMain = path.join(workingDir, 'timing_metadata.json');
    const volumeFileMain = path.join(workingDir, 'phrase_volume_map.json');

    const sourceDir = path.join(workingDir, '00_исходные');
    await this.ensureDirectory(sourceDir);
    const timingFileSource = path.join(sourceDir, 'timing_metadata.json');
    const volumeFileSource = path.join(sourceDir, 'phrase_volume_map.json');

    const jsonStr = JSON.stringify(timingMetadata, null, 2);

    await fs.writeFile(timingFileMain, jsonStr, 'utf8');
    await fs.writeFile(volumeFileMain, jsonStr, 'utf8');
    await fs.writeFile(timingFileSource, jsonStr, 'utf8');
    await fs.writeFile(volumeFileSource, jsonStr, 'utf8');

    log.info(`[Mixing] Timing metadata & phrase volume map saved to: ${timingFileMain}`);

    return {
      success: true,
      path: timingFileMain
    };
  }

  /**
   * Helper to load timing metadata & phrase volume map from working directory
   */
  async getTimingMetadata(workingDir) {
    if (!workingDir) return null;

    try {
      const passport = await AudioAnalysisService.getTimingAnalysis(workingDir);
      if (passport) return passport;
    } catch (err) {}

    const candidates = [
      path.join(workingDir, 'timing_project.analysis.json'),
      path.join(workingDir, 'project_timing.analysis.json'),
      path.join(workingDir, 'timing_metadata.json'),
      path.join(workingDir, 'phrase_volume_map.json'),
      path.join(workingDir, '00_исходные', 'timing_metadata.json'),
      path.join(workingDir, '00_исходные', 'phrase_volume_map.json')
    ];

    for (const c of candidates) {
      if (fsSync.existsSync(c)) {
        try {
          const raw = fsSync.readFileSync(c, 'utf8');
          return JSON.parse(raw);
        } catch (e) {
          log.warn(`[Mixing] Error reading timing metadata from ${c}:`, e);
        }
      }
    }
    return null;
  }

  async saveFinalVideo({ episode, targetDir, baseDir, destinationPath }) {
    if (!destinationPath) throw new Error('Укажите путь сохранения видео');
    const workingDir = this.resolveWorkingDir(targetDir, episode, baseDir);
    const statusData = await this.getStatus({ episode, targetDir: workingDir, baseDir });
    const finalVideo = statusData.manifest.finalVideo;

    if (!finalVideo || !finalVideo.path || !fsSync.existsSync(finalVideo.path)) {
      throw new Error('Финальное сведенное видео не найдено. Сначала выполните модуль сведение видео.');
    }

    await this.ensureDirectory(path.dirname(destinationPath));
    await fs.copyFile(finalVideo.path, destinationPath);
    log.info(`[Mixing] Final video copied to ${destinationPath}`);

    return {
      success: true,
      savedPath: destinationPath
    };
  }

  async openFolder(folderPath) {
    if (folderPath && fsSync.existsSync(folderPath)) {
      await shell.openPath(folderPath);
      return { success: true };
    }
    return { success: false, error: 'Папка не существует' };
  }

  /**
   * UVR MODEL: Check installation status of a UVR model
   */
  async checkUvrModelStatus({ modelId = 'uvr_denoise_lite' } = {}) {
    const rootUserData = app ? app.getPath('userData') : process.cwd();
    const uvrModelsDir = path.join(rootUserData, 'models', 'uvr');
    const modelDef = this.moduleDatabase.find(m => m.id === modelId) || this.moduleDatabase.find(m => m.id === 'uvr_denoise_lite');
    const filename = modelDef?.filename || (modelId === 'uvr_deecho_normal' ? 'UVR-De-Echo-Normal.pth' : 'UVR-DeNoise-Lite.pth');
    const localModelFile = path.join(uvrModelsDir, filename);
    const isInstalled = fsSync.existsSync(localModelFile);
    let bytes = null;
    if (isInstalled) {
      try {
        bytes = fsSync.statSync(localModelFile).size;
      } catch (e) {}
    }
    return {
      success: true,
      is_installed: isInstalled,
      installed_bytes: bytes,
      local_path: isInstalled ? localModelFile : null,
      modelInfo: {
        id: modelDef.id,
        name: modelDef.name || modelDef.title,
        filename: modelDef.filename,
        category: modelDef.category,
        description: modelDef.description,
        size_mb: modelDef.size_mb,
        recommended_for: modelDef.recommended_for,
        urls: modelDef.urls || [],
        format: modelDef.format || 'pth',
        engineArchitecture: modelDef.engineArchitecture
      }
    };
  }

  /**
   * UVR MODEL: Download / Activate model file on disk
   */
  async downloadUvrModel({ modelId = 'uvr_denoise_lite', onProgress, onLog } = {}) {
    const rootUserData = app ? app.getPath('userData') : process.cwd();
    const uvrModelsDir = path.join(rootUserData, 'models', 'uvr');
    await fs.mkdir(uvrModelsDir, { recursive: true });

    const modelDef = this.moduleDatabase.find(m => m.id === modelId) || this.moduleDatabase.find(m => m.id === 'uvr_denoise_lite');
    const filename = modelDef?.filename || (modelId === 'uvr_deecho_normal' ? 'UVR-De-Echo-Normal.pth' : 'UVR-DeNoise-Lite.pth');
    const localModelFile = path.join(uvrModelsDir, filename);
    const metaFile = `${localModelFile}.meta.json`;
    const urls = modelDef?.urls || [];
    const sizeMb = modelDef?.size_mb || 40.0;
    const approxBytes = Math.round(sizeMb * 1024 * 1024);

    const isConfig = /\.(yaml|yml|json)$/i.test(filename);
    const minValidExisting = isConfig ? 50 : 1024 * 1024;

    // If an existing file on disk is smaller than threshold, it is likely a corrupted previous placeholder
    if (fsSync.existsSync(localModelFile)) {
      const existingSize = fsSync.statSync(localModelFile).size;
      if (existingSize < minValidExisting) {
        log.warn(`[Mixing] Deleting corrupted previous placeholder file (${existingSize} bytes): ${localModelFile}`);
        try { fsSync.unlinkSync(localModelFile); } catch (e) {}
      } else {
        return {
          success: true,
          id: modelDef.id,
          name: modelDef.name || modelDef.title,
          filename: modelDef.filename,
          installed_bytes: existingSize,
          local_path: localModelFile
        };
      }
    }

    if (onLog) onLog(`Запуск загрузки модели ${filename} (${sizeMb} МБ)...`);

    const downloadFromUrl = (targetUrl) => {
      return new Promise((resolve, reject) => {
        const https = require('https');
        const http = require('http');

        const requestWithRedirect = (curUrl, redirectCount = 0) => {
          if (redirectCount > 8) {
            return reject(new Error('Слишком много перенаправлений'));
          }

          const client = curUrl.startsWith('https') ? https : http;
          const req = client.get(curUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': '*/*'
            }
          }, (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
              res.resume(); // CRITICAL: release socket stream before redirect
              const redirectUrl = new URL(res.headers.location, curUrl).toString();
              return requestWithRedirect(redirectUrl, redirectCount + 1);
            }

            if (res.statusCode !== 200) {
              res.resume();
              return reject(new Error(`HTTP статус: ${res.statusCode}`));
            }

            const totalBytes = parseInt(res.headers['content-length'] || String(approxBytes), 10);
            let downloadedBytes = 0;
            const tempFile = `${localModelFile}.download`;
            const fileStream = fsSync.createWriteStream(tempFile);

            res.on('data', (chunk) => {
              downloadedBytes += chunk.length;
              fileStream.write(chunk);
              if (onProgress && totalBytes > 0) {
                const percent = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
                onProgress({ percent, downloadedBytes, totalBytes });
              }
            });

            res.on('end', () => {
              fileStream.end(async () => {
                try {
                  const minTempValid = isConfig ? 50 : 1024 * 100;
                  if (fsSync.existsSync(tempFile) && fsSync.statSync(tempFile).size > minTempValid) {
                    await fs.rename(tempFile, localModelFile);
                    const metaInfo = {
                      id: modelDef.id,
                      name: modelDef.name || modelDef.title,
                      filename: modelDef.filename,
                      category: modelDef.category,
                      description: modelDef.description,
                      size_mb: modelDef.size_mb,
                      recommended_for: modelDef.recommended_for,
                      engineArchitecture: modelDef.engineArchitecture,
                      installed_bytes: downloadedBytes,
                      local_path: localModelFile,
                      format: modelDef.format || 'pth',
                      installedAt: new Date().toISOString()
                    };
                    await fs.writeFile(metaFile, JSON.stringify(metaInfo, null, 2), 'utf8');
                    resolve(metaInfo);
                  } else {
                    reject(new Error('Размер скачанного файла подозрительно мал'));
                  }
                } catch (err) {
                  reject(err);
                }
              });
            });

            res.on('error', (err) => {
              try { fsSync.unlinkSync(tempFile); } catch (e) {}
              reject(err);
            });
          });

          req.on('error', (err) => reject(err));
          req.setTimeout(35000, () => {
            req.destroy();
            reject(new Error('Превышен таймаут загрузки'));
          });
        };

        requestWithRedirect(targetUrl);
      });
    };

    for (const url of urls) {
      try {
        if (onLog) onLog(`Подключение к источнику весов: ${url}...`);
        const result = await downloadFromUrl(url);
        if (onLog) onLog(`✓ Модель ${filename} успешно загружена!`);
        return { success: true, ...result };
      } catch (err) {
        if (onLog) onLog(`Предупреждение при загрузке: ${err.message}`, 'warn');
      }
    }

    // Try secondary Python downloader with direct streaming
    try {
      if (onLog) onLog(`Запуск прямого Python-загрузчика для ${filename}...`);
      await AudioNeuralService._runPythonSidecar([
        '--mode', 'download_model',
        '--model_path', localModelFile,
        '--model_id', modelDef.id
      ], {
        onProgress,
        onLog,
        operationName: `Download Model ${filename}`
      });

      const minPyValid = isConfig ? 50 : 1024 * 512;
      if (fsSync.existsSync(localModelFile) && fsSync.statSync(localModelFile).size > minPyValid) {
        const sz = fsSync.statSync(localModelFile).size;
        const metaInfo = {
          id: modelDef.id,
          name: modelDef.name || modelDef.title,
          filename: modelDef.filename,
          installed_bytes: sz,
          local_path: localModelFile,
          format: modelDef.format || 'pth',
          installedAt: new Date().toISOString()
        };
        await fs.writeFile(metaFile, JSON.stringify(metaInfo, null, 2), 'utf8');
        if (onLog) onLog(`✓ Модель ${filename} успешно загружена через Python!`);
        return { success: true, ...metaInfo };
      }
    } catch (pyErr) {
      log.warn(`[Mixing] Python downloader fallback failed: ${pyErr.message}`);
    }

    throw new Error(`Не удалось скачать веса модели ${filename}. Проверьте доступ в интернет или скопируйте файл вручную в папку: ${uvrModelsDir}`);
  }

  /**
   * PIPELINE PRESETS: List all presets (built-in + user saved)
   */
  async getPipelinePresets({ baseDir }) {
    const root = baseDir || (app ? app.getPath('userData') : process.cwd());
    const presetsDir = path.join(root, 'config', 'mixing_pipeline_presets');
    await fs.mkdir(presetsDir, { recursive: true });

    // Built-in presets
    const builtInPresets = [
      {
        id: 'uvr_neural_clean_master',
        name: '🛡 VR-DeNoise Lite + Студийный мастеринг (Нейро-очистка шума)',
        description: 'Применяет нейросетевую модель VR-DeNoise Lite (VR Lightweight Stationarity Reducer) к дорожкам дабберов, устраняя шумы микрофонов и комнат без артефактов, с последующей эквализацией, даккингом и видео-сведением.',
        createdAt: '2026-01-01T00:00:00.000Z',
        isBuiltIn: true,
        pipeline: [
          {
            stepId: 'step_1_uvr_denoise',
            moduleId: 'uvr_denoise_lite',
            prefix: '01_denoise_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'uvr_denoise_lite')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_2_norm',
            moduleId: 'phrase_norm',
            prefix: '02_norm_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'phrase_norm')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_3_eq',
            moduleId: 'vocal_eq',
            prefix: '03_eq_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'vocal_eq')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_4_glue',
            moduleId: 'glue_compress',
            prefix: '04_glue_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'glue_compress')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_5_ducking',
            moduleId: 'ducking',
            prefix: '05_ducking_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'ducking')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_6_mix',
            moduleId: 'master_audio_mix',
            prefix: '06_master_mix_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'master_audio_mix')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_7_video',
            moduleId: 'video_mux',
            prefix: '07_video_mux_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'video_mux')?.defaultParams },
            status: 'idle',
            outputFiles: []
          }
        ]
      },
      {
        id: 'full_studio_cinema',
        name: '🎬 Полный студийный релиз (Автотайминг + Фиксы + EBU R128 + Даккинг + Сведение)',
        description: 'Идеален для профессиональных релизов и внешних серий: автоматическое выравнивание пауз, вшитие фиксов, поканальная нормализация, мягкая склейка голосов, сайдчейн-даккинг оригинала и итоговый видео-мукс.',
        createdAt: '2026-01-01T00:00:00.000Z',
        isBuiltIn: true,
        pipeline: [
          {
            stepId: 'step_1_autotiming',
            moduleId: 'auto_timing',
            prefix: '01_timing_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'auto_timing')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_2_fixes',
            moduleId: 'apply_fixes',
            prefix: '02_fixes_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'apply_fixes')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_3_norm',
            moduleId: 'phrase_norm',
            prefix: '03_norm_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'phrase_norm')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_4_glue',
            moduleId: 'glue_compress',
            prefix: '04_glue_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'glue_compress')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_5_ducking',
            moduleId: 'ducking',
            prefix: '05_ducking_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'ducking')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_6_mix',
            moduleId: 'master_audio_mix',
            prefix: '06_master_mix_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'master_audio_mix')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_7_video',
            moduleId: 'video_mux',
            prefix: '07_video_mux_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'video_mux')?.defaultParams },
            status: 'idle',
            outputFiles: []
          }
        ]
      },
      {
        id: 'fast_voiceover_stream',
        name: '⚡ Экспресс-закадр (Гейт + Нормализация + Склейка + Даккинг + Видео)',
        description: 'Быстрый и чистый конвейер без привязки к таймингу субтитров — моментальная очистка шумов, нормализация по EBU R128 и сайдчейн-даккинг с видеорядом.',
        createdAt: '2026-01-01T00:00:00.000Z',
        isBuiltIn: true,
        pipeline: createDefaultPipeline()
      },
      {
        id: 'voice_only_master',
        name: '🎙 Только вокальный микс (Без видеоряда)',
        description: 'Для подготовки сведенной дорожки голосов дабберов для передачи стороннему звукорежиссеру или монтажеру.',
        createdAt: '2026-01-01T00:00:00.000Z',
        isBuiltIn: true,
        pipeline: [
          {
            stepId: 'step_1_gate',
            moduleId: 'silence_gate',
            prefix: '01_gate_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'silence_gate')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_2_norm',
            moduleId: 'phrase_norm',
            prefix: '02_norm_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'phrase_norm')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_3_eq',
            moduleId: 'vocal_eq',
            prefix: '03_eq_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'vocal_eq')?.defaultParams },
            status: 'idle',
            outputFiles: []
          },
          {
            stepId: 'step_4_glue',
            moduleId: 'glue_compress',
            prefix: '04_glue_',
            enabled: true,
            params: { ...this.moduleDatabase.find(m => m.id === 'glue_compress')?.defaultParams },
            status: 'idle',
            outputFiles: []
          }
        ]
      }
    ];

    // Load custom presets from disk
    const customPresets = [];
    try {
      const files = await fs.readdir(presetsDir);
      for (const f of files) {
        if (f.endsWith('.json')) {
          try {
            const raw = await fs.readFile(path.join(presetsDir, f), 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && parsed.name && Array.isArray(parsed.pipeline)) {
              customPresets.push(parsed);
            }
          } catch (e) {}
        }
      }
    } catch (e) {}

    return {
      success: true,
      presets: [...builtInPresets, ...customPresets]
    };
  }

  /**
   * Save a customized entire pipeline as a preset
   */
  async savePipelinePreset({ baseDir, name, description, pipeline }) {
    if (!name || !pipeline) throw new Error('Имя пресета и конфигурация конвейера обязательны');
    const root = baseDir || (app ? app.getPath('userData') : process.cwd());
    const presetsDir = path.join(root, 'config', 'mixing_pipeline_presets');
    await fs.mkdir(presetsDir, { recursive: true });

    const safeId = `custom_${Date.now()}_${name.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '_')}`;
    const presetObj = {
      id: safeId,
      name,
      description: description || '',
      createdAt: new Date().toISOString(),
      isBuiltIn: false,
      pipeline
    };

    const filePath = path.join(presetsDir, `${safeId}.json`);
    await fs.writeFile(filePath, JSON.stringify(presetObj, null, 2), 'utf8');
    log.info(`[Mixing] Custom pipeline preset saved: ${name} (${filePath})`);

    return {
      success: true,
      preset: presetObj
    };
  }

  /**
   * Delete a customized pipeline preset
   */
  async deletePipelinePreset({ baseDir, presetId }) {
    if (!presetId) throw new Error('ID пресета обязателен');
    const root = baseDir || (app ? app.getPath('userData') : process.cwd());
    const presetsDir = path.join(root, 'config', 'mixing_pipeline_presets');
    const filePath = path.join(presetsDir, `${presetId}.json`);
    if (fsSync.existsSync(filePath)) {
      await fs.unlink(filePath);
      return { success: true };
    }
    return { success: false, error: 'Файл пресета не найден' };
  }

  /**
   * Import External Files (Standalone series without project entry)
   * Copies or symlinks external video, subtitles, and external audio tracks directly into working dir
   */
  async importExternalFiles({
    episode,
    targetDir,
    baseDir,
    videoPath,
    subPath,
    audioPaths = [],
    onProgress,
    onLog
  }) {
    const workingDir = this.resolveWorkingDir(targetDir, episode, baseDir);
    await this.ensureDirectory(workingDir);

    const rawDir = path.join(workingDir, '00_исходные');
    await this.ensureDirectory(rawDir);

    const logFn = (msg, level = 'info', meta = null) => {
      const tag = '[Mixing:ExternalImport]';
      if (level === 'error') {
        console.error(`${tag} ❌ ${msg}`, meta || '');
        log.error(`${tag} ${msg}`);
      } else if (level === 'warn') {
        console.warn(`${tag} ⚠️ ${msg}`, meta || '');
        log.warn(`${tag} ${msg}`);
      } else {
        console.log(`${tag} ${msg}`, meta || '');
        log.info(`${tag} ${msg}`);
      }
      if (onLog) onLog(msg, level, { meta });
      if (onProgress) onProgress({ message: msg, percent: undefined });
    };

    logFn(`Импорт внешних автономных файлов в папку: ${workingDir}`);

    // 1. Video
    if (videoPath && fsSync.existsSync(videoPath)) {
      const vName = path.basename(videoPath);
      const targetVideo = path.join(workingDir, vName);
      logFn(`Копирование внешнего видео: ${vName}...`);
      if (path.resolve(videoPath) !== path.resolve(targetVideo)) {
        await fs.copyFile(videoPath, targetVideo);
      }
      logFn(`Видео скопировано -> ${targetVideo}`);

      // Extract original audio track from imported video
      const origAudioOut = path.join(rawDir, '00_original_audio.wav');
      logFn('Извлечение оригинального аудио из видеоряда...');
      try {
        await this._extractAudioFromVideo(targetVideo, origAudioOut, logFn);
        logFn('Оригинальное аудио успешно сохранено в исходные');
      } catch (e) {
        logFn(`Внимание: не удалось извлечь оригинальное аудио: ${e.message}`, 'warn');
      }
    }

    // 2. Subtitles
    if (subPath && fsSync.existsSync(subPath)) {
      const sName = path.basename(subPath);
      const targetSub = path.join(workingDir, sName);
      logFn(`Копирование субтитров: ${sName}...`);
      if (path.resolve(subPath) !== path.resolve(targetSub)) {
        await fs.copyFile(subPath, targetSub);
      }
      logFn(`Субтитры скопированы -> ${targetSub}`);
    }

    // 3. Audio tracks
    const importedTracks = [];
    for (let i = 0; i < audioPaths.length; i++) {
      const aPath = audioPaths[i];
      if (aPath && fsSync.existsSync(aPath)) {
        const aName = path.basename(aPath);
        const targetAudio = path.join(rawDir, aName);
        logFn(`[${i + 1}/${audioPaths.length}] Копирование аудиодорожки: ${aName}...`);
        if (path.resolve(aPath) !== path.resolve(targetAudio)) {
          await fs.copyFile(aPath, targetAudio);
        }
        importedTracks.push({ name: aName, path: targetAudio, dubberNick: path.basename(aName, path.extname(aName)) });
      }
    }

    if (importedTracks.length > 0) {
      logFn(`Запуск фонового физического замера громкости для ${importedTracks.length} импортированных дорожек...`);
      try {
        await this.ensureTracksAnalysis(importedTracks, workingDir, logFn);
      } catch (e) {
        logFn(`Замер громкости завершится при первом запуске модулей: ${e.message}`, 'debug');
      }
    }

    logFn(`Все внешние материалы успешно импортированы в ${workingDir}`);
    return await this.getStatus({ episode, targetDir: workingDir, baseDir });
  }
}

module.exports = MixingMasterExecutors;
