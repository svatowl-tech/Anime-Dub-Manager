const { ipcMain } = require('electron');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');
const QAActingAnalysisService = require('../services/QAActingAnalysisService.cjs');

function registerQAActingHandlers(getData, saveData, mainWindow) {
  const emitProgress = (event, payload) => {
    try {
      const win = typeof mainWindow === 'function' ? mainWindow() : mainWindow;
      if (win && win.webContents && (!win.isDestroyed || !win.isDestroyed())) {
        win.webContents.send('qa-acting-progress', payload);
        return;
      }
      if (event?.sender && !event.sender.isDestroyed?.()) {
        event.sender.send('qa-acting-progress', payload);
      }
    } catch {}
  };

  ipcMain.handle('qa-acting-check-models', wrapIpcHandler(async (_event, { profile = 'full_acting' } = {}) => {
    return await QAActingAnalysisService.checkModels(profile);
  }));

  ipcMain.handle('qa-acting-download-models', wrapIpcHandler(async (event, { profile = 'full_acting' } = {}) => {
    return await QAActingAnalysisService.downloadModels(profile, (prog) => {
      emitProgress(event, prog);
    });
  }));

  ipcMain.handle('qa-acting-analyze-episode', wrapIpcHandler(async (event, payload) => {
    return await QAActingAnalysisService.analyzeEpisode(payload, getData, (prog) => {
      emitProgress(event, prog);
    });
  }));

  ipcMain.handle('qa-get-detection-settings', wrapIpcHandler(async () => {
    return await QAActingAnalysisService.getDetectionSettings(getData);
  }));

  ipcMain.handle('qa-save-detection-settings', wrapIpcHandler(async (_event, settings) => {
    return await QAActingAnalysisService.saveDetectionSettings(saveData, settings);
  }));

  ipcMain.handle('qa-get-stress-dictionary', wrapIpcHandler(async (_event, { projectId = null } = {}) => {
    return await QAActingAnalysisService.getStressDictionary(getData, projectId);
  }));

  ipcMain.handle('qa-save-stress-entry', wrapIpcHandler(async (_event, entry) => {
    return await QAActingAnalysisService.saveStressEntry(getData, saveData, entry);
  }));

  ipcMain.handle('qa-delete-stress-entry', wrapIpcHandler(async (_event, { id } = {}) => {
    return await QAActingAnalysisService.deleteStressEntry(getData, saveData, id);
  }));

  ipcMain.handle('qa-get-character-profiles', wrapIpcHandler(async (_event, { projectId = null } = {}) => {
    return await QAActingAnalysisService.getCharacterProfiles(getData, projectId);
  }));

  ipcMain.handle('qa-save-character-profile', wrapIpcHandler(async (_event, profile) => {
    return await QAActingAnalysisService.saveCharacterProfile(getData, saveData, profile);
  }));
}

module.exports = { registerQAActingHandlers };
