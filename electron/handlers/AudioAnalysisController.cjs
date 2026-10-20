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

  ipcMain.handle('audio-find-original-vocals', wrapIpcHandler(async (event, { searchDirs = [], manifest = null, ourVocalsPath = null, options = {} }) => {
    return AudioAnalysisService.findOriginalVocalsTrack(searchDirs, manifest, ourVocalsPath, options);
  }));

  ipcMain.handle('audio-find-glued-voices', wrapIpcHandler(async (event, { searchDirs = [], manifest = null }) => {
    return AudioAnalysisService.findGluedVoicesTrack(searchDirs, manifest);
  }));

  ipcMain.handle('audio-analyze-original-snapshots', wrapIpcHandler(async (event, { audioPath, options = {} }) => {
    if (!audioPath) {
      throw new Error('audioPath обязателен для построения слепков и карты эффектов оригинала');
    }
    const onProgress = (progress) => {
      try {
        event.sender.send('audio-analysis-progress', { audioPath, ...progress });
      } catch (e) {}
    };
    return await AudioAnalysisService.analyzeOriginalAcousticSnapshots(audioPath, options, onProgress);
  }));

  ipcMain.handle('audio-apply-acoustic-match', wrapIpcHandler(async (event, { ourVocalsPath, originalVocalsPath, searchDirs = [], manifest = null, options = {} }) => {
    if (!ourVocalsPath && !manifest) {
      throw new Error('ourVocalsPath обязателен для приведения склеенной дорожки голосов к оригиналу');
    }
    const onProgress = (progress) => {
      try {
        event.sender.send('audio-analysis-progress', { ourVocalsPath, ...progress });
      } catch (e) {}
    };
    return await AudioAnalysisService.applyAcousticProfileMatch({
      ourVocalsPath,
      originalVocalsPath,
      searchDirs,
      manifest,
      options,
      onProgress
    });
  }));
}

module.exports = {
  registerAudioAnalysisHandlers
};

