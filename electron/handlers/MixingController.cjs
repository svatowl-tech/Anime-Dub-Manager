const { ipcMain, app, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const log = require('electron-log');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');
const MixingPipelineService = require('../services/MixingPipelineService.cjs');
const AudioNeuralService = require('../services/AudioNeuralService.cjs');

function registerMixingHandlers(getData, mainWindow) {
  const getWin = () => (typeof mainWindow === 'function' ? mainWindow() : mainWindow);

  const sendProgress = (channel, data) => {
    const win = getWin();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  };

  const createLogSender = (defaultStepId = null) => {
    return (msg, level = 'info', meta = null) => {
      const timestamp = new Date().toISOString();
      const payload = {
        stepId: defaultStepId,
        message: typeof msg === 'string' ? msg : JSON.stringify(msg),
        level: level || 'info',
        meta: meta || null,
        timestamp
      };
      sendProgress('mixing-log', payload);
      // Also log to Node.js backend console
      const prefix = defaultStepId ? `[MixingController:${defaultStepId}]` : '[MixingController]';
      if (level === 'error') {
        console.error(`${prefix} ❌ ${payload.message}`, meta || '');
      } else if (level === 'warn') {
        console.warn(`${prefix} ⚠️ ${payload.message}`, meta || '');
      } else {
        console.log(`${prefix} ${payload.message}`, meta || '');
      }
    };
  };

  ipcMain.handle('mixing-get-status', wrapIpcHandler(async (event, { episode, targetDir }) => {
    if (!episode) throw new Error('Параметр серии обязателен');
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    console.log(`[MixingController] get-status: episode=${episode?.number || 'unknown'}, targetDir=${targetDir || 'default'}`);
    return await MixingPipelineService.getStatus({ episode, targetDir, baseDir });
  }));

  ipcMain.handle('create-video-preview-proxy', wrapIpcHandler(async (event, { videoPath, outputPath }) => {
    if (!videoPath) throw new Error('videoPath обязателен для создания MP4-прокси');
    const { createVideoProxy } = require('../services/ffmpegService.cjs');
    const onProgress = (percent) => {
      try {
        event.sender.send('video-proxy-progress', { videoPath, percent });
      } catch (e) {}
    };
    const proxyPath = await createVideoProxy(videoPath, outputPath, onProgress);
    return { success: true, proxyPath };
  }));

  ipcMain.handle('mixing-save-pipeline-config', wrapIpcHandler(async (event, { episode, targetDir, pipeline }) => {
    if (!episode || !pipeline) throw new Error('Параметры серии и конвейера обязательны');
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    console.log(`[MixingController] save-pipeline-config: ${pipeline.length} шагов`);
    return await MixingPipelineService.savePipelineConfig({ episode, targetDir, baseDir, pipeline });
  }));

  ipcMain.handle('mixing-save-timing-metadata', wrapIpcHandler(async (event, { episode, targetDir, timingMetadata }) => {
    if (!episode || !timingMetadata) throw new Error('Параметры серии и данных тайминга обязательны');
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    console.log(`[MixingController] save-timing-metadata: сохранение карты громкостей фраз тайминга`);
    return await MixingPipelineService.saveTimingMetadata({ episode, targetDir, baseDir, timingMetadata });
  }));

  ipcMain.handle('mixing-refresh-sources', wrapIpcHandler(async (event, { episode, targetDir }) => {
    if (!episode) throw new Error('Параметр серии обязателен');
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    console.log(`[MixingController] refresh-sources: пересканирование исходных файлов серии`);
    return await MixingPipelineService.rescanAndExtractSources({ episode, targetDir, baseDir });
  }));

  ipcMain.handle('mixing-import-sound-engineer-files', wrapIpcHandler(async (event, params) => {
    const { episode, targetDir, skipConversion, smartExport, additionalProcessing, autoApplyFixes, includeSubtitles, autoTiming } = params;
    if (!episode) throw new Error('Параметр серии обязателен');

    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const projectsData = await getData('projects.json');
    const participantsData = await getData('participants.json');

    const onProgress = (p) => {
      sendProgress('mixing-progress', p);
    };

    const onLog = createLogSender('import');

    onLog(`Инициализация импорта файлов звукорежиссера для серии #${episode.number || 1}...`, 'info', { params });

    return await MixingPipelineService.importSoundEngineerFiles({
      episode,
      targetDir,
      baseDir,
      config,
      projectsData,
      participantsData,
      skipConversion: !!skipConversion,
      smartExport: smartExport !== false,
      additionalProcessing: !!additionalProcessing,
      autoApplyFixes: autoApplyFixes !== false,
      includeSubtitles: includeSubtitles !== false,
      autoTiming: autoTiming !== false,
      onProgress,
      onLog
    });
  }));

  ipcMain.handle('mixing-run-step', wrapIpcHandler(async (event, { episode, targetDir, stepId }) => {
    if (!episode || !stepId) throw new Error('Не указаны обязательные параметры (episode, stepId)');
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');

    const onProgress = (p) => {
      sendProgress('mixing-progress', { stepId, ...p });
    };

    const onLog = (msg, level = 'info', meta = null) => {
      createLogSender(stepId)(msg, level, meta);
    };

    return await MixingPipelineService.runStep({
      episode,
      targetDir,
      baseDir,
      stepId,
      onProgress,
      onLog
    });
  }));

  ipcMain.handle('mixing-run-all-steps', wrapIpcHandler(async (event, { episode, targetDir }) => {
    if (!episode) throw new Error('Параметр серии обязателен');
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');

    const onProgress = (p) => {
      sendProgress('mixing-progress', p);
    };

    const onLog = createLogSender('pipeline');

    return await MixingPipelineService.runAllSteps({
      episode,
      targetDir,
      baseDir,
      onProgress,
      onLog
    });
  }));

  ipcMain.handle('mixing-save-final-video', wrapIpcHandler(async (event, { episode, targetDir, destinationPath }) => {
    let dest = destinationPath;
    if (!dest) {
      const win = getWin();
      const saveResult = await dialog.showSaveDialog(win, {
        title: 'Сохранить сведенное видео серии',
        defaultPath: `${episode?.project?.title || 'Project'}_Ep${episode?.number || 1}_release.mp4`,
        filters: [{ name: 'Видео MP4', extensions: ['mp4'] }]
      });
      if (saveResult.canceled || !saveResult.filePath) {
        return { canceled: true };
      }
      dest = saveResult.filePath;
    }

    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');

    return await MixingPipelineService.saveFinalVideo({
      episode,
      targetDir,
      baseDir,
      destinationPath: dest
    });
  }));

  ipcMain.handle('mixing-open-folder', wrapIpcHandler(async (event, { folderPath }) => {
    return await MixingPipelineService.openFolder(folderPath);
  }));

  // Presets of entire pipeline
  ipcMain.handle('mixing-get-pipeline-presets', wrapIpcHandler(async (event) => {
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    return await MixingPipelineService.getPipelinePresets({ baseDir });
  }));

  ipcMain.handle('mixing-save-pipeline-preset', wrapIpcHandler(async (event, { name, description, pipeline }) => {
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    return await MixingPipelineService.savePipelinePreset({ baseDir, name, description, pipeline });
  }));

  ipcMain.handle('mixing-delete-pipeline-preset', wrapIpcHandler(async (event, { presetId }) => {
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    return await MixingPipelineService.deletePipelinePreset({ baseDir, presetId });
  }));

  // Export / Import entire pipeline configuration to / from external JSON file
  ipcMain.handle('mixing-export-pipeline-file', wrapIpcHandler(async (event, { pipeline, defaultName }) => {
    const win = getWin();
    const res = await dialog.showSaveDialog(win, {
      title: 'Сохранить конвейер модулей в файл',
      defaultPath: defaultName || 'mixing_pipeline.json',
      filters: [{ name: 'JSON конфигурация конвейера', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    await fs.writeFile(res.filePath, JSON.stringify(pipeline, null, 2), 'utf8');
    return { canceled: false, filePath: res.filePath };
  }));

  ipcMain.handle('mixing-import-pipeline-file', wrapIpcHandler(async (event, { episode, targetDir }) => {
    const win = getWin();
    const res = await dialog.showOpenDialog(win, {
      title: 'Загрузить конвейер модулей из файла',
      filters: [{ name: 'JSON конфигурация конвейера', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths || res.filePaths.length === 0) return { canceled: true };
    const filePath = res.filePaths[0];
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const pipeline = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.pipeline) ? parsed.pipeline : null);
    if (!pipeline || pipeline.length === 0) {
      throw new Error('В выбранном файле не найдена валидная цепочка модулей сведения');
    }
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const saved = await MixingPipelineService.savePipelineConfig({ episode, targetDir, baseDir, pipeline });
    return { canceled: false, filePath, manifest: saved.manifest, pipeline };
  }));

  ipcMain.handle('mixing-reset-pipeline-default', wrapIpcHandler(async (event, { episode, targetDir }) => {
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const defaultPipeline = MixingPipelineService.createFactoryPipeline();
    const saved = await MixingPipelineService.savePipelineConfig({ episode, targetDir, baseDir, pipeline: defaultPipeline });
    return { success: true, manifest: saved.manifest, pipeline: defaultPipeline };
  }));

  // External Standalone File Import
  ipcMain.handle('mixing-select-external-files', wrapIpcHandler(async (event, { type }) => {
    const win = getWin();
    let filters = [];
    let properties = ['openFile'];

    if (type === 'video') {
      filters = [{ name: 'Видеофайлы', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm'] }];
    } else if (type === 'subtitles') {
      filters = [{ name: 'Субтитры', extensions: ['ass', 'srt', 'vtt'] }];
    } else if (type === 'audio') {
      filters = [{ name: 'Аудио дорожки', extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a', 'aac'] }];
      properties = ['openFile', 'multiSelections'];
    }

    const res = await dialog.showOpenDialog(win, {
      title: type === 'video' ? 'Выберите видео серии' : (type === 'subtitles' ? 'Выберите файл субтитров' : 'Выберите аудиодорожки'),
      filters,
      properties
    });

    if (res.canceled || !res.filePaths || res.filePaths.length === 0) {
      return { canceled: true, filePaths: [] };
    }

    return { canceled: false, filePaths: res.filePaths };
  }));

  ipcMain.handle('mixing-import-external-files', wrapIpcHandler(async (event, { episode, targetDir, videoPath, subPath, audioPaths }) => {
    if (!episode) throw new Error('Параметр серии обязателен');
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const onLog = createLogSender('external_import');
    const onProgress = (p) => {
      sendProgress('mixing-progress', p);
    };
    onLog(`Импорт внешних файлов в сведение: video=${videoPath || 'нет'}, sub=${subPath || 'нет'}, audio=${audioPaths?.length || 0} шт.`, 'info');
    return await MixingPipelineService.importExternalFiles({
      episode,
      targetDir,
      baseDir,
      videoPath,
      subPath,
      audioPaths,
      onProgress,
      onLog
    });
  }));

  // UVR Models Management
  ipcMain.handle('mixing-check-uvr-model', wrapIpcHandler(async (event, { modelId } = {}) => {
    const onLog = createLogSender('model_check');
    onLog(`Проверка статуса модели: ${modelId || 'uvr_denoise_lite'}`, 'debug');
    return await MixingPipelineService.checkUvrModelStatus({ modelId });
  }));

  ipcMain.handle('mixing-download-uvr-model', wrapIpcHandler(async (event, { modelId } = {}) => {
    const onProgress = (p) => {
      sendProgress('mixing-progress', p);
    };
    const onLog = createLogSender(modelId || 'uvr_model');

    return await MixingPipelineService.downloadUvrModel({
      modelId,
      onProgress,
      onLog
    });
  }));
  // Neural AI Processor Handlers (DeepFilterNet3 & Demucs v4)
  ipcMain.handle('neural-check-environment', wrapIpcHandler(async () => {
    return await AudioNeuralService.checkEnvironment();
  }));

  ipcMain.handle('neural-process-denoise', wrapIpcHandler(async (event, params) => {
    const { inputPath, outputPath, attenuationLimitDb, sensitivity, wetDryBlend } = params;
    const onProgress = (p) => sendProgress('mixing-progress', p);
    const onLog = createLogSender('deepfilternet_denoise');
    return await AudioNeuralService.denoiseAudio({
      inputPath,
      outputPath,
      attenuationLimitDb,
      sensitivity,
      wetDryBlend,
      onProgress,
      onLog
    });
  }));

  ipcMain.handle('neural-process-dereverb', wrapIpcHandler(async (event, params) => {
    const { inputPath, outputPath, reverbReduction, sensitivity, wetDryBlend } = params;
    const onProgress = (p) => sendProgress('mixing-progress', p);
    const onLog = createLogSender('deepfilternet_dereverb');
    return await AudioNeuralService.dereverbAudio({
      inputPath,
      outputPath,
      reverbReduction,
      sensitivity,
      wetDryBlend,
      onProgress,
      onLog
    });
  }));

  ipcMain.handle('neural-process-separation', wrapIpcHandler(async (event, params) => {
    const { inputPath, outputDir, modelName, shifts, overlap, stems, prefix } = params;
    const onProgress = (p) => sendProgress('mixing-progress', p);
    const onLog = createLogSender('demucs_separation');
    return await AudioNeuralService.separateStems({
      inputPath,
      outputDir,
      modelName,
      shifts,
      overlap,
      stems,
      prefix,
      onProgress,
      onLog
    });
  }));

  ipcMain.handle('neural-process-pedalboard', wrapIpcHandler(async (event, params) => {
    const { inputPath, outputPath, moduleId, params: dspParams } = params;
    const onProgress = (p) => sendProgress('mixing-progress', p);
    const onLog = createLogSender('pedalboard_dsp');
    return await AudioNeuralService.processPedalboardDsp({
      inputPath,
      outputPath,
      moduleId: moduleId || 'voice_master_strip',
      params: dspParams || params,
      onProgress,
      onLog
    });
  }));

  ipcMain.handle('neural-process-voicefixer', wrapIpcHandler(async (event, params) => {
    const { inputPath, outputPath, modelPath, airBandBoostDb, harmonicSaturation, formantClarity, warmTubeEmulation, subBassProtect } = params;
    const onProgress = (p) => sendProgress('mixing-progress', p);
    const onLog = createLogSender('voicefixer');
    return await AudioNeuralService.voiceFixer({
      inputPath,
      outputPath,
      modelPath,
      airBandBoostDb,
      harmonicSaturation,
      formantClarity,
      warmTubeEmulation,
      subBassProtect,
      onProgress,
      onLog
    });
  }));
}

module.exports = { registerMixingHandlers };
