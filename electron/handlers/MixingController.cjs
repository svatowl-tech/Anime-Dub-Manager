const { ipcMain, app, dialog } = require('electron');
const path = require('path');
const log = require('electron-log');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');
const MixingPipelineService = require('../services/MixingPipelineService.cjs');

function registerMixingHandlers(getData, mainWindow) {
  const getWin = () => (typeof mainWindow === 'function' ? mainWindow() : mainWindow);

  const sendProgress = (channel, data) => {
    const win = getWin();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  };

  ipcMain.handle('mixing-get-status', wrapIpcHandler(async (event, { episode, targetDir }) => {
    if (!episode) throw new Error('Параметр серии обязателен');
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    return await MixingPipelineService.getStatus({ episode, targetDir, baseDir });
  }));

  ipcMain.handle('mixing-save-pipeline-config', wrapIpcHandler(async (event, { episode, targetDir, pipeline }) => {
    if (!episode || !pipeline) throw new Error('Параметры серии и конвейера обязательны');
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    return await MixingPipelineService.savePipelineConfig({ episode, targetDir, baseDir, pipeline });
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

    const onLog = (msg, level) => {
      sendProgress('mixing-log', { message: msg, level });
    };

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

    const onLog = (msg, level) => {
      sendProgress('mixing-log', { stepId, message: msg, level });
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

    const onLog = (msg, level) => {
      sendProgress('mixing-log', { message: msg, level });
    };

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

    return await MixingPipelineService.saveFinalVideo({
      episode,
      targetDir,
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
    return await MixingPipelineService.importExternalFiles({
      episode,
      targetDir,
      baseDir,
      videoPath,
      subPath,
      audioPaths
    });
  }));

  // UVR Models Management
  ipcMain.handle('mixing-check-uvr-model', wrapIpcHandler(async (event, { modelId } = {}) => {
    return await MixingPipelineService.checkUvrModelStatus({ modelId });
  }));

  ipcMain.handle('mixing-download-uvr-model', wrapIpcHandler(async (event, { modelId } = {}) => {
    const onProgress = (p) => {
      sendProgress('mixing-progress', p);
    };
    const onLog = (msg, level) => {
      sendProgress('mixing-log', { message: msg, level });
    };

    return await MixingPipelineService.downloadUvrModel({
      modelId,
      onProgress,
      onLog
    });
  }));
}

module.exports = { registerMixingHandlers };
