const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const log = require('electron-log');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');
const ExportService = require('../services/ExportService.cjs');
const AutoTimingService = require('../services/AutoTimingService.cjs');

function registerExportHandlers(getData, mainWindow) {
  const getWin = () => (typeof mainWindow === 'function' ? mainWindow() : mainWindow);

  ipcMain.handle('export-dabber-files', wrapIpcHandler(async (event, payload) => {
    const { episode, targetDir, skipConversion, additionalProcessing, options } = payload || {};
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

    return await ExportService.exportDabberFiles({
      episode,
      targetDir: exportDir,
      options: {
        skipConversion: skipConversion ?? options?.skipConversion,
        additionalProcessing: additionalProcessing ?? options?.additionalProcessing
      },
      config,
      participantsData,
      projectsData,
      onProgress
    });
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

  ipcMain.handle('match-actors-tracks', wrapIpcHandler(async (event, { episode, audioFiles }) => {
    if (!episode) throw new Error('Missing required episode data');
    const participantsData = await getData('participants.json');
    const projectsData = await getData('projects.json');
    const project = (projectsData || []).find(p => p.id === episode.projectId);

    const files = audioFiles || (episode.uploads || []).filter(u => u.type === 'DUBBER_FILE' || u.type === 'FIXES');
    return await AutoTimingService.matchActorsWithAudioTracks(
      episode.subPath,
      files,
      participantsData,
      project ? project.characterAliases : null,
      episode.assignments || []
    );
  }));

  ipcMain.handle('run-auto-timing-analysis', wrapIpcHandler(async (event, { episode, audioFiles, options }) => {
    if (!episode || !episode.subPath) throw new Error('Missing episode or subtitle file');
    const participantsData = await getData('participants.json');
    const projectsData = await getData('projects.json');
    const project = (projectsData || []).find(p => p.id === episode.projectId);

    const files = audioFiles || (episode.uploads || []).filter(u => u.type === 'DUBBER_FILE' || u.type === 'FIXES');
    const matchResult = await AutoTimingService.matchActorsWithAudioTracks(
      episode.subPath,
      files,
      participantsData,
      project ? project.characterAliases : null,
      episode.assignments || []
    );

    const timingResult = await AutoTimingService.alignProjectAndResolveCollisions({
      subPath: episode.subPath,
      matchedTracks: matchResult.matchedTracks,
      options: options || { minGapSec: 0.12, leadInSec: 0.05 }
    });

    return {
      matchResult,
      timingResult
    };
  }));

  ipcMain.handle('export-sound-engineer-files', wrapIpcHandler(async (event, payloadOrEpisode, maybeTargetDir, maybeSkipConv, maybeSmartExp, maybeAddProc, maybeAutoFix, maybeIncSubs, maybeAutoTiming) => {
    let episode, targetDir, skipConversion, smartExport, additionalProcessing, autoApplyFixes, includeSubtitles, autoTiming;
    
    if (payloadOrEpisode && typeof payloadOrEpisode === 'object') {
      if (payloadOrEpisode.episode) {
        ({ episode, targetDir, skipConversion, smartExport, additionalProcessing, autoApplyFixes, includeSubtitles, autoTiming } = payloadOrEpisode);
      } else if (payloadOrEpisode.id || payloadOrEpisode.number !== undefined || payloadOrEpisode.projectId) {
        episode = payloadOrEpisode;
        targetDir = maybeTargetDir;
        skipConversion = maybeSkipConv;
        smartExport = maybeSmartExp;
        additionalProcessing = maybeAddProc;
        autoApplyFixes = maybeAutoFix;
        includeSubtitles = maybeIncSubs;
        autoTiming = maybeAutoTiming;
      } else {
        ({ episode, targetDir, skipConversion, smartExport, additionalProcessing, autoApplyFixes, includeSubtitles, autoTiming } = payloadOrEpisode);
      }
    } else {
      episode = payloadOrEpisode;
      targetDir = maybeTargetDir;
      skipConversion = maybeSkipConv;
      smartExport = maybeSmartExp;
      additionalProcessing = maybeAddProc;
      autoApplyFixes = maybeAutoFix;
      includeSubtitles = maybeIncSubs;
      autoTiming = maybeAutoTiming;
    }

    if (!episode) {
      const episodesData = await getData('episodes.json').catch(() => []);
      if (Array.isArray(episodesData) && episodesData.length > 0) {
        episode = episodesData[0];
      }
    }

    if (!episode) throw new Error('Missing required parameter: episode');
    
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const MixingPipelineService = require('../services/MixingPipelineService.cjs');
    
    let exportDir = targetDir;
    if (!exportDir || typeof exportDir !== 'string' || !exportDir.trim()) {
      if (episode && episode.projectId && episode.number !== undefined) {
        exportDir = path.join(baseDir, 'projects', String(episode.projectId), `Episode_${episode.number}`, 'mixing');
      } else {
        exportDir = MixingPipelineService.getDefaultTargetDir(episode, baseDir);
      }
    } else if (!path.isAbsolute(exportDir.trim())) {
      const epDir = MixingPipelineService.getEpisodeDir(episode, baseDir);
      exportDir = path.resolve(epDir, exportDir.trim());
    } else {
      exportDir = exportDir.trim();
    }
    
    const projectsData = await getData('projects.json');
    const participantsData = await getData('participants.json');

    const onProgress = (p) => {
      const win = getWin();
      if (win && !win.isDestroyed()) win.webContents.send('ffmpeg-progress', p.percent);
    };

    return await ExportService.exportSoundEngineerFiles({
      episode,
      targetDir: exportDir,
      options: {
        skipConversion: skipConversion ?? false,
        smartExport: smartExport ?? false,
        additionalProcessing: additionalProcessing ?? false,
        autoApplyFixes: autoApplyFixes ?? false,
        includeSubtitles: includeSubtitles !== false,
        autoTiming: autoTiming === true
      },
      config,
      projectsData,
      participantsData,
      onProgress
    });
  }));

  ipcMain.handle('timing-export-to-mixing', wrapIpcHandler(async (event, { episode, targetDir, tracks, audioClips, volumes, timingMetadata }) => {
    if (!episode) throw new Error('Missing required parameter: episode');

    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const MixingPipelineService = require('../services/MixingPipelineService.cjs');
    
    let exportDir = targetDir;
    if (!exportDir || typeof exportDir !== 'string' || !exportDir.trim()) {
      if (episode && episode.projectId && episode.number !== undefined) {
        exportDir = path.join(baseDir, 'projects', String(episode.projectId), `Episode_${episode.number}`, 'mixing');
      } else {
        exportDir = MixingPipelineService.getDefaultTargetDir(episode, baseDir);
      }
    } else if (!path.isAbsolute(exportDir.trim())) {
      const epDir = MixingPipelineService.getEpisodeDir(episode, baseDir);
      exportDir = path.resolve(epDir, exportDir.trim());
    } else {
      exportDir = exportDir.trim();
    }

    const projectsData = await getData('projects.json');
    const project = (projectsData || []).find(p => p.id === episode.projectId);
    const projectTitle = project ? project.title : 'Unknown';
    const baseVideoName = `${projectTitle}_${episode.number}`;

    const rawDir = path.join(exportDir, '00_исходные');
    await fs.mkdir(exportDir, { recursive: true });
    await fs.mkdir(rawDir, { recursive: true });

    const win = getWin();
    const onProgress = (p) => {
      if (win && !win.isDestroyed()) win.webContents.send('ffmpeg-progress', p.percent);
    };

    // 1. Copy raw video to 00_исходные
    if (episode.rawPath && require('fs').existsSync(episode.rawPath)) {
      const vidExt = path.extname(episode.rawPath);
      const targetVidPath = path.join(rawDir, `raw_video${vidExt}`);
      if (path.resolve(targetVidPath) !== path.resolve(episode.rawPath)) {
        try {
          await fs.copyFile(episode.rawPath, targetVidPath);
        } catch (e) {}
      }
    }

    // 2. Copy general subtitles to targetDir & 00_исходные
    if (episode.subPath && require('fs').existsSync(episode.subPath)) {
      const generalSubName = `${baseVideoName}_subtitles.ass`;
      try {
        await fs.copyFile(episode.subPath, path.join(exportDir, generalSubName));
        await fs.copyFile(episode.subPath, path.join(rawDir, 'subtitles.ass'));
      } catch (e) {}
    }

    // 3. Render only the final, complete continuous audio track for each dubber
    const trackList = tracks || [];
    const clipsMap = audioClips || {};
    const volsMap = volumes || {};
    const renderedTracks = [];

    for (let tIdx = 0; tIdx < trackList.length; tIdx++) {
      const tr = trackList[tIdx];
      const nick = tr.dubberName || tr.participant || `dubber_${tIdx + 1}`;
      const charName = tr.characterName || tr.character || 'Персонаж';
      const clips = (clipsMap[tr.id] || []).filter(c => !c.isDeleted);
      
      const outFilename = `${baseVideoName}_[${nick}].wav`;
      const outFilePath = path.join(exportDir, outFilename);
      const outRawFilePath = path.join(rawDir, `${String(tIdx + 1).padStart(2, '0')}_${nick}.wav`);

      // Find valid file path for track
      let sourceTrackFile = tr.filePath;
      if ((!sourceTrackFile || !require('fs').existsSync(sourceTrackFile)) && episode.uploads) {
        const matchingUpload = episode.uploads.find(u => 
          (u.type === 'DUBBER_FILE' || u.type === 'FIXES') && 
          (u.uploadedById === tr.id || u.participantId === tr.id || (u.fileName && u.fileName.includes(nick)))
        );
        if (matchingUpload && matchingUpload.path && require('fs').existsSync(matchingUpload.path)) {
          sourceTrackFile = matchingUpload.path;
        }
      }

      const phrases = clips.map(c => ({
        sourceAudioPath: c.sourceAudioPath || sourceTrackFile,
        sourceStartSec: c.sourceStartSec,
        sourceEndSec: c.sourceEndSec,
        targetStartSec: Number((c.clipStartSec + (c.offsetSec || 0)).toFixed(2)),
        targetEndSec: Number((c.clipStartSec + (c.offsetSec || 0) + c.durationSec).toFixed(2)),
        durationSec: Number(c.durationSec.toFixed(2)),
        volumePercent: c.volumePercent ?? Math.round((volsMap[tr.id] ?? 1.0) * 100)
      }));

      if (phrases.length > 0 && sourceTrackFile && require('fs').existsSync(sourceTrackFile)) {
        await AutoTimingService.assembleMultiSourceTrack(sourceTrackFile, phrases, outFilePath, { targetDir: exportDir, timingMetadata });
        try {
          await fs.copyFile(outFilePath, outRawFilePath);
        } catch (e) {}
      } else if (sourceTrackFile && require('fs').existsSync(sourceTrackFile)) {
        await fs.copyFile(sourceTrackFile, outFilePath);
        try {
          await fs.copyFile(outFilePath, outRawFilePath);
        } catch (e) {}
      }

      renderedTracks.push({
        trackId: tr.id,
        dubberNick: nick,
        characterName: charName,
        outputPath: outFilePath,
        phrasesCount: phrases.length
      });

      onProgress({ percent: Math.round(((tIdx + 1) / Math.max(1, trackList.length)) * 100) });
    }

    // 4. Save timing metadata
    if (timingMetadata) {
      try {
        await fs.writeFile(path.join(exportDir, 'timing_metadata.json'), JSON.stringify(timingMetadata, null, 2), 'utf8');
        await fs.writeFile(path.join(rawDir, 'timing_metadata.json'), JSON.stringify(timingMetadata, null, 2), 'utf8');
      } catch (e) {}
    }

    // 5. Trigger mixing status refresh to build mixing_manifest.json
    try {
      if (typeof MixingPipelineService.getStatus === 'function') {
        await MixingPipelineService.getStatus({ episode, targetDir: exportDir, baseDir });
      }
    } catch (e) {}

    return {
      success: true,
      targetDir: exportDir,
      renderedTracksCount: renderedTracks.length
    };
  }));

  ipcMain.handle('build-release', wrapIpcHandler(async (event, payload) => {
    const { episode, targetDir, customAudioPath, customRawPath } = payload || {};
    if (!episode || !targetDir) throw new Error('Missing required parameters');
    
    const onProgress = (p) => {
      if (mainWindow) mainWindow.webContents.send('ffmpeg-progress', p.percent);
    };

    return await ExportService.buildRelease({
      episode,
      targetDir,
      customAudioPath,
      customRawPath,
      onProgress
    });
  }));
}

module.exports = { registerExportHandlers };
