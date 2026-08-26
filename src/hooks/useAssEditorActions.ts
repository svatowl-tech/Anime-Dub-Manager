import { Episode, RoleAssignment, Participant } from '../types';
import { ipcSafe } from '../lib/ipcSafe';
import { SIGN_KEYWORDS } from '../constants';
import { useAssEditorState } from './useAssEditorState';
import { latinToCyrillic, polivanovToHepburn } from '../lib/translit';
import { generateStartEpisodeMessage } from '../lib/templates';
import { exportMappingToJson, importMappingFromJson } from '../lib/mappingExport';
import { sanitizeFolderName } from '../lib/pathUtils';
import { appLogger } from '../lib/appLogger';

export const useAssEditorActions = (
  currentEpisode: Episode | null,
  onRefresh: () => void,
  state: ReturnType<typeof useAssEditorState>
) => {
  const { 
    assignments, setAssignments, 
    actors, setActors, 
    participants, 
    setStatus,
    lastAnalyzedEpisodeId,
    characterAliases,
    setIsSaving,
    setLinkingCharacter,
    setIsSplitting
  } = state;

  const saveToDatabase = async (currentAssignments: RoleAssignment[]) => {
    if (!currentEpisode) return;
    appLogger.info('ass', `Сохранение назначений для эпизода ${currentEpisode.id} (${currentAssignments.length} ролей)...`);
    
    try {
      const cleanAssignments = currentAssignments.map(a => {
        const { dubber, substitute, ...rest } = a;
        return rest;
      });

      const updatedEpisode = {
        ...currentEpisode,
        assignments: cleanAssignments
      };
      
      await ipcSafe.invoke('save-episode', updatedEpisode);
      
      // Also update global mapping if needed
      if (currentEpisode.projectId && currentEpisode.project) {
        const currentMapping: {characterName: string, dubberId: string}[] = currentAssignments
          .filter(a => a.dubberId)
          .map(a => ({ characterName: a.characterName, dubberId: a.dubberId }));
        
        // Merge with existing global mapping
        const existingMappingRaw = currentEpisode.project.globalMapping || '[]';
        const existingMapping: {characterName: string, dubberId: string}[] = Array.isArray(JSON.parse(existingMappingRaw))
          ? JSON.parse(existingMappingRaw)
          : Object.entries(JSON.parse(existingMappingRaw)).map(([k, v]) => ({ characterName: k, dubberId: v as string }));

        const mergedMapping = [...existingMapping];
        currentMapping.forEach(m => {
          const exists = mergedMapping.some(em => em.characterName === m.characterName && em.dubberId === m.dubberId);
          if (!exists) {
            const emptyIdx = mergedMapping.findIndex(em => em.characterName === m.characterName && !em.dubberId);
            if (emptyIdx !== -1) {
              mergedMapping[emptyIdx].dubberId = m.dubberId;
            } else {
              mergedMapping.push(m);
            }
          }
        });

        const updatedProject = {
          ...currentEpisode.project,
          globalMapping: JSON.stringify(mergedMapping)
        };
        await ipcSafe.invoke('save-project', updatedProject);
      }
      
      appLogger.info('ass', `Назначения успешно сохранены для эпизода ${currentEpisode.id}`);
      onRefresh();
    } catch (error) {
      appLogger.error('ass', 'Ошибка сохранения в базу данных:', error);
      console.error("Auto-save error:", error);
    }
  };

  const handleAnalyzeExisting = async (currentAssignments: RoleAssignment[] = assignments): Promise<RoleAssignment[]> => {
    if (!currentEpisode?.subPath) {
      appLogger.warn('ass', 'Анализ невозможен: не указан путь к субтитрам эпизода');
      return [];
    }
    
    appLogger.info('ass', `Запуск анализа субтитров: ${currentEpisode.subPath}`);
    setStatus("Анализ существующих субтитров...");
    try {
      const result = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
      
      if (result && result.actors) {
        const rawActors: string[] = result.actors;
        const lines: any[] = result.lines || [];
        appLogger.info('ass', `Найдено ${rawActors.length} актеров/стилей и ${lines.length} строк диалогов`);
        
        // Calculate line counts per main character
        const lineCounts: Record<string, number> = {};
        lines.forEach(line => {
          const nameToUse = line.name || line.style || "Unknown";
          const mainName = characterAliases[nameToUse] || nameToUse;
          lineCounts[mainName] = (lineCounts[mainName] || 0) + 1;
        });

        // Map to main names and deduplicate, filtering out signs
        const mainActors = Array.from(new Set(rawActors.map(name => {
          const nameToUse = name || "Unknown";
          return characterAliases[nameToUse] || nameToUse;
        }))).filter(name => !SIGN_KEYWORDS.includes(name as string)) as string[];
        
        setActors(mainActors);

        const globalMappingRaw = currentEpisode?.project?.globalMapping || '[]';
        let globalMapping: {characterName: string, dubberId: string}[] = [];
        try {
          const parsed = JSON.parse(globalMappingRaw);
          if (Array.isArray(parsed)) {
            globalMapping = parsed;
          } else if (parsed && typeof parsed === 'object') {
            globalMapping = Object.entries(parsed).map(([k, v]) => ({ characterName: k, dubberId: v as string }));
          }
        } catch (e) {
          console.error("Error parsing global mapping:", e);
        }

        const existingNames = new Set(currentAssignments.map(a => a.characterName));
        const toAdd = mainActors.filter((name: string) => !existingNames.has(name));
        
        const updatedPrev = currentAssignments.map(a => ({
          ...a,
          lineCount: lineCounts[a.characterName] || 0
        }));

        let finalAssignments: RoleAssignment[] = [];
        if (toAdd?.length > 0) {
          const newAssignments = toAdd.map((actor: string) => {
            // Priority 1: Global mapping
            const mappingEntry = globalMapping.find(m => m.characterName === actor);
            let dubberId = mappingEntry?.dubberId || "";
            
            // Priority 2: Case-insensitive nickname match if no global mapping
            if (!dubberId) {
              const matchedParticipant = participants.find(
                p => p.nickname.toLowerCase() === actor.toLowerCase()
              );
              if (matchedParticipant) {
                dubberId = matchedParticipant.id;
              }
            }

            const dubber = participants.find(p => p.id === dubberId);
            return {
              id: Math.random().toString(),
              episodeId: currentEpisode.id,
              characterName: actor,
              dubberId: dubberId,
              dubber: dubber,
              status: "PENDING" as const,
              lineCount: lineCounts[actor] || 0
            };
          });

          finalAssignments = [...updatedPrev, ...newAssignments];
        } else {
          finalAssignments = updatedPrev;
        }

        setAssignments(finalAssignments);
        saveToDatabase(finalAssignments);

        lastAnalyzedEpisodeId.current = currentEpisode.id;
        setStatus(`Анализ завершен. Найдено ${mainActors?.length || 0} персонажей.`);
        return finalAssignments;
      }
      return assignments;
    } catch (error) {
      console.error("Parse error:", error);
      setStatus("Ошибка при анализе файла.");
      return assignments;
    }
  };

  const handleClearAssignments = async () => {
    if (!window.confirm("Вы уверены, что хотите очистить ВСЕ распределения ролей для этого эпизода?")) return;
    setAssignments([]);
    setActors([]);
    if (currentEpisode) {
      await saveToDatabase([]);
    }
    setStatus("Все распределения ролей очищены.");
  };

  const handleTransliterateNames = () => {
    const updated = assignments.map(a => ({
      ...a,
      characterName: latinToCyrillic(a.characterName)
    }));
    setAssignments(updated);
    saveToDatabase(updated);
    setStatus("Имена персонажей транслитерированы.");
  };

  const handlePolivanovToHepburn = () => {
    const updated = assignments.map(a => ({
      ...a,
      characterName: polivanovToHepburn(a.characterName)
    }));
    setAssignments(updated);
    saveToDatabase(updated);
    setStatus("Имена персонажей конвертированы (Поливанов -> Хэпберн).");
  };

  const handleAssignById = (assignmentId: string, dubberId: string) => {
    const dubber = participants.find(p => p.id === dubberId);
    const updated = assignments.map(a => 
      a.id === assignmentId ? { ...a, dubberId, dubber, status: dubberId ? 'PENDING' : 'PENDING' } : a
    );
    setAssignments(updated);
    saveToDatabase(updated);
  };

  const handleSetSubstitute = (assignmentId: string, substituteId: string) => {
    const substitute = participants.find(p => p.id === substituteId);
    const updated = assignments.map(a => 
      a.id === assignmentId ? { ...a, substituteId, substitute } : a
    );
    setAssignments(updated);
    saveToDatabase(updated);
  };

  const handleRemoveAssignment = (assignmentId: string, characterName: string) => {
    const updated = assignments.filter(a => a.id !== assignmentId);
    // If no assignments left for this character, add an empty one
    if (updated.filter(a => a.characterName === characterName).length === 0) {
      updated.push({
        id: Math.random().toString(36).substring(2, 11),
        episodeId: currentEpisode?.id || '',
        characterName,
        dubberId: "",
        status: "PENDING"
      });
    }
    setAssignments(updated);
    saveToDatabase(updated);
  };

  const handleAddDubberToCharacter = (characterName: string) => {
    const newAssignment: RoleAssignment = {
      id: Math.random().toString(36).substring(2, 11),
      episodeId: currentEpisode?.id || '',
      characterName,
      dubberId: "",
      status: "PENDING",
      lineCount: 0
    };
    setAssignments([...assignments, newAssignment]);
  };

  const handleLinkAsAlias = async (aliasName: string, mainName: string) => {
    if (!currentEpisode) return;
    try {
      // 1. Update project characterAliases
      const aliases = { ...characterAliases };
      aliases[aliasName] = mainName;
      
      await ipcSafe.invoke('save-project', {
        ...currentEpisode.project,
        characterAliases: JSON.stringify(aliases)
      });

      // 2. Re-analyze to update actors list and line counts
      const mappingEntries = (state as any).globalMapping.filter((m: any) => m.characterName === mainName && m.dubberId);
      
      const aliasAssignments = assignments.filter(a => a.characterName === aliasName);
      let updatedAssignments = assignments.filter(a => a.characterName !== aliasName);
      
      // Transfer dubber assignments from alias to main if they exist
      aliasAssignments.forEach(aa => {
        const dubberIdToUse = aa.dubberId;
        const dubberToUse = aa.dubber;
        
        const alreadyHasThisDubber = updatedAssignments.some(a => a.characterName === mainName && a.dubberId === dubberIdToUse);
        
        if (!alreadyHasThisDubber && dubberIdToUse) {
           updatedAssignments.push({
             ...aa,
             characterName: mainName,
             dubberId: dubberIdToUse,
             dubber: dubberToUse,
             id: Math.random().toString(36).substring(2, 11)
           });
        }
      });

      // Also ensure all dubbers from global mapping for the main character are present
      mappingEntries.forEach((me: any) => {
        const alreadyHasThisDubber = updatedAssignments.some(a => a.characterName === mainName && a.dubberId === me.dubberId);
        if (!alreadyHasThisDubber) {
          updatedAssignments.push({
            id: Math.random().toString(36).substring(2, 11),
            episodeId: currentEpisode.id,
            characterName: mainName,
            dubberId: me.dubberId,
            dubber: participants.find(p => p.id === me.dubberId),
            status: 'PENDING',
            lineCount: 0
          });
        }
      });

      // If main character still has no assignments, create one empty
      if (updatedAssignments.filter(a => a.characterName === mainName).length === 0) {
        updatedAssignments.push({
          id: Math.random().toString(36).substring(2, 11),
          episodeId: currentEpisode.id,
          characterName: mainName,
          dubberId: "",
          status: "PENDING"
        });
      }

      setAssignments(updatedAssignments);
      await saveToDatabase(updatedAssignments);
      
      // 4. Update actors list
      setActors(prev => prev.filter(a => a !== aliasName));
      
      setLinkingCharacter(null);
      setStatus(`Персонаж "${aliasName}" успешно связан с "${mainName}".`);
      onRefresh();
    } catch (error) {
      console.error("Link alias error:", error);
      setStatus("Ошибка при связывании алиаса.");
    }
  };

  const handleStartRecording = async () => {
    if (!currentEpisode) return;

    setIsSaving(true);
    setStatus("Перевод эпизода в статус 'ЗАПИСЬ'...");

    try {
      const updatedEpisode = {
        ...currentEpisode,
        status: "RECORDING" as const
      };
      await ipcSafe.invoke('save-episode', updatedEpisode);
      setStatus("Статус обновлен! Теперь можно приступать к записи.");
      onRefresh();
    } catch (error) {
      console.error("Status update error:", error);
      setStatus("Ошибка при обновлении статуса.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSplitAss = async () => {
    if (!currentEpisode || !currentEpisode.subPath) return;
    setIsSplitting(true);
    appLogger.info('ass', `Начало разделения субтитров для ${currentEpisode.subPath} (${assignments.filter(a => a.dubberId).length} назначенных ролей)...`);
    setStatus("Генерация разделенных файлов...");

    try {
      const result = await ipcSafe.invoke('split-ass', {
        subPath: currentEpisode.subPath,
        assignments: assignments.filter(a => a.dubberId),
        characterAliases
      });

      if (result && result.outputDir) {
        appLogger.info('ass', `Субтитры успешно разделены в папку: ${result.outputDir}`);
        setStatus(`Успешно! Файлы сохранены в: ${result.outputDir}`);
      } else {
        appLogger.warn('ass', 'Разделение завершилось без указания выходной директории');
        setStatus(`Ошибка: Не получен путь сохранения файлов.`);
      }
    } catch (error: any) {
      appLogger.error('ass', 'Ошибка при разделении субтитров:', error);
      console.error("Split error:", error);
      setStatus("Ошибка при разделении файла: " + (error.message || String(error)));
    } finally {
      setIsSplitting(false);
    }
  };

  const handleGenerateStartMessage = async () => {
    if (!currentEpisode) return;
    
    let currentAssignments = assignments;
    // Refresh line counts before generating if they are all zero
    const hasLineCounts = assignments.some(a => (a.lineCount || 0) > 0);
    if (!hasLineCounts && currentEpisode.subPath) {
      currentAssignments = await handleAnalyzeExisting();
    }
    
    const msg = generateStartEpisodeMessage({ ...currentEpisode, assignments: currentAssignments }, participants);
    state.setGeneratedMessage(msg);
    state.setIsMessageModalOpen(true);
  };

  const parseAssTime = (timeStr: string) => {
    const parts = timeStr.split(':');
    if (parts.length === 3) {
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      const seconds = parseFloat(parts[2]);
      return (hours * 3600) + (minutes * 60) + seconds;
    }
    return 0;
  };

  const handleCheckConsecutiveLines = async () => {
    if (!currentEpisode?.subPath) return;
    setStatus("Проверка на склейки...");
    try {
      const result = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
      if (!result || !result.lines) {
        setStatus("Ошибка при чтении субтитров.");
        return;
      }

      const linesWithDubbers = result.lines.map((line: any) => {
        const charName = characterAliases[line.name] || line.name;
        const assignment = assignments.find(a => a.characterName === charName);
        const dubberId = assignment?.substituteId || assignment?.dubberId;
        const dubber = participants.find(p => p.id === dubberId);
        return {
          ...line,
          mainCharacter: charName,
          dubberId: dubberId,
          dubberName: dubber?.nickname || "Неизвестно",
          startTime: parseAssTime(line.start),
          endTime: parseAssTime(line.end)
        };
      }).filter((l: any) => l.dubberId && l.mainCharacter);

      linesWithDubbers.sort((a: any, b: any) => a.startTime - b.startTime);

      const warnings: any[] = [];
      const dubberLines: Record<string, any[]> = {};
      linesWithDubbers.forEach((l: any) => {
        if (!dubberLines[l.dubberId]) dubberLines[l.dubberId] = [];
        dubberLines[l.dubberId].push(l);
      });

      for (const dubberId in dubberLines) {
        const dLines = dubberLines[dubberId];
        for (let i = 0; i < dLines.length - 1; i++) {
          const current = dLines[i];
          const next = dLines[i+1];
          
          if (current.mainCharacter !== next.mainCharacter) {
            const gap = next.startTime - current.endTime;
            if (gap < 2) {
              warnings.push({
                dubberName: current.dubberName,
                char1: current.mainCharacter,
                char2: next.mainCharacter,
                time1: current.start,
                end1: current.end,
                time2: next.start,
                end2: next.end,
                text1: current.text,
                text2: next.text,
                gap: gap
              });
            }
          }
        }
      }

      (state as any).setConsecutiveWarnings(warnings);
      (state as any).setShowConsecutiveWarnings(true);
      setStatus(`Проверка завершена. Найдено склеек: ${warnings.length}`);
    } catch (error) {
      console.error(error);
      setStatus("Ошибка при проверке склеек.");
    }
  };

  const handleExportFullAss = async () => {
    if (!currentEpisode || !currentEpisode.subPath) return;
    setStatus("Экспорт полного файла с ролями...");

    try {
      const projectTitle = sanitizeFolderName(currentEpisode.project?.title || "Project");
      const episodeFolder = sanitizeFolderName(`Episode_${currentEpisode.number || "0"}`);
      const subDir = `${projectTitle}/${episodeFolder}/Subtitles`;
      
      const config = await ipcSafe.invoke('get-config');
      const baseDir = config.baseDir || '';
      const outputPath = `${baseDir}/${subDir}/${projectTitle}_Ep${currentEpisode.number}_Full_Roles.ass`;

      const result = await ipcSafe.invoke('export-full-ass-with-roles', {
        assFilePath: currentEpisode.subPath,
        outputPath,
        assignments,
        characterAliases
      });

      if (result && result.path) {
        setStatus(`Полный файл успешно экспортирован: ${result.path}`);
      } else {
        setStatus("Ошибка при экспорте полного файла: Не удалось получить путь.");
      }
    } catch (error: any) {
      console.error("Export error:", error);
      setStatus("Ошибка при экспорте полного файла: " + (error.message || String(error)));
    }
  };

  const handleExportMapping = () => {
    const mapping: Record<string, string> = assignments.reduce((acc, a) => ({ ...acc, [a.characterName]: (a.substituteId || a.dubberId) }), {});
    const json = exportMappingToJson(mapping, participants);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mapping_${currentEpisode?.project?.title || 'project'}_ep${currentEpisode?.number || 0}.json`;
    a.click();
  };

  const handleImportMapping = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const json = event.target?.result as string;
      const newMapping = importMappingFromJson(json, participants);
      
      const updated = assignments.map(a => ({
        ...a,
        dubberId: newMapping[a.characterName] || a.dubberId,
        dubber: participants.find(p => p.id === (newMapping[a.characterName] || a.dubberId))
      }));
      setAssignments(updated);
      setStatus("Распределение ролей импортировано!");
    };
    reader.readAsText(file);
  };

  const handleExport = async (targetDir: string, skipConversion: boolean, smartExport?: boolean, currentAssignments?: RoleAssignment[]) => {
    if (!currentEpisode) return;
    
    try {
      const taskType = state.exportRole === 'DABBER' ? 'export-dabber-files' : 'export-sound-engineer-files';
      const roleName = state.exportRole === 'DABBER' ? 'Даберам' : 'Звукоreжиссеру';
      const newStatus = state.exportRole === 'DABBER' ? 'RECORDING' : 'SOUND_ENGINEERING';
      
      // Use provided assignments or fallback to episode.assignments
      const assignmentsToUse = currentAssignments || currentEpisode.assignments || [];
      const episodeWithAssignments = {
        ...currentEpisode,
        status: newStatus as any,
        assignments: assignmentsToUse
      };
      
      await ipcSafe.invoke('save-episode', episodeWithAssignments);
      
      await ipcSafe.invoke('enqueue-ffmpeg-task', {
        type: taskType,
        payload: { 
          episode: episodeWithAssignments, 
          targetDir, 
          skipConversion, 
          smartExport 
        },
        metadata: {
          title: `Экспорт ${roleName}: ${currentEpisode.project?.title} - Серия ${currentEpisode.number}`
        }
      });
      
      state.setIsExportModalOpen(false);
      onRefresh();
    } catch (error: any) {
      console.error("Export error:", error);
      setStatus('Ошибка при постановке в очередь: ' + error.message);
    }
  };

  const checkConsecutiveDubberLines = async (currentAssignments: RoleAssignment[]) => {
    if (!currentEpisode?.subPath) return;

    try {
      const data = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
      const lines: any[] = data.lines || data;
      
      const warnings: string[] = [];
      
      for (let i = 0; i < lines.length - 1; i++) {
        const line1 = lines[i];
        const line2 = lines[i + 1];
        
        if (!line1.name || !line2.name || line1.name === line2.name) continue;
        
        const assignment1 = currentAssignments.find(a => a.characterName === line1.name);
        const assignment2 = currentAssignments.find(a => a.characterName === line2.name);
        
        const dubberId1 = assignment1?.substituteId || assignment1?.dubberId;
        const dubberId2 = assignment2?.substituteId || assignment2?.dubberId;
        
        if (assignment1 && assignment2 && dubberId1 && dubberId2 && dubberId1 === dubberId2) {
          const dubberName = assignment1.substitute?.nickname || assignment1.dubber?.nickname || dubberId1;
          warnings.push(`Дабер ${dubberName} озвучивает подряд персонажей ${line1.name} и ${line2.name} (строки ${line1.rawLineIndex} и ${line2.rawLineIndex})`);
        }
      }
      
      if (warnings.length > 0) {
        setStatus(`Внимание: ${warnings.length} случаев подряд озвучки одним дабером!`);
      } else {
        setStatus("Распределение ролей корректно.");
      }
    } catch (error) {
      console.error("Error checking consecutive lines:", error);
    }
  };

  return { 
    saveToDatabase,
    handleAnalyzeExisting,
    handleAssignById,
    handleSetSubstitute,
    handleRemoveAssignment,
    handleAddDubberToCharacter,
    handleLinkAsAlias,
    handleStartRecording,
    handleSplitAss,
    handleClearAssignments,
    handleTransliterateNames,
    handlePolivanovToHepburn,
    handleGenerateStartMessage,
    handleCheckConsecutiveLines,
    handleExportFullAss,
    handleExportMapping,
    handleImportMapping,
    handleExport,
    checkConsecutiveDubberLines
  };
};
