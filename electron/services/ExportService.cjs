const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const log = require('electron-log');
const { bakeSubtitles, transcodeToMp4, muxRelease } = require('./ffmpegService.cjs');
const { splitSubsByDubber, extractSignsAss, exportFullAssWithRoles } = require('./subtitleService.cjs');

/**
 * Helper to copy a file and report progress.
 */
async function copyLargeFile(src, dest, onProgress, startP = 0, endP = 100) {
  const stat = await fs.stat(src);
  const total = stat.size;
  let copied = 0;
  return new Promise((resolve, reject) => {
    const rs = fsSync.createReadStream(src);
    const ws = fsSync.createWriteStream(dest);
    let lastUpdate = 0;
    
    rs.on('data', (chunk) => {
      copied += chunk.length;
      const now = Date.now();
      if (now - lastUpdate > 200) { // throttle updates
        const p = startP + ((copied / total) * (endP - startP));
        if (onProgress) onProgress({ percent: p });
        lastUpdate = now;
      }
    });

    rs.on('error', reject);
    ws.on('error', reject);
    ws.on('close', () => {
      if (onProgress) onProgress({ percent: endP });
      resolve();
    });
    
    rs.pipe(ws);
  });
}

/**
 * Service for handling complex export operations.
 */
class ExportService {
  static async exportDabberFiles(episode, targetDir, skipConversion, additionalProcessing, config, participantsData, projectsData, onProgress, onCommand) {
    if (!episode || !targetDir) throw new Error('Missing required parameters');
    log.info(`Exporting dabber files for episode ${episode.number} to ${targetDir}`);
    await fs.mkdir(targetDir, { recursive: true });

    let videoProgressEnd = episode.subPath ? 95 : 100;

    const project = (projectsData || []).find(p => p.id === episode.projectId);
    const projectTitle = project ? project.title : 'Unknown';
    const baseVideoName = `${projectTitle}_${episode.number}`;

    if (episode.rawPath) {
      const videoName = path.basename(episode.rawPath);
      const ext = path.extname(videoName);

      if (skipConversion) {
        let outVideoPath = path.join(targetDir, `${baseVideoName}[оригинал]${ext}`);
        if (path.resolve(outVideoPath) !== path.resolve(episode.rawPath)) {
          onProgress({ percent: 0 }); // Start progress
          await copyLargeFile(episode.rawPath, outVideoPath, onProgress, 0, videoProgressEnd);
        } else {
          onProgress({ percent: videoProgressEnd });
        }
      } else if (episode.isHardsub) {
        const finalName = `${baseVideoName}_[хардсаб]${ext}`;
        let outVideoPath = path.join(targetDir, finalName);
        
        if (path.resolve(outVideoPath) === path.resolve(episode.rawPath)) {
          outVideoPath = path.join(targetDir, `${baseVideoName}_[хардсаб][обработка]${ext}`);
        }

        await transcodeToMp4(episode.rawPath, outVideoPath, (p) => onProgress({ percent: (p / 100) * videoProgressEnd }), onCommand, { 
          useNvenc: config.useNvenc, 
          gpuIndex: config.gpuIndex,
          crf: 28,
          additionalProcessing
        });
      } else {
        const suffix = episode.subPath ? '_[с надписями]' : (additionalProcessing ? '_[обработка]' : '_[копия]');
        let outVideoPath = path.join(targetDir, `${baseVideoName}${suffix}${ext}`);

        if (path.resolve(outVideoPath) === path.resolve(episode.rawPath)) {
          outVideoPath = path.join(targetDir, `${baseVideoName}${suffix}[копия]${ext}`);
        }

        if (episode.subPath) {
          await bakeSubtitles(episode.rawPath, episode.subPath, outVideoPath, (p) => onProgress({ percent: (p / 100) * videoProgressEnd }), onCommand, { 
            useNvenc: config.useNvenc, 
            gpuIndex: config.gpuIndex,
            crf: 28,
            additionalProcessing
          });
        } else {
          await transcodeToMp4(episode.rawPath, outVideoPath, (p) => onProgress({ percent: (p / 100) * videoProgressEnd }), onCommand, { 
            useNvenc: config.useNvenc, 
            gpuIndex: config.gpuIndex,
            crf: 28,
            additionalProcessing
          });
        }
      }
    }

    if (episode.subPath) {
      if (!episode.rawPath) {
        onProgress({ percent: 0 });
      }
      const ext = path.extname(episode.subPath);
      const generalSubName = `${baseVideoName}_[субтитры_общие]${ext}`;
      
      // Использовать exportFullAssWithRoles вместо fs.copyFile, чтобы в ролях были дабберы
      await exportFullAssWithRoles(
        episode.subPath, 
        path.join(targetDir, generalSubName), 
        episode.assignments, 
        participantsData,
        project ? project.characterAliases : null
      );
      
      const subProgressStart = videoProgressEnd;
      await splitSubsByDubber(episode.subPath, targetDir, episode.assignments, participantsData, {
        onProgress: (p) => onProgress({ percent: subProgressStart + (p.percent / 100 * (100 - subProgressStart)) }),
        baseFileName: baseVideoName,
        characterAliases: project ? project.characterAliases : null
      });
      onProgress({ percent: 100 });
    }

    return { success: true, targetDir, yandexUrl: null };
  }

  static async exportSoundEngineerFiles(episode, targetDir, skipConversion, smartExport, additionalProcessing, config, projectsData, participantsData, onProgress, onCommand) {
    if (!episode || !targetDir) throw new Error('Missing required parameters');
    log.info(`Exporting sound engineer files for episode ${episode.number} to ${targetDir}`);
    log.info(`Export options: skipConversion=${skipConversion}, smartExport=${smartExport}, additionalProcessing=${additionalProcessing}`);
    await fs.mkdir(targetDir, { recursive: true });

    const project = (projectsData || []).find(p => p.id === episode.projectId);
    const projectTitle = project ? project.title : 'Unknown';
    const baseVideoName = `${projectTitle}_${episode.number}`;

    if (episode.rawPath) {
      log.info(`Processing raw video for sound engineer: ${episode.rawPath}`);
      const videoName = path.basename(episode.rawPath);
      const ext = path.extname(videoName);
      
      if (skipConversion) {
        log.info('Video: skipConversion is true. Performing straight copy.');
        let outVideoPath = path.join(targetDir, `${baseVideoName}[оригинал]${ext}`);
        if (path.resolve(outVideoPath) !== path.resolve(episode.rawPath)) {
          onProgress({ percent: 0 });
          await copyLargeFile(episode.rawPath, outVideoPath, onProgress, 0, 100);
          log.info('Video: copy complete.');
        } else {
          log.info('Video: target path matches source. Skipping copy.');
          onProgress({ percent: 100 });
        }
      } else if (episode.isHardsub) {
        log.info('Video: isHardsub is true.');
        const markedVideoPath = path.join(targetDir, `${baseVideoName}_[хардсаб]${ext}`);
        
        if (additionalProcessing) {
          log.info('Video: isHardsub && additionalProcessing. Transcoding video.');
          await transcodeToMp4(episode.rawPath, markedVideoPath, (p) => onProgress({ percent: p }), onCommand, { 
            useNvenc: config.useNvenc, 
            gpuIndex: config.gpuIndex,
            crf: 18,
            additionalProcessing
          });
          log.info('Video: isHardsub && additionalProcessing transcode complete.');
        } else {
          log.info('Video: isHardsub but no additionalProcessing. Performing straight copy.');
          onProgress({ percent: 0 });
          await copyLargeFile(episode.rawPath, markedVideoPath, onProgress, 0, 100);
          log.info('Video: isHardsub copy complete.');
        }
      } else {
        let hasSigns = false;
        let signsAssPath = null;
        log.info('Video: is not Hardsub. Checking for signs (ASS).');
        if (episode.subPath) {
          signsAssPath = path.join(targetDir, `temp_signs_${Date.now()}.ass`);
          hasSigns = await extractSignsAss(episode.subPath, signsAssPath);
          log.info(`Video: extractSignsAss result = ${hasSigns}`);
        } else {
          log.info('Video: No subPath provided in episode. No signs extracted.');
        }
        
        const suffix = hasSigns ? '_[с надписями]' : (additionalProcessing ? '_[обработка]' : '[копия]');
        const bakedVideoPath = path.join(targetDir, `${baseVideoName}${suffix}${ext}`);

        if (hasSigns) {
          log.info('Video: hasSigns is true. Baking subtitles into video.');
          await bakeSubtitles(episode.rawPath, signsAssPath, bakedVideoPath, (p) => onProgress({ percent: p }), onCommand, { 
            useNvenc: config.useNvenc, 
            gpuIndex: config.gpuIndex,
            crf: 18,
            additionalProcessing
          });
          log.info('Video: baking subtitles complete.');
          await fs.unlink(signsAssPath).catch(() => {});
        } else if (additionalProcessing) {
          log.info('Video: no signs, but additionalProcessing is true. Transcoding video.');
          await transcodeToMp4(episode.rawPath, bakedVideoPath, (p) => onProgress({ percent: p }), onCommand, { 
            useNvenc: config.useNvenc, 
            gpuIndex: config.gpuIndex,
            crf: 18,
            additionalProcessing
          });
          log.info('Video: Transcoding complete.');
          if (signsAssPath) await fs.unlink(signsAssPath).catch(() => {});
        } else {
          log.info('Video: no signs, no additionalProcessing. Performing straight copy.');
          onProgress({ percent: 0 });
          await copyLargeFile(episode.rawPath, bakedVideoPath, onProgress, 0, 100);
          log.info('Video: copy complete.');
          if (signsAssPath) await fs.unlink(signsAssPath).catch(() => {});
        }
      }
    } else {
      log.info('No episode.rawPath. Skipping video export phase.');
    }

    const dubberFiles = {};
    for (const upload of episode.uploads) {
      if (upload.type === 'DUBBER_FILE' || upload.type === 'FIXES') {
        const dubberId = upload.uploadedById;
        if (!dubberFiles[dubberId]) dubberFiles[dubberId] = { original: [], fixes: [] };
        if (upload.type === 'DUBBER_FILE') dubberFiles[dubberId].original.push(upload);
        else dubberFiles[dubberId].fixes.push(upload);
      }
    }

    const getNick = (id) => {
      const p = participantsData.find(part => part.id === id);
      return p ? p.nickname : 'Unknown';
    };

    const getExportName = (upload, isFix) => {
      const nick = getNick(upload.uploadedById);
      const ext = path.extname(upload.path);
      const fixSuffix = isFix ? '_[фикс]' : '';
      return `${baseVideoName}_[${nick}]${fixSuffix}${ext}`;
    };

    for (const dubberId in dubberFiles) {
      const { original, fixes } = dubberFiles[dubberId];
      const latestOriginal = original.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      const latestFix = fixes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

      if (smartExport && latestOriginal && latestFix) {
        try {
          const origStat = await fs.stat(latestOriginal.path);
          const fixStat = await fs.stat(latestFix.path);

          if (fixStat.size < origStat.size) {
            await fs.copyFile(latestOriginal.path, path.join(targetDir, getExportName(latestOriginal, false)));
            await fs.copyFile(latestFix.path, path.join(targetDir, getExportName(latestFix, true)));
          } else {
            await fs.copyFile(latestFix.path, path.join(targetDir, getExportName(latestFix, true)));
          }
        } catch (e) {
          log.error('Smart export stat error:', e);
          await fs.copyFile(latestOriginal.path, path.join(targetDir, getExportName(latestOriginal, false)));
          await fs.copyFile(latestFix.path, path.join(targetDir, getExportName(latestFix, true)));
        }
      } else {
        if (latestOriginal) await fs.copyFile(latestOriginal.path, path.join(targetDir, getExportName(latestOriginal, false)));
        if (latestFix) await fs.copyFile(latestFix.path, path.join(targetDir, getExportName(latestFix, true)));
      }
    }

    return { success: true, targetDir, yandexUrl: null };
  }

  static async buildRelease(episode, targetDir, customAudioPath, customRawPath, onProgress, onCommand) {
    if (!episode || !targetDir) throw new Error('Missing required parameters');
    log.info(`Building release for episode ${episode.number} in ${targetDir}`);
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
    
    try {
      await muxRelease(finalRawPath, audioPath, signsPath, outputPath, (p) => onProgress({ percent: p }), onCommand);
      if (signsPath) {
        await fs.unlink(signsPath).catch(() => {});
      }
      return { path: outputPath };
    } catch (err) {
      if (signsPath) {
        await fs.unlink(signsPath).catch(() => {});
      }
      throw err;
    }
  }
}

module.exports = ExportService;
