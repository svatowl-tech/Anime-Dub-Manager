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

class MixingVocalDspExecutors {
  /**
   * EXEC: Voice Timbre Match (harmonizes frequency curve of all dubber voices to studio standard)
   */
  async _execVoiceTimbreMatch({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    await fs.mkdir(stepFolder, { recursive: true });
    const matchIntensity = Number(params.matchIntensity ?? 75);
    const targetProfile = String(params.targetProfile ?? 'studio_neutral');
    const subBassCutoff = Number(params.subBassCutoff ?? 75);
    const airLimitDb = Number(params.airLimitDb ?? 3.0);
    const smoothness = Number(params.smoothness ?? 3);

    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для калибровки АЧХ.');
    }

    logFn(`[Калибровка АЧХ] Старт гармонизации спектра (Python LTAS) для ${inputFiles.length} дорожек к профилю «${targetProfile}» (Интенсивность: ${matchIntensity}%, Сглаживание: ${smoothness}x)...`);

    const results = [];
    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);
      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      logFn(`[${i+1}/${inputFiles.length}] Выравнивание АЧХ даббера «${nick}» к студийному эталону (LTAS)...`);

      await AudioNeuralService.matchVoiceTimbre({
        inputPath: track.path,
        outputPath: outPath,
        matchIntensity,
        targetProfile,
        subBassCutoff,
        airLimitDb,
        smoothness,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `Калибровка АЧХ [${nick}]: ${p.percent}%` });
          }
        },
        onLog: logFn
      });

      if (!fsSync.existsSync(outPath)) {
        throw new Error(`Python LTAS-калибратор не сформировал выходной файл для дорожки «${nick}».`);
      }

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
      logFn(`✓ Дорожка «${nick}» успешно приведена к единому студийному знаменателю АЧХ -> ${outName}`);
    }

    return results;
  }

  /**
   * EXEC: FFmpeg Multi-Band Timbre EQ (Dedicated standalone FFmpeg module)
   */
  async _execFfmpegTimbreEq({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    await fs.mkdir(stepFolder, { recursive: true });
    const matchIntensity = Number(params.matchIntensity ?? 75);
    const targetProfile = String(params.targetProfile ?? 'studio_neutral');
    const subBassCutoff = Number(params.subBassCutoff ?? 75);
    const airLimitDb = Number(params.airLimitDb ?? 3.0);

    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для модуля FFmpeg Multi-Band Timbre EQ.');
    }

    logFn(`[FFmpeg Timbre EQ] Калибровка тембра ${inputFiles.length} дорожек по профилю «${targetProfile}»...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);
      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      const scale = Math.max(0.1, Math.min(1.0, matchIntensity / 100));
      const hpFreq = Math.max(20, Math.round(subBassCutoff));
      let eqBands = [];
      if (targetProfile === 'warm_broadcast') {
        eqBands = [
          `equalizer=f=160:t=q:w=1.2:g=${(1.5 * scale).toFixed(2)}`,
          `equalizer=f=350:t=q:w=1.4:g=${(-1.2 * scale).toFixed(2)}`,
          `equalizer=f=2800:t=q:w=1.2:g=${(1.2 * scale).toFixed(2)}`,
          `equalizer=f=9000:t=h:g=${Math.min(airLimitDb, 1.5 * scale).toFixed(2)}`
        ];
      } else if (targetProfile === 'crisp_anime') {
        eqBands = [
          `equalizer=f=220:t=q:w=1.3:g=${(-1.5 * scale).toFixed(2)}`,
          `equalizer=f=1800:t=q:w=1.1:g=${(1.8 * scale).toFixed(2)}`,
          `equalizer=f=3800:t=q:w=1.2:g=${(2.2 * scale).toFixed(2)}`,
          `equalizer=f=11000:t=h:g=${Math.min(airLimitDb, 2.5 * scale).toFixed(2)}`
        ];
      } else {
        eqBands = [
          `equalizer=f=250:t=q:w=1.4:g=${(-1.2 * scale).toFixed(2)}`,
          `equalizer=f=1400:t=q:w=1.2:g=${(1.0 * scale).toFixed(2)}`,
          `equalizer=f=3200:t=q:w=1.2:g=${(1.4 * scale).toFixed(2)}`,
          `equalizer=f=10000:t=h:g=${Math.min(airLimitDb, 1.8 * scale).toFixed(2)}`
        ];
      }
      const filterChain = [`highpass=f=${hpFreq}`, ...eqBands].join(',');
      const cmd = ffmpeg(track.path)
        .audioFilters(filterChain)
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outPath);

      await this._execFfmpeg(cmd, {
        logFn,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `FFmpeg Timbre EQ [${nick}]: ${p.percent}%` });
          }
        },
        outPath,
        description: `FFmpeg Timbre EQ [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
      logFn(`✓ Дорожка «${nick}» откалибрована FFmpeg Timbre EQ -> ${outName}`);
    }

    return results;
  }

  /**
   * EXEC: Silence Gate (cleans pauses between phrases with granular settings)
   */
  async _execSilenceGate({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const thresholdDb = Number(params.thresholdDb ?? -45.0);
    const rangeDb = Number(params.rangeDb ?? -80.0);
    const attackMs = Number(params.attackMs ?? 10);
    const releaseMs = Number(params.releaseMs ?? 160);
    const detectionMode = params.detectionMode === 'peak' ? 'peak' : 'rms';

    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для применения гейта тишины.');
    }

    logFn(`Применение гейта тишины (Порог: ${thresholdDb} dB, Диапазон: ${rangeDb} dB, Атака: ${attackMs}ms, Спад: ${releaseMs}ms, Детектор: ${detectionMode}) к ${inputFiles.length} дорожкам...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      logFn(`[${i+1}/${inputFiles.length}] Обработка гейта для «${nick}»...`);

      const filter = `agate=threshold=${thresholdDb}dB:range=${rangeDb}dB:attack=${attackMs}:release=${releaseMs}:detection=${detectionMode}`;

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
            onProgress({ percent: current, message: `Гейт: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `Silence Gate [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

  /**
   * EXEC: Phrase Normalization (EBU R128 or DynAudNorm with granular settings)
   */
  async _execPhraseNorm({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const targetLufs = Number(params.targetLufs ?? -16.0);
    const truePeak = Number(params.truePeak ?? -1.0);
    const lra = Number(params.loudnessRange ?? 11.0);
    const maxGainDb = Number(params.maxGainDb ?? 14.0);
    const mode = params.mode || 'loudnorm';
    const dualMono = params.dualMono !== false;

    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для нормализации.');
    }

    const timingMeta = await this.getTimingMetadata(workingDir);
    if (timingMeta) {
      logFn(`[Интеллектуальный сведение] Учитываются целевые уровни из timing_metadata.json`);
    }

    // Ensure physical track measurements exist for all dubber tracks
    const trackAnalysis = await this.ensureTracksAnalysis(inputFiles, workingDir, logFn);

    logFn(`Нормализация речевых фраз (Режим: ${mode}, Target: ${targetLufs} LUFS, Peak: ${truePeak} dB) для ${inputFiles.length} дорожек...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      const roleVolPct = this._resolveTrackVolumePercent(track, timingMeta);

      let trackTargetLufs = targetLufs;
      if (roleVolPct !== 100) {
        const offsetDb = 20 * Math.log10(Math.max(10, roleVolPct) / 100);
        trackTargetLufs = Number((targetLufs + offsetDb).toFixed(1));
        logFn(`[Интеллектуальная нормализация] Дорожка «${nick}»: установлена целевая громкость ${trackTargetLufs} LUFS (коэффициент тайминга ${roleVolPct}%)`);
      } else {
        logFn(`[${i+1}/${inputFiles.length}] Нормализация «${nick}» к ${trackTargetLufs} LUFS...`);
      }

      const stats = trackAnalysis[track.path] || trackAnalysis[track.name] || {};
      const measuredI = typeof stats.integratedLufsDb === 'number' ? stats.integratedLufsDb : -24.0;
      const measuredTp = typeof stats.truePeakDb === 'number' ? stats.truePeakDb : -1.0;
      const measuredLra = typeof stats.loudnessRangeDb === 'number' ? stats.loudnessRangeDb : lra;
      const measuredThresh = typeof stats.lufsThresholdDb === 'number' ? stats.lufsThresholdDb : -33.0;
      const rms = typeof stats.speechRmsDb === 'number' ? stats.speechRmsDb : -24.0;

      if (mode === 'pyloudnorm' || mode === 'pyln') {
        const trackStartPct = Math.round((i / inputFiles.length) * 100);
        const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);
        await AudioNeuralService.loudnessNorm({
          inputPath: track.path,
          outputPath: outPath,
          targetLufs: trackTargetLufs,
          truePeak,
          modeType: 'track',
          onProgress: (p) => {
            if (onProgress && p && typeof p.percent === 'number') {
              const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
              onProgress({ percent: current, message: `pyloudnorm: ${nick} (${Math.round(p.percent)}%)` });
            }
          },
          onLog: (msg) => logFn(`[pyloudnorm] ${msg}`)
        });
        if (!fsSync.existsSync(outPath)) {
          throw new Error(`pyloudnorm не сформировал выходной файл для дорожки «${nick}».`);
        }
        const st = fsSync.statSync(outPath);
        results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
        continue;
      }

      let filter = '';
      if (mode === 'dynaudnorm') {
        const preGain = Math.max(-12, Math.min(maxGainDb, trackTargetLufs - (measuredI !== -24 ? measuredI : rms)));
        filter = `volume=${preGain.toFixed(1)}dB,dynaudnorm=f=180:g=15:p=0.92:m=${maxGainDb}:s=12,alimiter=limit=${truePeak}dB:attack=1:release=40:level=true`;
      } else {
        // Two-pass measured EBU R128 with intelligent pre-gain for weak mics
        filter = `loudnorm=I=${trackTargetLufs}:TP=${truePeak}:LRA=${lra}:measured_I=${measuredI}:measured_TP=${measuredTp}:measured_LRA=${measuredLra}:measured_thresh=${measuredThresh}:linear=true:dual_mono=${dualMono ? 'true' : 'false'},alimiter=limit=${truePeak}dB:attack=1:release=40:level=true`;
      }

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
            onProgress({ percent: current, message: `Нормализация: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `Phrase Norm [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

  /**
   * EXEC: EBU R128 Loudness Normalization using pyloudnorm Python Sidecar
   */
  async _execLoudnessNorm({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const targetLufs = Number(params.targetLufs ?? -23.0);
    const truePeak = Number(params.truePeak ?? -1.0);
    const modeType = params.modeType || 'track';

    if (!inputFiles || inputFiles.length === 0) {
      throw new Error('Нет входных файлов для EBU R128 нормализации.');
    }

    logFn(`[EBU R128 pyloudnorm] Старт нормализации громкости (${modeType}, target: ${targetLufs} LUFS, peak: ${truePeak} dBTP) для ${inputFiles.length} файлов...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const file = inputFiles[i];
      const nick = this._resolveTrackNick(file, inputFiles, i);
      const outName = this._resolveTrackOutName(file, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      logFn(`[${i + 1}/${inputFiles.length}] EBU R128 pyloudnorm обработка «${nick}» -> ${outName}`);

      await AudioNeuralService.loudnessNorm({
        inputPath: file.path,
        outputPath: outPath,
        targetLufs,
        truePeak,
        modeType,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = Math.round((i / inputFiles.length) * 100 + (p.percent / inputFiles.length));
            onProgress({ percent: Math.min(99, current), message: `EBU R128: ${nick} (${Math.round(p.percent)}%)` });
          }
        },
        onLog: (msg) => logFn(`[pyloudnorm] ${msg}`)
      });

      if (!fsSync.existsSync(outPath)) {
        throw new Error(`Модуль pyloudnorm не создал выходной файл для дорожки «${nick}».`);
      }

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    if (onProgress) {
      onProgress({ percent: 100, message: 'EBU R128 нормализация завершена' });
    }

    return results;
  }

  /**
   * EXEC: FFmpeg EBU R128 Loudnorm (Dedicated standalone FFmpeg module)
   */
  async _execFfmpegLoudnorm({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const targetLufs = Number(params.targetLufs ?? -16.0);
    const truePeak = Number(params.truePeak ?? -1.0);
    const lra = Number(params.lra ?? 11.0);

    if (!inputFiles || inputFiles.length === 0) {
      throw new Error('Нет входных файлов для модуля FFmpeg Loudnorm.');
    }

    logFn(`[FFmpeg Loudnorm] Нормализация громкости EBU R128 (target: ${targetLufs} LUFS, peak: ${truePeak} dBTP) для ${inputFiles.length} файлов...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const file = inputFiles[i];
      const nick = this._resolveTrackNick(file, inputFiles, i);
      const outName = this._resolveTrackOutName(file, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      const filter = `loudnorm=I=${targetLufs}:TP=${truePeak}:LRA=${lra}:linear=true,alimiter=limit=${truePeak}dB:attack=1:release=40:level=true`;
      const cmd = ffmpeg(file.path)
        .audioFilters(filter)
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outPath);

      await this._execFfmpeg(cmd, { logFn, outPath, description: `FFmpeg Loudnorm [${nick}]` });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

  /**
   * EXEC: De-Esser (suppresses sibilants)
   */
  async _execDeesser({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const rawFreq = Number(params.frequencyHz ?? 6200);
    const rawIntensity = Number(params.intensity ?? 3.5);
    const rawMaxReduction = Number(params.maxReduction ?? 0.50);

    // FFmpeg's deesser filter expects normalized parameters in range [0.0 - 1.0]:
    // f (frequency): float [0.0 - 1.0] relative to Nyquist (24000 Hz for 48kHz audio)
    const normF = Math.max(0.01, Math.min(0.99, rawFreq / 24000.0)).toFixed(4);

    // i (intensity): float [0.0 - 1.0]. UI values range from 0 to 10
    const normI = Math.max(0.0, Math.min(1.0, rawIntensity > 1.0 ? rawIntensity / 10.0 : rawIntensity)).toFixed(2);

    // m (max deessing): float [0.0 - 1.0], default 0.5
    const maxDeess = Math.max(0.05, Math.min(1.0, rawMaxReduction > 1.0 ? rawMaxReduction / 100.0 : rawMaxReduction)).toFixed(2);

    // s (output mode): 'o' (output processed audio), 'i' (input), 'e' (ess)
    const outputMode = 'o';

    const results = [];
    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      logFn(`[${i+1}/${inputFiles.length}] Деэссинг для «${nick}» (${rawFreq} Hz -> normF=${normF}, intensity: ${rawIntensity} -> normI=${normI}, maxReduction: ${maxDeess})...`);

      const filter = `deesser=f=${normF}:i=${normI}:m=${maxDeess}:s=${outputMode}`;

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
            onProgress({ percent: current, message: `Деэссинг: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `De-Esser [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

  /**
   * EXEC: De-Plosive Pro (Linkwitz-Riley LR4 low-frequency pop & breath suppression)
   */
  async _execDePlosive({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const thresholdDb = Number(params.thresholdDb ?? -24.0);
    const freqLimit = Number(params.frequencyLimitHz ?? 120);
    const depthDb = Number(params.suppressionDepthDb ?? -18.0);
    const recoveryMs = Math.max(5, Math.min(500, Number(params.recoveryMs ?? 35)));
    const wetDry = Math.max(0.1, Math.min(1.0, Number(params.wetDryPercent ?? 100) / 100.0));

    logFn(`Подавление задувов De-Plosive Pro (Срез: ${freqLimit} Hz, Порог: ${thresholdDb} dB, Глубина: ${depthDb} dB, Восстановление: ${recoveryMs} ms, Wet: ${(wetDry * 100).toFixed(0)}%)...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      logFn(`[${i+1}/${inputFiles.length}] De-Plosive для «${nick}»...`);

      // Cascaded LR4 highpass (poles=2 twice) + dynamic sub-frequency compressor & notch + dry/wet mix
      const compRatio = Math.max(2, Math.min(20, Math.round(Math.abs(depthDb) / 3)));
      const coreFilter = `highpass=f=45:p=2,highpass=f=45:p=2,equalizer=f=${freqLimit}:t=q:w=1.5:g=${depthDb.toFixed(1)},acompressor=threshold=${thresholdDb}dB:ratio=${compRatio}:attack=2:release=${recoveryMs}:knee=3dB,alimiter=limit=-0.5dB`;
      const filter = wetDry < 0.999
        ? `asplit[orig][tofilt];[tofilt]${coreFilter}[filt];[orig]volume=${(1.0 - wetDry).toFixed(2)}[dry];[filt]volume=${wetDry.toFixed(2)}[wet];[dry][wet]amix=inputs=2:duration=first:dropout_transition=0`
        : coreFilter;

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
            onProgress({ percent: current, message: `De-Plosive: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `De-Plosive [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

  /**
   * EXEC: Vocal Thickener (Chebyshev sub-harmonics & analog tape warmth)
   */
  async _execVocalThickener({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const bodyDrive = Number(params.bodyDrivePercent ?? 50) / 100.0;
    const presenceClarity = Number(params.presenceClarityPercent ?? 40) / 100.0;
    const tapeDensity = Number(params.tapeDensityPercent ?? 45) / 100.0;
    const mixRatio = Math.max(0.1, Math.min(1.0, Number(params.mixPercent ?? 100) / 100.0));

    logFn(`Уплотнение вокала Vocal Thickener (Drive: ${(bodyDrive * 100).toFixed(0)}%, Clarity: ${(presenceClarity * 100).toFixed(0)}%, Tape: ${(tapeDensity * 100).toFixed(0)}%, Mix: ${(mixRatio * 100).toFixed(0)}%)...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      logFn(`[${i+1}/${inputFiles.length}] Vocal Thickener для «${nick}»...`);

      const bodyGain = (bodyDrive * 3.5).toFixed(1);
      const exciterAmount = (presenceClarity * 4.0).toFixed(1);
      const drive = (1.0 + tapeDensity * 1.5).toFixed(2);

      const coreFilter = `equalizer=f=200:t=q:w=1.2:g=${bodyGain},aexciter=level_in=1:level_out=1:amount=${exciterAmount}:drive=${drive}:freq=3800,alimiter=limit=-0.5dB`;
      const filter = mixRatio < 0.999
        ? `asplit[orig][tofilt];[tofilt]${coreFilter}[filt];[orig]volume=${(1.0 - mixRatio).toFixed(2)}[dry];[filt]volume=${mixRatio.toFixed(2)}[wet];[dry][wet]amix=inputs=2:duration=first:dropout_transition=0`
        : coreFilter;

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
            onProgress({ percent: current, message: `Thickener: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `Vocal Thickener [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

  /**
   * EXEC: Spectral De-Reverb Lite (16-band EDR diffuse tail reduction)
   */
  async _execSpectralDeReverb({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const reductionDb = Number(params.reductionDb ?? -9.0);
    const decayTimeEstMs = Math.max(100, Math.min(1500, Number(params.decayTimeEstMs ?? 350.0)));
    const clarity = Math.max(0, Math.min(100, Number(params.clarityPercent ?? 70.0)));
    const mixRatio = Math.max(0.1, Math.min(1.0, Number(params.mixPercent ?? 100) / 100.0));

    logFn(`16-полосный Spectral De-Reverb (Подавление: ${reductionDb} dB, Спад: ${decayTimeEstMs} ms, Читаемость: ${clarity}%, Mix: ${(mixRatio * 100).toFixed(0)}%)...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      logFn(`[${i+1}/${inputFiles.length}] De-Reverb для «${nick}»...`);

      const noiseRed = Math.min(25, Math.abs(reductionDb) * 1.5).toFixed(1);
      const boxCut = (-1.5 - (decayTimeEstMs / 600.0)).toFixed(1);
      const clarityBoost = ((clarity / 100.0) * 2.5).toFixed(1);
      const coreFilter = `afftdn=nf=-30:nr=${noiseRed}:nt=w,agate=threshold=-44dB:range=-14dB:attack=8:release=${Math.round(decayTimeEstMs * 0.45)},equalizer=f=480:t=q:w=1.5:g=${boxCut},equalizer=f=3200:t=q:w=1.3:g=${clarityBoost},alimiter=limit=-0.5dB`;
      const filter = mixRatio < 0.999
        ? `asplit[orig][tofilt];[tofilt]${coreFilter}[filt];[orig]volume=${(1.0 - mixRatio).toFixed(2)}[dry];[filt]volume=${mixRatio.toFixed(2)}[wet];[dry][wet]amix=inputs=2:duration=first:dropout_transition=0`
        : coreFilter;

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
            onProgress({ percent: current, message: `De-Reverb: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `Spectral De-Reverb [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

  /**
   * EXEC: Headroom Recovery (safe true peak boost with lookahead limiter)
   */
  async _execHeadroomRecovery({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const autoHeadroom = params.autoHeadroom !== false;
    const targetPeakDb = Number(params.targetPeakDb ?? -6.0);
    const maxBoostDb = Number(params.maxBoostDb ?? 36.0);
    const manualGainDb = Number(params.manualGainDb ?? 0.0);
    const lookaheadMs = Math.max(0.5, Math.min(20.0, Number(params.lookaheadMs ?? 3.0)));
    const mixRatio = Math.max(0.1, Math.min(1.0, Number(params.mixPercent ?? 100) / 100.0));

    const trackAnalysis = await this.ensureTracksAnalysis(inputFiles, workingDir, logFn);

    logFn(`Разгон громкости Headroom Recovery (Auto: ${autoHeadroom ? 'Вкл' : 'Выкл'}, Target Peak: ${targetPeakDb} dBFS, Max Boost: ${maxBoostDb} dB, Lookahead: ${lookaheadMs} ms)...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      const stats = trackAnalysis[track.path] || trackAnalysis[track.name] || {};
      const currentPeak = typeof stats.peakDb === 'number' ? stats.peakDb : -6.0;
      const neededHeadroom = autoHeadroom ? Math.max(0, targetPeakDb - currentPeak) : 0;
      const totalGain = Math.min(maxBoostDb, Math.max(-24, neededHeadroom + manualGainDb + (autoHeadroom ? 3.0 : 0.0))).toFixed(1);

      logFn(`[${i+1}/${inputFiles.length}] Headroom Recovery для «${nick}» (Текущий пик: ${currentPeak} dB, Подъем: +${totalGain} dB)...`);

      const coreFilter = `volume=${totalGain}dB,alimiter=limit=${targetPeakDb}dB:attack=${lookaheadMs}:release=50:level=true`;
      const filter = mixRatio < 0.999
        ? `asplit[orig][tofilt];[tofilt]${coreFilter}[filt];[orig]volume=${(1.0 - mixRatio).toFixed(2)}[dry];[filt]volume=${mixRatio.toFixed(2)}[wet];[dry][wet]amix=inputs=2:duration=first:dropout_transition=0`
        : coreFilter;

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
            onProgress({ percent: current, message: `Headroom: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `Headroom Recovery [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

  /**
   * EXEC: Speech Leveler (two-stage RMS leveling + peak limiter)
   */
  async _execSpeechLeveler({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const targetLevelDb = Number(params.targetLevelDb ?? -18.0);
    const maxBoostDb = Number(params.maxBoostDb ?? 18.0);
    const maxCutDb = Number(params.maxCutDb ?? -12.0);
    const levelingSpeedMs = Math.max(50, Math.min(1000, Number(params.levelingSpeedMs ?? 200.0)));
    const silenceGateDb = Number(params.silenceGateDb ?? -50.0);
    const peakCeilingDb = Number(params.peakCeilingDb ?? -2.0);
    const mixRatio = Math.max(0.1, Math.min(1.0, Number(params.mixPercent ?? 100) / 100.0));

    const trackAnalysis = await this.ensureTracksAnalysis(inputFiles, workingDir, logFn);

    logFn(`Двухступенчатый Speech Leveler (Target: ${targetLevelDb} dB, Max Boost: +${maxBoostDb} dB, Max Cut: ${maxCutDb} dB, Speed: ${levelingSpeedMs} ms, Gate: ${silenceGateDb} dB, Ceiling: ${peakCeilingDb} dBFS)...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      const stats = trackAnalysis[track.path] || trackAnalysis[track.name] || {};
      const currentRms = typeof stats.speechRmsDb === 'number' ? stats.speechRmsDb : -24.0;
      const minAllowedDelta = -Math.abs(maxCutDb);
      const gainDelta = Math.max(minAllowedDelta, Math.min(maxBoostDb, targetLevelDb - currentRms));

      logFn(`[${i+1}/${inputFiles.length}] Speech Leveler для «${nick}» (RMS: ${currentRms} dB -> пред-усиление: ${gainDelta >= 0 ? '+' : ''}${gainDelta.toFixed(1)} dB, окно: ${levelingSpeedMs} ms)...`);

      const coreFilter = `agate=threshold=${silenceGateDb}dB:range=-24dB:attack=10:release=180,volume=${gainDelta.toFixed(1)}dB,dynaudnorm=f=${Math.round(levelingSpeedMs)}:g=15:p=0.92:m=${maxBoostDb}:s=12,alimiter=limit=${peakCeilingDb}dB:attack=1:release=45:level=true`;
      const filter = mixRatio < 0.999
        ? `asplit[orig][tofilt];[tofilt]${coreFilter}[filt];[orig]volume=${(1.0 - mixRatio).toFixed(2)}[dry];[filt]volume=${mixRatio.toFixed(2)}[wet];[dry][wet]amix=inputs=2:duration=first:dropout_transition=0`
        : coreFilter;

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
            onProgress({ percent: current, message: `Leveler: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `Speech Leveler [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

  /**
   * EXEC: Vocal EQ (Low-Cut, Body, Boxiness cut, Presence, Air)
   */
  async _execVocalEq({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const lowCut = Number(params.lowCutHz ?? 85);
    const lowCutSlope = params.lowCutSlope || '24dB/oct';
    const bodyGain = Number(params.bodyGainDb ?? 0.5);
    const boxCutGain = Number(params.boxCutGainDb ?? -1.5);
    const presHz = Number(params.presenceHz ?? 3200);
    const presGain = Number(params.presenceGainDb ?? 2.0);
    const airGain = Number(params.airGainDb ?? 1.5);

    const results = [];
    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      logFn(`[${i+1}/${inputFiles.length}] Параметрический EQ для «${nick}» (Low-Cut: ${lowCut} Hz @ ${lowCutSlope})...`);

      const hpStage = lowCutSlope === '24dB/oct'
        ? `highpass=f=${lowCut}:p=2,highpass=f=${lowCut}:p=2`
        : `highpass=f=${lowCut}:p=2`;
      const filter = `${hpStage},equalizer=f=250:t=q:w=1.2:g=${bodyGain},equalizer=f=500:t=q:w=1.4:g=${boxCutGain},equalizer=f=${presHz}:t=q:w=1.5:g=${presGain},equalizer=f=11000:t=h:g=${airGain}`;

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
            onProgress({ percent: current, message: `Вокальный EQ: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `Vocal EQ [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

  /**
   * EXEC: Spotify Pedalboard Studio Voice DSP Engine
   * Batch processes all input tracks (e.g. 7-12 character tracks from auto-timing).
   * Runs Python sidecar or fallback DSP with high-precision studio EQ, compression, reverb & limiter.
   */
  async _execPedalboardDsp({ moduleId = 'voice_master_strip', workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    if (inputFiles.length === 0) {
      throw new Error(`Нет входных дорожек для применения модуля «${moduleId}».`);
    }

    const modDef = MODULE_DATABASE.find(m => m.id === moduleId);
    const modTitle = modDef?.title || modDef?.name || moduleId;

    logFn(`[Spotify Pedalboard DSP] Запуск обработки ${inputFiles.length} дорожек через модуль «${modTitle}»...`);

    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      logFn(`[${i+1}/${inputFiles.length}] Обработка дорожки «${nick}» (Pedalboard DSP: ${modTitle})...`);

      await AudioNeuralService.processPedalboardDsp({
        inputPath: track.path,
        outputPath: outPath,
        moduleId,
        params: params || {},
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `Pedalboard DSP: ${nick} (${p.percent.toFixed(0)}%)` });
          }
        },
        onLog: (msg, level) => {
          logFn(`  [${nick}] ${msg}`, level || 'debug');
        }
      });

      if (!fsSync.existsSync(outPath)) {
        throw new Error(`Spotify Pedalboard DSP («${modTitle}») не создал выходной файл для дорожки «${nick}».`);
      }

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    logFn(`✔ Успешно обработано ${results.length} дорожек через «${modTitle}»!`);
    return results;
  }

  /**
   * EXEC: FFmpeg Broadcast Voice Strip (Dedicated standalone FFmpeg module)
   */
  async _execFfmpegMasterStrip({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для модуля FFmpeg Broadcast Voice Strip.');
    }

    const eqHighpass = Number(params?.eqHighpass ?? 80);
    const eqPresenceFreq = Number(params?.eqPresenceFreq ?? 3200);
    const eqPresenceGain = Number(params?.eqPresenceGain ?? 2.5);
    const eqLowpass = Number(params?.eqLowpass ?? 18000);
    const compThresh = Number(params?.compThresholdDb ?? -18.0);
    const compRatio = Number(params?.compRatio ?? 3.5);
    const compAttack = Number(params?.compAttackMs ?? 15.0);
    const compRelease = Number(params?.compReleaseMs ?? 120.0);
    const deessFreq = Number(params?.deesserFreqHz ?? 6500);
    const deessAmount = Number(params?.deesserAmount ?? 0.60);
    const reverbWet = Number(params?.reverbWet ?? 0.06);
    const limiterThresh = Number(params?.limiterThresholdDb ?? -0.5);

    logFn(`[FFmpeg Broadcast Voice Strip] Комплексная обработка ${inputFiles.length} дорожек...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);
      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      const filterParts = [];
      if (eqHighpass > 20) filterParts.push(`highpass=f=${eqHighpass}`);
      if (Math.abs(eqPresenceGain) > 0.1) filterParts.push(`equalizer=f=${eqPresenceFreq}:t=q:w=1.2:g=${eqPresenceGain}`);
      if (eqLowpass < 22000) filterParts.push(`lowpass=f=${eqLowpass}`);
      if (deessAmount > 0.05) {
        filterParts.push(`equalizer=f=${deessFreq}:t=q:w=2.2:g=${(-deessAmount * 7).toFixed(1)}`);
      }
      filterParts.push(`acompressor=threshold=${compThresh}dB:ratio=${compRatio}:attack=${compAttack}:release=${compRelease}:knee=3dB:makeup=1.5dB`);
      if (reverbWet > 0.01) {
        filterParts.push(`aecho=0.8:0.6:40|70:${(reverbWet * 3).toFixed(2)}|${(reverbWet * 2).toFixed(2)}`);
      }
      filterParts.push(`alimiter=limit=${limiterThresh}dB:attack=1:release=40:level=true`);

      const cmd = ffmpeg(track.path)
        .audioFilters(filterParts.join(','))
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outPath);

      await this._execFfmpeg(cmd, {
        logFn,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `FFmpeg Master Strip: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `FFmpeg Broadcast Voice Strip [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

  /**
   * EXEC: Airwindows DSP Restoration & Saturation Suite
   * Batch processes tracks through Airwindows VST3 / Python DSP without silent fallback
   */
  async _execAirwindowsDsp({ moduleId = 'airwindows_restore', workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    if (inputFiles.length === 0) {
      throw new Error(`Нет входных дорожек для применения модуля «${moduleId}».`);
    }

    const modDef = MODULE_DATABASE.find(m => m.id === moduleId);
    const modTitle = modDef?.title || modDef?.name || moduleId;

    logFn(`[Airwindows DSP Suite] Запуск обработки ${inputFiles.length} дорожек через модуль «${modTitle}»...`);

    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      logFn(`[${i+1}/${inputFiles.length}] Обработка дорожки «${nick}» (Airwindows DSP: ${modTitle})...`);

      await AudioNeuralService.processAirwindowsDsp({
        inputPath: track.path,
        outputPath: outPath,
        moduleId,
        params: params || {},
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `Airwindows DSP: ${nick} (${p.percent.toFixed(0)}%)` });
          }
        },
        onLog: (msg, level) => {
          logFn(`  [${nick}] ${msg}`, level || 'debug');
        }
      });

      if (!fsSync.existsSync(outPath)) {
        throw new Error(`Airwindows DSP («${modTitle}») не создал выходной файл для дорожки «${nick}».`);
      }

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    logFn(`✔ Успешно обработано ${results.length} дорожек через Airwindows DSP («${modTitle}»)!`);
    return results;
  }

  /**
   * EXEC: FFmpeg De-Pop / De-Ess / Exciter Strip (Dedicated standalone FFmpeg module)
   */
  async _execFfmpegAirwindowsStrip({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для модуля FFmpeg De-Pop / De-Ess / Exciter Strip.');
    }

    const deess = Number(params?.deessIntensity ?? 0.50);
    const pop = Number(params?.popIntensity ?? 0.50);
    const slew = Number(params?.slewIntensity ?? 0.40);
    const density = Number(params?.densityDrive ?? 0.40);

    logFn(`[FFmpeg De-Pop/De-Ess/Exciter] Обработка ${inputFiles.length} дорожек...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);
      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      const filterParts = [];
      if (pop > 0.05) {
        const cutHigh = Math.round(60 + pop * 60);
        filterParts.push(`highpass=f=${cutHigh},equalizer=f=110:t=q:w=1.5:g=${(-pop * 10.0).toFixed(1)}`);
      }
      if (deess > 0.05) {
        const normF = (6500 / 24000.0).toFixed(4);
        const normI = (deess > 1.0 ? deess / 10.0 : deess).toFixed(2);
        filterParts.push(`deesser=f=${normF}:i=${normI}:m=0.5:s=o`);
      }
      if (slew > 0.05) {
        filterParts.push(`equalizer=f=8500:t=q:w=2.5:g=${(-slew * 4.0).toFixed(1)}`);
      }
      if (density > 0.05) {
        const drive = (1.0 + density * 1.2).toFixed(2);
        filterParts.push(`aexciter=level_in=1:level_out=1:amount=${(density * 2.0).toFixed(1)}:drive=${drive}:freq=3500`);
      }
      filterParts.push('alimiter=limit=-0.5dB');

      const cmd = ffmpeg(track.path)
        .audioFilters(filterParts.join(','))
        .audioCodec('pcm_s16le')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(outPath);

      await this._execFfmpeg(cmd, {
        logFn,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `FFmpeg De-Pop/De-Ess: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `FFmpeg De-Pop/De-Ess [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
    }

    return results;
  }

  /**
   * EXEC: Glue Compress (Mix all voices into one glue master)
   */
  async _execGlueCompress({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const thresholdDb = Number(params.thresholdDb ?? -18.0);
    const ratio = Number(params.ratio ?? 3.0);
    const attackMs = Number(params.attackMs ?? 20);
    const releaseMs = Number(params.releaseMs ?? 250);
    const kneeDb = Number(params.kneeDb ?? 3.5);
    const makeupDb = Number(params.makeupDb ?? 2.0);
    const peakLimitDb = Number(params.peakLimitDb ?? -1.0);

    if (inputFiles.length === 0) {
      throw new Error('Нет дорожек дабберов для склейки.');
    }

    const outName = `${prefix}voices_master.wav`;
    const outPath = path.join(stepFolder, outName);

    const trackAnalysis = await this.ensureTracksAnalysis(inputFiles, workingDir, logFn);
    const timingMeta = await this.getTimingMetadata(workingDir);

    logFn(`Склеивание и вокальная шинная компрессия ${inputFiles.length} дорожек в «${outName}» (Ratio ${ratio}:1, Thresh ${thresholdDb}dB, Knee ${kneeDb}dB, Makeup +${makeupDb}dB)...`);

    let command = ffmpeg();
    inputFiles.forEach(t => { command = command.input(t.path); });

    const n = inputFiles.length;
    let filter = '';

    if (n > 1) {
      const filterParts = [];
      const mixInputs = [];
      for (let i = 0; i < n; i++) {
        const tr = inputFiles[i];
        const st = trackAnalysis[tr.path] || trackAnalysis[tr.name] || {};
        const rms = typeof st.speechRmsDb === 'number' ? st.speechRmsDb : -24.0;
        // Equalize energy into the glue compressor bus at nominal -20 dB RMS
        const balGain = Math.max(-14, Math.min(18, -20.0 - rms));
        const roleVolPct = this._resolveTrackVolumePercent(tr, timingMeta);
        const userVolGainDb = roleVolPct !== 100 ? (20 * Math.log10(Math.max(10, roleVolPct) / 100)) : 0;
        const totalGain = Math.max(-24, Math.min(24, balGain + userVolGainDb));
        filterParts.push(`[${i}:a]volume=${totalGain.toFixed(1)}dB[bal_${i}]`);
        mixInputs.push(`[bal_${i}]`);
        logFn(`  • Дорожка «${tr.dubberNick || tr.name}» (RMS ${rms} dB, громкость роли ${roleVolPct}%) -> пред-баланс шины: ${totalGain >= 0 ? '+' : ''}${totalGain.toFixed(1)} dB`, 'debug');
      }
      filterParts.push(`${mixInputs.join('')}amix=inputs=${n}:dropout_transition=0:normalize=0[mixed]`);
      filterParts.push(`[mixed]acompressor=threshold=${thresholdDb}dB:ratio=${ratio}:attack=${attackMs}:release=${releaseMs}:knee=${kneeDb}dB:makeup=${makeupDb}dB,alimiter=limit=${peakLimitDb}dB:attack=2:release=40:level=true[out]`);
      filter = filterParts.join(';');

      command.complexFilter(filter, ['out']);
    } else {
      const roleVolPct = this._resolveTrackVolumePercent(inputFiles[0], timingMeta);
      const userVolGainDb = roleVolPct !== 100 ? (20 * Math.log10(Math.max(10, roleVolPct) / 100)) : 0;
      const volFilter = userVolGainDb !== 0 ? `volume=${userVolGainDb.toFixed(1)}dB,` : '';
      filter = `${volFilter}acompressor=threshold=${thresholdDb}dB:ratio=${ratio}:attack=${attackMs}:release=${releaseMs}:knee=${kneeDb}dB:makeup=${makeupDb}dB,alimiter=limit=${peakLimitDb}dB:attack=2:release=40:level=true`;
      command.audioFilters(filter);
    }

    command
      .audioCodec('pcm_s16le')
      .audioChannels(2)
      .audioFrequency(48000)
      .output(outPath);

    await this._execFfmpeg(command, {
      logFn,
      onProgress: (p) => {
        if (onProgress && p && p.percent) onProgress({ percent: Math.round(p.percent), message: 'Склейка голосов...' });
      },
      outPath,
      description: `Склейка и компрессия ${n} дорожек`
    });

    const st = fsSync.statSync(outPath);
    logFn(`Голосовой мастер-файл успешно склеен: ${outName} (${(st.size / (1024*1024)).toFixed(2)} MB)`);
    return [{ name: outName, path: outPath, size: st.size }];
  }

}

module.exports = MixingVocalDspExecutors;
