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

class MixingStepRunner {
  /**
   * Safely replace an existing target file using retry and fallback strategies against Win32 / player file locks
   */
  async _safeReplaceFile(tempPath, targetPath, logFn = null) {
    if (!fsSync.existsSync(tempPath)) {
      throw new Error(`Временный файл ${tempPath} не найден для записи в ${targetPath}`);
    }

    const dir = path.dirname(targetPath);
    await this.ensureDirectory(dir, logFn);

    let lastErr = null;
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        if (fsSync.existsSync(targetPath)) {
          try {
            await fs.unlink(targetPath);
          } catch (unlinkErr) {
            // If direct unlink failed because file is locked by a player or sync service, try moving target to a trash temp name
            const trashTemp = path.join(dir, `.trash_${Date.now()}_${Math.random().toString(36).substring(2, 6)}_${path.basename(targetPath)}`);
            try {
              await fs.rename(targetPath, trashTemp);
              // Try to delete trash in background after 3 seconds
              setTimeout(() => { try { if (fsSync.existsSync(trashTemp)) fsSync.unlinkSync(trashTemp); } catch (e) {} }, 3000);
            } catch (trashErr) {}
          }
        }

        try {
          await fs.rename(tempPath, targetPath);
        } catch (renameErr) {
          // Fallback to copy + unlink (e.g. cross-volume or lock edge-case)
          await fs.copyFile(tempPath, targetPath);
          try { await fs.unlink(tempPath); } catch (e) {}
        }

        return targetPath;
      } catch (err) {
        lastErr = err;
        if (attempt < 6) {
          await new Promise(r => setTimeout(r, 120 * attempt));
        }
      }
    }

    // Final fallback: copyFile
    try {
      await fs.copyFile(tempPath, targetPath);
      try { await fs.unlink(tempPath); } catch (e) {}
      return targetPath;
    } catch (err) {
      const errMsg = `Не удалось перезаписать файл «${path.basename(targetPath)}» (Permission denied / занят другим процессом или плеером). Рекомендация: остановите воспроизведение или закройте сторонние плееры. ${lastErr?.message || err.message}`;
      if (logFn) logFn(errMsg, 'warn');
      throw new Error(errMsg);
    }
  }

  _isGluedVoiceBusTrack(track) {
    if (!track) return false;
    if (track.trackKey === 'voices_master') return true;
    const rawName = (track.name || path.basename(track.path || '')).toLowerCase();
    const rawNick = (track.dubberNick || track.baseDubberNick || '').toLowerCase();
    return (
      rawName.includes('voices_master') ||
      rawName.includes('склеенная шина голосов') ||
      rawName.includes('glued_voices') ||
      rawName.includes('mix_voices') ||
      rawNick.includes('voices_master') ||
      rawNick.includes('склеенная шина голосов') ||
      rawNick.includes('склеенная дорожка всех голосов')
    );
  }

  _deriveDubberNickFromFilename(filename = '', stepPrefix = '') {
    let base = path.basename(filename || '', path.extname(filename || ''));
    if (stepPrefix && base.startsWith(stepPrefix)) {
      base = base.slice(stepPrefix.length);
    } else {
      base = base
        .replace(/^00_timed_/i, '')
        .replace(/^(0[1-9]|1[0-9])_(ff_[a-z0-9]+|[a-z0-9]+)_/i, '')
        .replace(/^[0-9]{2}_[a-z0-9_]+?_/i, '');
    }
    const trMatch = base.match(/_(дорожка\d+|track\d+|layer\d+|take\d+)/i);
    const cleanNick = base
      .replace(/_(дорожка\d+|track\d+|layer\d+|take\d+)/gi, '')
      .replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '')
      .replace(/^[_\s-]+|[_\s-]+$/g, '')
      .trim();
    if (/^(voices_master|склеенная шина голосов|glued_voices|mix_voices)$/i.test(cleanNick) || cleanNick.toLowerCase().includes('voices_master') || cleanNick.toLowerCase().includes('склеенная шина голосов')) {
      return 'Склеенная шина голосов';
    }
    if (trMatch) {
      const trLabel = trMatch[1].replace(/дорожка/i, 'Дорожка ').replace(/track/i, 'Дорожка ');
      return `${cleanNick || base} (${trLabel.trim()})`;
    }
    return cleanNick || base || 'Даббер';
  }

  _getTrackKey(track, stepPrefix = '') {
    if (!track) return 'unknown';
    if (this._isGluedVoiceBusTrack(track)) {
      return 'voices_master';
    }
    const rawNick = track.dubberNick || this._deriveDubberNickFromFilename(track.name || path.basename(track.path || ''), stepPrefix);
    const trMatch = rawNick.match(/(?:дорожка|track|layer|take)\s*(\d+)/i) ||
                    (track.name || '').match(/_(?:дорожка|track|layer|take)(\d+)/i);
    const trNum = trMatch ? trMatch[1] : '1';
    const baseNick = rawNick
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '')
      .replace(/^00_timed_/i, '')
      .replace(/^[_\s-]+|[_\s-]+$/g, '')
      .toLowerCase()
      .trim();
    if (baseNick === 'voices_master' || baseNick.includes('склеенная шина голосов')) {
      return 'voices_master';
    }
    return `${baseNick || 'dubber'}__${trNum}`;
  }

  _resolveTrackOutName(track, inputFiles, index, prefix) {
    if (this._isGluedVoiceBusTrack(track) && (!Array.isArray(inputFiles) || inputFiles.length === 1)) {
      return `${prefix}voices_master.wav`;
    }
    const origBase = path.basename(track.path || track.name || '', path.extname(track.path || track.name || ''));
    const trMatch = origBase.match(/_(дорожка\d+|track\d+|layer\d+|take\d+)/i) || (track.name || '').match(/_(дорожка\d+|track\d+|layer\d+|take\d+)/i) || (track.dubberNick || '').match(/(дорожка\s*\d+|track\s*\d+)/i);
    const fallbackNick = this._deriveDubberNickFromFilename(origBase);
    const rawNick = track.baseDubberNick || track.dubberNick || fallbackNick || `dubber_${index + 1}`;
    const nick = rawNick.replace(/\s*\([^)]*\)/g, '').replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '').replace(/^00_timed_/i, '').replace(/^[_\s-]+|[_\s-]+$/g, '').trim() || `dubber_${index + 1}`;
    
    if (trMatch) {
      const normSuffix = trMatch[1].replace(/\s+/g, '').toLowerCase();
      return `${prefix}${nick}_${normSuffix}.wav`;
    }
    
    const sameNickTracks = inputFiles.filter(f => {
      const fRaw = f.baseDubberNick || f.dubberNick || this._deriveDubberNickFromFilename(f.name || '');
      const fNick = fRaw.replace(/\s*\([^)]*\)/g, '').replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '').replace(/^00_timed_/i, '').replace(/^[_\s-]+|[_\s-]+$/g, '').trim();
      return fNick.toLowerCase() === nick.toLowerCase();
    });
    
    if (sameNickTracks.length > 1) {
      const occ = inputFiles.slice(0, index + 1).filter(f => {
        const fRaw = f.baseDubberNick || f.dubberNick || this._deriveDubberNickFromFilename(f.name || '');
        const fNick = fRaw.replace(/\s*\([^)]*\)/g, '').replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '').replace(/^00_timed_/i, '').replace(/^[_\s-]+|[_\s-]+$/g, '').trim();
        return fNick.toLowerCase() === nick.toLowerCase();
      }).length;
      return `${prefix}${nick}_дорожка${occ}.wav`;
    }
    
    return `${prefix}${nick}.wav`;
  }

  _resolveTrackNick(track, inputFiles, index) {
    if (this._isGluedVoiceBusTrack(track) && (!Array.isArray(inputFiles) || inputFiles.length === 1)) {
      return 'Склеенная шина голосов';
    }
    const origBase = path.basename(track.path || track.name || '', path.extname(track.path || track.name || ''));
    const trMatch = origBase.match(/_(дорожка\d+|track\d+|layer\d+|take\d+)/i) || (track.name || '').match(/_(дорожка\d+|track\d+|layer\d+|take\d+)/i) || (track.dubberNick || '').match(/(дорожка\s*\d+|track\s*\d+)/i);
    const fallbackNick = this._deriveDubberNickFromFilename(origBase);
    const rawNick = track.baseDubberNick || track.dubberNick || fallbackNick || `dubber_${index + 1}`;
    const nick = rawNick.replace(/\s*\([^)]*\)/g, '').replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '').replace(/^00_timed_/i, '').replace(/^[_\s-]+|[_\s-]+$/g, '').trim() || `dubber_${index + 1}`;
    
    if (trMatch) {
      const trLabel = trMatch[1].replace(/дорожка\s*/i, 'Дорожка ').replace(/track\s*/i, 'Дорожка ');
      return `${nick} (${trLabel.trim()})`;
    }
    
    const sameNickTracks = inputFiles.filter(f => {
      const fRaw = f.baseDubberNick || f.dubberNick || this._deriveDubberNickFromFilename(f.name || '');
      const fNick = fRaw.replace(/\s*\([^)]*\)/g, '').replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '').replace(/^00_timed_/i, '').replace(/^[_\s-]+|[_\s-]+$/g, '').trim();
      return fNick.toLowerCase() === nick.toLowerCase();
    });
    
    if (sameNickTracks.length > 1) {
      const occ = inputFiles.slice(0, index + 1).filter(f => {
        const fRaw = f.baseDubberNick || f.dubberNick || this._deriveDubberNickFromFilename(f.name || '');
        const fNick = fRaw.replace(/\s*\([^)]*\)/g, '').replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '').replace(/^00_timed_/i, '').replace(/^[_\s-]+|[_\s-]+$/g, '').trim();
        return fNick.toLowerCase() === nick.toLowerCase();
      }).length;
      return `${nick} (Дорожка ${occ})`;
    }
    
    return nick;
  }

  _resolveTrackVolumePercent(track, timingMeta) {
    if (!timingMeta || !timingMeta.rolesVolumeMap) return 100;
    const volMap = timingMeta.rolesVolumeMap;
    const tName = (track.name || path.basename(track.path || '')).toLowerCase();
    const tNick = (track.dubberNick || '').toLowerCase();
    const baseNick = (track.baseDubberNick || tNick.replace(/\s*\([^)]*\)/g, '')).toLowerCase().replace(/^[_\s-]+|[_\s-]+$/g, '').trim();

    // 0. Direct key match in rolesVolumeMap
    if (track.dubberNick && volMap[track.dubberNick] !== undefined) {
      return Number(volMap[track.dubberNick]) || 100;
    }
    if (track.name && volMap[track.name] !== undefined) {
      return Number(volMap[track.name]) || 100;
    }

    // Extract track number from name or dubberNick
    const trMatch = tName.match(/_(?:дорожка|track|layer|take)(\d+)/i) || 
                   tNick.match(/(?:дорожка|track|layer|take)\s*(\d+)/i);
    const trNum = trMatch ? parseInt(trMatch[1], 10) : null;

    // 1. Precise match with track number if multi-track
    if (trNum !== null) {
      for (const [role, vol] of Object.entries(volMap)) {
        const rLower = role.toLowerCase();
        const rTrMatch = rLower.match(/(?:дорожка|track|layer|take)\s*(\d+)/i);
        const rTrNum = rTrMatch ? parseInt(rTrMatch[1], 10) : null;
        if (rTrNum === trNum && (rLower.includes(baseNick) || baseNick.includes(rLower.replace(/\s*\([^)]*\)/g, '').trim()))) {
          return Number(vol) || 100;
        }
      }
    }

    // 2. Exact match case-insensitive
    for (const [role, vol] of Object.entries(volMap)) {
      const rLower = role.toLowerCase();
      if (rLower === tNick || rLower === tName) {
        return Number(vol) || 100;
      }
    }

    // 3. Single track actor fallback
    if (trNum === null) {
      for (const [role, vol] of Object.entries(volMap)) {
        const rLower = role.toLowerCase();
        if (/(?:дорожка|track)\s*\d+/i.test(rLower)) continue;
        if (rLower.includes(baseNick) || baseNick.includes(rLower)) {
          return Number(vol) || 100;
        }
      }
    }

    return 100;
  }

  /**
   * Universal FFmpeg executor with deep command/stderr/progress logging and safe atomic file replacement
   */
  async _execFfmpeg(command, { logFn, onProgress, outPath, description = 'FFmpeg' } = {}) {
    if (this.isAborted) {
      throw new Error('Процесс сведения остановлен пользователем.');
    }

    let finalTarget = outPath;
    if (!finalTarget && Array.isArray(command._outputs) && command._outputs.length > 0) {
      finalTarget = command._outputs[0]?.target;
    }

    let tempOutPath = null;
    if (finalTarget && typeof finalTarget === 'string') {
      const ext = path.extname(finalTarget) || '.wav';
      const dir = path.dirname(finalTarget);
      await this.ensureDirectory(dir, logFn);

      const baseName = path.basename(finalTarget, ext);
      tempOutPath = path.join(dir, `.tmp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}_${baseName}${ext}`);

      // Substitute the output in fluent-ffmpeg so FFmpeg writes to a clean unlocked temp file
      if (!Array.isArray(command._outputs) || command._outputs.length === 0) {
        command.output(tempOutPath);
      } else {
        for (const out of command._outputs) {
          if (out) out.target = tempOutPath;
        }
        if (command._currentOutput) {
          command._currentOutput.target = tempOutPath;
        }
      }
    }

    // Always enforce overwrite flag (-y) to prevent FFmpeg hanging or permission prompts
    try {
      command.outputOptions(['-y']);
    } catch (e) {}

    this._activeFfmpegCommands.add(command);

    try {
      await new Promise((resolve, reject) => {
        const lastStderr = [];
        let commandLineStr = '';

        command
          .on('start', (cmdLine) => {
            if (this.isAborted) {
              try { command.kill('SIGKILL'); } catch (e) {}
              reject(new Error('Процесс сведения остановлен пользователем.'));
              return;
            }
            if (command.ffmpegProc) {
              trackProcess(command.ffmpegProc, description);
            }
            commandLineStr = cmdLine;
            console.log(`[Mixing:FFmpeg] 🚀 ${description} -> START:\n  ${cmdLine}`);
            if (logFn) logFn(`[FFmpeg] ${description}: ${cmdLine}`, 'debug');
          })
          .on('stderr', (stderrLine) => {
            lastStderr.push(stderrLine);
            if (lastStderr.length > 30) lastStderr.shift();
            if (stderrLine.includes('Error') || stderrLine.includes('failed') || stderrLine.includes('Invalid') || stderrLine.includes('fatal')) {
              console.warn(`[Mixing:FFmpeg:Stderr] ⚠️ ${stderrLine}`);
            }
          })
          .on('progress', (p) => {
            if (onProgress && p && typeof p.percent === 'number') {
              onProgress(p);
            }
          })
          .on('end', () => {
            this._activeFfmpegCommands.delete(command);
            resolve(tempOutPath || finalTarget);
          })
          .on('error', (err, stdout, stderr) => {
            this._activeFfmpegCommands.delete(command);
            if (this.isAborted || (err && /SIGKILL|killed|aborted/i.test(err.message))) {
              reject(new Error('Процесс сведения остановлен пользователем.'));
              return;
            }
            const detailStderr = (stderr || lastStderr.join('\n')).slice(-700);
            const fullErrMsg = `[FFmpeg Ошибка] ${description}: ${err.message}${detailStderr ? `\nДетали stderr:\n${detailStderr}` : ''}`;
            console.error(`[Mixing:FFmpeg:Fatal] ❌ ${fullErrMsg}\nКоманда: ${commandLineStr}`);
            if (logFn) logFn(fullErrMsg, 'error', { commandLine: commandLineStr, stderr: detailStderr });
            reject(new Error(fullErrMsg));
          })
          .run();
      });

      if (this.isAborted) {
        throw new Error('Процесс сведения остановлен пользователем.');
      }

      // If we used a temporary file, safely replace outPath with retries
      if (tempOutPath && finalTarget) {
        await this._safeReplaceFile(tempOutPath, finalTarget, logFn);
      }

      let sizeStr = '';
      if (finalTarget && fsSync.existsSync(finalTarget)) {
        const st = fsSync.statSync(finalTarget);
        sizeStr = `(${(st.size / 1024 / 1024).toFixed(2)} MB)`;
      }
      console.log(`[Mixing:FFmpeg] ✅ ${description} успешно завершено ${sizeStr}`);
      if (logFn) logFn(`[FFmpeg] Успешно: ${description} ${sizeStr}`, 'debug');

      return finalTarget;
    } catch (err) {
      this._activeFfmpegCommands.delete(command);
      if (tempOutPath && fsSync.existsSync(tempOutPath)) {
        try { await fs.unlink(tempOutPath); } catch (e) {}
      }
      throw err;
    }
  }

  /**
   * Ensure audio track physical loudness statistics (RMS, LUFS, Peak, NoiseFloor) exist for given tracks.
   * If missing (e.g. newly imported or re-mixing old series), measures them dynamically with FFmpeg ebur128.
   */
  async ensureTracksAnalysis(tracks = [], workingDir = '', logFn = null) {
    const analysisMap = {};
    const analysisFile = workingDir ? path.join(workingDir, 'track_analysis.json') : null;
    
    if (analysisFile && fsSync.existsSync(analysisFile)) {
      try {
        const cached = JSON.parse(fsSync.readFileSync(analysisFile, 'utf8'));
        Object.assign(analysisMap, cached);
      } catch (e) {}
    }

    for (let i = 0; i < tracks.length; i++) {
      const tr = tracks[i];
      if (!tr || !tr.path || !fsSync.existsSync(tr.path)) continue;

      const key = tr.path;
      const nameKey = tr.name || path.basename(tr.path);
      const nick = tr.dubberNick || nameKey;

      if (!analysisMap[key] && analysisMap[nameKey]) {
        analysisMap[key] = analysisMap[nameKey];
      }

      let stats = analysisMap[key];
      if (!stats || typeof stats.speechRmsDb !== 'number' || typeof stats.integratedLufsDb !== 'number') {
        if (logFn) logFn(`[Анализ громкости] Замер акустических параметров дорожки «${nick}»...`, 'debug');
        try {
          stats = await AudioAnalysisService.measureTrackStats(tr.path);
          analysisMap[key] = stats;
          analysisMap[nameKey] = stats;
          if (logFn) logFn(`[Анализ] «${nick}»: RMS ${stats.speechRmsDb} dB, LUFS ${stats.integratedLufsDb}, Peak ${stats.truePeakDb} dBFS`, 'debug');
        } catch (err) {
          log.warn(`[Mixing] Ошибка замера дорожки ${nick}:`, err.message);
          stats = {
            speechRmsDb: -24.0,
            peakDb: -1.0,
            integratedLufsDb: -23.0,
            loudnessRangeDb: 9.0,
            truePeakDb: -1.0,
            lufsThresholdDb: -33.0,
            noiseFloorDb: -52.0
          };
          analysisMap[key] = stats;
          analysisMap[nameKey] = stats;
        }
      }
    }

    if (analysisFile && Object.keys(analysisMap).length > 0) {
      try {
        await fs.writeFile(analysisFile, JSON.stringify(analysisMap, null, 2), 'utf8');
      } catch (e) {}
    }

    return analysisMap;
  }

  _extractAudioFromVideo(videoPath, outAudioPath, logFn) {
    const cmd = ffmpeg(videoPath)
      .noVideo()
      .audioCodec('pcm_s16le')
      .audioChannels(2)
      .audioFrequency(48000)
      .output(outAudioPath);

    return this._execFfmpeg(cmd, {
      logFn,
      outPath: outAudioPath,
      description: `Извлечение оригинального аудио из ${path.basename(videoPath)}`
    });
  }

  async runStep({ episode, targetDir, baseDir, stepId, onProgress, onLog, _fromChain = false }) {
    if (!_fromChain) {
      this.isAborted = false;
    }
    if (this.isAborted) {
      throw new Error('Процесс сведения остановлен пользователем.');
    }

    const workingDir = this.resolveWorkingDir(targetDir, episode, baseDir);
    const statusData = await this.getStatus({ episode, targetDir: workingDir, baseDir });
    const manifest = statusData.manifest;

    const stepIndex = manifest.pipeline.findIndex(s => s.stepId === stepId);
    if (stepIndex === -1) {
      throw new Error(`Шаг конвейера с ID "${stepId}" не найден.`);
    }

    const step = manifest.pipeline[stepIndex];
    const logFn = (msg, level = 'info', meta = null) => {
      const tag = `[Mixing:${step.moduleId}]`;
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
      if (onLog) onLog(msg, level, { stepId: step.stepId, moduleId: step.moduleId, meta });
    };

    const startTime = Date.now();
    step.status = 'processing';
    step.error = null;
    await fs.writeFile(path.join(workingDir, 'mixing_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    try {
      const stepFolder = path.join(workingDir, `${String(stepIndex + 1).padStart(2, '0')}_${step.moduleId}`);
      await fs.mkdir(stepFolder, { recursive: true });

      const inputFiles = this._resolveInputsForStep(manifest, stepIndex);

      logFn(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      logFn(`▶ [ШАГ ${stepIndex + 1}/${manifest.pipeline.length}] Запуск: «${step.title || step.moduleId}» (ID: ${step.moduleId})`);
      logFn(`  Папка этапа: ${stepFolder}`);
      logFn(`  Количество выбранных входных дорожек: ${inputFiles.length}`);
      inputFiles.forEach((f, idx) => {
        logFn(`    • [${idx + 1}/${inputFiles.length}] ${f.dubberNick || f.name} (${f.name})`, 'debug');
      });
      logFn(`  Параметры модуля: ${JSON.stringify(step.params || {})}`, 'debug', { params: step.params });

      let resultFiles = [];
      switch (step.moduleId) {
        case 'auto_timing':
          resultFiles = await this._execAutoTiming({ episode, workingDir, stepFolder, prefix: step.prefix, manifest, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'stage_mfa_lipsync':
        case 'mfa_lipsync':
          resultFiles = await this._execMfaLipsync({ episode, workingDir, stepFolder, prefix: step.prefix, manifest, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'acoustic_original_match':
        case 'acoustic_match_full':
        case 'acoustic_match_soft_reverb':
        case 'acoustic_match_dry_focus':
          resultFiles = await this._execAcousticMatch({ episode, workingDir, stepFolder, prefix: step.prefix, manifest, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'apply_fixes':
          resultFiles = await this._execApplyFixes({ episode, workingDir, stepFolder, prefix: step.prefix, manifest, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'auto_norm_phrases':
          resultFiles = await this._execAutoNormPhrases({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'uvr_denoise_lite':
        case 'uvr_denoise_foxjoy':
        case 'deepfilternet3':
        case 'uvr_denoise_full':
          resultFiles = await this._execUvrDenoiseLite({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: { modelId: step.moduleId, ...step.params }, logFn, onProgress });
          break;
        case 'ffmpeg_denoise':
          resultFiles = await this._execFfmpegDenoise({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'uvr_deecho_normal':
        case 'vst-spectral-dereverb':
        case 'reverb_foxjoy':
        case 'uvr_deecho_aggressive':
        case 'mdx_dereverb_room':
          resultFiles = await this._execUvrDeEchoNormal({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: { modelId: step.moduleId, ...step.params }, logFn, onProgress });
          break;
        case 'ffmpeg_deecho':
          resultFiles = await this._execFfmpegDeEcho({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'uvr_mdx_voc_ft':
        case 'uvr_mdx_inst_hq3':
        case 'kim_vocal_2':
        case 'htdemucs_ft':
        case 'htdemucs':
        case 'htdemucs_vocals_bgm':
        case 'mdx23c_8step':
        case 'hp_karaoke_uvr':
        case 'mel_band_roformer_vocals':
        case 'bs_roformer_viperx':
        case 'bs_roformer_cinema':
          resultFiles = await this._execStemSeparation({ episode, workingDir, stepFolder, prefix: step.prefix, manifest, inputFiles, params: { modelId: step.moduleId, ...step.params }, logFn, onProgress });
          break;
        case 'ffmpeg_vocal_remover':
          resultFiles = await this._execFfmpegVocalRemover({ episode, workingDir, stepFolder, prefix: step.prefix, manifest, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'voicefixer_fe':
          resultFiles = await this._execVoiceFixer({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'ffmpeg_harmonic_restorer':
          resultFiles = await this._execFfmpegHarmonicRestorer({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'voice_timbre_match':
          resultFiles = await this._execVoiceTimbreMatch({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'ffmpeg_timbre_eq':
          resultFiles = await this._execFfmpegTimbreEq({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'silence_gate':
          resultFiles = await this._execSilenceGate({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'phrase_norm':
          resultFiles = await this._execPhraseNorm({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'stage_loudness_norm':
        case 'loudness_norm':
          resultFiles = await this._execLoudnessNorm({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'ffmpeg_loudnorm':
          resultFiles = await this._execFfmpegLoudnorm({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'deesser':
          resultFiles = await this._execDeesser({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'de_plosive':
          resultFiles = await this._execDePlosive({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'vocal_thickener':
          resultFiles = await this._execVocalThickener({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'spectral_dereverb_lite':
          resultFiles = await this._execSpectralDeReverb({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'headroom_recovery':
          resultFiles = await this._execHeadroomRecovery({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'speech_leveler':
          resultFiles = await this._execSpeechLeveler({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'vocal_eq':
          resultFiles = await this._execVocalEq({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'voice_eq':
        case 'voice_compressor':
        case 'voice_deesser':
        case 'voice_reverb':
        case 'voice_limiter':
        case 'voice_master_strip':
          resultFiles = await this._execPedalboardDsp({ moduleId: step.moduleId, workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'ffmpeg_master_strip':
          resultFiles = await this._execFfmpegMasterStrip({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'airwindows_restore':
        case 'airwindows_saturate':
        case 'airwindows_dsp':
          resultFiles = await this._execAirwindowsDsp({ moduleId: step.moduleId, workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'ffmpeg_airwindows_strip':
          resultFiles = await this._execFfmpegAirwindowsStrip({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'glue_compress':
          resultFiles = await this._execGlueCompress({ workingDir, stepFolder, prefix: step.prefix, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'ducking':
          resultFiles = await this._execDucking({ episode, workingDir, stepFolder, prefix: step.prefix, manifest, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'master_audio_mix':
          resultFiles = await this._execMasterMix({ episode, workingDir, stepFolder, prefix: step.prefix, manifest, inputFiles, params: step.params, logFn, onProgress });
          break;
        case 'video_mux':
          resultFiles = await this._execVideoMux({ episode, workingDir, stepFolder, prefix: step.prefix, manifest, inputFiles, params: step.params, logFn, onProgress });
          break;
        default:
          throw new Error(`Неизвестный тип модуля: ${step.moduleId}`);
      }

      // Clean up any stale audio/video files in stepFolder that were not produced in this run
      try {
        const validResultPaths = new Set((resultFiles || []).map(rf => rf?.path ? path.resolve(rf.path).toLowerCase() : ''));
        if (validResultPaths.size > 0 && fsSync.existsSync(stepFolder)) {
          const existingEntries = fsSync.readdirSync(stepFolder);
          for (const entry of existingEntries) {
            if (!/\.(wav|mp3|flac|ogg|m4a|aac|mp4|mkv)$/i.test(entry)) continue;
            const fullEntryPath = path.join(stepFolder, entry);
            if (!validResultPaths.has(path.resolve(fullEntryPath).toLowerCase())) {
              try { fsSync.unlinkSync(fullEntryPath); } catch (_) {}
            }
          }
        }
      } catch (_) {}

      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
      step.status = 'completed';
      step.outputFiles = resultFiles;
      step.error = null;
      step.updatedAt = new Date().toISOString();

      if (step.moduleId === 'video_mux' && resultFiles.length > 0) {
        manifest.finalVideo = resultFiles[0];
      }

      await fs.writeFile(path.join(workingDir, 'mixing_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
      await this.persistPipeline(manifest.pipeline, workingDir, episode, baseDir);
      logFn(`✔ Шаг «${step.moduleId}» успешно выполнен за ${elapsedSec}s! Создано файлов: ${resultFiles.length}`, 'info', {
        stepId: step.stepId,
        durationSec: elapsedSec,
        outputFiles: resultFiles
      });
      resultFiles.forEach((f, idx) => {
        logFn(`    ✓ [${idx + 1}/${resultFiles.length}] ${f.name} (${(f.size / (1024 * 1024)).toFixed(2)} MB)`, 'debug');
      });
      logFn(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      return {
        success: true,
        stepId: step.stepId,
        outputFiles: resultFiles,
        durationSec: elapsedSec
      };
    } catch (err) {
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
      const isUserAborted = this.isAborted || (err && /остановлен пользователем|отменена пользователем/i.test(err.message));
      step.status = isUserAborted ? 'idle' : 'error';
      step.error = err.message || String(err);
      await fs.writeFile(path.join(workingDir, 'mixing_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
      await this.persistPipeline(manifest.pipeline, workingDir, episode, baseDir);
      console.error(`[Mixing:Step:Error] 💥 Остановка шага ${step.moduleId} (${stepId}) за ${elapsedSec}s:`, err);
      logFn(`💥 ${isUserAborted ? 'ОСТАНОВЛЕНО ПОЛЬЗОВАТЕЛЕМ' : 'КРИТИЧЕСКАЯ ОШИБКА'} шага «${step.moduleId}» за ${elapsedSec}s: ${err.message}`, 'error', {
        stack: err.stack,
        stepId: step.stepId,
        moduleId: step.moduleId,
        params: step.params
      });
      throw err;
    }
  }

  _isOriginalSeparationStep(stepOrModId) {
    const mod = (typeof stepOrModId === 'string' ? stepOrModId : (stepOrModId?.moduleId || '')).toLowerCase();
    return [
      'htdemucs', 'htdemucs_ft', 'htdemucs_vocals_bgm', 'uvr_mdx_inst_hq3',
      'uvr_mdx_voc_ft', 'kim_vocal_2', 'mdx23c_8step', 'hp_karaoke_uvr',
      'mel_band_roformer_vocals', 'bs_roformer_viperx', 'bs_roformer_cinema',
      'separate', 'separate_stems', 'demucs', 'ffmpeg_vocal_remover'
    ].includes(mod) || mod.includes('roformer') || mod.includes('demucs') || mod.startsWith('uvr_mdx');
  }

  _isAcousticMatchStep(stepOrModId) {
    const mod = (typeof stepOrModId === 'string' ? stepOrModId : (stepOrModId?.moduleId || '')).toLowerCase();
    return [
      'acoustic_original_match',
      'acoustic_match_full',
      'acoustic_match_soft_reverb',
      'acoustic_match_dry_focus',
      'acoustic_matched'
    ].includes(mod) || mod.startsWith('acoustic_match');
  }

  _isNonDubberStep(step) {
    if (!step) return false;
    const mod = (step.moduleId || '').toLowerCase();
    if (this._isOriginalSeparationStep(mod)) return true;
    if (['ducking', 'master_audio_mix', 'video_mux'].includes(mod)) return true;
    return false;
  }

  /**
   * Checks whether a step belongs to the sequential Voice Processing Chain
   * (includes per-dubber processing, glue_compress, acoustic_original_match, and post-glue voice modules;
   * excludes original separation, sidechain ducking background output, master_audio_mix, and video_mux).
   */
  _isVoiceChainStep(stepOrModId) {
    const mod = (typeof stepOrModId === 'string' ? stepOrModId : (stepOrModId?.moduleId || '')).toLowerCase();
    if (!mod) return false;
    if (this._isOriginalSeparationStep(mod)) return false;
    if (['ducking', 'master_audio_mix', 'video_mux'].includes(mod)) return false;
    return true;
  }

  /**
   * Strictly finds the single immediately preceding enabled & completed voice chain step before `beforeStepIndex`.
   * Never accumulates or merges outputs from older steps.
   */
  _findLatestCompletedVoiceStep(manifest, beforeStepIndex) {
    const pipeline = manifest?.pipeline || [];
    const limit = typeof beforeStepIndex === 'number' ? Math.min(beforeStepIndex, pipeline.length) : pipeline.length;
    const glueStepIdx = pipeline.findIndex(s => s && s.enabled && s.moduleId === 'glue_compress');

    for (let i = limit - 1; i >= 0; i--) {
      const s = pipeline[i];
      if (!s || !s.enabled) continue;
      if (!this._isVoiceChainStep(s)) continue;
      let validOutputs = (s.outputFiles || []).filter(f => f && f.path && fsSync.existsSync(f.path));
      if (validOutputs.length > 0) {
        const isPostGlue = glueStepIdx !== -1 && i >= glueStepIdx;
        if (isPostGlue && (!s.customInputTracks || s.customInputTracks.length === 0) && validOutputs.length > 1) {
          // Safeguard: if an old run left multiple files in a post-glue step, pick the latest modified file
          validOutputs = [...validOutputs].sort((a, b) => {
            try {
              return fsSync.statSync(b.path).mtimeMs - fsSync.statSync(a.path).mtimeMs;
            } catch (_) {
              return 0;
            }
          }).slice(0, 1);
        }
        return {
          step: s,
          stepIndex: i,
          stepNumber: i + 1,
          isPostGlue,
          outputFiles: validOutputs
        };
      }
    }
    return null;
  }

  /**
   * Resolves all candidate input tracks entering a given step.
   * CRITICAL RULE:
   * - Every Voice Processing Module strictly receives ONLY the outputs of the immediately preceding voice module
   *   (or source dubber tracks if it is the first voice module). Never accumulates earlier steps (like step #5 glue_compress into step #10).
   * - Special modules (Original Separation, Acoustic Match, Ducking, Master Mix, Video Mux) receive their dedicated inputs,
   *   where the voice input is always strictly the latest preceding completed voice module.
   */
  _resolveCandidateInputsForStep(manifest, stepIndex) {
    const currentStep = manifest?.pipeline?.[stepIndex];
    if (!currentStep) return [];

    const moduleId = currentStep.moduleId;
    const excludedSet = new Set(Array.isArray(currentStep.excludedTrackKeys) ? currentStep.excludedTrackKeys : []);
    const customTracks = Array.isArray(currentStep.customInputTracks) ? currentStep.customInputTracks : [];

    const markExcluded = (item) => {
      const key = item.trackKey || this._getTrackKey(item);
      const isExcl = excludedSet.has(key) || (item.path && excludedSet.has(item.path)) || (item.name && excludedSet.has(item.name));
      return {
        ...item,
        trackKey: key,
        excluded: isExcl
      };
    };

    // 1. Special Module: Original Audio Separation steps
    if (this._isOriginalSeparationStep(moduleId)) {
      const list = [];
      if (manifest.sourceFiles?.originalAudio?.path && fsSync.existsSync(manifest.sourceFiles.originalAudio.path)) {
        list.push(markExcluded({
          ...manifest.sourceFiles.originalAudio,
          trackKey: 'original_audio',
          dubberNick: 'Оригинальное аудио серии',
          sourceLabel: 'Исходник серии'
        }));
      }
      for (const ct of customTracks) {
        if (ct && ct.path && fsSync.existsSync(ct.path)) {
          list.push(markExcluded({ ...ct, isCustom: true, sourceLabel: 'Добавлена вручную' }));
        }
      }
      return list;
    }

    // 1B. Special Module: Acoustic Matched Step (Separated Original Vocals + Immediately Preceding Glued Voice Step)
    if (this._isAcousticMatchStep(moduleId)) {
      const list = [];
      const allSteps = manifest.pipeline || [];

      // Input 1: Separated original vocal stem from preceding (or any completed) stem separation step
      let origVocalFile = null;
      let origVocalStepNum = null;
      for (let i = 0; i < allSteps.length; i++) {
        const s = allSteps[i];
        if (!s || !this._isOriginalSeparationStep(s.moduleId) || !Array.isArray(s.outputFiles)) continue;
        for (const f of s.outputFiles) {
          if (!f || !f.path || !fsSync.existsSync(f.path)) continue;
          const lower = path.basename(f.path).toLowerCase();
          if (
            !AudioAnalysisService.isUnseparatedOriginalAudio(f.path) &&
            (f.type === 'vocals' || lower.includes('vocal'))
          ) {
            origVocalFile = f;
            origVocalStepNum = i + 1;
          }
        }
      }

      if (origVocalFile) {
        list.push(markExcluded({
          ...origVocalFile,
          trackKey: 'original_vocals',
          dubberNick: '1. Вокальная дорожка оригинала (Эталон эффектов)',
          sourceLabel: `Из шага #${origVocalStepNum} (Разделение оригинала)`
        }));
      }

      // Input 2: Strictly the immediately preceding completed voice step (e.g. glue_compress or a post-glue voice step)
      const prevVoice = this._findLatestCompletedVoiceStep(manifest, stepIndex);
      if (prevVoice && prevVoice.outputFiles.length > 0) {
        const vf = prevVoice.outputFiles[0];
        list.push(markExcluded({
          ...vf,
          trackKey: 'voices_master',
          dubberNick: '2. Склеенная дорожка всех голосов (voices_master)',
          sourceLabel: `Из шага #${prevVoice.stepNumber} (${prevVoice.step.moduleId})`
        }));
      } else {
        // Fallback if no preceding voice step is completed yet: check if glue_compress is completed anywhere
        for (let i = 0; i < allSteps.length; i++) {
          const s = allSteps[i];
          if (!s || s.moduleId !== 'glue_compress' || !Array.isArray(s.outputFiles) || s.outputFiles.length === 0) continue;
          const gf = s.outputFiles[0];
          if (gf && gf.path && fsSync.existsSync(gf.path)) {
            list.push(markExcluded({
              ...gf,
              trackKey: 'voices_master',
              dubberNick: '2. Склеенная дорожка всех голосов (voices_master)',
              sourceLabel: `Из шага #${i + 1} (Склейка голосов)`
            }));
            break;
          }
        }
      }

      for (const ct of customTracks) {
        if (ct && ct.path && fsSync.existsSync(ct.path)) {
          list.push(markExcluded({ ...ct, isCustom: true, sourceLabel: 'Добавлена вручную' }));
        }
      }
      return list;
    }

    // 2. Special Bus / Post-Mix steps (ducking, master_audio_mix, video_mux)
    if (['ducking', 'master_audio_mix', 'video_mux'].includes(moduleId)) {
      const list = [];
      const searchEnd = stepIndex > 0 ? stepIndex : (manifest.pipeline || []).length;

      if (moduleId === 'video_mux') {
        // Strictly take the latest preceding master_audio_mix output
        for (let i = searchEnd - 1; i >= 0; i--) {
          const s = manifest.pipeline[i];
          if (s && s.moduleId === 'master_audio_mix' && Array.isArray(s.outputFiles) && s.outputFiles.length > 0) {
            const mf = s.outputFiles[0];
            if (mf && mf.path && fsSync.existsSync(mf.path)) {
              list.push(markExcluded({
                ...mf,
                trackKey: 'master_audio',
                dubberNick: 'Сведенный мастер-звук',
                sourceLabel: `Из шага #${i + 1} (Мастер-микс аудио)`
              }));
              break;
            }
          }
        }
      } else {
        // For BOTH 'ducking' and 'master_audio_mix':
        // Voice Input: Strictly take the output of the immediately preceding completed voice step (e.g. Step #10, NEVER Step #5 if Step #10 exists!)
        const prevVoice = this._findLatestCompletedVoiceStep(manifest, searchEnd);
        if (prevVoice && prevVoice.outputFiles.length > 0) {
          for (let vIdx = 0; vIdx < prevVoice.outputFiles.length; vIdx++) {
            const vf = prevVoice.outputFiles[vIdx];
            const isSingleBus = prevVoice.isPostGlue || prevVoice.outputFiles.length === 1;
            const key = isSingleBus ? 'voices_master' : this._getTrackKey(vf, prevVoice.step.prefix);
            const nick = isSingleBus
              ? 'Склеенная шина голосов'
              : (vf.dubberNick || this._deriveDubberNickFromFilename(vf.name, prevVoice.step.prefix));
            list.push(markExcluded({
              ...vf,
              trackKey: key,
              dubberNick: nick,
              sourceLabel: `Из шага #${prevVoice.stepNumber} (${prevVoice.step.moduleId})`
            }));
          }
        }

        // Background Audio Input for 'master_audio_mix' (and 'ducking')
        if (moduleId === 'master_audio_mix') {
          let bgFile = null;
          let bgLabel = '';
          let bgNick = 'Фоновая дорожка';
          for (let i = searchEnd - 1; i >= 0; i--) {
            const s = manifest.pipeline[i];
            if (s && s.enabled && s.moduleId === 'ducking' && Array.isArray(s.outputFiles) && s.outputFiles[0]?.path && fsSync.existsSync(s.outputFiles[0].path)) {
              bgFile = s.outputFiles[0];
              bgLabel = `Из шага #${i + 1} (Сайдчейн-даккинг)`;
              bgNick = 'Приглушенный фон оригинала (Ducked)';
              break;
            }
          }
          if (!bgFile) {
            for (let i = searchEnd - 1; i >= 0; i--) {
              const s = manifest.pipeline[i];
              if (s && s.enabled && this._isOriginalSeparationStep(s.moduleId) && Array.isArray(s.outputFiles)) {
                const inst = s.outputFiles.find(f => f && f.path && fsSync.existsSync(f.path) && (f.type === 'instrumental' || /no_vocals|instrumental|_me\.wav/i.test(f.name || '')));
                if (inst) {
                  bgFile = inst;
                  bgLabel = `Из шага #${i + 1} (Инструментал оригинала)`;
                  bgNick = 'Инструментал оригинала (M&E)';
                  break;
                }
              }
            }
          }
          if (!bgFile && manifest.sourceFiles?.originalAudio?.path && fsSync.existsSync(manifest.sourceFiles.originalAudio.path)) {
            bgFile = manifest.sourceFiles.originalAudio;
            bgLabel = 'Исходник серии';
            bgNick = 'Оригинальное аудио серии (Фон)';
          }
          if (bgFile) {
            list.push(markExcluded({
              ...bgFile,
              trackKey: 'background_audio',
              dubberNick: bgNick,
              sourceLabel: bgLabel
            }));
          }
        }
      }

      for (const ct of customTracks) {
        if (ct && ct.path && fsSync.existsSync(ct.path)) {
          list.push(markExcluded({ ...ct, isCustom: true, sourceLabel: 'Добавлена вручную' }));
        }
      }
      if (list.length > 0) return list;
    }

    // 3. Voice Processing Modules (all per-dubber modules, glue_compress, and post-glue voice modules)
    // STRICT RULE: Take ONLY the output files of the immediately preceding completed voice step!
    const prevVoice = this._findLatestCompletedVoiceStep(manifest, stepIndex);
    const resultList = [];

    if (prevVoice && prevVoice.outputFiles.length > 0) {
      for (const outFile of prevVoice.outputFiles) {
        if (!outFile || !outFile.path || !fsSync.existsSync(outFile.path)) continue;
        const isGluedBus = prevVoice.isPostGlue || this._isGluedVoiceBusTrack(outFile);
        const key = isGluedBus ? 'voices_master' : this._getTrackKey(outFile, prevVoice.step.prefix);
        const nick = isGluedBus
          ? 'Склеенная шина голосов'
          : (outFile.dubberNick || this._deriveDubberNickFromFilename(outFile.name, prevVoice.step.prefix));

        resultList.push(markExcluded({
          ...outFile,
          trackKey: key,
          dubberNick: nick,
          sourceLabel: `Из шага #${prevVoice.stepNumber} (${prevVoice.step.moduleId})`
        }));
      }
    } else {
      // No preceding voice step has been executed yet -> take source dubber tracks
      const baseDubbers = manifest.sourceFiles?.dubberTracks || [];
      for (let idx = 0; idx < baseDubbers.length; idx++) {
        const tr = baseDubbers[idx];
        if (!tr || !tr.path) continue;
        const key = this._getTrackKey(tr);
        resultList.push(markExcluded({
          ...tr,
          trackKey: key,
          dubberNick: tr.dubberNick || this._deriveDubberNickFromFilename(tr.name),
          sourceLabel: 'Исходная дорожка'
        }));
      }
    }

    // Add custom tracks explicitly attached to currentStep ONLY
    for (const ct of customTracks) {
      if (ct && ct.path && fsSync.existsSync(ct.path)) {
        const cKey = this._getTrackKey(ct);
        resultList.push(markExcluded({
          ...ct,
          trackKey: cKey,
          dubberNick: ct.dubberNick || this._deriveDubberNickFromFilename(ct.name),
          isCustom: true,
          sourceLabel: 'Добавлена в этот шаг вручную'
        }));
      }
    }

    return resultList;
  }

  _resolveInputsForStep(manifest, stepIndex) {
    const candidates = this._resolveCandidateInputsForStep(manifest, stepIndex);
    return candidates.filter(t => !t.excluded);
  }

}

module.exports = MixingStepRunner;
