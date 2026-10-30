const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const log = require('electron-log');
const { bakeSubtitles, transcodeToMp4, muxRelease, applyFixesToOriginalAudio } = require('./ffmpegService.cjs');
const { splitSubsByDubber, extractSignsAss, exportFullAssWithRoles } = require('./subtitleService.cjs');
const AutoTimingService = require('./AutoTimingService.cjs');
const { sanitizeFileNamePart, sanitizeFolderName, sanitizeProjectTitle, sanitizeDubberNick, sanitizePath } = require('../lib/pathSanitizer.cjs');

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
  static async exportDabberFiles(paramsOrEpisode, maybeTargetDir, maybeSkipConv, maybeAddProc, maybeConfig, maybeParticipantsData, maybeProjectsData, maybeOnProgress, maybeOnCommand) {
    let episode, targetDir, skipConversion, additionalProcessing, config, participantsData, projectsData, onProgress, onCommand;

    if (paramsOrEpisode && typeof paramsOrEpisode === 'object' && (paramsOrEpisode.episode || (!paramsOrEpisode.number && !paramsOrEpisode.id && paramsOrEpisode.targetDir))) {
      const p = paramsOrEpisode;
      episode = p.episode;
      targetDir = p.targetDir;
      const opts = p.options || {};
      skipConversion = p.skipConversion ?? opts.skipConversion ?? false;
      additionalProcessing = p.additionalProcessing ?? opts.additionalProcessing ?? false;
      config = p.config || {};
      participantsData = p.participantsData || [];
      projectsData = p.projectsData || [];
      onProgress = p.onProgress;
      onCommand = p.onCommand;
    } else {
      episode = paramsOrEpisode;
      targetDir = maybeTargetDir;
      skipConversion = maybeSkipConv;
      additionalProcessing = maybeAddProc;
      config = maybeConfig;
      participantsData = maybeParticipantsData;
      projectsData = maybeProjectsData;
      onProgress = maybeOnProgress;
      onCommand = maybeOnCommand;
    }

    if (!episode || !targetDir) throw new Error('Missing required parameters');
    targetDir = sanitizePath(targetDir);
    log.info(`Exporting dabber files for episode ${episode.number} to ${targetDir}`);
    await fs.mkdir(targetDir, { recursive: true });

    let videoProgressEnd = episode.subPath ? 95 : 100;

    const project = (projectsData || []).find(p => p.id === episode.projectId);
    const rawProjectTitle = project ? project.title : 'Unknown';
    const projectTitle = sanitizeProjectTitle(rawProjectTitle);
    const baseVideoName = `${projectTitle}_${episode.number}`;

    if (episode.rawPath) {
      const videoName = path.basename(episode.rawPath);
      const ext = path.extname(videoName);

      let outVideoPath;
      if (skipConversion) {
        outVideoPath = path.join(targetDir, `${baseVideoName}[оригинал]${ext}`);
      } else if (episode.isHardsub) {
        const finalName = `${baseVideoName}_[хардсаб]${ext}`;
        outVideoPath = path.join(targetDir, finalName);
        if (path.resolve(outVideoPath) === path.resolve(episode.rawPath)) {
          outVideoPath = path.join(targetDir, `${baseVideoName}_[хардсаб][обработка]${ext}`);
        }
      } else {
        const suffix = episode.subPath ? '_[с надписями]' : (additionalProcessing ? '_[обработка]' : '_[копия]');
        outVideoPath = path.join(targetDir, `${baseVideoName}${suffix}${ext}`);
        if (path.resolve(outVideoPath) === path.resolve(episode.rawPath)) {
          outVideoPath = path.join(targetDir, `${baseVideoName}${suffix}[копия]${ext}`);
        }
      }

      // Check if video file already exists in target directory to avoid redundant re-encoding or re-copying
      let videoAlreadyExists = false;
      try {
        const stat = await fs.stat(outVideoPath);
        if (stat.size > 0) {
          videoAlreadyExists = true;
        }
      } catch (e) {
        // Also check if any existing video file for this episode already exists in targetDir
        try {
          const filesInTarget = await fs.readdir(targetDir);
          const existingVid = filesInTarget.find(f => {
            const fExt = path.extname(f).toLowerCase();
            return ['.mp4', '.mkv', '.avi', '.mov', '.webm'].includes(fExt) && f.startsWith(baseVideoName);
          });
          if (existingVid) {
            const vidStat = await fs.stat(path.join(targetDir, existingVid));
            if (vidStat.size > 0) {
              videoAlreadyExists = true;
              outVideoPath = path.join(targetDir, existingVid);
            }
          }
        } catch (dirErr) {}
      }

      if (videoAlreadyExists) {
        log.info(`[exportDabberFiles] Video file already exists at ${outVideoPath}. Skipping re-encode/copy to preserve existing video.`);
        onProgress({ percent: videoProgressEnd });
      } else {
        if (skipConversion) {
          if (path.resolve(outVideoPath) !== path.resolve(episode.rawPath)) {
            onProgress({ percent: 0 });
            await copyLargeFile(episode.rawPath, outVideoPath, onProgress, 0, videoProgressEnd);
          } else {
            onProgress({ percent: videoProgressEnd });
          }
        } else if (episode.isHardsub) {
          await transcodeToMp4(episode.rawPath, outVideoPath, (p) => onProgress({ percent: (p / 100) * videoProgressEnd }), onCommand, { 
            useNvenc: config.useNvenc, 
            gpuIndex: config.gpuIndex,
            crf: 28,
            additionalProcessing
          });
        } else {
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
        characterAliases: project ? project.characterAliases : null,
        overwriteExisting: true
      });
      onProgress({ percent: 100 });
    }

    return { success: true, targetDir, yandexUrl: null };
  }

  /**
   * Fast probe of audio file size and duration (WAV header parser + ffprobe fallback).
   */
  static async probeAudioFileFast(filePath) {
    if (!filePath || !fsSync.existsSync(filePath)) {
      return { exists: false, sizeBytes: 0, durationSec: 0 };
    }
    let sizeBytes = 0;
    try {
      const st = await fs.stat(filePath);
      sizeBytes = st.size || 0;
    } catch (_) {}

    let durationSec = 0;
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.wav' && sizeBytes > 44) {
      try {
        const fh = await fs.open(filePath, 'r');
        try {
          const buf = Buffer.alloc(Math.min(4096, sizeBytes));
          const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
          if (bytesRead >= 44 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
            let offset = 12;
            let byteRate = 0;
            let dataSize = 0;
            while (offset + 8 <= bytesRead) {
              const chunkId = buf.toString('ascii', offset, offset + 4);
              const chunkSize = buf.readUInt32LE(offset + 4);
              if (chunkId === 'fmt ' && offset + 16 <= bytesRead) {
                byteRate = buf.readUInt32LE(offset + 8 + 8);
              } else if (chunkId === 'data') {
                dataSize = chunkSize;
                break;
              }
              offset += 8 + chunkSize + (chunkSize % 2);
            }
            if (byteRate > 0) {
              const effectiveData = dataSize > 0 && dataSize <= sizeBytes ? dataSize : Math.max(0, sizeBytes - 44);
              durationSec = Number((effectiveData / byteRate).toFixed(2));
            }
          }
        } finally {
          await fh.close();
        }
      } catch (_) {}
    }

    if (!durationSec || durationSec <= 0) {
      try {
        const { getVideoMetadata } = require('./ffmpegService.cjs');
        const meta = await getVideoMetadata(filePath);
        if (meta && meta.format && meta.format.duration) {
          const d = parseFloat(meta.format.duration);
          if (!isNaN(d) && d > 0) durationSec = Number(d.toFixed(2));
        }
      } catch (_) {}
    }

    return { exists: true, sizeBytes, durationSec };
  }

  /**
   * Builds a complete, canonical catalog of all dubber tracks and fix tracks for Sound Engineer export.
   * Ensures every track (Track 1, Track 2, Fix 1, etc.) gets a unique ID, well-formed export filename,
   * file size, and duration.
   */
  static async resolveSoundEngineerTrackCatalog(episode, projectsData = [], participantsData = [], config = {}) {
    if (!episode) return { baseVideoName: 'Episode_1', tracks: [] };

    const project = (projectsData || []).find(p => p.id === episode.projectId);
    const rawProjectTitle = project ? project.title : (episode.project?.title || 'Unknown');
    const projectTitle = sanitizeProjectTitle(rawProjectTitle);
    const baseVideoName = `${projectTitle}_${episode.number || 1}`;

    const epFromProject = project ? (project.episodes || []).find(e => e.number === episode.number || e.id === episode.id) : null;
    const assignments = (episode.assignments && episode.assignments.length > 0)
      ? episode.assignments
      : (epFromProject && epFromProject.assignments ? epFromProject.assignments : []);
    const episodeUploads = (episode.uploads && episode.uploads.length > 0)
      ? episode.uploads
      : (epFromProject && epFromProject.uploads ? epFromProject.uploads : []);

    const getNick = (id, upload) => {
      if (id && id !== 'unknown') {
        const p = (participantsData || []).find(part => part.id === id || String(part.id) === String(id));
        if (p && p.nickname) return p.nickname;
        if (Array.isArray(assignments)) {
          const as = assignments.find(a => a.dubberId === id || String(a.dubberId) === String(id) || a.substituteId === id || String(a.substituteId) === String(id) || a.id === id);
          if (as) {
            const nick = as.substitute?.nickname || as.dubber?.nickname || as.dubberName || as.dubberNick;
            if (nick) return nick;
          }
        }
      }
      if (upload) {
        if (upload.dubberNick) return upload.dubberNick;
        if (upload.dubberName) return upload.dubberName;
        if (upload.assignmentId && Array.isArray(assignments)) {
          const as = assignments.find(a => a.id === upload.assignmentId);
          if (as) {
            const nick = as.substitute?.nickname || as.dubber?.nickname || as.dubberName || as.dubberNick;
            if (nick) return nick;
          }
        }
      }
      if (id && id !== 'unknown' && !/^\d+$/.test(String(id)) && !String(id).startsWith('0.')) return String(id);
      if (upload?.fileName || upload?.path) {
        const fn = upload.fileName || path.basename(upload.path);
        return path.basename(fn, path.extname(fn))
          .replace(/\[?(фикс|fix|take|layer|дорожка|слой)\s*\d*\]?/gi, '')
          .replace(/^00_timed_/i, '')
          .trim() || 'Даббер';
      }
      return 'Даббер';
    };

    const dubberFiles = {};
    const seenPathsPerDubber = {};

    for (const upload of episodeUploads) {
      if (upload.type === 'DUBBER_FILE' || upload.type === 'FIXES') {
        if (!upload.path) continue;
        // Skip internal QA slice files
        const lowerPath = String(upload.path).toLowerCase();
        const lowerName = String(upload.fileName || path.basename(upload.path)).toLowerCase();
        if (lowerPath.includes('slice') || lowerName.includes('slice')) continue;

        const nick = getNick(upload.uploadedById || upload.participantId || upload.dubberId, upload);
        const safeGroupKey = sanitizeDubberNick(nick).toLowerCase() || String(upload.uploadedById || upload.participantId || upload.dubberId || nick);

        if (!dubberFiles[safeGroupKey]) {
          dubberFiles[safeGroupKey] = { allFiles: [], original: [], fixes: [], nick, dubberId: upload.uploadedById || upload.participantId || upload.dubberId || safeGroupKey };
          seenPathsPerDubber[safeGroupKey] = new Set();
        }

        const normPath = path.resolve(upload.path);
        const isFix = upload.type === 'FIXES' || upload.isFix === true;
        const dedupKey = `${normPath}__${isFix ? 'FIX' : 'ORIG'}`;
        if (seenPathsPerDubber[safeGroupKey].has(dedupKey)) continue;
        seenPathsPerDubber[safeGroupKey].add(dedupKey);

        dubberFiles[safeGroupKey].allFiles.push(upload);
      }
    }

    const catalogTracks = [];

    for (const groupKey of Object.keys(dubberFiles)) {
      const group = dubberFiles[groupKey];
      const nick = group.nick;
      const safeNick = sanitizeDubberNick(nick);

      const isExplicitFix = (f) => f.type === 'FIXES' || f.isFix === true;
      const rawOriginals = group.allFiles.filter(f => !isExplicitFix(f));
      const rawFixes = group.allFiles.filter(isExplicitFix);

      // Sort chronologically ascending so Track 1 is the first uploaded track, Track 2 is the second, etc.
      const sortedOriginals = [...rawOriginals].sort((a, b) => {
        const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tA - tB;
      });
      const sortedFixes = [...rawFixes].sort((a, b) => {
        const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tA - tB;
      });

      const probedOriginals = [];
      for (let oIdx = 0; oIdx < sortedOriginals.length; oIdx++) {
        const orig = sortedOriginals[oIdx];
        const probe = await ExportService.probeAudioFileFast(orig.path);
        const ext = path.extname(orig.path || orig.fileName || '.wav') || '.wav';
        const exportFileName = sortedOriginals.length === 1
          ? `${baseVideoName}_[${safeNick}]${ext}`
          : `${baseVideoName}_[${safeNick}]_дорожка${oIdx + 1}${ext}`;
        const roleLabel = sortedOriginals.length === 1
          ? 'Основная дорожка'
          : `Дорожка ${oIdx + 1}`;
        const trackId = String(orig.id || `${groupKey}_orig_${oIdx + 1}_${path.basename(orig.path)}`);

        const item = {
          id: trackId,
          uploadId: orig.id || null,
          dubberKey: groupKey,
          dubberId: group.dubberId,
          dubberNick: nick,
          safeNick,
          path: orig.path,
          fileName: orig.fileName || path.basename(orig.path),
          exportFileName,
          type: 'DUBBER_FILE',
          isFix: false,
          trackNumber: oIdx + 1,
          totalOriginalsForDubber: sortedOriginals.length,
          totalFixesForDubber: sortedFixes.length,
          roleLabel,
          sizeBytes: probe.sizeBytes || orig.size || 0,
          durationSec: probe.durationSec || 0,
          exists: probe.exists,
          isSnippetFix: false,
          recommendedSelected: probe.exists,
          rawUpload: orig
        };
        probedOriginals.push(item);
        catalogTracks.push(item);
      }

      const maxOrigSize = probedOriginals.reduce((max, item) => Math.max(max, item.sizeBytes || 0), 0);

      for (let fIdx = 0; fIdx < sortedFixes.length; fIdx++) {
        const fix = sortedFixes[fIdx];
        const probe = await ExportService.probeAudioFileFast(fix.path);
        const ext = path.extname(fix.path || fix.fileName || '.wav') || '.wav';
        const exportFileName = sortedFixes.length === 1
          ? `${baseVideoName}_[${safeNick}]_[фикс]${ext}`
          : `${baseVideoName}_[${safeNick}]_[фикс_${fIdx + 1}]${ext}`;
        const roleLabel = sortedFixes.length === 1
          ? 'Фикс'
          : `Фикс ${fIdx + 1}`;
        const trackId = String(fix.id || `${groupKey}_fix_${fIdx + 1}_${path.basename(fix.path)}`);
        const fixSize = probe.sizeBytes || fix.size || 0;
        const isSnippetFix = maxOrigSize > 0 && fixSize > 0 && fixSize < maxOrigSize * 0.75;

        catalogTracks.push({
          id: trackId,
          uploadId: fix.id || null,
          dubberKey: groupKey,
          dubberId: group.dubberId,
          dubberNick: nick,
          safeNick,
          path: fix.path,
          fileName: fix.fileName || path.basename(fix.path),
          exportFileName,
          type: 'FIXES',
          isFix: true,
          trackNumber: fIdx + 1,
          totalOriginalsForDubber: sortedOriginals.length,
          totalFixesForDubber: sortedFixes.length,
          roleLabel,
          sizeBytes: fixSize,
          durationSec: probe.durationSec || 0,
          exists: probe.exists,
          isSnippetFix,
          recommendedSelected: probe.exists,
          rawUpload: fix
        });
      }
    }

    return {
      baseVideoName,
      projectTitle,
      assignments,
      tracks: catalogTracks
    };
  }

  static async exportSoundEngineerFiles(paramsOrEpisode, maybeTargetDir, maybeSkipConv, maybeSmartExp, maybeAddProc, maybeAutoFix, maybeConfig, maybeProjectsData, maybeParticipantsData, maybeOnProgress, maybeOnCommand, maybeIncSubs, maybeAutoTiming) {
    let episode, targetDir, skipConversion, smartExport, additionalProcessing, autoApplyFixes, includeSubtitles, autoTiming, selectedTrackIds, config, projectsData, participantsData, onProgress, onCommand, opts;

    if (paramsOrEpisode && typeof paramsOrEpisode === 'object' && (paramsOrEpisode.episode || (!paramsOrEpisode.number && !paramsOrEpisode.id && paramsOrEpisode.targetDir))) {
      const p = paramsOrEpisode;
      episode = p.episode;
      targetDir = p.targetDir;
      opts = p.options || {};
      skipConversion = p.skipConversion ?? opts.skipConversion ?? false;
      smartExport = p.smartExport ?? opts.smartExport ?? false;
      additionalProcessing = p.additionalProcessing ?? opts.additionalProcessing ?? false;
      autoApplyFixes = p.autoApplyFixes ?? opts.autoApplyFixes ?? false;
      includeSubtitles = (p.includeSubtitles ?? opts.includeSubtitles) !== false;
      autoTiming = (p.autoTiming ?? opts.autoTiming) === true;
      selectedTrackIds = p.selectedTrackIds ?? opts.selectedTrackIds ?? null;
      config = p.config || {};
      projectsData = p.projectsData || [];
      participantsData = p.participantsData || [];
      onProgress = p.onProgress;
      onCommand = p.onCommand;
    } else {
      // Positional args fallback
      opts = {};
      episode = paramsOrEpisode;
      targetDir = maybeTargetDir;
      skipConversion = maybeSkipConv;
      smartExport = maybeSmartExp;
      additionalProcessing = maybeAddProc;
      autoApplyFixes = maybeAutoFix;
      config = maybeConfig;
      projectsData = maybeProjectsData;
      participantsData = maybeParticipantsData;
      onProgress = maybeOnProgress;
      onCommand = maybeOnCommand;
      includeSubtitles = maybeIncSubs !== false;
      autoTiming = maybeAutoTiming === true;
      selectedTrackIds = null;

      // Handle legacy signature where autoApplyFixes was omitted
      if (typeof autoApplyFixes === 'object' && !projectsData) {
        includeSubtitles = typeof onCommand === 'boolean' ? onCommand : true;
        onCommand = onProgress;
        onProgress = participantsData;
        participantsData = projectsData;
        projectsData = config;
        config = autoApplyFixes;
        autoApplyFixes = false;
        autoTiming = false;
      }
    }

    if (!episode || !targetDir) throw new Error('Missing required parameters');
    targetDir = sanitizePath(targetDir);
    await fs.mkdir(targetDir, { recursive: true });

    const project = (projectsData || []).find(p => p.id === episode.projectId);
    const rawProjectTitle = project ? project.title : 'Unknown';
    const projectTitle = sanitizeProjectTitle(rawProjectTitle);
    const baseVideoName = `${projectTitle}_${episode.number}`;

    const epFromProject = project ? (project.episodes || []).find(e => e.number === episode.number || e.id === episode.id) : null;
    const assignments = (episode.assignments && episode.assignments.length > 0)
      ? episode.assignments
      : (epFromProject && epFromProject.assignments ? epFromProject.assignments : []);

    const logs = [];
    const logFilePath = path.join(targetDir, 'ЭКСПОРТ_ЛОГ.txt');

    const logStep = async (message, level = 'info', percent = null) => {
      const timeStr = new Date().toLocaleTimeString('ru-RU');
      const prefix = level === 'error' ? '❌ [ОШИБКА]' : (level === 'warn' ? '⚠️ [ВНИМАНИЕ]' : (level === 'success' ? '✅ [УСПЕХ]' : 'ℹ️ [ИНФО]'));
      const line = `[${timeStr}] ${prefix} ${message}`;
      logs.push(line);
      log[level === 'error' ? 'error' : (level === 'warn' ? 'warn' : 'info')](line);
      try {
        await fs.appendFile(logFilePath, line + '\n');
      } catch (e) {}
      if (onProgress) {
        onProgress({
          percent: percent !== null ? percent : undefined,
          log: line,
          logs,
          message
        });
      }
    };

    // Initialize log file
    const logHeader = `============================================================\n` +
      `  ПОДРОБНЫЙ ЖУРНАЛ ЭКСПОРТА ДЛЯ ЗВУКОРЕЖИССЕРА\n` +
      `  Проект: ${projectTitle} | Серия: ${episode.number}\n` +
      `  Дата и время запуска: ${new Date().toLocaleString('ru-RU')}\n` +
      `  Параметры: автотайминг=${autoTiming}, вшитие фиксов=${autoApplyFixes}, умная сортировка=${smartExport}, общие сабы=${includeSubtitles}, пропуск конвертации видео=${skipConversion}\n` +
      `============================================================\n\n`;
    await fs.writeFile(logFilePath, logHeader, 'utf-8');

    await logStep(`Запуск экспорта материалов звукорежиссеру в директорию: ${targetDir}`, 'info', 0);

    try {
      // 1. Экспорт общих субтитров с размеченными дабберами для звукорежиссера
      if (includeSubtitles !== false && episode.subPath) {
        await logStep(`[Субтитры] Экспорт общих субтитров с подстановкой никнеймов дабберов...`, 'info', 5);
        const ext = path.extname(episode.subPath);
        const generalSubName = `${baseVideoName}_[субтитры_общие]${ext}`;
        const outSubPath = path.join(targetDir, generalSubName);
        try {
          await exportFullAssWithRoles(
            episode.subPath,
            outSubPath,
            assignments,
            participantsData,
            project ? project.characterAliases : null
          );
          await logStep(`[Субтитры] Успешно экспортированы: ${generalSubName}`, 'success', 10);
        } catch (subErr) {
          await logStep(`[Субтитры] Ошибка экспорта субтитров: ${subErr.message}`, 'error', 10);
        }
      }

      // 2. Обработка видеофайла
      if (episode.rawPath) {
        await logStep(`[Видео] Обработка видеофайла: ${path.basename(episode.rawPath)}`, 'info', 12);
        const videoName = path.basename(episode.rawPath);
        const ext = path.extname(videoName);
        
        if (skipConversion) {
          await logStep('[Видео] Режим: прямое копирование оригинала без конвертации.', 'info', 14);
          let outVideoPath = path.join(targetDir, `${baseVideoName}[оригинал]${ext}`);
          if (path.resolve(outVideoPath) !== path.resolve(episode.rawPath)) {
            await copyLargeFile(episode.rawPath, outVideoPath, (p) => {
              if (onProgress) onProgress({ percent: 14 + (p.percent / 100) * 16 });
            }, 0, 100);
            await logStep(`[Видео] Копирование оригинала завершено: ${path.basename(outVideoPath)}`, 'success', 30);
          } else {
            await logStep('[Видео] Исходный путь совпадает с целевым, копирование пропущено.', 'info', 30);
          }
        } else if (episode.isHardsub) {
          const markedVideoPath = path.join(targetDir, `${baseVideoName}_[хардсаб]${ext}`);
          if (additionalProcessing) {
            await logStep('[Видео] Хардсаб с дополнительной постобработкой (транскодирование)...', 'info', 14);
            await transcodeToMp4(episode.rawPath, markedVideoPath, (p) => {
              if (onProgress) onProgress({ percent: 14 + (p / 100) * 16 });
            }, onCommand, { 
              useNvenc: config.useNvenc, 
              gpuIndex: config.gpuIndex,
              crf: 18,
              additionalProcessing
            });
            await logStep(`[Видео] Транскодирование хардсаба завершено: ${path.basename(markedVideoPath)}`, 'success', 30);
          } else {
            await logStep('[Видео] Прямое копирование хардсаб-видео...', 'info', 14);
            await copyLargeFile(episode.rawPath, markedVideoPath, (p) => {
              if (onProgress) onProgress({ percent: 14 + (p.percent / 100) * 16 });
            }, 0, 100);
            await logStep(`[Видео] Копирование завершено: ${path.basename(markedVideoPath)}`, 'success', 30);
          }
        } else {
          let hasSigns = false;
          let signsAssPath = null;
          if (episode.subPath) {
            signsAssPath = path.join(targetDir, `temp_signs_${Date.now()}.ass`);
            hasSigns = await extractSignsAss(episode.subPath, signsAssPath);
            await logStep(`[Видео] Проверка надписей в ASS: обнаружено = ${hasSigns ? 'Да' : 'Нет'}`, 'info', 15);
          }
          
          const suffix = hasSigns ? '_[с надписями]' : (additionalProcessing ? '_[обработка]' : '[копия]');
          const bakedVideoPath = path.join(targetDir, `${baseVideoName}${suffix}${ext}`);

          if (hasSigns) {
            await logStep('[Видео] Вшитие надписей (знаков) в видео...', 'info', 16);
            await bakeSubtitles(episode.rawPath, signsAssPath, bakedVideoPath, (p) => {
              if (onProgress) onProgress({ percent: 16 + (p / 100) * 14 });
            }, onCommand, { 
              useNvenc: config.useNvenc, 
              gpuIndex: config.gpuIndex,
              crf: 18,
              additionalProcessing
            });
            await logStep(`[Видео] Вшитие надписей завершено: ${path.basename(bakedVideoPath)}`, 'success', 30);
            await fs.unlink(signsAssPath).catch(() => {});
          } else if (additionalProcessing) {
            await logStep('[Видео] Транскодирование видео с дополнительной обработкой...', 'info', 16);
            await transcodeToMp4(episode.rawPath, bakedVideoPath, (p) => {
              if (onProgress) onProgress({ percent: 16 + (p / 100) * 14 });
            }, onCommand, { 
              useNvenc: config.useNvenc, 
              gpuIndex: config.gpuIndex,
              crf: 18,
              additionalProcessing
            });
            await logStep(`[Видео] Транскодирование завершено: ${path.basename(bakedVideoPath)}`, 'success', 30);
            if (signsAssPath) await fs.unlink(signsAssPath).catch(() => {});
          } else {
            await logStep('[Видео] Прямое копирование исходного видео...', 'info', 16);
            await copyLargeFile(episode.rawPath, bakedVideoPath, (p) => {
              if (onProgress) onProgress({ percent: 16 + (p.percent / 100) * 14 });
            }, 0, 100);
            await logStep(`[Видео] Копирование видео завершено: ${path.basename(bakedVideoPath)}`, 'success', 30);
            if (signsAssPath) await fs.unlink(signsAssPath).catch(() => {});
          }
        }
      } else {
        await logStep('[Видео] Исходный видеофайл отсутствует в серии, видео-этап пропущен.', 'info', 30);
      }

      // Build canonical track catalog (Track 1, Track 2, Fixes, etc.)
      const catalog = await ExportService.resolveSoundEngineerTrackCatalog(
        episode,
        projectsData,
        participantsData,
        config
      );

      let activeTracks = catalog.tracks.filter(t => t.exists);
      if (Array.isArray(selectedTrackIds) && selectedTrackIds.length > 0) {
        const selectedSet = new Set(selectedTrackIds.map(id => String(id)));
        activeTracks = activeTracks.filter(t =>
          selectedSet.has(String(t.id)) ||
          selectedSet.has(String(t.uploadId)) ||
          selectedSet.has(String(t.path)) ||
          selectedSet.has(String(t.exportFileName))
        );
        await logStep(`[Выбор дорожек] Пользователем выбрано дорожек для экспорта: ${activeTracks.length} из ${catalog.tracks.length}`, 'info', 31);
      } else {
        await logStep(`[Выбор дорожек] Найдено дорожек для экспорта: ${activeTracks.length}`, 'info', 31);
      }

      // ----------------------------------------------------
      // AUDIO PROCESSING PIPELINE FOR SOUND ENGINEER
      // ----------------------------------------------------
      if (autoTiming && episode.subPath) {
        await logStep(`[АУДИО-КОНВЕЙЕР: АВТОТАЙМИНГ И ВШИТИЕ ФИКСОВ] Запуск конвейера тайминга и сведения...`, 'info', 32);

        const rawDubberUploads = activeTracks.map(t => ({
          ...t.rawUpload,
          path: t.path,
          dubberNick: t.dubberNick,
          exportFileName: t.exportFileName
        }));
        await logStep(`[Бэкап] Сохранение ${activeTracks.length} выбранных исходных дорожек до автотайминга в «бэкап»...`, 'info', 33);

        const rawBackupDir = path.join(targetDir, 'бэкап', 'исходные_дорожки_до_автотайминга');
        await fs.mkdir(rawBackupDir, { recursive: true });
        for (let bIdx = 0; bIdx < activeTracks.length; bIdx++) {
          const tr = activeTracks[bIdx];
          try {
            await fs.copyFile(tr.path, path.join(rawBackupDir, tr.exportFileName));
            await logStep(`[Бэкап] Сохранен оригинал: ${tr.exportFileName}`, 'info');
          } catch (e) {
            await logStep(`[Бэкап] Не удалось скопировать файл в бэкап: ${tr.path} (${e.message})`, 'warn');
          }
        }
        await logStep(`[Бэкап] Все исходные дорожки сохранены в резервной папке.`, 'success', 38);

        // Сопоставление персонажей и аудиодорожек
        await logStep(`[Автотайминг] Сопоставление дорожек дабберов с персонажами из субтитров...`, 'info', 40);
        const matchResult = await AutoTimingService.matchActorsWithAudioTracks(
          episode.subPath,
          rawDubberUploads,
          participantsData,
          project ? project.characterAliases : null,
          assignments
        );

        for (const m of matchResult.matchedTracks) {
          await logStep(`[Сопоставление] Дорожка: ${path.basename(m.trackPath)} -> Даббер: «${m.dubberNick}» | Роль: «${m.characterName}» (метод: ${m.matchMethod})`, 'info');
        }

        if (matchResult.matchedTracks.length > 0) {
          // Шаг 1: Автотайминг фраз и глобальное разведение коллизий
          await logStep(`[Автотайминг] Детекция речевых пауз и выравнивание тайминга для ${matchResult.matchedTracks.length} дорожек...`, 'info', 45);
          const timingResult = await AutoTimingService.alignProjectAndResolveCollisions({
            subPath: episode.subPath,
            matchedTracks: matchResult.matchedTracks,
            options: { minGapSec: 0.12, leadInSec: 0.05 }
          });

          await logStep(`[Коллизии] Разведение перекрытий завершено: обнаружено ${timingResult.stats.totalCollisionsFound}, успешно разведено ${timingResult.stats.totalCollisionsResolved}`, 'success', 60);

          // Шаг 2: Вшитие фиксов без хвостов и выравнивание удлиненных дублей
          await logStep(`[Вшитие фиксов] Объединение фиксов с оригинальными дорожками, полное удаление хвостов и сдвиг перекрытий...`, 'info', 65);
          const mergedResult = AutoTimingService.smartApplyFixesToTimedTracks(timingResult, {
            minGapSec: 0.12
          });

          await logStep(`[Вшитие фиксов] Вшито фраз фиксов: ${mergedResult.fixStats?.fixesAppliedCount || 0}, удалено хвостов: ${mergedResult.fixStats?.leftoverTailsCleanedCount || 0}, сдвигов удлиненных дублей: ${mergedResult.fixStats?.longerFixCollisionsAdjustedCount || 0}`, 'success', 70);

          // Шаг 3: Сборка и экспорт финальных дорожек
          await logStep(`[Рендеринг] Сборка и вывод готовых оттаймленных аудиодорожек в папку экспорта...`, 'info', 72);
          await AutoTimingService.renderAutoTimedTracks(
            mergedResult, 
            targetDir, 
            baseVideoName, 
            { targetDir }, 
            onProgress, 
            logStep
          );

          // Ensure any selected track that was not part of matchedTracks (e.g. extra layer / secondary track) is also copied so nothing is lost
          const matchedPaths = new Set(matchResult.matchedTracks.map(m => path.resolve(m.trackPath)));
          for (const tr of activeTracks) {
            if (!matchedPaths.has(path.resolve(tr.path))) {
              const outExtraPath = path.join(targetDir, tr.exportFileName);
              if (!fsSync.existsSync(outExtraPath)) {
                await fs.copyFile(tr.path, outExtraPath);
                await logStep(`[Доп. дорожка] Скопирована выбранная дорожка: ${tr.exportFileName}`, 'info');
              }
            }
          }

          await logStep(`[Конвейер] Конвейер автотайминга и сведения успешно выполнен для всех файлов!`, 'success', 98);
        } else {
          await logStep(`[Предупреждение] Не удалось сопоставить ни одной дорожки в автотайминге. Выполняется прямое копирование всех выбранных дорожек...`, 'warn', 70);
          for (const tr of activeTracks) {
            const targetPath = path.join(targetDir, tr.exportFileName);
            await fs.copyFile(tr.path, targetPath);
            await logStep(`[Копирование] Экспортирован файл: ${tr.exportFileName}`, 'info');
          }
        }
      } else {
        // 2. СТАНДАРТНЫЙ ЭКСПОРТ (Строго по выбранным дорожкам дабберов без потери слоев)
        await logStep(`[АУДИО-КОНВЕЙЕР: СТАНДАРТНЫЙ ЭКСПОРТ] Выгрузка выбранных дорожек дабберов (${activeTracks.length} шт.)...`, 'info', 35);

        // Group active tracks by dubberKey
        const tracksByDubber = {};
        for (const tr of activeTracks) {
          if (!tracksByDubber[tr.dubberKey]) {
            tracksByDubber[tr.dubberKey] = {
              nick: tr.dubberNick,
              safeNick: tr.safeNick,
              dubberId: tr.dubberId,
              originals: [],
              fixes: []
            };
          }
          if (tr.isFix) {
            tracksByDubber[tr.dubberKey].fixes.push(tr);
          } else {
            tracksByDubber[tr.dubberKey].originals.push(tr);
          }
        }

        const dubberKeys = Object.keys(tracksByDubber);
        let dIdx = 0;

        for (const dKey of dubberKeys) {
          dIdx++;
          const group = tracksByDubber[dKey];
          const { nick, originals, fixes, dubberId } = group;
          const dubberPercent = 35 + Math.round((dIdx / Math.max(1, dubberKeys.length)) * 58);

          // Case A: User explicitly enabled autoApplyFixes AND dubber has 1 original + 1 fragmentary snippet fix
          if (autoApplyFixes && originals.length === 1 && fixes.length === 1 && fixes[0].isSnippetFix) {
            const origTrack = originals[0];
            const fixTrack = fixes[0];
            try {
              await logStep(`[Фикс] Даббер «${nick}»: сведение фрагментарного фикса (${(fixTrack.sizeBytes / (1024*1024)).toFixed(2)} МБ) с основной дорожкой...`, 'info', dubberPercent);
              const backupDir = path.join(targetDir, 'бэкап');
              await fs.mkdir(backupDir, { recursive: true });

              await fs.copyFile(origTrack.path, path.join(backupDir, origTrack.exportFileName));
              await fs.copyFile(fixTrack.path, path.join(backupDir, fixTrack.exportFileName));

              const mainOutPath = path.join(targetDir, origTrack.exportFileName);

              let targetSec = undefined;
              const dubberAssignments = (assignments || []).filter(a => a.dubberId === dubberId || a.substituteId === dubberId);
              for (const a of dubberAssignments) {
                if (a.comments) {
                  try {
                    const comments = JSON.parse(a.comments);
                    if (Array.isArray(comments) && comments.length > 0 && comments[0].timestamp !== undefined) {
                      targetSec = comments[0].timestamp;
                    }
                  } catch (e) {}
                }
              }

              const result = await applyFixesToOriginalAudio(origTrack.path, fixTrack.path, mainOutPath, { targetSec });

              const reportPath = path.join(backupDir, 'ИНФО_О_ФИКСАХ.txt');
              const intervalsText = result.intervals && result.intervals.length > 0
                ? result.intervals.map(i => `  • ${i.startSec.toFixed(2)} сек — ${i.endSec.toFixed(2)} сек (длительность ${i.durationSec.toFixed(2)} сек)`).join('\n')
                : '  • Сведение дорожки фикса с оригиналом\n';
              const reportEntry = `[${new Date().toLocaleString()}] Даббер: ${nick}\n` +
                `Файл оригинала: ${origTrack.fileName} (${(origTrack.sizeBytes / (1024 * 1024)).toFixed(2)} МБ)\n` +
                `Файл фикса: ${fixTrack.fileName} (${(fixTrack.sizeBytes / (1024 * 1024)).toFixed(2)} МБ)\n` +
                `Примененные фразы фиксов:\n${intervalsText}\n` +
                `Резервные копии сохранены в этой папке («бэкап»), а готовая дорожка с вшитыми фиксами помещена в основную папку экспорта.\n` +
                `------------------------------------------------------------\n\n`;
              await fs.appendFile(reportPath, reportEntry).catch(() => {});

              await logStep(`[Фикс] Успешно сведен фикс даббера «${nick}» -> ${origTrack.exportFileName}`, 'success', dubberPercent);
            } catch (e) {
              await logStep(`[Ошибка] Сбой авто-сведения фикса даббера «${nick}»: ${e.message}. Экспортируем обе дорожки раздельно.`, 'warn', dubberPercent);
              await fs.copyFile(origTrack.path, path.join(targetDir, origTrack.exportFileName));
              await fs.copyFile(fixTrack.path, path.join(targetDir, fixTrack.exportFileName));
            }
          } else {
            // Standard rock-solid export: export EVERY selected original track and EVERY selected fix track with its unique filename!
            for (const origTrack of originals) {
              const origOut = path.join(targetDir, origTrack.exportFileName);
              await fs.copyFile(origTrack.path, origOut);
              await logStep(
                `[Экспорт] ${origTrack.roleLabel} даббера «${nick}»: ${origTrack.exportFileName} (${(origTrack.sizeBytes / (1024 * 1024)).toFixed(2)} МБ)`,
                'success',
                dubberPercent
              );
            }

            for (const fixTrack of fixes) {
              const fixOut = path.join(targetDir, fixTrack.exportFileName);
              await fs.copyFile(fixTrack.path, fixOut);
              await logStep(
                `[Экспорт] ${fixTrack.roleLabel} даббера «${nick}»: ${fixTrack.exportFileName} (${(fixTrack.sizeBytes / (1024 * 1024)).toFixed(2)} МБ)`,
                'success',
                dubberPercent
              );
            }
          }
        }
      }

      // 4. Экспорт разделенных стемов оригинала (Vocals & M&E)
      const stemsOption = (paramsOrEpisode && typeof paramsOrEpisode === 'object' && paramsOrEpisode.originalStems) || (opts && opts.originalStems);
      let vocalsStemPath = stemsOption?.vocalsPath;
      let meStemPath = stemsOption?.instrumentalPath;

      if (!vocalsStemPath || !meStemPath) {
        try {
          const MixingPipelineService = require('./MixingPipelineService.cjs');
          const baseDir = (config && config.baseDir) ? config.baseDir : (app?.getPath ? app.getPath('userData') : process.cwd());
          const epDir = MixingPipelineService.getEpisodeDir(episode, baseDir);
          const candVocals = path.join(epDir, 'Тайминг', 'stems', 'original_vocals.wav');
          const candME = path.join(epDir, 'Тайминг', 'stems', 'original_instrumental.wav');
          if (fsSync.existsSync(candVocals) && (!vocalsStemPath || !fsSync.existsSync(vocalsStemPath))) {
            vocalsStemPath = candVocals;
          }
          if (fsSync.existsSync(candME) && (!meStemPath || !fsSync.existsSync(meStemPath))) {
            meStemPath = candME;
          }
        } catch (e) {}
      }

      const ffmpeg = require('fluent-ffmpeg');
      const outStemExt = skipConversion ? '.wav' : '.flac';

      if (vocalsStemPath && fsSync.existsSync(vocalsStemPath)) {
        await logStep(`[Стемы оригинала] Экспорт изолированных голосов оригинала (${outStemExt.toUpperCase()})...`, 'info', 95);
        const vocalsOutName = `${baseVideoName}_[00_Голоса_оригинала_Vocals]${outStemExt}`;
        const vocalsOutPath = path.join(targetDir, vocalsOutName);
        try {
          if (outStemExt === '.flac') {
            await new Promise((resolve, reject) => {
              ffmpeg(vocalsStemPath)
                .noVideo()
                .audioCodec('flac')
                .audioFrequency(48000)
                .output(vocalsOutPath)
                .on('end', resolve)
                .on('error', async (err) => {
                  log.warn('[ExportService] FLAC convert error for vocals, fallback to copy:', err.message);
                  await fs.copyFile(vocalsStemPath, path.join(targetDir, `${baseVideoName}_[00_Голоса_оригинала_Vocals].wav`));
                  resolve();
                })
                .run();
            });
          } else {
            await fs.copyFile(vocalsStemPath, vocalsOutPath);
          }
          await logStep(`[Стемы оригинала] Голоса оригинала экспортированы: ${vocalsOutName}`, 'success', 97);
        } catch (stemErr) {
          await logStep(`[Стемы оригинала] Не удалось экспортировать вокал: ${stemErr.message}`, 'warn', 97);
        }
      }

      if (meStemPath && fsSync.existsSync(meStemPath)) {
        await logStep(`[Стемы оригинала] Экспорт фонограммы M&E (${outStemExt.toUpperCase()})...`, 'info', 98);
        const meOutName = `${baseVideoName}_[00_Фон_оригинала_ME]${outStemExt}`;
        const meOutPath = path.join(targetDir, meOutName);
        try {
          if (outStemExt === '.flac') {
            await new Promise((resolve, reject) => {
              ffmpeg(meStemPath)
                .noVideo()
                .audioCodec('flac')
                .audioFrequency(48000)
                .output(meOutPath)
                .on('end', resolve)
                .on('error', async (err) => {
                  log.warn('[ExportService] FLAC convert error for ME, fallback to copy:', err.message);
                  await fs.copyFile(meStemPath, path.join(targetDir, `${baseVideoName}_[00_Фон_оригинала_ME].wav`));
                  resolve();
                })
                .run();
            });
          } else {
            await fs.copyFile(meStemPath, meOutPath);
          }
          await logStep(`[Стемы оригинала] Фонограмма M&E экспортирована: ${meOutName}`, 'success', 99);
        } catch (stemErr) {
          await logStep(`[Стемы оригинала] Не удалось экспортировать фон M&E: ${stemErr.message}`, 'warn', 99);
        }
      }

      await logStep(`🎉 Все материалы для звукорежиссера успешно экспортированы!`, 'success', 100);
      return { success: true, targetDir, logFilePath, yandexUrl: null };
    } catch (fatalErr) {
      await logStep(`Фатальная ошибка при экспорте: ${fatalErr.message}\n${fatalErr.stack || ''}`, 'error');
      throw fatalErr;
    }
  }

  static async buildRelease(paramsOrEpisode, maybeTargetDir, maybeCustomAudio, maybeCustomRaw, maybeOnProgress, maybeOnCommand) {
    let episode, targetDir, customAudioPath, customRawPath, onProgress, onCommand;

    if (paramsOrEpisode && typeof paramsOrEpisode === 'object' && (paramsOrEpisode.episode || (!paramsOrEpisode.number && !paramsOrEpisode.id && paramsOrEpisode.targetDir))) {
      const p = paramsOrEpisode;
      episode = p.episode;
      targetDir = p.targetDir;
      customAudioPath = p.customAudioPath;
      customRawPath = p.customRawPath;
      onProgress = p.onProgress;
      onCommand = p.onCommand;
    } else {
      episode = paramsOrEpisode;
      targetDir = maybeTargetDir;
      customAudioPath = maybeCustomAudio;
      customRawPath = maybeCustomRaw;
      onProgress = maybeOnProgress;
      onCommand = maybeOnCommand;
    }

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
