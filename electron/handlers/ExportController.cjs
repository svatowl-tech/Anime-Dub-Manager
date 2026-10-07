const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const log = require('electron-log');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');
const ExportService = require('../services/ExportService.cjs');
const AutoTimingService = require('../services/AutoTimingService.cjs');
const AudioAnalysisService = require('../services/AudioAnalysisService.cjs');

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

    // 1. Copy raw video to 00_исходные and extract original audio
    const epDir = MixingPipelineService.getEpisodeDir(episode, baseDir);
    const parentDir = path.dirname(exportDir);
    const videoExtRegex = /\.(mp4|mkv|mov|avi|webm)$/i;
    let effectiveVideoPath = episode.rawPath && require('fs').existsSync(episode.rawPath) ? episode.rawPath : null;

    if (!effectiveVideoPath) {
      const searchDirs = [epDir, parentDir, exportDir, episode.folderPath].filter(d => d && typeof d === 'string' && require('fs').existsSync(d));
      for (const dir of searchDirs) {
        try {
          const files = require('fs').readdirSync(dir);
          const found = files.find(f => videoExtRegex.test(f) && !f.includes('[СВЕДЕНО]') && !f.includes('video_mux'));
          if (found) {
            effectiveVideoPath = path.join(dir, found);
            break;
          }
        } catch (e) {}
      }
    }

    if (effectiveVideoPath && require('fs').existsSync(effectiveVideoPath)) {
      const vidExt = path.extname(effectiveVideoPath);
      const targetVidPath = path.join(rawDir, `raw_video${vidExt}`);
      if (path.resolve(targetVidPath) !== path.resolve(effectiveVideoPath)) {
        try {
          await fs.copyFile(effectiveVideoPath, targetVidPath);
        } catch (e) {}
      }

      const origAudioPath = path.join(rawDir, '00_original_audio.wav');
      const origAudioExportPath = path.join(exportDir, '00_original_audio.wav');
      if (!require('fs').existsSync(origAudioPath) || require('fs').statSync(origAudioPath).size < 1000) {
        try {
          const ffmpeg = require('fluent-ffmpeg');
          await new Promise((resolve, reject) => {
            ffmpeg(effectiveVideoPath)
              .noVideo()
              .audioCodec('pcm_s16le')
              .audioChannels(2)
              .audioFrequency(48000)
              .output(origAudioPath)
              .on('end', () => resolve())
              .on('error', (err) => reject(err))
              .run();
          });
          log.info(`[ExportController] Извлечена оригинальная аудиодорожка из видео: ${origAudioPath}`);
        } catch (audioErr) {
          log.warn('[ExportController] Could not extract 00_original_audio.wav from video:', audioErr.message);
        }
      }

      if (require('fs').existsSync(origAudioPath)) {
        try {
          if (path.resolve(origAudioExportPath) !== path.resolve(origAudioPath)) {
            await fs.copyFile(origAudioPath, origAudioExportPath);
          }
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

    // 3. Render ONLY ONE master continuous audio track per unique actor/dubber (00_timed_Actor.wav)
    const trackList = tracks || [];
    const clipsMap = audioClips || {};
    const volsMap = volumes || {};
    const renderedTracks = [];

    const getCleanNick = (rawNick) => {
      if (!rawNick) return 'dubber';
      let clean = String(rawNick)
        .replace(/\[.*\]/g, '')
        .replace(/_?(дорожка|слой|take|layer|фикс|fix)\s*\d*/gi, '')
        .replace(/[^\w\d\s\u0400-\u04FF_-]/g, '')
        .trim();
      return clean || 'dubber';
    };

    // Group all tracks by unique actor
    const actorTracksMap = new Map();
    for (const tr of trackList) {
      const rawNick = tr.dubberName || tr.participant || 'Даббер';
      const cleanNick = getCleanNick(rawNick);
      if (!actorTracksMap.has(cleanNick)) {
        actorTracksMap.set(cleanNick, {
          nick: cleanNick,
          characterName: tr.characterName || tr.character || 'Персонаж',
          tracks: []
        });
      }
      actorTracksMap.get(cleanNick).tracks.push(tr);
    }

    const actorEntries = Array.from(actorTracksMap.values());
    for (let aIdx = 0; aIdx < actorEntries.length; aIdx++) {
      const { nick, characterName, tracks: actorTrs } = actorEntries[aIdx];
      const outFilename = `00_timed_${nick}.wav`;
      const outFilePath = path.join(exportDir, outFilename);
      const outRawFilePath = path.join(rawDir, outFilename);

      // Collect all phrases for this actor across main tracks and fix layers
      const phrases = [];
      let primarySourceFile = null;

      for (const tr of actorTrs) {
        let sourceFile = tr.filePath;
        if ((!sourceFile || !require('fs').existsSync(sourceFile)) && episode.uploads) {
          const matchingUpload = episode.uploads.find(u => 
            (u.type === 'DUBBER_FILE' || u.type === 'FIXES') && 
            (u.uploadedById === tr.id || u.participantId === tr.id || (u.fileName && u.fileName.includes(nick)))
          );
          if (matchingUpload && matchingUpload.path && require('fs').existsSync(matchingUpload.path)) {
            sourceFile = matchingUpload.path;
          }
        }

        if (sourceFile && require('fs').existsSync(sourceFile) && !primarySourceFile) {
          primarySourceFile = sourceFile;
        }

        const clips = (clipsMap[tr.id] || []).filter(c => !c.isDeleted);
        for (const c of clips) {
          phrases.push({
            sourceAudioPath: c.sourceAudioPath || sourceFile || primarySourceFile,
            sourceStartSec: c.sourceStartSec,
            sourceEndSec: c.sourceEndSec,
            targetStartSec: Number((c.clipStartSec + (c.offsetSec || 0)).toFixed(2)),
            targetEndSec: Number((c.clipStartSec + (c.offsetSec || 0) + c.durationSec).toFixed(2)),
            durationSec: Number(c.durationSec.toFixed(2)),
            volumePercent: c.volumePercent ?? Math.round((volsMap[tr.id] ?? 1.0) * 100),
            isFix: c.isFix || tr.id.includes('_fix_')
          });
        }
      }

      // Sort phrases chronologically
      phrases.sort((a, b) => a.targetStartSec - b.targetStartSec);

      if (phrases.length > 0 && primarySourceFile && require('fs').existsSync(primarySourceFile)) {
        await AutoTimingService.assembleMultiSourceTrack(primarySourceFile, phrases, outFilePath, { targetDir: exportDir, timingMetadata });
      } else if (primarySourceFile && require('fs').existsSync(primarySourceFile)) {
        await fs.copyFile(primarySourceFile, outFilePath);
      }

      if (require('fs').existsSync(outFilePath)) {
        try {
          await fs.copyFile(outFilePath, outRawFilePath);
        } catch (e) {}
      }

      renderedTracks.push({
        dubberNick: nick,
        characterName,
        outputPath: outFilePath,
        phrasesCount: phrases.length
      });

      onProgress({ percent: Math.round(((aIdx + 1) / Math.max(1, actorEntries.length)) * 100) });
    }

    // Clean up any leftover slice files or temporary artifacts from mixing directory and 00_исходные
    const cleanupDirs = [exportDir, rawDir];
    for (const dir of cleanupDirs) {
      if (require('fs').existsSync(dir)) {
        const files = await fs.readdir(dir).catch(() => []);
        for (const f of files) {
          const lower = f.toLowerCase();
          if (lower.includes('slice') || lower.startsWith('temp_') || lower.endsWith('.raw')) {
            if (!f.startsWith('00_timed_')) {
              await fs.unlink(path.join(dir, f)).catch(() => {});
            }
          }
        }
      }
    }

    // 4. Save timing metadata and Audio Analysis passport
    if (timingMetadata) {
      try {
        await fs.writeFile(path.join(exportDir, 'timing_metadata.json'), JSON.stringify(timingMetadata, null, 2), 'utf8');
        await fs.writeFile(path.join(rawDir, 'timing_metadata.json'), JSON.stringify(timingMetadata, null, 2), 'utf8');
        await AudioAnalysisService.saveTimingAnalysis(exportDir, {
          timingMetadata,
          renderedTracks
        });
      } catch (e) {
        log.warn('[ExportController] Error saving timing analysis passport:', e.message);
      }
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
