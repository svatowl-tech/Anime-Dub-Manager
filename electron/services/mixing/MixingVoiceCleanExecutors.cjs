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

class MixingVoiceCleanExecutors {
  /**
   * EXEC: UVR DeNoise Lite (VR Lightweight Stationarity Reducer)
   * High-speed neural stationary noise suppression preserving voice formants
   */
  async _execUvrDenoiseLite({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const nrDb = Number(params.noiseReductionDb ?? 18.0);
    const attenLimDb = Number(params.attenuationLimitDb ?? 100.0);
    const postFilter = Boolean(params.postFilter);
    const autoDownload = params.autoDownloadModel !== false;

    // Custom sensitivity and dry/wet blend controls
    const sensitivity = Number(params.sensitivity ?? 6.0);
    const wetDryBlend = Math.max(10, Math.min(100, Number(params.wetDryBlend ?? 95.0)));

    const activeModelId = params.modelId || 'uvr_denoise_foxjoy';
    const modelDef = MODULE_DATABASE.find(m => m.id === activeModelId) || MODULE_DATABASE.find(m => m.id === 'uvr_denoise_foxjoy');
    const modelName = modelDef?.name || modelDef?.title || activeModelId;
    const filename = modelDef?.filename || 'UVR-DeNoise.pth';

    if (inputFiles.length === 0) {
      throw new Error(`Нет входных дорожек для применения модели ${modelName}.`);
    }

    logFn(`[${modelName}] Запуск нейросетевого шумоподавления (модель: ${filename})...`);
    logFn(`Параметры: Подавление=${nrDb} dB, Предел DF3=${Math.abs(attenLimDb)} dB, Post-Filter=${postFilter ? 'Вкл' : 'Выкл'}, Чувствительность=${sensitivity}/10, Wet/Dry=${wetDryBlend}%`);

    // Ensure model storage folder exists for offline UVR models
    const rootUserData = app ? app.getPath('userData') : process.cwd();
    const uvrModelsDir = path.join(rootUserData, 'models', 'uvr');
    await fs.mkdir(uvrModelsDir, { recursive: true });
    const localModelFile = path.join(uvrModelsDir, filename);

    let modelInstalled = fsSync.existsSync(localModelFile);
    if (!modelInstalled && autoDownload) {
      logFn(`Файл весов ${filename} не обнаружен локально. Запуск автозагрузки / инициализации...`);
      try {
        await this.downloadUvrModel({
          modelId: activeModelId,
          onProgress: (p) => {
            if (onProgress && p && typeof p.percent === 'number') {
              onProgress({ percent: Math.round(p.percent * 0.15), message: `Загрузка модели ${modelName}: ${p.percent}%` });
            }
          },
          onLog: logFn
        });
        modelInstalled = fsSync.existsSync(localModelFile);
      } catch (err) {
        logFn(`Предупреждение при скачивании весов из сети: ${err.message}. Переход на встроенный локальный модуль VR Spectral Denoise.`, 'warn');
      }
    }

    if (modelInstalled) {
      const st = fsSync.statSync(localModelFile);
      logFn(`✓ Задействована модель: ${filename} (${(st.size / (1024*1024)).toFixed(1)} МБ)`);
      logFn(`Архитектура: ${modelDef?.engineArchitecture || 'VR Speech Denoise'} | Режим: Пакетная очистка на ${inputFiles.length} дорожках`);
    } else {
      logFn(`✓ Задействован встроенный движок архитектуры ${modelDef?.engineArchitecture || 'VR Speech Denoise'} на ${inputFiles.length} дорожках`);
    }

    const results = [];
    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);
      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      logFn(`[${i+1}/${inputFiles.length}] Применение модели «${modelName}» к дорожке «${nick}»...`);

      logFn(`[Neural AI] Запуск нейросетевой модели «${modelName}» для дорожки «${nick}»...`);
      const neuralRes = await AudioNeuralService.denoiseAudio({
        inputPath: track.path,
        outputPath: outPath,
        modelPath: localModelFile,
        modelId: activeModelId,
        noiseReductionDb: nrDb,
        attenuationLimitDb: Math.abs(attenLimDb),
        postFilter,
        sensitivity,
        wetDryBlend,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `${modelName} [${nick}]: ${p.percent}%` });
          }
        },
        onLog: logFn
      });

      if (!neuralRes || !fsSync.existsSync(outPath)) {
        throw new Error(`Модель «${modelName}» не создала выходной файл для дорожки «${nick}».`);
      }

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
      logFn(`✓ Дорожка «${nick}» успешно очищена нейросетью «${modelName}» -> ${outName} (${(st.size / (1024*1024)).toFixed(1)} МБ)`);
    }

    return results;
  }

  /**
   * EXEC: FFmpeg Spectral Denoise (Dedicated standalone FFmpeg afftdn module)
   */
  async _execFfmpegDenoise({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const nrDb = Number(params.noiseReductionDb ?? 16.0);
    const floorDb = Number(params.noiseFloorDb ?? -50.0);
    const sensitivity = Number(params.sensitivity ?? 6.0);
    const wetDryBlend = Math.max(10, Math.min(100, Number(params.wetDryBlend ?? 95.0)));
    const preserveFormants = params.preserveVoiceFormants !== false;

    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для модуля FFmpeg Spectral Denoise.');
    }

    logFn(`[FFmpeg Spectral Denoise] Запуск частотного FFT-шумоподавления для ${inputFiles.length} дорожек...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);
      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      const sensFactor = sensitivity / 10.0;
      const fftNr = Math.min(45, Math.max(0.1, nrDb * sensFactor));
      const fftFloor = Math.min(-20, Math.max(-85, floorDb));
      const tnVal = params.noiseTraining !== undefined ? (params.noiseTraining ? 1 : 0) : (sensitivity > 6.0 ? 1 : 0);
      const trVal = sensitivity >= 2.0 ? 1 : 0;

      let filterChain = '';
      if (wetDryBlend < 100) {
        const wetVal = (wetDryBlend / 100).toFixed(2);
        const dryVal = (1.0 - wetDryBlend / 100).toFixed(2);
        filterChain = `asplit[orig][tofilt]; [tofilt]highpass=f=65,afftdn=nr=${fftNr.toFixed(1)}:nf=${fftFloor}:tn=${tnVal}:tr=${trVal}:om=o`;
        if (preserveFormants) {
          filterChain += `,equalizer=f=3400:t=q:w=1.2:g=1.2,equalizer=f=10500:t=h:g=0.8`;
        }
        filterChain += `[filt]; [orig]volume=${dryVal}[dry]; [filt]volume=${wetVal}[wet]; [dry][wet]amix=inputs=2:duration=first:dropout_transition=0`;
      } else {
        filterChain = `highpass=f=65,afftdn=nr=${fftNr.toFixed(1)}:nf=${fftFloor}:tn=${tnVal}:tr=${trVal}:om=o`;
        if (preserveFormants) {
          filterChain += `,equalizer=f=3400:t=q:w=1.2:g=1.2,equalizer=f=10500:t=h:g=0.8`;
        }
      }

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
            onProgress({ percent: current, message: `FFmpeg Denoise [${nick}] (${p.percent}%)` });
          }
        },
        outPath,
        description: `FFmpeg Spectral Denoise [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
      logFn(`✓ Дорожка «${nick}» обработана FFmpeg Spectral Denoise -> ${outName}`);
    }

    return results;
  }

  /**
   * EXEC: UVR De-Echo Normal (VR Architecture Flutter Echo Canceller)
   * Soft suppression of flutter echo without thinning low and mid frequencies
   */
  async _execUvrDeEchoNormal({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const reverbReduction = Number(params.reverbReduction ?? (params.deechoReductionDb ? params.deechoReductionDb / 25.0 : 0.65));
    const autoDownload = params.autoDownloadModel !== false;

    // Custom sensitivity and dry/wet blend controls
    const sensitivity = Number(params.sensitivity ?? 6.5);
    const wetDryBlend = Math.max(10, Math.min(100, Number(params.wetDryBlend ?? 85.0)));

    const activeModelId = params.modelId || 'uvr_deecho_normal';
    const modelDef = MODULE_DATABASE.find(m => m.id === activeModelId) || MODULE_DATABASE.find(m => m.id === 'uvr_deecho_normal');
    const modelName = modelDef?.name || modelDef?.title || activeModelId;
    const filename = modelDef?.filename || 'UVR-De-Echo-Normal.pth';

    if (inputFiles.length === 0) {
      throw new Error(`Нет входных дорожек для применения модели ${modelName}.`);
    }

    logFn(`[${modelName}] Запуск подавления комнатного и порхающего эха (модель: ${filename})...`);
    logFn(`Степень дериверберации: ${(reverbReduction * 100).toFixed(0)}%, Чувствительность: ${sensitivity}/10, Подмешивание Wet/Dry: ${wetDryBlend}%`);

    const rootUserData = app ? app.getPath('userData') : process.cwd();
    const uvrModelsDir = path.join(rootUserData, 'models', 'uvr');
    await fs.mkdir(uvrModelsDir, { recursive: true });
    const localModelFile = path.join(uvrModelsDir, filename);

    if (activeModelId === 'vst-spectral-dereverb') {
      logFn(`✓ Задействован нативный C++ DSP алгоритм 16-Band Filterbank Energy Decay Subtraction (нулевая задержка).`);
    } else {
      let modelInstalled = fsSync.existsSync(localModelFile);
      if (!modelInstalled && autoDownload && modelDef?.urls?.length > 0) {
        logFn(`Файл весов ${filename} не обнаружен локально. Запуск автозагрузки / инициализации...`);
        try {
          await this.downloadUvrModel({
            modelId: activeModelId,
            onProgress: (p) => {
              if (onProgress && p && typeof p.percent === 'number') {
                onProgress({ percent: Math.round(p.percent * 0.15), message: `Загрузка ${modelName}: ${p.percent}%` });
              }
            },
            onLog: logFn
          });
          modelInstalled = fsSync.existsSync(localModelFile);
        } catch (err) {
          logFn(`Предупреждение при скачивании весов из сети: ${err.message}. Переход на встроенный локальный модуль VR Flutter Echo Canceller.`, 'warn');
        }
      }

      if (modelInstalled) {
        const st = fsSync.statSync(localModelFile);
        logFn(`✓ Задействована модель: ${filename} (${(st.size / (1024*1024)).toFixed(1)} МБ)`);
        logFn(`Архитектура: ${modelDef?.engineArchitecture || 'VR Flutter Echo Canceller'} | Пакетная очистка эха на ${inputFiles.length} дорожках`);
      } else {
        logFn(`✓ Задействован встроенный движок архитектуры ${modelDef?.engineArchitecture || 'VR Flutter Echo Canceller'} на ${inputFiles.length} дорожках`);
      }
    }

    const results = [];
    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);
      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      logFn(`[${i+1}/${inputFiles.length}] Применение модели «${modelName}» к дорожке «${nick}»...`);

      logFn(`[Neural AI] Запуск модели «${modelName}» для дорожки «${nick}»...`);
      const neuralRes = await AudioNeuralService.dereverbAudio({
        inputPath: track.path,
        outputPath: outPath,
        modelPath: localModelFile,
        modelId: activeModelId,
        reverbReduction,
        sensitivity,
        wetDryBlend,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `${modelName} [${nick}]: ${p.percent}%` });
          }
        },
        onLog: logFn
      });

      if (!neuralRes || !fsSync.existsSync(outPath)) {
        throw new Error(`Модель дериверберации «${modelName}» не создала выходной файл для дорожки «${nick}».`);
      }

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
      logFn(`✓ Дорожка «${nick}» успешно очищена от эха моделью «${modelName}» -> ${outName} (${(st.size / (1024*1024)).toFixed(1)} МБ)`);
    }

    return results;
  }

  /**
   * EXEC: FFmpeg De-Echo & Room Filter (Dedicated standalone FFmpeg module)
   */
  async _execFfmpegDeEcho({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const deechoDb = Number(params.deechoReductionDb ?? 14.0);
    const earlyDecay = Math.max(0.1, Math.min(1.0, Number(params.earlyReflectionsDecay ?? 0.70)));
    const preserveBody = params.preserveBodyFrequencies !== false;
    const sensitivity = Number(params.sensitivity ?? 6.5);
    const wetDryBlend = Math.max(10, Math.min(100, Number(params.wetDryBlend ?? 85.0)));

    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для модуля FFmpeg De-Echo.');
    }

    logFn(`[FFmpeg De-Echo] Запуск фильтрации комнатного эха для ${inputFiles.length} дорожек...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);
      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      const sensFactor = sensitivity / 10.0;
      const effectiveDeechoDb = Math.min(30, Math.max(1, deechoDb * sensFactor));
      const nrAmount = Math.min(22, Math.max(1, Math.round(effectiveDeechoDb * 0.75)));
      const effectiveEarlyDecay = Math.max(0.05, Math.min(1.0, earlyDecay * (0.2 + sensFactor * 0.8)));
      const notchGain = -(effectiveEarlyDecay * 2.2).toFixed(1);
      const tnVal = params.noiseTraining !== undefined ? (params.noiseTraining ? 1 : 0) : (sensitivity > 6.0 ? 1 : 0);
      const trVal = sensitivity >= 2.0 ? 1 : 0;

      let filterChain = '';
      if (wetDryBlend < 100) {
        const wetVal = (wetDryBlend / 100).toFixed(2);
        const dryVal = (1.0 - wetDryBlend / 100).toFixed(2);
        filterChain = `asplit[orig][tofilt]; [tofilt]highpass=f=60,afftdn=nr=${nrAmount}:nf=-52:tn=${tnVal}:tr=${trVal}:om=o,equalizer=f=3200:t=q:w=2.0:g=${notchGain},equalizer=f=4800:t=q:w=2.5:g=${notchGain}`;
        if (preserveBody) {
          filterChain += `,equalizer=f=260:t=q:w=1.0:g=1.0,equalizer=f=420:t=q:w=1.2:g=0.8`;
        }
        filterChain += `[filt]; [orig]volume=${dryVal}[dry]; [filt]volume=${wetVal}[wet]; [dry][wet]amix=inputs=2:duration=first:dropout_transition=0`;
      } else {
        filterChain = `highpass=f=60,afftdn=nr=${nrAmount}:nf=-52:tn=${tnVal}:tr=${trVal}:om=o,equalizer=f=3200:t=q:w=2.0:g=${notchGain},equalizer=f=4800:t=q:w=2.5:g=${notchGain}`;
        if (preserveBody) {
          filterChain += `,equalizer=f=260:t=q:w=1.0:g=1.0,equalizer=f=420:t=q:w=1.2:g=0.8`;
        }
      }

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
            onProgress({ percent: current, message: `FFmpeg De-Echo [${nick}] (${p.percent}%)` });
          }
        },
        outPath,
        description: `FFmpeg De-Echo [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
      logFn(`✓ Дорожка «${nick}» обработана FFmpeg De-Echo -> ${outName}`);
    }

    return results;
  }

  /**
   * EXEC: Stem Separation (UVR-MDX-NET / Demucs / RoFormer / Kim / Karaoke)
   * Separates original audio track into Vocals, Instrumental (M&E), BGM, and SFX stems
   */
  async _execStemSeparation({ episode, workingDir, stepFolder, prefix, manifest, inputFiles, params, logFn, onProgress }) {
    const autoDownload = params.autoDownloadModel !== false;
    const activeModelId = params.modelId || 'uvr_mdx_voc_ft';
    const modelDef = MODULE_DATABASE.find(m => m.id === activeModelId) || MODULE_DATABASE.find(m => m.id === 'uvr_mdx_voc_ft');
    const modelName = modelDef?.name || modelDef?.title || activeModelId;
    const filename = modelDef?.filename || 'UVR-MDX-NET-Voc_FT.onnx';

    let sourceAudioPath = manifest.sourceFiles.originalAudio?.path;
    if (!sourceAudioPath || !fsSync.existsSync(sourceAudioPath)) {
      if (inputFiles.length > 0 && fsSync.existsSync(inputFiles[0].path)) {
        sourceAudioPath = inputFiles[0].path;
      } else {
        const vPath = manifest.sourceFiles.video?.path || episode?.rawPath;
        if (!vPath || !fsSync.existsSync(vPath)) {
          throw new Error('Оригинальное аудио или видео не найдено для разделения.');
        }
        sourceAudioPath = path.join(workingDir, '00_исходные', '00_original_audio.wav');
        await fs.mkdir(path.dirname(sourceAudioPath), { recursive: true });
        await this._extractAudioFromVideo(vPath, sourceAudioPath, logFn);
      }
    }

    logFn(`[${modelName}] Запуск разделения звука (модель: ${filename})...`);
    logFn(`Архитектура: ${modelDef?.engineArchitecture || 'MDX-Net Spectrogram'} | Назначение: ${modelDef?.recommended_for || 'Изоляция вокала и фона'}`);

    const rootUserData = app ? app.getPath('userData') : process.cwd();
    const uvrModelsDir = path.join(rootUserData, 'models', 'uvr');
    await fs.mkdir(uvrModelsDir, { recursive: true });
    const localModelFile = path.join(uvrModelsDir, filename);

    let modelInstalled = fsSync.existsSync(localModelFile);
    if (!modelInstalled && autoDownload && modelDef?.urls?.length > 0) {
      logFn(`Файл весов ${filename} (${modelDef.size_mb} MB) не обнаружен локально. Запуск автозагрузки...`);
      try {
        await this.downloadUvrModel({
          modelId: activeModelId,
          onProgress: (p) => {
            if (onProgress && p && typeof p.percent === 'number') {
              onProgress({ percent: Math.round(p.percent * 0.20), message: `Загрузка модели ${modelName}: ${p.percent}%` });
            }
          },
          onLog: logFn
        });
        modelInstalled = fsSync.existsSync(localModelFile);
      } catch (err) {
        logFn(`Предупреждение при скачивании весов: ${err.message}. Переход на высокоточный встроенный гибридный разделяющий фильтр.`, 'warn');
      }
    }

    if (modelInstalled) {
      const st = fsSync.statSync(localModelFile);
      logFn(`✓ Задействована модель: ${filename} (${(st.size / (1024*1024)).toFixed(1)} МБ)`);
    } else {
      logFn(`✓ Задействован встроенный движок архитектуры ${modelDef?.engineArchitecture || 'MDX-Net Spectrogram'}`);
    }

    const shifts = Number(params.shifts ?? 1);
    const overlap = Number(params.overlap ?? 0.25);
    const stemsSelection = params.stems || (params.extractVocals && !params.extractInstrumental ? 'vocals_only' : (!params.extractVocals && params.extractInstrumental ? 'instrumental_only' : 'both'));

    logFn(`[Neural AI] Запуск модели «${modelName}» для разделения стемов (shifts=${shifts}, overlap=${overlap}, stems=${stemsSelection})...`);
    const neuralStems = await AudioNeuralService.separateStems({
      inputPath: sourceAudioPath,
      outputDir: stepFolder,
      modelName: activeModelId,
      modelPath: localModelFile,
      modelId: activeModelId,
      shifts,
      overlap,
      stems: stemsSelection,
      prefix,
      onProgress: (p) => {
        if (onProgress && p && typeof p.percent === 'number') {
          onProgress({ percent: p.percent, message: `${modelName}: ${p.percent}%` });
        }
      },
      onLog: logFn
    });

    if (!neuralStems || !Array.isArray(neuralStems) || neuralStems.length === 0) {
      throw new Error(`Модель «${modelName}» не сформировала стем-файлы.`);
    }

    const formatted = neuralStems.map(s => {
      let sz = 0;
      try { sz = fsSync.statSync(s.path).size; } catch (e) {}
      return {
        name: path.basename(s.path),
        path: s.path,
        size: sz,
        type: s.type
      };
    });
    logFn(`✓ Разделение оригинала успешно завершено нейросетью «${modelName}» (${formatted.length} стем-файлов)!`);
    return formatted;
  }

  /**
   * EXEC: FFmpeg Vocal / Instrumental Splitter (Dedicated standalone FFmpeg module)
   */
  async _execFfmpegVocalRemover({ episode, workingDir, stepFolder, prefix, manifest, inputFiles, params, logFn, onProgress }) {
    let sourceAudioPath = manifest.sourceFiles.originalAudio?.path;
    if (inputFiles.length > 0 && fsSync.existsSync(inputFiles[0].path)) {
      sourceAudioPath = inputFiles[0].path;
    } else if (!sourceAudioPath || !fsSync.existsSync(sourceAudioPath)) {
      const vPath = manifest.sourceFiles.video?.path || episode?.rawPath;
      if (!vPath || !fsSync.existsSync(vPath)) {
        throw new Error('Оригинальное аудио или видео не найдено для разделения.');
      }
      sourceAudioPath = path.join(workingDir, '00_исходные', '00_original_audio.wav');
      await fs.mkdir(path.dirname(sourceAudioPath), { recursive: true });
      await this._extractAudioFromVideo(vPath, sourceAudioPath, logFn);
    }

    const sensitivity = Number(params.sensitivity ?? 6.5);
    const marginDb = Number(params.marginDb ?? 1.5);
    const gateThreshold = Number(params.postProcessThreshold ?? 0.20);
    const instBlend = Number(params.instrumentalBlend ?? 100.0);

    logFn(`[FFmpeg Vocal/M&E Splitter] Разделение частотного диапазона оригинала (Чувствительность=${sensitivity}/10)...`);

    const hpVocFreq = Math.round(55 + (sensitivity * 7));
    const lpVocFreq = Math.round(16500 - (sensitivity * 750));
    let vocFilters = `highpass=f=${hpVocFreq},lowpass=f=${lpVocFreq}`;
    if (marginDb !== 0) {
      vocFilters += `,equalizer=f=1000:t=q:w=1.0:g=${marginDb.toFixed(1)},equalizer=f=3400:t=q:w=1.5:g=${(marginDb * 0.5).toFixed(1)}`;
    }
    if (gateThreshold > 0.0) {
      const gateDb = -(65 - gateThreshold * 35).toFixed(1);
      vocFilters += `,agate=threshold=${gateDb}dB:range=-15dB:attack=15:release=140`;
    }
    if (instBlend < 100.0) {
      const origWeight = (1.0 - instBlend / 100.0).toFixed(2);
      const vocWeight = (instBlend / 100.0).toFixed(2);
      vocFilters = `asplit[orig_audio][to_filt]; [to_filt]${vocFilters}[filtered_vocal]; [orig_audio]volume=${origWeight}[dry]; [filtered_vocal]volume=${vocWeight}[wet]; [dry][wet]amix=inputs=2:duration=first:dropout_transition=0`;
    }

    const results = [];
    const vocalsName = `${prefix}original_vocals.wav`;
    const vocalsPath = path.join(stepFolder, vocalsName);
    const instName = `${prefix}original_instrumental_ME.wav`;
    const instPath = path.join(stepFolder, instName);

    const vocCmd = ffmpeg(sourceAudioPath)
      .audioFilters(vocFilters)
      .audioCodec('pcm_s16le')
      .audioChannels(2)
      .audioFrequency(48000)
      .output(vocalsPath);

    await this._execFfmpeg(vocCmd, {
      logFn,
      onProgress: (p) => {
        if (onProgress && p && p.percent) onProgress({ percent: Math.round(p.percent * 0.5), message: `Извлечение вокала: ${p.percent}%` });
      },
      outPath: vocalsPath,
      description: `FFmpeg Изоляция вокала`
    });

    const vocSt = fsSync.statSync(vocalsPath);
    results.push({ name: vocalsName, path: vocalsPath, size: vocSt.size, type: 'vocals' });

    const notchDepth = -(sensitivity * 2.5).toFixed(1);
    const instFilters = `highpass=f=25,equalizer=f=1000:t=q:w=1.0:g=${(notchDepth * 0.4).toFixed(1)},equalizer=f=3200:t=q:w=2.0:g=${notchDepth}`;

    const instCmd = ffmpeg(sourceAudioPath)
      .audioFilters(instFilters)
      .audioCodec('pcm_s16le')
      .audioChannels(2)
      .audioFrequency(48000)
      .output(instPath);

    await this._execFfmpeg(instCmd, {
      logFn,
      onProgress: (p) => {
        if (onProgress && p && p.percent) onProgress({ percent: 50 + Math.round(p.percent * 0.5), message: `Извлечение фонограммы: ${p.percent}%` });
      },
      outPath: instPath,
      description: `FFmpeg Извлечение фонограммы (M&E)`
    });

    const instSt = fsSync.statSync(instPath);
    results.push({ name: instName, path: instPath, size: instSt.size, type: 'instrumental' });

    logFn(`✓ Частотное разделение FFmpeg завершено! Сформировано стемов: ${results.length}`);
    return results;
  }

  /**
   * EXEC: VoiceFixer Harmonic Restorer (VoiceFixer Neural Harmonic Synthesizer)
   * Restores air-band frequencies (12-16kHz), aligns formants and adds analog warmth
   */
  async _execVoiceFixer({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const airBoost = Number(params.airBandBoostDb ?? 3.5);
    const sat = Math.max(0.1, Math.min(1.0, Number(params.harmonicSaturation ?? 0.45)));
    const clarity = Math.max(0.1, Math.min(1.0, Number(params.formantClarity ?? 0.65)));
    const subBassProtect = params.subBassPreservation !== false;
    const warmTube = params.warmTubeEmulation !== false;
    const autoDownload = params.autoDownloadModel !== false;

    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для применения модели VoiceFixer.');
    }

    logFn(`[VoiceFixer] Запуск нейросетевого восстановления гармоник модели vf.ckpt...`);
    logFn(`Параметры: Air-Boost ${airBoost} dB, Сатурация ${sat}, Читаемость формант ${clarity}, Ламповый тон: ${warmTube ? 'Вкл' : 'Выкл'}`);

    const rootUserData = app ? app.getPath('userData') : process.cwd();
    const uvrModelsDir = path.join(rootUserData, 'models', 'uvr');
    await fs.mkdir(uvrModelsDir, { recursive: true });
    const localModelFile = path.join(uvrModelsDir, 'vf.ckpt');
    const localVocoderFile = path.join(uvrModelsDir, 'model.ckpt-1490000_trimed.pt');

    let modelInstalled = fsSync.existsSync(localModelFile);
    if (!modelInstalled && autoDownload) {
      logFn('Файл весов vf.ckpt не обнаружен локально. Запуск загрузки / инициализации...');
      await this.downloadUvrModel({
        modelId: 'voicefixer_fe',
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            onProgress({ percent: Math.round(p.percent * 0.15), message: `Загрузка VoiceFixer (vf.ckpt): ${p.percent}%` });
          }
        },
        onLog: logFn
      });
      modelInstalled = fsSync.existsSync(localModelFile);
    }

    if (autoDownload && !fsSync.existsSync(localVocoderFile)) {
      try {
        await this.downloadUvrModel({
          modelId: 'voicefixer_vocoder',
          onProgress: (p) => {
            if (onProgress && p && typeof p.percent === 'number') {
              onProgress({ percent: Math.round(p.percent * 0.1), message: `Загрузка вокодера VoiceFixer: ${p.percent}%` });
            }
          },
          onLog: logFn
        });
      } catch (vocErr) {
        logFn(`Примечание: загрузка дополнительного файла вокодера пропущена (${vocErr.message}).`, 'warn');
      }
    }

    const results = [];
    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);

      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      logFn(`[${i+1}/${inputFiles.length}] Запуск VoiceFixer Harmonic Restorer для дорожки «${nick}»...`);
      const neuralRes = await AudioNeuralService.voiceFixer({
        inputPath: track.path,
        outputPath: outPath,
        modelPath: localModelFile,
        airBandBoostDb: airBoost,
        harmonicSaturation: sat,
        formantClarity: clarity,
        warmTubeEmulation: warmTube,
        subBassProtect,
        onProgress: (p) => {
          if (onProgress && p && typeof p.percent === 'number') {
            const current = trackStartPct + Math.round((p.percent / 100) * (trackEndPct - trackStartPct));
            onProgress({ percent: current, message: `VoiceFixer [${nick}]: ${p.percent}%` });
          }
        },
        onLog: logFn
      });

      if (!neuralRes || !fsSync.existsSync(outPath)) {
        throw new Error(`Нейросеть VoiceFixer не сформировала выходной файл для дорожки «${nick}».`);
      }

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
      logFn(`✓ Дорожка «${nick}» обработана нейросетью VoiceFixer -> ${outName} (${(st.size / (1024*1024)).toFixed(1)} МБ)`);
    }

    return results;
  }

  /**
   * EXEC: FFmpeg Harmonic Exciter & Air Restorer (Dedicated standalone FFmpeg module)
   */
  async _execFfmpegHarmonicRestorer({ workingDir, stepFolder, prefix, inputFiles, params, logFn, onProgress }) {
    const airBoost = Number(params.airBandBoostDb ?? 3.5);
    const sat = Math.max(0.1, Math.min(1.0, Number(params.harmonicSaturation ?? 0.45)));
    const clarity = Math.max(0.1, Math.min(1.0, Number(params.formantClarity ?? 0.65)));
    const subBassProtect = params.subBassPreservation !== false;
    const warmTube = params.warmTubeEmulation !== false;

    if (inputFiles.length === 0) {
      throw new Error('Нет входных дорожек для модуля FFmpeg Harmonic Exciter.');
    }

    logFn(`[FFmpeg Harmonic Exciter] Восстановление ВЧ-воздуха и гармоник для ${inputFiles.length} дорожек...`);
    const results = [];

    for (let i = 0; i < inputFiles.length; i++) {
      const track = inputFiles[i];
      const nick = this._resolveTrackNick(track, inputFiles, i);
      const outName = this._resolveTrackOutName(track, inputFiles, i, prefix);
      const outPath = path.join(stepFolder, outName);
      const trackStartPct = Math.round((i / inputFiles.length) * 100);
      const trackEndPct = Math.round(((i + 1) / inputFiles.length) * 100);

      let filterChain = '';
      if (subBassProtect) {
        filterChain += `highpass=f=70,`;
      }
      filterChain += `equalizer=f=13500:t=h:g=${airBoost.toFixed(1)}`;
      const clarityGain = (clarity * 3.0).toFixed(1);
      filterChain += `,equalizer=f=3400:t=q:w=1.2:g=${clarityGain}`;
      if (warmTube && sat > 0.15) {
        const drive = (1.0 + sat * 0.8).toFixed(2);
        filterChain += `,aexciter=level_in=1:level_out=1:amount=${(sat * 2).toFixed(1)}:drive=${drive}:freq=7500`;
      }

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
            onProgress({ percent: current, message: `FFmpeg Exciter: ${nick} (${p.percent}%)` });
          }
        },
        outPath,
        description: `FFmpeg Harmonic Exciter [${nick}]`
      });

      const st = fsSync.statSync(outPath);
      results.push({ name: outName, path: outPath, size: st.size, dubberNick: nick });
      logFn(`✓ Дорожка «${nick}» обработана FFmpeg Harmonic Exciter -> ${outName}`);
    }

    return results;
  }

}

module.exports = MixingVoiceCleanExecutors;
