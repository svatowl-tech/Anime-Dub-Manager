const { ipcMain } = require('electron');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');
const AudioAnalysisService = require('../services/AudioAnalysisService.cjs');
const log = require('electron-log');

function registerAudioAnalysisHandlers() {
  ipcMain.handle('audio-get-track-analysis', wrapIpcHandler(async (event, { audioPath, force = false, options = {} }) => {
    if (!audioPath) {
      throw new Error('audioPath is required for audio-get-track-analysis');
    }
    const onProgress = (progress) => {
      try {
        event.sender.send('audio-analysis-progress', { audioPath, ...progress });
      } catch (e) {}
    };
    return await AudioAnalysisService.getOrRunAnalysis(audioPath, force, options, onProgress);
  }));

  ipcMain.handle('audio-run-track-analysis', wrapIpcHandler(async (event, { audioPath, options = {} }) => {
    if (!audioPath) {
      throw new Error('audioPath is required for audio-run-track-analysis');
    }
    const onProgress = (progress) => {
      try {
        event.sender.send('audio-analysis-progress', { audioPath, ...progress });
      } catch (e) {}
    };
    return await AudioAnalysisService.analyzeTrack(audioPath, options, onProgress);
  }));

  ipcMain.handle('audio-save-timing-analysis', wrapIpcHandler(async (event, { episodeDir, data }) => {
    if (!episodeDir || !data) {
      throw new Error('episodeDir and data are required for audio-save-timing-analysis');
    }
    return await AudioAnalysisService.saveTimingAnalysis(episodeDir, data);
  }));

  ipcMain.handle('audio-get-timing-analysis', wrapIpcHandler(async (event, { episodeDir }) => {
    if (!episodeDir) {
      throw new Error('episodeDir is required for audio-get-timing-analysis');
    }
    return await AudioAnalysisService.getTimingAnalysis(episodeDir);
  }));
}

module.exports = {
  registerAudioAnalysisHandlers
};
