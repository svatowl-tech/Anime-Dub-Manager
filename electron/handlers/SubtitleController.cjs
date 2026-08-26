const { ipcMain } = require('electron');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');
const { 
  getRawSubtitles, 
  saveRawSubtitles, 
  saveTranslatedSubtitles, 
  splitSubsByActor, 
  splitSubsByDubber, 
  exportFullAssWithRoles, 
  extractSignsAss,
  autoFixSubtitles,
  shiftSubtitlesTime,
  exportCharacterSubtitles,
  mergeMultipleSubtitles
} = require('../services/subtitleService.cjs');

function registerSubtitleHandlers(getData) {
  ipcMain.handle('merge-multiple-subtitles', wrapIpcHandler(async (event, { filePaths, options }) => {
    if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
      throw new Error('Не указаны файлы субтитров');
    }
    return await mergeMultipleSubtitles(filePaths, options);
  }));
  ipcMain.handle('auto-fix-subtitles', wrapIpcHandler(async (event, { filePath }) => {
    if (!filePath) throw new Error('Missing file path');
    return await autoFixSubtitles(filePath);
  }));

  ipcMain.handle('shift-subtitles-time', wrapIpcHandler(async (event, { filePath, offsetMs, selectedLineIds }) => {
    if (!filePath || offsetMs === undefined) throw new Error('Missing required parameters');
    return await shiftSubtitlesTime(filePath, offsetMs, selectedLineIds);
  }));

  ipcMain.handle('get-raw-subtitles', wrapIpcHandler(async (event, filePath) => {
    if (!filePath) throw new Error('Missing file path');
    return await getRawSubtitles(filePath);
  }));

  ipcMain.handle('save-raw-subtitles', wrapIpcHandler(async (event, { filePath, lines, overwrite = false }) => {
    if (!filePath || !lines) throw new Error('Missing required parameters');
    return await saveRawSubtitles(filePath, lines, overwrite);
  }));

  ipcMain.handle('merge-subtitles', wrapIpcHandler(async (event, { filePath, newLines, overwrite = false }) => {
    if (!filePath || !newLines) throw new Error('Missing required parameters');
    const existing = await getRawSubtitles(filePath);
    const existingLines = existing.lines || [];
    
    let finalLines = [];
    if (overwrite || existingLines.length === 0) {
      finalLines = newLines;
    } else {
      const { mergeSubtitles } = require('../services/subtitleService.cjs');
      finalLines = mergeSubtitles(existingLines, newLines);
    }
    
    await saveRawSubtitles(filePath, finalLines, true);
    return finalLines;
  }));

  ipcMain.handle('split-subs-by-actor', wrapIpcHandler(async (event, { assFilePath, outputDirectory, options }) => {
    if (!assFilePath || !outputDirectory) throw new Error('Missing required parameters');
    return await splitSubsByActor(assFilePath, outputDirectory, options);
  }));

  ipcMain.handle('split-subs-by-dubber', wrapIpcHandler(async (event, { assFilePath, outputDirectory, assignments, options }) => {
    if (!assFilePath || !outputDirectory || !assignments) throw new Error('Missing required parameters');
    const participantsData = getData ? await getData('participants.json') : [];
    return await splitSubsByDubber(assFilePath, outputDirectory, assignments, participantsData, options);
  }));

  ipcMain.handle('export-full-ass-with-roles', wrapIpcHandler(async (event, { assFilePath, outputPath, assignments, characterAliases }) => {
    if (!assFilePath || !outputPath || !assignments) throw new Error('Missing required parameters');
    const participantsData = getData ? await getData('participants.json') : [];
    const savedPath = await exportFullAssWithRoles(assFilePath, outputPath, assignments, participantsData, characterAliases);
    return { path: savedPath };
  }));
  
  ipcMain.handle('extract-signs-ass', wrapIpcHandler(async (event, { filePath, outputPath }) => {
    if (!filePath || !outputPath) throw new Error('Missing required parameters');
    return await extractSignsAss(filePath, outputPath);
  }));

  ipcMain.handle('export-character-subtitles', wrapIpcHandler(async (event, { assFilePath, outputPath, characterName, characterAliases, format }) => {
    if (!assFilePath || !outputPath || !characterName) throw new Error('Missing required parameters');
    return await exportCharacterSubtitles(assFilePath, outputPath, characterName, characterAliases, format);
  }));
}

module.exports = { registerSubtitleHandlers };
