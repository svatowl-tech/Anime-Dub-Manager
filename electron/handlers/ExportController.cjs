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

  ipcMain.handle('check-snippet-fixes', wrapIpcHandler(async (event, { episode }) => {
    if (!episode || !episode.uploads) return { hasSnippetFixes: false, count: 0, details: [] };

    const dubberFiles = {};
    for (const upload of episode.uploads) {
      if (upload.type === 'DUBBER_FILE' || upload.type === 'FIXES') {
        const dubberId = upload.uploadedById;
        if (!dubberFiles[dubberId]) dubberFiles[dubberId] = { original: [], fixes: [] };
        if (upload.type === 'DUBBER_FILE') dubberFiles[dubberId].original.push(upload);
        else dubberFiles[dubberId].fixes.push(upload);
      }
    }

    const details = [];
    let snippetCount = 0;

    for (const dubberId in dubberFiles) {
      const { original, fixes } = dubberFiles[dubberId];
      const latestOriginal = original.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      const latestFix = fixes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

      if (latestOriginal && latestFix) {
        try {
          const origStat = await fs.stat(latestOriginal.path);
          const fixStat = await fs.stat(latestFix.path);
          const isSnippet = fixStat.size < origStat.size;
          if (isSnippet) {
            snippetCount++;
          }
          details.push({
            dubberId,
            origSize: origStat.size,
            fixSize: fixStat.size,
            isSnippet
          });
        } catch (e) {
          log.warn('[check-snippet-fixes] Could not stat files for dubber:', dubberId, e.message);
        }
      }
    }

    return {
      hasSnippetFixes: snippetCount > 0,
      count: snippetCount,
      details
    };
  }));

  ipcMain.handle('export-sound-engineer-files', wrapIpcHandler(async (event, { episode, targetDir, skipConversion, smartExport, additionalProcessing, autoApplyFixes }) => {
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

    return await ExportService.exportSoundEngineerFiles(episode, exportDir, skipConversion, smartExport, additionalProcessing, autoApplyFixes, config, projectsData, participantsData, onProgress);
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
