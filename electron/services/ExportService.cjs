const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const log = require('electron-log');
const { bakeSubtitles, transcodeToMp4, muxRelease, applyFixesToOriginalAudio } = require('./ffmpegService.cjs');
const { splitSubsByDubber, extractSignsAss, exportFullAssWithRoles } = require('./subtitleService.cjs');
const AutoTimingService = require('./AutoTimingService.cjs');

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

  static async exportSoundEngineerFiles(episode, targetDir, skipConversion, smartExport, additionalProcessing, autoApplyFixes, config, projectsData, participantsData, onProgress, onCommand, includeSubtitles = true, autoTiming = false) {
    if (!episode || !targetDir) throw new Error('Missing required parameters');

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

    await fs.mkdir(targetDir, { recursive: true });

    const project = (projectsData || []).find(p => p.id === episode.projectId);
    const projectTitle = project ? project.title : 'Unknown';
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

      const dubberFiles = {};
      for (const upload of (episode.uploads || [])) {
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

      // ----------------------------------------------------
      // AUDIO PROCESSING PIPELINE FOR SOUND ENGINEER
      // ----------------------------------------------------
      if (autoTiming && episode.subPath) {
        await logStep(`[АУДИО-КОНВЕЙЕР: АВТОТАЙМИНГ И ВШИТИЕ ФИКСОВ] Запуск конвейера тайминга и сведения...`, 'info', 32);

        const rawDubberUploads = (episode.uploads || []).filter(u => u.type === 'DUBBER_FILE' || u.type === 'FIXES');
        await logStep(`[Бэкап] Сохранение ${rawDubberUploads.length} исходных дорожек до автотайминга в «бэкап»...`, 'info', 33);

        const rawBackupDir = path.join(targetDir, 'бэкап', 'исходные_дорожки_до_автотайминга');
        await fs.mkdir(rawBackupDir, { recursive: true });
        for (let bIdx = 0; bIdx < rawDubberUploads.length; bIdx++) {
          const u = rawDubberUploads[bIdx];
          try {
            const isFix = u.type === 'FIXES';
            const backupFilename = getExportName(u, isFix);
            await fs.copyFile(u.path, path.join(rawBackupDir, backupFilename));
            await logStep(`[Бэкап] Сохранен оригинал: ${backupFilename}`, 'info');
          } catch (e) {
            await logStep(`[Бэкап] Не удалось скопировать файл в бэкап: ${u.path} (${e.message})`, 'warn');
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
            {}, 
            onProgress, 
            logStep
          );
          await logStep(`[Конвейер] Конвейер автотайминга и сведения успешно выполнен для всех файлов!`, 'success', 98);
        } else {
          await logStep(`[Предупреждение] Не удалось сопоставить ни одной дорожки в автотайминге. Выполняется стандартное резервное копирование файлов...`, 'warn', 70);
          for (const u of rawDubberUploads) {
            const isFix = u.type === 'FIXES';
            const targetPath = path.join(targetDir, getExportName(u, isFix));
            await fs.copyFile(u.path, targetPath);
            await logStep(`[Копирование] Экспортирован файл: ${path.basename(targetPath)}`, 'info');
          }
        }
      } else {
        // 2. СТАНДАРТНЫЙ ЭКСПОРТ (Без автотайминга или без субтитров)
        await logStep(`[АУДИО-КОНВЕЙЕР: СТАНДАРТНЫЙ ЭКСПОРТ] Обработка дорожек дабберов...`, 'info', 35);

        const totalDubbers = Object.keys(dubberFiles).length;
        let dIdx = 0;

        for (const dubberId in dubberFiles) {
          dIdx++;
          const nick = getNick(dubberId);
          const { original, fixes } = dubberFiles[dubberId];
          const latestOriginal = original.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
          const latestFix = fixes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

          const dubberPercent = 35 + Math.round((dIdx / Math.max(1, totalDubbers)) * 60);

          if (autoApplyFixes && latestOriginal && latestFix) {
            try {
              const origStat = await fs.stat(latestOriginal.path);
              const fixStat = await fs.stat(latestFix.path);

              if (fixStat.size < origStat.size) {
                await logStep(`[Фикс] Даббер «${nick}»: фрагментарный фикс (${(fixStat.size / (1024*1024)).toFixed(2)} МБ < ${(origStat.size / (1024*1024)).toFixed(2)} МБ). Сведение с оригиналом...`, 'info', dubberPercent);
                const backupDir = path.join(targetDir, 'бэкап');
                await fs.mkdir(backupDir, { recursive: true });

                await fs.copyFile(latestOriginal.path, path.join(backupDir, getExportName(latestOriginal, false)));
                await fs.copyFile(latestFix.path, path.join(backupDir, getExportName(latestFix, true)));

                const mainOutPath = path.join(targetDir, getExportName(latestOriginal, false));

                let targetSec = undefined;
                const dubberAssignments = (episode.assignments || []).filter(a => a.dubberId === dubberId || a.substituteId === dubberId);
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

                const result = await applyFixesToOriginalAudio(latestOriginal.path, latestFix.path, mainOutPath, { targetSec });

                const reportPath = path.join(backupDir, 'ИНФО_О_ФИКСАХ.txt');
                const intervalsText = result.intervals && result.intervals.length > 0
                  ? result.intervals.map(i => `  • ${i.startSec.toFixed(2)} сек — ${i.endSec.toFixed(2)} сек (длительность ${i.durationSec.toFixed(2)} сек)`).join('\n')
                  : '  • Сведение дорожки фикса с оригиналом\n';
                const reportEntry = `[${new Date().toLocaleString()}] Даббер: ${nick}\n` +
                  `Файл оригинала: ${path.basename(latestOriginal.path)} (${(origStat.size / (1024 * 1024)).toFixed(2)} МБ)\n` +
                  `Файл фикса: ${path.basename(latestFix.path)} (${(fixStat.size / (1024 * 1024)).toFixed(2)} МБ)\n` +
                  `Примененные фразы фиксов:\n${intervalsText}\n` +
                  `Резервные копии сохранены в этой папке («бэкап»), а готовая дорожка с вшитыми фиксами помещена в основную папку экспорта.\n` +
                  `------------------------------------------------------------\n\n`;
                await fs.appendFile(reportPath, reportEntry).catch(() => {});

                await logStep(`[Фикс] Успешно сведен фикс даббера «${nick}» -> ${path.basename(mainOutPath)}`, 'success', dubberPercent);
              } else {
                await logStep(`[Фикс] Даббер «${nick}»: фикс заменяет всю дорожку целиком. Экспорт дорожки фикса.`, 'info', dubberPercent);
                const targetFixPath = path.join(targetDir, getExportName(latestFix, true));
                await fs.copyFile(latestFix.path, targetFixPath);
                await logStep(`[Экспорт] Скопирован фикс: ${path.basename(targetFixPath)}`, 'success', dubberPercent);
              }
            } catch (e) {
              await logStep(`[Ошибка] Сбой авто-сведения фикса даббера «${nick}»: ${e.message}. Выполняется резервное копирование обоих файлов.`, 'warn', dubberPercent);
              const targetOrigPath = path.join(targetDir, getExportName(latestOriginal, false));
              await fs.copyFile(latestOriginal.path, targetOrigPath);
              if (latestFix) {
                await fs.copyFile(latestFix.path, path.join(targetDir, getExportName(latestFix, true)));
              }
            }
          } else if (smartExport && latestOriginal && latestFix) {
            try {
              const origStat = await fs.stat(latestOriginal.path);
              const fixStat = await fs.stat(latestFix.path);

              if (fixStat.size < origStat.size) {
                const origOut = path.join(targetDir, getExportName(latestOriginal, false));
                await fs.copyFile(latestOriginal.path, origOut);
                await fs.copyFile(latestFix.path, path.join(targetDir, getExportName(latestFix, true)));
                await logStep(`[Умный экспорт] Даббер «${nick}»: экспортированы оригинал и фикс.`, 'info', dubberPercent);
              } else {
                const fixOut = path.join(targetDir, getExportName(latestFix, true));
                await fs.copyFile(latestFix.path, fixOut);
                await logStep(`[Умный экспорт] Даббер «${nick}»: фикс заменяет оригинал (экспортирован только фикс).`, 'info', dubberPercent);
              }
            } catch (e) {
              await logStep(`[Умный экспорт] Ошибка оценки файлов «${nick}»: ${e.message}`, 'warn', dubberPercent);
              const origOut = path.join(targetDir, getExportName(latestOriginal, false));
              await fs.copyFile(latestOriginal.path, origOut);
              if (latestFix) await fs.copyFile(latestFix.path, path.join(targetDir, getExportName(latestFix, true)));
            }
          } else {
            if (latestOriginal) {
              const origOut = path.join(targetDir, getExportName(latestOriginal, false));
              await fs.copyFile(latestOriginal.path, origOut);
              await logStep(`[Экспорт] Дорожка даббера «${nick}» экспортирована: ${path.basename(origOut)}`, 'info', dubberPercent);
            }
            if (latestFix) {
              const fixOut = path.join(targetDir, getExportName(latestFix, true));
              await fs.copyFile(latestFix.path, fixOut);
              await logStep(`[Экспорт] Дорожка фикса «${nick}» экспортирована: ${path.basename(fixOut)}`, 'info', dubberPercent);
            }
          }
        }
      }

      await logStep(`🎉 Все материалы для звукорежиссера успешно экспортированы!`, 'success', 100);
      return { success: true, targetDir, logFilePath, yandexUrl: null };
    } catch (fatalErr) {
      await logStep(`Фатальная ошибка при экспорте: ${fatalErr.message}\n${fatalErr.stack || ''}`, 'error');
      throw fatalErr;
    }
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
