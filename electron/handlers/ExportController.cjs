const { ipcMain, app, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const log = require('electron-log');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');
const ExportService = require('../services/ExportService.cjs');
const AutoTimingService = require('../services/AutoTimingService.cjs');
const AudioAnalysisService = require('../services/AudioAnalysisService.cjs');
const { sanitizePath, sanitizeProjectTitle } = require('../lib/pathSanitizer.cjs');

function registerExportHandlers(getData, mainWindow) {
  const getWin = () => (typeof mainWindow === 'function' ? mainWindow() : mainWindow);

  ipcMain.handle('export-dabber-files', wrapIpcHandler(async (event, payload) => {
    const { episode, targetDir, skipConversion, additionalProcessing, options } = payload || {};
    if (!episode || !targetDir) throw new Error('Missing required parameters');
    
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const exportDir = sanitizePath(path.isAbsolute(targetDir) ? targetDir : path.join(baseDir, targetDir));
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
          const isSnippet = fixStat.size < origStat.size * 0.95;
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
    let episode, targetDir, skipConversion, smartExport, additionalProcessing, autoApplyFixes, includeSubtitles, autoTiming, originalStems;
    
    if (payloadOrEpisode && typeof payloadOrEpisode === 'object') {
      if (payloadOrEpisode.episode) {
        ({ episode, targetDir, skipConversion, smartExport, additionalProcessing, autoApplyFixes, includeSubtitles, autoTiming, originalStems } = payloadOrEpisode);
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
      const epDir = MixingPipelineService.getEpisodeDir(episode, baseDir);
      const projDir = path.dirname(epDir);
      const epName = path.basename(epDir) || `Episode_${episode.number || 1}`;
      exportDir = path.join(projDir, `${epName} для звукорежиссёра`);
    } else if (!path.isAbsolute(exportDir.trim())) {
      const epDir = MixingPipelineService.getEpisodeDir(episode, baseDir);
      const projDir = path.dirname(epDir);
      exportDir = path.resolve(projDir, exportDir.trim());
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
        autoTiming: autoTiming === true,
        originalStems
      },
      originalStems,
      config,
      projectsData,
      participantsData,
      onProgress
    });
  }));

  ipcMain.handle('export-get-default-dir', wrapIpcHandler(async (event, { episode, role } = {}) => {
    if (!episode) return { success: true, defaultDir: '' };
    const config = await getData('config.json').catch(() => ({}));
    const baseDir = (config && config.baseDir) ? config.baseDir : app.getPath('userData');
    const projectsData = await getData('projects.json').catch(() => []);
    const project = Array.isArray(projectsData) ? projectsData.find(p => p.id === episode.projectId) : null;
    const enrichedEpisode = {
      ...episode,
      project: episode.project || project || { title: 'Project' }
    };
    const MixingPipelineService = require('../services/MixingPipelineService.cjs');
    const epDir = MixingPipelineService.getEpisodeDir(enrichedEpisode, baseDir);
    const projDir = path.dirname(epDir);
    const epName = path.basename(epDir) || `Episode_${episode.number || 1}`;

    let defaultDir;
    if (role === 'DABBER') {
      const { sanitizeFolderName } = require('../lib/pathSanitizer.cjs');
      const projectTitle = sanitizeFolderName(enrichedEpisode.project?.title || '');
      const epNum = enrichedEpisode.number !== undefined ? `_Ep${enrichedEpisode.number}` : '';
      const prefix = projectTitle ? `${projectTitle}${epNum}_` : (epNum ? `Ep${enrichedEpisode.number}_` : '');
      defaultDir = path.join(epDir, `${prefix}Для_даберов`);
    } else {
      defaultDir = path.join(projDir, `${epName} для звукорежиссёра`);
    }
    return { success: true, defaultDir, epDir, projDir };
  }));

  ipcMain.handle('timing-export-to-mixing', wrapIpcHandler(async (event, { episode, targetDir, tracks, audioClips, volumes, timingMetadata, originalStems }) => {
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
    const rawProjectTitle = project ? project.title : 'Unknown';
    const projectTitle = sanitizeProjectTitle(rawProjectTitle);
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

    // 1B. Copy separated original stems (Vocals & M&E) to exportDir & rawDir
    let vocalsStemSrc = originalStems?.vocalsPath;
    let instStemSrc = originalStems?.instrumentalPath;
    if (!vocalsStemSrc || !instStemSrc) {
      const timingStemsDir = path.join(epDir, 'Тайминг', 'stems');
      const candV = path.join(timingStemsDir, 'original_vocals.wav');
      const candI = path.join(timingStemsDir, 'original_instrumental.wav');
      if (!vocalsStemSrc && require('fs').existsSync(candV)) vocalsStemSrc = candV;
      if (!instStemSrc && require('fs').existsSync(candI)) instStemSrc = candI;
    }

    if (vocalsStemSrc && require('fs').existsSync(vocalsStemSrc)) {
      try {
        await fs.copyFile(vocalsStemSrc, path.join(rawDir, 'original_vocals.wav'));
        await fs.copyFile(vocalsStemSrc, path.join(exportDir, 'original_vocals.wav'));
        log.info(`[ExportController] Стемы оригинала: вокал скопирован в сведение -> ${path.join(exportDir, 'original_vocals.wav')}`);
      } catch (e) {
        log.warn('[ExportController] Error copying original_vocals.wav to mixing:', e.message);
      }
    }

    if (instStemSrc && require('fs').existsSync(instStemSrc)) {
      try {
        await fs.copyFile(instStemSrc, path.join(rawDir, 'original_instrumental.wav'));
        await fs.copyFile(instStemSrc, path.join(exportDir, 'original_instrumental.wav'));
        log.info(`[ExportController] Стемы оригинала: фонограмма M&E скопирована в сведение -> ${path.join(exportDir, 'original_instrumental.wav')}`);
      } catch (e) {
        log.warn('[ExportController] Error copying original_instrumental.wav to mixing:', e.message);
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

      // Разделение основных дорожек и слоев фиксов по правилам пользователя:
      // 1. Дорожка + фикс -> фикс встраивается в дорожку (1 итоговая дорожка).
      // 2. Две дорожки без фиксов -> жестко две дорожки в тайминг и сведение.
      // 3. Две дорожки + фиксы (3 суммарно) -> фиксы встраиваются в ту дорожку, где эта фраза, и дальше идут 2 дорожки.
      const isFixTr = (t) =>
        t.role === 'fix' ||
        t.isFix === true ||
        t.type === 'FIXES' ||
        (t.id && (t.id.startsWith('fix_') || t.id.endsWith('_fix') || t.id.includes('_fix_'))) ||
        (t.participant || '').toLowerCase().includes('фикс') ||
        /(?:_fix|фикс|\[fix\]|\[фикс\])/i.test(t.filePath || '');
      const mainTrs = actorTrs.filter(t => !isFixTr(t));
      const fixTrs = actorTrs.filter(t => isFixTr(t));
      const effectiveMainTrs = mainTrs.length > 0 ? mainTrs : (actorTrs.length > 0 ? [actorTrs[0]] : []);
      const isMultiTrack = effectiveMainTrs.length > 1;

      // Проверяем, были ли фиксы уже вшиты в основные дорожки на этапе Тайминга
      const alreadyStitchedInMain = effectiveMainTrs.some(mt =>
        (clipsMap[mt.id] || []).some(c => !c.isDeleted && c.isFix)
      );

      // Сортировка фиксов ТОЛЬКО при экспорте (если они еще не были вшиты в Тайминге):
      // 1. Цельный фикс (перезапись всей дорожки, >= 75% размера оригинала):
      //    полностью заменяет черновую дорожку, вшивание отдельных фраз НЕ ТРЕБУЕТСЯ!
      // 2. Фрагментарные фиксы (отдельные фразы, легче оригинала):
      //    вшиваются в соответствующую дорожку оригинала.
      const snippetFixClips = [];
      const fullReplacementFixes = new Map();

      if (!alreadyStitchedInMain) {
        for (const fTr of fixTrs) {
          let fSize = 0;
          try { if (fTr.filePath && require('fs').existsSync(fTr.filePath)) fSize = require('fs').statSync(fTr.filePath).size; } catch (e) {}

          let bestMainTr = effectiveMainTrs.find(mt => mt.id === fTr.targetMainTrackId || mt.id === fTr.id.replace(/_fix$/, '')) || effectiveMainTrs[0];
          if (!bestMainTr && effectiveMainTrs.length > 1) {
            const fName = (fTr.filePath || fTr.participant || '').toLowerCase();
            const matched = effectiveMainTrs.find((mt, idx) => {
              const trNum = idx + 1;
              return fName.includes(`дорожка${trNum}`) || fName.includes(`track${trNum}`) || fName.includes(`take${trNum}`) || fName.includes(`_layer${trNum}`);
            });
            if (matched) bestMainTr = matched;
          }

          let mSize = 0;
          try { if (bestMainTr?.filePath && require('fs').existsSync(bestMainTr.filePath)) mSize = require('fs').statSync(bestMainTr.filePath).size; } catch (e) {}

          const ratio = (mSize > 0 && fSize > 0) ? (fSize / mSize) : 0;
          const isFullReplacement = mSize > 0 && fSize > 0 && (fSize >= mSize * 0.75);

          if (isFullReplacement && bestMainTr) {
            fullReplacementFixes.set(bestMainTr.id, fTr);
            log.info(`[ExportController] Даббер «${nick}»: фикс «${path.basename(fTr.filePath || '')}» является цельным (${(ratio * 100).toFixed(0)}% размера) — заменяет дорожку целиком, вшивание не требуется.`);
          } else {
            const fClips = (clipsMap[fTr.id] || []).filter(c => !c.isDeleted);
            for (const c of fClips) {
              snippetFixClips.push({ ...c, trackFilePath: fTr.filePath, targetMainTrackId: bestMainTr?.id });
            }
          }
        }
      }

      for (let mIdx = 0; mIdx < effectiveMainTrs.length; mIdx++) {
        const tr = effectiveMainTrs[mIdx];
        const trackNum = mIdx + 1;
        const outFilename = isMultiTrack ? `00_timed_${nick}_дорожка${trackNum}.wav` : `00_timed_${nick}.wav`;
        const outFilePath = path.join(exportDir, outFilename);
        const outRawFilePath = path.join(rawDir, outFilename);

        const fullFixTrack = fullReplacementFixes.get(tr.id);
        let sourceFile = fullFixTrack?.filePath || tr.filePath;
        if ((!sourceFile || !require('fs').existsSync(sourceFile)) && episode.uploads) {
          const matchingUpload = episode.uploads.find(u => 
            (u.type === 'DUBBER_FILE' || u.type === 'FIXES') && 
            (u.uploadedById === tr.id || u.participantId === tr.id || (u.fileName && u.fileName.includes(nick)))
          );
          if (matchingUpload && matchingUpload.path && require('fs').existsSync(matchingUpload.path)) {
            sourceFile = matchingUpload.path;
          }
        }

        let primarySourceFile = sourceFile;

        // Собираем фразы: если был цельный фикс, берем клипы из него, иначе из основной дорожки
        const rawClips = (fullFixTrack && clipsMap[fullFixTrack.id]?.length > 0)
          ? clipsMap[fullFixTrack.id]
          : (clipsMap[tr.id] || []);
        const trackClips = rawClips.filter(c => !c.isDeleted);
        const phrases = [];

        for (const c of trackClips) {
          const phraseSrc = (c.sourceAudioPath && require('fs').existsSync(c.sourceAudioPath))
            ? c.sourceAudioPath
            : (sourceFile || primarySourceFile);

          if (phraseSrc && require('fs').existsSync(phraseSrc) && !primarySourceFile) {
            primarySourceFile = phraseSrc;
          }

          const targetStartSec = Number((c.clipStartSec + (c.offsetSec || 0)).toFixed(3));
          const phraseDuration = Number((c.durationSec || Math.max(0.1, (c.sourceEndSec - c.sourceStartSec))).toFixed(3));
          const targetEndSec = Number((targetStartSec + phraseDuration).toFixed(3));

          phrases.push({
            id: c.id,
            sourceAudioPath: phraseSrc,
            sourceStartSec: c.sourceStartSec ?? 0,
            sourceEndSec: c.sourceEndSec ?? phraseDuration,
            targetStartSec,
            targetEndSec,
            durationSec: phraseDuration,
            volumePercent: 100, // Строго сохраняем 100% исходный уровень без нормализации и изменения громкости в тайминге!
            isFix: Boolean(fullFixTrack || c.isFix)
          });
        }

        // Вшивание фрагментарных фиксов ТОЛЬКО если дорожка НЕ заменена цельным фиксом
        if (!fullFixTrack && snippetFixClips.length > 0) {
          for (const fClip of snippetFixClips) {
            const fixTargetStart = Number((fClip.clipStartSec + (fClip.offsetSec || 0)).toFixed(3));
            const fixDur = Number((fClip.durationSec || Math.max(0.1, (fClip.sourceEndSec - fClip.sourceStartSec))).toFixed(3));
            const fixTargetEnd = Number((fixTargetStart + fixDur).toFixed(3));

            let matchesThisTrack = false;
            let matchedPhraseIdx = -1;

            for (let pIdx = 0; pIdx < phrases.length; pIdx++) {
              const p = phrases[pIdx];
              const overlap = Math.max(0, Math.min(p.targetEndSec, fixTargetEnd) - Math.max(p.targetStartSec, fixTargetStart));
              if (overlap > 0.2 || Math.abs(p.targetStartSec - fixTargetStart) < 2.5) {
                matchesThisTrack = true;
                matchedPhraseIdx = pIdx;
                break;
              }
            }

            if (!isMultiTrack) {
              matchesThisTrack = true;
            } else if (!matchesThisTrack && mIdx === 0) {
              const otherTracksHaveMatch = effectiveMainTrs.some((otherTr, oIdx) => {
                if (oIdx === mIdx) return false;
                const oClips = (clipsMap[otherTr.id] || []).filter(c => !c.isDeleted);
                return oClips.some(oc => {
                  const oStart = oc.clipStartSec + (oc.offsetSec || 0);
                  const oEnd = oStart + oc.durationSec;
                  return Math.max(0, Math.min(oEnd, fixTargetEnd) - Math.max(oStart, fixTargetStart)) > 0.2 || Math.abs(oStart - fixTargetStart) < 2.5;
                });
              });
              if (!otherTracksHaveMatch) {
                matchesThisTrack = true;
              }
            }

            if (matchesThisTrack) {
              const fixSrc = (fClip.sourceAudioPath && require('fs').existsSync(fClip.sourceAudioPath))
                ? fClip.sourceAudioPath
                : (fClip.trackFilePath || primarySourceFile);

              const fixPhraseObj = {
                id: fClip.id,
                sourceAudioPath: fixSrc,
                sourceStartSec: fClip.sourceStartSec ?? 0,
                sourceEndSec: fClip.sourceEndSec ?? fixDur,
                targetStartSec: fixTargetStart,
                targetEndSec: fixTargetEnd,
                durationSec: fixDur,
                volumePercent: 100,
                isFix: true
              };

              if (matchedPhraseIdx >= 0) {
                phrases[matchedPhraseIdx] = fixPhraseObj;
              } else {
                phrases.push(fixPhraseObj);
              }
            }
          }
        }

        // If primarySourceFile was not found on tracks, check phrases
        if (!primarySourceFile || !require('fs').existsSync(primarySourceFile)) {
          const foundFromClip = phrases.find(p => p.sourceAudioPath && require('fs').existsSync(p.sourceAudioPath));
          if (foundFromClip) {
            primarySourceFile = foundFromClip.sourceAudioPath;
          }
        }

        // Sort phrases chronologically
        phrases.sort((a, b) => a.targetStartSec - b.targetStartSec);

        // Deduplicate phrases strictly within this single track
        const cleanPhrases = [];
        for (const p of phrases) {
          if (cleanPhrases.length === 0) {
            cleanPhrases.push(p);
            continue;
          }
          const last = cleanPhrases[cleanPhrases.length - 1];
          const overlapStart = Math.max(last.targetStartSec, p.targetStartSec);
          const overlapEnd = Math.min(last.targetEndSec, p.targetEndSec);
          const overlapSec = Math.max(0, overlapEnd - overlapStart);

          if (overlapSec > 0.35 && overlapSec > Math.min(last.durationSec, p.durationSec) * 0.4) {
            if (p.isFix && !last.isFix) {
              cleanPhrases[cleanPhrases.length - 1] = p;
            } else if (!last.isFix && p.durationSec > last.durationSec) {
              cleanPhrases[cleanPhrases.length - 1] = p;
            }
            continue;
          }
          cleanPhrases.push(p);
        }

        if (cleanPhrases.length > 0 && primarySourceFile && require('fs').existsSync(primarySourceFile)) {
          const trackTitle = isMultiTrack ? `«${nick}» (дорожка ${trackNum})` : `«${nick}»`;
          log.info(`[ExportController] Рендеринг оттаймленной дорожки для даббера ${trackTitle} (${cleanPhrases.length} фраз, без нормализаций и искажений)...`);
          await AutoTimingService.assembleMultiSourceTrack(primarySourceFile, cleanPhrases, outFilePath, { 
            targetDir: exportDir, 
            timingMetadata,
            renderFromClips: true,
            exactTimelineRender: true,
            timingExport: true
          });
        } else if (primarySourceFile && require('fs').existsSync(primarySourceFile)) {
          await fs.copyFile(primarySourceFile, outFilePath);
        }

        if (require('fs').existsSync(outFilePath)) {
          try {
            await fs.copyFile(outFilePath, outRawFilePath);
          } catch (e) {}
        }

        renderedTracks.push({
          dubberNick: isMultiTrack ? `${nick} (Дорожка ${trackNum})` : nick,
          baseNick: nick,
          trackIndex: trackNum,
          characterName,
          outputPath: outFilePath,
          phrasesCount: cleanPhrases.length
        });
      }

      onProgress({ percent: Math.round(((aIdx + 1) / Math.max(1, actorEntries.length)) * 100) });
    }

    // Strictly keep ONLY the rendered master tracks from this Timing export!
    // Remove any stale 00_timed_*_дорожка1.wav, 00_timed_*_дорожка2.wav, old untimed dubber tracks, or slice artifacts
    const validRenderedFiles = new Set(renderedTracks.map(rt => path.basename(rt.outputPath).toLowerCase()));
    const singleTrackActorNicks = new Set(
      renderedTracks
        .filter(rt => !/_дорожка\d+\.wav$/i.test(rt.outputPath))
        .map(rt => String(rt.baseNick || '').toLowerCase())
        .filter(Boolean)
    );

    const cleanupDirs = [exportDir, rawDir];
    for (const dir of cleanupDirs) {
      if (require('fs').existsSync(dir)) {
        const files = await fs.readdir(dir).catch(() => []);
        for (const f of files) {
          const lower = f.toLowerCase();
          if (lower === '00_original_audio.wav' || lower === 'original_audio.wav' || lower.startsWith('original_')) {
            continue;
          }
          const isAudioFile = /\.(wav|mp3|flac|ogg|m4a|aac)$/i.test(f);
          const isTempArtifact = lower.includes('slice') || lower.startsWith('temp_') || lower.endsWith('.raw');
          const isStaleAudio = isAudioFile && validRenderedFiles.size > 0 && !validRenderedFiles.has(lower);
          if (isTempArtifact || isStaleAudio) {
            await fs.unlink(path.join(dir, f)).catch(() => {});
          }
        }
      }
    }

    // Also clean up any stale *_дорожка1.wav / *_дорожка2.wav files inside pipeline step folders for single-track actors
    if (singleTrackActorNicks.size > 0 && require('fs').existsSync(exportDir)) {
      const entries = await fs.readdir(exportDir, { withFileTypes: true }).catch(() => []);
      for (const ent of entries) {
        if (ent.isDirectory() && /^\d{2}_/.test(ent.name) && ent.name !== '00_исходные') {
          const stepDir = path.join(exportDir, ent.name);
          const stepFiles = await fs.readdir(stepDir).catch(() => []);
          for (const sf of stepFiles) {
            const lowerSf = sf.toLowerCase();
            if (/_дорожка\d+\.wav$/i.test(lowerSf)) {
              for (const actorLower of singleTrackActorNicks) {
                if (lowerSf.includes(actorLower)) {
                  await fs.unlink(path.join(stepDir, sf)).catch(() => {});
                  break;
                }
              }
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

  const resolveEpisodeTimingDir = async (episode) => {
    if (!episode) throw new Error('Missing required parameter: episode');
    const config = await getData('config.json').catch(() => ({}));
    const baseDir = (config && config.baseDir) ? config.baseDir : app.getPath('userData');
    const projectsData = await getData('projects.json').catch(() => []);
    const project = Array.isArray(projectsData) ? projectsData.find(p => p.id === episode.projectId) : null;
    const enrichedEpisode = {
      ...episode,
      project: episode.project || project || { title: 'Project' }
    };
    const MixingPipelineService = require('../services/MixingPipelineService.cjs');
    const epDir = MixingPipelineService.getEpisodeDir(enrichedEpisode, baseDir);
    const rawTimingDir = path.join(epDir, 'Тайминг');
    const timingDir = await MixingPipelineService.ensureDirectory(rawTimingDir).catch(() => rawTimingDir);
    return { epDir, timingDir, enrichedEpisode };
  };

  ipcMain.handle('timing-load-state', wrapIpcHandler(async (event, { episode } = {}) => {
    if (!episode) return { success: true, exists: false, state: null };
    const { timingDir } = await resolveEpisodeTimingDir(episode);
    const stateFilePath = path.join(timingDir, 'timing_state.json');
    if (require('fs').existsSync(stateFilePath)) {
      try {
        const raw = await fs.readFile(stateFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.tracks) && parsed.tracks.length > 0 && parsed.audioClips) {
          log.info(`[TimingState] Загружено сохраненное состояние вкладки «Тайминг» из: ${stateFilePath}`);
          return {
            success: true,
            exists: true,
            timingDir,
            filePath: stateFilePath,
            state: parsed
          };
        }
      } catch (err) {
        log.warn(`[TimingState] Ошибка чтения файла состояния тайминга ${stateFilePath}:`, err.message);
      }
    }
    return {
      success: true,
      exists: false,
      timingDir,
      filePath: stateFilePath,
      state: null
    };
  }));

  ipcMain.handle('timing-save-state', wrapIpcHandler(async (event, { episode, state } = {}) => {
    if (!episode || !state) throw new Error('Missing required parameters: episode, state');
    const { timingDir } = await resolveEpisodeTimingDir(episode);
    await fs.mkdir(timingDir, { recursive: true });

    const stateFilePath = path.join(timingDir, 'timing_state.json');
    const statusFilePath = path.join(timingDir, 'timing_status.json');
    const updatedAt = new Date().toISOString();

    const payloadToSave = {
      version: '1.0',
      episodeId: episode.id,
      projectId: episode.projectId,
      episodeNumber: episode.number,
      projectTitle: episode.project?.title || '',
      updatedAt,
      ...state
    };

    const tracksList = Array.isArray(state.tracks) ? state.tracks : [];
    const clipsMap = state.audioClips && typeof state.audioClips === 'object' ? state.audioClips : {};
    const totalClipsCount = Object.values(clipsMap).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);

    const statusSummary = {
      episodeId: episode.id,
      projectId: episode.projectId,
      episodeNumber: episode.number,
      updatedAt,
      timingDir,
      status: {
        isSilenceRemoved: Boolean(state.isSilenceRemoved),
        isFixesStitched: Boolean(state.isFixesStitched),
        isTimingAnalyzed: Boolean(state.isTimingAnalyzed),
        tracksCount: tracksList.length,
        totalClipsCount,
        issuesCount: Array.isArray(state.timingIssues) ? state.timingIssues.length : 0,
        collisionsCount: Array.isArray(state.collisions) ? state.collisions.length : 0,
        missingSubtitlesCount: Array.isArray(state.missingSubtitles) ? state.missingSubtitles.length : 0
      }
    };

    await fs.writeFile(stateFilePath, JSON.stringify(payloadToSave, null, 2), 'utf8');
    await fs.writeFile(statusFilePath, JSON.stringify(statusSummary, null, 2), 'utf8');

    return {
      success: true,
      timingDir,
      filePath: stateFilePath,
      updatedAt
    };
  }));

  ipcMain.handle('timing-reset-state', wrapIpcHandler(async (event, { episode } = {}) => {
    if (!episode) throw new Error('Missing required parameter: episode');
    const { timingDir } = await resolveEpisodeTimingDir(episode);
    const stateFilePath = path.join(timingDir, 'timing_state.json');
    const statusFilePath = path.join(timingDir, 'timing_status.json');

    if (require('fs').existsSync(stateFilePath)) {
      await fs.unlink(stateFilePath).catch(() => {});
    }
    if (require('fs').existsSync(statusFilePath)) {
      await fs.unlink(statusFilePath).catch(() => {});
    }

    log.info(`[TimingState] Состояние вкладки «Тайминг» сброшено (очищена папка: ${timingDir})`);
    return {
      success: true,
      timingDir
    };
  }));

  ipcMain.handle('timing-separate-original-stems', wrapIpcHandler(async (event, { episode, videoPath, modelId = 'uvr_mdx_voc_ft' } = {}) => {
    if (!episode) throw new Error('Параметр episode обязателен для разделения стемов оригинала');
    const config = await getData('config.json').catch(() => ({}));
    const baseDir = (config && config.baseDir) ? config.baseDir : app.getPath('userData');
    const MixingPipelineService = require('../services/MixingPipelineService.cjs');
    const AudioNeuralService = require('../services/AudioNeuralService.cjs');
    const ffmpeg = require('fluent-ffmpeg');
    const { extractAudioPeaks } = require('../services/ffmpegService.cjs');

    const { epDir, timingDir } = await resolveEpisodeTimingDir(episode);
    const stemsDir = path.join(timingDir, 'stems');
    await fs.mkdir(stemsDir, { recursive: true });

    const win = getWin();
    const sendProgress = (percent, message) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('timing-stem-separation-progress', { percent, message });
      }
    };

    sendProgress(5, 'Поиск оригинального видео серии...');

    let effectiveVideo = videoPath && require('fs').existsSync(videoPath) ? videoPath : null;
    if (!effectiveVideo && episode.rawPath && require('fs').existsSync(episode.rawPath)) {
      effectiveVideo = episode.rawPath;
    }
    if (!effectiveVideo) {
      const searchDirs = [epDir, path.dirname(epDir), episode.folderPath].filter(d => d && typeof d === 'string' && require('fs').existsSync(d));
      const videoExtRegex = /\.(mp4|mkv|mov|avi|webm)$/i;
      for (const dir of searchDirs) {
        try {
          const files = require('fs').readdirSync(dir);
          const found = files.find(f => videoExtRegex.test(f) && !f.includes('[СВЕДЕНО]') && !f.includes('video_mux'));
          if (found) { effectiveVideo = path.join(dir, found); break; }
        } catch (e) {}
      }
    }
    if (!effectiveVideo) {
      throw new Error('Видеофайл серии не найден для разделения стемов.');
    }

    sendProgress(15, 'Извлечение несжатого аудио оригинала (WAV 48kHz)...');
    const rawAudioPath = path.join(stemsDir, 'source_original_audio.wav');
    if (!require('fs').existsSync(rawAudioPath) || require('fs').statSync(rawAudioPath).size < 1000) {
      await new Promise((resolve, reject) => {
        ffmpeg(effectiveVideo)
          .noVideo()
          .audioCodec('pcm_s16le')
          .audioChannels(2)
          .audioFrequency(48000)
          .output(rawAudioPath)
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .run();
      });
    }

    const vocalsPath = path.join(stemsDir, 'original_vocals.wav');
    const instrumentalPath = path.join(stemsDir, 'original_instrumental.wav');

    sendProgress(25, `Запуск модели нейросетевого разделения: ${modelId}...`);

    if (modelId === 'ffmpeg_vocal_remover') {
      sendProgress(35, 'FFmpeg Splitter: Выделение вокального диапазона...');
      const vocFilters = 'highpass=f=80,lowpass=f=12000,equalizer=f=1000:t=q:w=1.0:g=1.5,equalizer=f=3400:t=q:w=1.5:g=0.8,agate=threshold=-50dB:range=-15dB:attack=15:release=140';
      await new Promise((resolve, reject) => {
        ffmpeg(rawAudioPath)
          .audioFilters(vocFilters)
          .audioCodec('pcm_s16le')
          .audioChannels(2)
          .audioFrequency(48000)
          .output(vocalsPath)
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .run();
      });

      sendProgress(65, 'FFmpeg Splitter: Выделение фонограммы M&E...');
      const instFilters = 'highpass=f=25,equalizer=f=1000:t=q:w=1.0:g=-6.0,equalizer=f=3200:t=q:w=2.0:g=-15.0';
      await new Promise((resolve, reject) => {
        ffmpeg(rawAudioPath)
          .audioFilters(instFilters)
          .audioCodec('pcm_s16le')
          .audioChannels(2)
          .audioFrequency(48000)
          .output(instrumentalPath)
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .run();
      });
    } else {
      const modelDef = MixingPipelineService.moduleDatabase.find(m => m.id === modelId) ||
                       MixingPipelineService.moduleDatabase.find(m => m.id === 'uvr_mdx_voc_ft');
      const filename = modelDef?.filename || 'UVR-MDX-NET-Voc_FT.onnx';

      const rootUserData = app ? app.getPath('userData') : process.cwd();
      const uvrModelsDir = path.join(rootUserData, 'models', 'uvr');
      await fs.mkdir(uvrModelsDir, { recursive: true });
      const localModelFile = path.join(uvrModelsDir, filename);

      if (!require('fs').existsSync(localModelFile) && modelDef?.urls?.length > 0) {
        sendProgress(30, `Загрузка весов модели ${modelDef.name || filename}...`);
        try {
          await MixingPipelineService.downloadUvrModel({
            modelId: modelDef.id,
            onProgress: (p) => {
              if (p && typeof p.percent === 'number') {
                sendProgress(Math.round(30 + p.percent * 0.25), `Загрузка весов: ${p.percent}%`);
              }
            },
            onLog: (msg) => log.info(`[TimingStems] ${msg}`)
          });
        } catch (downloadErr) {
          log.warn(`[TimingStems] Model weights download warning: ${downloadErr.message}`);
        }
      }

      sendProgress(55, `Обработка нейросетью «${modelDef?.name || modelId}»...`);
      const tempOutputDir = path.join(stemsDir, 'temp_neural_out');
      await fs.mkdir(tempOutputDir, { recursive: true });

      const neuralRes = await AudioNeuralService.separateStems({
        inputPath: rawAudioPath,
        outputDir: tempOutputDir,
        modelName: modelDef?.id || modelId,
        modelPath: require('fs').existsSync(localModelFile) ? localModelFile : null,
        modelId: modelDef?.id || modelId,
        shifts: 1,
        overlap: 0.25,
        stems: 'both',
        prefix: 'stem_',
        onProgress: (p) => {
          if (p && typeof p.percent === 'number') {
            sendProgress(Math.round(55 + p.percent * 0.35), `Нейросеть: ${p.percent}%`);
          }
        },
        onLog: (msg) => log.info(`[TimingStems] ${msg}`)
      });

      let foundVocals = null;
      let foundInst = null;
      if (Array.isArray(neuralRes)) {
        foundVocals = neuralRes.find(s => s.type === 'vocals' || /vocal/i.test(s.path || s.name))?.path;
        foundInst = neuralRes.find(s => s.type === 'instrumental' || /instrumental|no_vocal|accompaniment|other/i.test(s.path || s.name))?.path;
      }
      if (!foundVocals || !foundInst) {
        const tempFiles = require('fs').readdirSync(tempOutputDir);
        for (const tf of tempFiles) {
          const fullTf = path.join(tempOutputDir, tf);
          if (/vocal/i.test(tf)) foundVocals = fullTf;
          else if (/instrumental|no_vocal|other|accompaniment/i.test(tf)) foundInst = fullTf;
        }
      }

      if (foundVocals && require('fs').existsSync(foundVocals)) {
        await fs.copyFile(foundVocals, vocalsPath);
      }
      if (foundInst && require('fs').existsSync(foundInst)) {
        await fs.copyFile(foundInst, instrumentalPath);
      }
      try {
        const tempFiles = require('fs').readdirSync(tempOutputDir);
        for (const tf of tempFiles) await fs.unlink(path.join(tempOutputDir, tf)).catch(() => {});
        await fs.rmdir(tempOutputDir).catch(() => {});
      } catch (e) {}
    }

    sendProgress(92, 'Генерация вейвформ для Голосов и Фона...');
    let vocalsPeaks = [];
    let instrumentalPeaks = [];
    try {
      const vRes = await extractAudioPeaks(vocalsPath, 25);
      vocalsPeaks = Array.isArray(vRes) ? vRes : (vRes?.peaks || []);
    } catch (e) {}

    try {
      const iRes = await extractAudioPeaks(instrumentalPath, 25);
      instrumentalPeaks = Array.isArray(iRes) ? iRes : (iRes?.peaks || []);
    } catch (e) {}

    sendProgress(100, 'Стемы оригинала успешно разделены!');

    return {
      success: true,
      vocalsPath,
      instrumentalPath,
      modelId,
      vocalsPeaks,
      instrumentalPeaks
    };
  }));

  ipcMain.handle('timing-import-original-stem', wrapIpcHandler(async (event, { episode, stemType, filePath } = {}) => {
    if (!episode || !stemType) throw new Error('Missing parameters: episode, stemType');
    const { timingDir } = await resolveEpisodeTimingDir(episode);
    const stemsDir = path.join(timingDir, 'stems');
    await fs.mkdir(stemsDir, { recursive: true });

    let sourceFile = filePath;
    if (!sourceFile) {
      const win = getWin();
      const res = await dialog.showOpenDialog(win, {
        title: stemType === 'vocals' ? 'Выберите файл изолированных голосов (Vocals)' : 'Выберите файл фонограммы (M&E / Instrumental)',
        filters: [{ name: 'Аудиофайлы', extensions: ['wav', 'flac', 'mp3', 'm4a', 'ogg', 'aac'] }],
        properties: ['openFile']
      });
      if (res.canceled || !res.filePaths || res.filePaths.length === 0) {
        return { canceled: true };
      }
      sourceFile = res.filePaths[0];
    }

    const targetName = stemType === 'vocals' ? 'original_vocals.wav' : 'original_instrumental.wav';
    const targetPath = path.join(stemsDir, targetName);

    const ext = path.extname(sourceFile).toLowerCase();
    if (ext === '.wav') {
      await fs.copyFile(sourceFile, targetPath);
    } else {
      const ffmpeg = require('fluent-ffmpeg');
      await new Promise((resolve, reject) => {
        ffmpeg(sourceFile)
          .noVideo()
          .audioCodec('pcm_s16le')
          .audioChannels(2)
          .audioFrequency(48000)
          .output(targetPath)
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .run();
      });
    }

    const { extractAudioPeaks } = require('../services/ffmpegService.cjs');
    let peaks = [];
    try {
      const pRes = await extractAudioPeaks(targetPath, 25);
      peaks = Array.isArray(pRes) ? pRes : (pRes?.peaks || []);
    } catch (e) {}

    return {
      success: true,
      canceled: false,
      filePath: targetPath,
      stemType,
      peaks
    };
  }));

  ipcMain.handle('timing-export-stems-to-folder', wrapIpcHandler(async (event, { episode, targetFolder, format = 'flac' } = {}) => {
    if (!episode) throw new Error('Missing parameter: episode');
    const { epDir, timingDir } = await resolveEpisodeTimingDir(episode);
    const stemsDir = path.join(timingDir, 'stems');
    const vocalsPath = path.join(stemsDir, 'original_vocals.wav');
    const instrumentalPath = path.join(stemsDir, 'original_instrumental.wav');

    let outFolder = targetFolder;
    if (!outFolder) {
      const win = getWin();
      const res = await dialog.showOpenDialog(win, {
        title: 'Выберите папку для сохранения стемов оригинала',
        properties: ['openDirectory', 'createDirectory']
      });
      if (res.canceled || !res.filePaths || res.filePaths.length === 0) {
        return { canceled: true };
      }
      outFolder = res.filePaths[0];
    }

    await fs.mkdir(outFolder, { recursive: true });
    const ffmpeg = require('fluent-ffmpeg');
    const epNum = episode.number !== undefined ? `_Ep${episode.number}` : '';
    const projTitle = sanitizeProjectTitle(episode.project?.title || 'Episode');
    const basePrefix = `${projTitle}${epNum}`;

    const ext = format === 'wav' ? '.wav' : '.flac';
    const outVocals = path.join(outFolder, `${basePrefix}_[00_Голоса_оригинала_Vocals]${ext}`);
    const outInst = path.join(outFolder, `${basePrefix}_[00_Фон_оригинала_ME]${ext}`);

    const exportedFiles = [];

    if (require('fs').existsSync(vocalsPath)) {
      if (format === 'wav') {
        await fs.copyFile(vocalsPath, outVocals);
      } else {
        await new Promise((resolve, reject) => {
          ffmpeg(vocalsPath).noVideo().audioCodec('flac').audioFrequency(48000).output(outVocals).on('end', resolve).on('error', reject).run();
        });
      }
      exportedFiles.push(outVocals);
    }

    if (require('fs').existsSync(instrumentalPath)) {
      if (format === 'wav') {
        await fs.copyFile(instrumentalPath, outInst);
      } else {
        await new Promise((resolve, reject) => {
          ffmpeg(instrumentalPath).noVideo().audioCodec('flac').audioFrequency(48000).output(outInst).on('end', resolve).on('error', reject).run();
        });
      }
      exportedFiles.push(outInst);
    }

    return {
      success: true,
      canceled: false,
      targetFolder: outFolder,
      files: exportedFiles
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
