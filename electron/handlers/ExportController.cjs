const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const log = require('electron-log');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');
const ExportService = require('../services/ExportService.cjs');

function registerExportHandlers(getData, mainWindow) {
  const getWin = () => (typeof mainWindow === 'function' ? mainWindow() : mainWindow);

  ipcMain.handle('export-dabber-files', wrapIpcHandler(async (event, { episode, targetDir, skipConversion, additionalProcessing }) => {
    if (!episode || !targetDir) throw new Error('Missing required parameters');
    
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const exportDir = path.isAbsolute(targetDir) ? targetDir : path.join(baseDir, targetDir);
    const participantsData = await getData('participants.json');
    const projectsData = await getData('projects.json');
    
    const onProgress = (p) => {
      const win = getWin();
      if (win && !win.isDestroyed()) win.webContents.send('ffmpeg-progress', p.percent);
    };

    return await ExportService.exportDabberFiles(episode, exportDir, skipConversion, additionalProcessing, config, participantsData, projectsData, onProgress);
  }));

  ipcMain.handle('export-sound-engineer-files', wrapIpcHandler(async (event, { episode, targetDir, skipConversion, smartExport, additionalProcessing }) => {
    if (!episode || !targetDir) throw new Error('Missing required parameters');
    
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const exportDir = path.isAbsolute(targetDir) ? targetDir : path.join(baseDir, targetDir);
    const projectsData = await getData('projects.json');
    const participantsData = await getData('participants.json');

    const onProgress = (p) => {
      const win = getWin();
      if (win && !win.isDestroyed()) win.webContents.send('ffmpeg-progress', p.percent);
    };

    return await ExportService.exportSoundEngineerFiles(episode, exportDir, skipConversion, smartExport, additionalProcessing, config, projectsData, participantsData, onProgress);
  }));

  ipcMain.handle('build-release', wrapIpcHandler(async (event, { episode, targetDir, customAudioPath, customRawPath }) => {
    if (!episode || !targetDir) throw new Error('Missing required parameters');
    
    const onProgress = (p) => {
      if (mainWindow) mainWindow.webContents.send('ffmpeg-progress', p.percent);
    };

    return await ExportService.buildRelease(episode, targetDir, customAudioPath, customRawPath, onProgress);
  }));
}

module.exports = { registerExportHandlers };
