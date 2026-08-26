const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const log = require('electron-log');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');
const MediaWorker = require('../lib/MediaWorker.cjs');
const ExportService = require('../services/ExportService.cjs');
const { 
  bakeSubtitles, 
  transcodeToMp4, 
  muxRelease, 
  takeScreenshot, 
  getVideoMetadata, 
  extractSubtitleTrack,
  setCustomFfmpegPath,
  getActiveProcesses
} = require('../services/ffmpegService.cjs');
const { extractHardsub } = require('../services/ocrService.cjs');
const { cleanAssFile, extractSignsAss } = require('../services/subtitleService.cjs');

function registerMediaHandlers(getData, mainWindow, taskQueue) {
  const getWin = () => (typeof mainWindow === 'function' ? mainWindow() : mainWindow);

  ipcMain.handle('enqueue-ffmpeg-task', wrapIpcHandler(async (event, { type, payload, metadata }) => {
    log.info(`Enqueuing background task: ${type}`);
    let taskFn;
    let args = [];
    
    const config = await getData('config.json');
    const participantsData = await getData('participants.json');
    const projectsData = await getData('projects.json');

    switch (type) {
      case 'bake-subtitles': {
        const { videoPath, assPath, outputPath, options } = payload;
        taskFn = (id, v, a, o, opts, onProgress, onCommand) => 
          MediaWorker.execute(bakeSubtitles, [v, a, o, onProgress, onCommand, opts]); 
        args = [videoPath, assPath, outputPath, options || {}];
        break;
      }
      case 'transcode-video': {
        const { videoPath, outputPath, options } = payload;
        taskFn = (id, v, o, opts, onProgress, onCommand) => 
          MediaWorker.execute(transcodeToMp4, [v, o, onProgress, onCommand, opts]); 
        args = [videoPath, outputPath, options || {}];
        break;
      }
      case 'mux-release': {
        const { episode, targetDir, customAudioPath, customRawPath } = payload;
        const { rawPath, subPath, uploads, number, project } = episode;
        
        const finalRawPath = customRawPath || rawPath;
        if (!finalRawPath) throw new Error('Raw video is missing');
        
        let audioPath = customAudioPath;
        if (!audioPath) {
          const soundEngineerUpload = (uploads || [])
            .filter(u => u.role === 'SOUND_ENGINEER' || u.type === 'SOUND_ENGINEER_FILE')
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
            
          if (!soundEngineerUpload) throw new Error('Sound engineer audio is missing');
          audioPath = soundEngineerUpload.path;
        }
        
        let signsPath = null;
        if (subPath) {
          const tempSignsPath = path.join(path.dirname(subPath), `temp_signs_${Date.now()}.ass`);
          const hasSigns = await extractSignsAss(subPath, tempSignsPath);
          if (hasSigns) {
            signsPath = tempSignsPath;
          }
        }
        
        const title = project?.title || 'Project';
        const typeAndSeason = project?.typeAndSeason || '';
        const fileName = `[${number} серия] ${title} ${typeAndSeason} [Оканэ].mp4`.replace(/\s+/g, ' ');
        const outputPath = path.join(targetDir, fileName);
        
        taskFn = async (id, v, a, s, o, onProgress, onCommand) => {
          try {
            const res = await MediaWorker.execute(muxRelease, [v, a, s, o, onProgress, onCommand]);
            if (s) await fs.unlink(s).catch(() => {});
            return res;
          } catch (err) {
            if (s) await fs.unlink(s).catch(() => {});
            throw err;
          }
        };
        args = [finalRawPath, audioPath, signsPath, outputPath];
        break;
      }
      case 'export-dabber-files': {
        const { episode, targetDir, skipConversion, additionalProcessing } = payload;
        taskFn = async (id, ep, tDir, sConv, addProc, onProgress, onCommand) => {
          return await ExportService.exportDabberFiles(ep, tDir, sConv, addProc, config, participantsData, projectsData, onProgress, onCommand);
        };
        args = [episode, targetDir, skipConversion, additionalProcessing];
        break;
      }
      case 'export-sound-engineer-files': {
        const { episode, targetDir, skipConversion, smartExport, additionalProcessing } = payload;
        taskFn = async (id, ep, tDir, sConv, sExp, addProc, onProgress, onCommand) => {
          return await ExportService.exportSoundEngineerFiles(ep, tDir, sConv, sExp, addProc, config, projectsData, participantsData, onProgress, onCommand);
        };
        args = [episode, targetDir, skipConversion, smartExport, additionalProcessing];
        break;
      }
      default: throw new Error('Unknown task type');
    }
    
    return taskQueue.enqueue(type, taskFn, args, metadata);
  }));

  ipcMain.handle('bake-subtitles', wrapIpcHandler(async (event, { videoPath, finalAssPath, outputPath }) => {
    if (!videoPath || !finalAssPath || !outputPath) throw new Error('Missing required paths');
    log.info(`Starting interactive subtitle baking: ${videoPath} + ${finalAssPath} -> ${outputPath}`);
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    
    const absVideoPath = path.isAbsolute(videoPath) ? videoPath : path.join(baseDir, videoPath);
    const absAssPath = path.isAbsolute(finalAssPath) ? finalAssPath : path.join(baseDir, finalAssPath);
    const absOutputPath = path.isAbsolute(outputPath) ? outputPath : path.join(baseDir, outputPath);

    await fs.mkdir(path.dirname(absOutputPath), { recursive: true });

    const options = {
      useNvenc: config.useNvenc,
      gpuIndex: config.gpuIndex
    };

    return await bakeSubtitles(absVideoPath, absAssPath, absOutputPath, (percent) => {
      const win = getWin();
      if (win && !win.isDestroyed()) win.webContents.send('ffmpeg-progress', percent);
    }, null, options);
  }));

  ipcMain.handle('transcode-video', wrapIpcHandler(async (event, { videoPath, outputPath, audioStreamIndex }) => {
    if (!videoPath || !outputPath) throw new Error('Missing required paths');
    log.info(`Starting interactive transcoding: ${videoPath} -> ${outputPath}`);
    const config = await getData('config.json');
    const options = {
      useNvenc: config.useNvenc,
      gpuIndex: config.gpuIndex,
      audioStreamIndex
    };
    return await transcodeToMp4(videoPath, outputPath, (percent) => {
      const win = getWin();
      if (win && !win.isDestroyed()) win.webContents.send('ffmpeg-progress', percent);
    }, null, options);
  }));

  ipcMain.handle('get-video-metadata', wrapIpcHandler(async (event, videoPath) => {
    if (!videoPath) throw new Error('Missing video path');
    return await getVideoMetadata(videoPath);
  }));

  ipcMain.handle('extract-subtitle-track', wrapIpcHandler(async (event, { videoPath, outputPath, streamIndex }) => {
    if (!videoPath || !outputPath || streamIndex === undefined) throw new Error('Missing required parameters');
    await extractSubtitleTrack(videoPath, outputPath, streamIndex);
    await cleanAssFile(outputPath);
    return { path: outputPath };
  }));

  ipcMain.handle('take-screenshot', wrapIpcHandler(async (event, { videoPath, timestamp, outputPath }) => {
    if (!videoPath || !timestamp || !outputPath) throw new Error('Missing required parameters');
    await takeScreenshot(videoPath, timestamp, outputPath);
    return { path: outputPath };
  }));

  ipcMain.handle('extract-audio-peaks', wrapIpcHandler(async (event, { videoPath, pointsPerSecond = 10 }) => {
    if (!videoPath) throw new Error('Missing videoPath');
    const { extractAudioPeaks } = require('../services/ffmpegService.cjs');
    return await extractAudioPeaks(videoPath, pointsPerSecond);
  }));

  ipcMain.handle('extract-hardsub', wrapIpcHandler(async (event, { videoPath, outputAssPath, language, preprocess, crop }) => {
    if (!videoPath || !outputAssPath) throw new Error('Missing required paths');
    log.info(`Starting hardsub OCR extraction: ${videoPath} -> ${outputAssPath} (lang: ${language}, preprocess: ${preprocess}, crop: ${JSON.stringify(crop)})`);
    return await extractHardsub(videoPath, outputAssPath, (percent) => {
      const win = getWin();
      if (win && !win.isDestroyed()) win.webContents.send('ffmpeg-progress', percent);
    }, { language, preprocess, crop });
  }));
}

module.exports = { registerMediaHandlers };
