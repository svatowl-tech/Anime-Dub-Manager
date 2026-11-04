import { useState, useEffect, useCallback } from "react";
import { Episode, Participant, RoleAssignment } from "../../types";
import { sanitizeFolderName } from "../../lib/pathUtils";
import { exportMappingToJson, importMappingFromJson } from "../../lib/mappingExport";
import { ipcSafe } from "../../lib/ipcSafe";
import { generateStartEpisodeMessage } from "../../lib/templates";
import { toast } from 'sonner';

export interface UseAssSplitterProps {
  currentEpisode: Episode | null;
  assignments: RoleAssignment[];
  setAssignments: React.Dispatch<React.SetStateAction<RoleAssignment[]>>;
  participants: Participant[];
  setStatus: (status: string) => void;
  onRefresh: () => void;
  updateHasUnsavedChanges: (val: boolean) => void;
  handleAnalyzeExisting: () => Promise<RoleAssignment[]>;
}

export function useAssSplitter({
  currentEpisode,
  assignments,
  setAssignments,
  participants,
  setStatus,
  onRefresh,
  updateHasUnsavedChanges,
  handleAnalyzeExisting,
}: UseAssSplitterProps) {
  const [distributeGroups, setDistributeGroups] = useState(false);
  const [distributeMultipleRoles, setDistributeMultipleRoles] = useState(false);
  const [saveSignsInAss, setSaveSignsInAss] = useState(false);
  const [showSigns, setShowSigns] = useState(true);
  const [outputFormat, setOutputFormat] = useState<"ass" | "srt">("ass");
  const [isSplitting, setIsSplitting] = useState(false);
  const [isMessageModalOpen, setIsMessageModalOpen] = useState(false);
  const [generatedMessage, setGeneratedMessage] = useState("");
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportRole, setExportRole] = useState<'DABBER' | 'SOUND_ENGINEER'>('DABBER');
  const [showConsecutiveWarnings, setShowConsecutiveWarnings] = useState(false);
  const [consecutiveWarnings, setConsecutiveWarnings] = useState<any[]>([]);

  useEffect(() => {
    const removeListener = ipcSafe.on('ffmpeg-progress', (progress: number) => {
      setExportProgress(progress);
    });
    return () => removeListener();
  }, []);

  const handleExportMapping = useCallback(() => {
    const mapping: Record<string, string> = assignments.reduce(
      (acc, a) => ({ ...acc, [a.characterName]: a.dubberId }),
      {}
    );
    const json = exportMappingToJson(mapping, participants);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mapping_${currentEpisode?.project?.title || 'project'}_ep${currentEpisode?.number || 0}.json`;
    a.click();
  }, [assignments, currentEpisode, participants]);

  const handleImportMapping = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const json = event.target?.result as string;
      const newMapping = importMappingFromJson(json, participants);

      setAssignments(prev => prev.map(a => ({
        ...a,
        dubberId: newMapping[a.characterName] || a.dubberId
      })));
      updateHasUnsavedChanges(true);
      setStatus("Распределение ролей импортировано. Нажмите «Сохранить проект».");
    };
    reader.readAsText(file);
  }, [participants, setAssignments, setStatus, updateHasUnsavedChanges]);

  const handleExport = useCallback(async (
    targetDir: string,
    skipConversion: boolean,
    smartExport?: boolean,
    uploadToYandex?: boolean,
    additionalProcessing?: boolean,
    autoApplyFixesOrAssignments?: boolean | RoleAssignment[],
    includeSubtitlesOrAssignments?: boolean | RoleAssignment[],
    autoTiming?: boolean,
    currentAssignmentsOrTrackIds?: RoleAssignment[] | string[],
    selectedTrackIdsArg?: string[]
  ) => {
    if (!currentEpisode) return;

    try {
      const taskType = exportRole === 'DABBER' ? 'export-dabber-files' : 'export-sound-engineer-files';
      const roleName = exportRole === 'DABBER' ? 'Даберам' : 'Звукорежиссеру';
      const newStatus = exportRole === 'DABBER' ? 'RECORDING' : 'SOUND_ENGINEERING';

      const autoApplyFixes = typeof autoApplyFixesOrAssignments === 'boolean' ? autoApplyFixesOrAssignments : false;
      const includeSubtitles = typeof includeSubtitlesOrAssignments === 'boolean' ? includeSubtitlesOrAssignments : true;
      const isAutoTiming = typeof autoTiming === 'boolean' ? autoTiming : false;

      let rawAssignments: RoleAssignment[] = assignments;
      let selectedTrackIds: string[] | undefined = selectedTrackIdsArg;

      if (Array.isArray(autoApplyFixesOrAssignments)) {
        rawAssignments = autoApplyFixesOrAssignments;
      } else if (Array.isArray(includeSubtitlesOrAssignments)) {
        rawAssignments = includeSubtitlesOrAssignments;
      } else if (Array.isArray(currentAssignmentsOrTrackIds)) {
        if (currentAssignmentsOrTrackIds.length === 0 || typeof currentAssignmentsOrTrackIds[0] === 'string') {
          selectedTrackIds = currentAssignmentsOrTrackIds as string[];
        } else {
          rawAssignments = currentAssignmentsOrTrackIds as RoleAssignment[];
        }
      }

      const updatedEpisode = {
        ...currentEpisode,
        status: newStatus as any,
        assignments: rawAssignments.map(a => {
          const { dubber, substitute, ...rest } = a;
          return rest;
        })
      };

      await ipcSafe.invoke('save-episode', updatedEpisode);

      await ipcSafe.invoke('enqueue-ffmpeg-task', {
        type: taskType,
        payload: {
          episode: updatedEpisode,
          targetDir,
          skipConversion,
          smartExport,
          uploadToYandex,
          additionalProcessing,
          autoApplyFixes,
          includeSubtitles,
          autoTiming: isAutoTiming,
          selectedTrackIds
        },
        metadata: {
          title: `Экспорт ${roleName}: ${currentEpisode.project?.title} - Серия ${currentEpisode.number}`
        }
      });

      setIsExportModalOpen(false);
      setStatus(`Задание на экспорт (${roleName}) добавлено в очередь.`);
      onRefresh();
    } catch (error: any) {
      console.error('Enqueue task error:', error);
      setStatus('Ошибка при постановке в очередь: ' + error.message);
    }
  }, [assignments, currentEpisode, exportRole, onRefresh, setStatus]);

  const handleSplitAss = useCallback(async () => {
    if (!currentEpisode || !currentEpisode.subPath) return;
    setIsSplitting(true);
    setStatus("Генерация разделенных файлов...");

    try {
      const projectTitle = sanitizeFolderName(currentEpisode.project?.title || "Project");
      const episodeFolder = sanitizeFolderName(`Episode_${currentEpisode.number || "0"}`);
      const subDir = `${projectTitle}/${episodeFolder}/Subtitles/output_dubbers`;

      const config = await ipcSafe.invoke('get-config');
      const baseDir = config.baseDir || '';
      const outputDirectory = `${baseDir}/${subDir}`;

      const options = {
        distributeGroups,
        distributeMultipleRoles,
        saveSignsInAss,
        outputFormat
      };

      const data = await ipcSafe.invoke('split-subs-by-dubber', {
        assFilePath: currentEpisode.subPath,
        outputDirectory,
        assignments,
        options
      });

      if (data && data.generatedFiles) {
        setStatus(
          `Файлы успешно разделены и сохранены в папке output_dubbers! Сгенерировано файлов: ${data.generatedFiles.length}`,
        );
      } else {
        setStatus("Ошибка при разделении файлов: Не удалось получить список сгенерированных файлов.");
      }
    } catch (error: any) {
      console.error("Split error:", error);
      setStatus("Ошибка при разделении файлов: " + (error.message || String(error)));
    } finally {
      setIsSplitting(false);
    }
  }, [assignments, currentEpisode, distributeGroups, distributeMultipleRoles, outputFormat, saveSignsInAss, setStatus]);

  const handleGenerateStartMessage = useCallback(async () => {
    if (!currentEpisode) return;

    let currentAssignments = assignments;
    const hasLineCounts = assignments.some(a => (a.lineCount || 0) > 0);
    if (!hasLineCounts && currentEpisode.subPath) {
      currentAssignments = await handleAnalyzeExisting();
    }

    const msg = generateStartEpisodeMessage({ ...currentEpisode, assignments: currentAssignments }, participants);
    setGeneratedMessage(msg);
    setIsMessageModalOpen(true);
  }, [assignments, currentEpisode, handleAnalyzeExisting, participants]);

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

  const handleCheckConsecutiveLines = useCallback(async () => {
    if (!currentEpisode?.subPath) return;
    setStatus("Проверка на склейки...");
    try {
      const result = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
      if (!result || !result.lines) {
        setStatus("Ошибка при чтении субтитров.");
        return;
      }

      const aliases: Record<string, string> = JSON.parse(currentEpisode?.project?.characterAliases || '{}');

      const linesWithDubbers = result.lines.map((line: any) => {
        const charName = aliases[line.name] || line.name;
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
          const next = dLines[i + 1];

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

      setConsecutiveWarnings(warnings);
      setShowConsecutiveWarnings(true);
      setStatus(`Проверка завершена. Найдено склеек: ${warnings.length}`);
    } catch (error) {
      console.error(error);
      setStatus("Ошибка при проверке склеек.");
    }
  }, [assignments, currentEpisode, participants, setStatus]);

  const handleExportFullAss = useCallback(async () => {
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
        assignments
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
  }, [assignments, currentEpisode, setStatus]);

  const handleExportCharacterSubtitles = useCallback(async (characterName: string) => {
    if (!currentEpisode || !currentEpisode.subPath) {
      toast.error("Нет загруженного файла субтитров для этого эпизода.");
      return;
    }

    try {
      const projectTitle = sanitizeFolderName(currentEpisode.project?.title || "Project");
      const defaultName = `${projectTitle}_Ep${currentEpisode.number || "0"}_${characterName}.ass`;

      const saveResult = await ipcSafe.invoke('show-save-dialog', {
        title: `Экспорт субтитров персонажа ${characterName}`,
        defaultPath: defaultName,
        filters: [
          { name: 'Advanced SubStation Alpha', extensions: ['ass'] },
          { name: 'SubRip Subtitles', extensions: ['srt'] }
        ]
      });

      if (saveResult.canceled || !saveResult.filePath) {
        return;
      }

      const format = saveResult.filePath.toLowerCase().endsWith('.srt') ? 'srt' : 'ass';

      setStatus(`Экспорт субтитров для ${characterName}...`);
      const result = await ipcSafe.invoke('export-character-subtitles', {
        assFilePath: currentEpisode.subPath,
        outputPath: saveResult.filePath,
        characterName,
        characterAliases: currentEpisode.project?.characterAliases || '{}',
        format
      });

      if (result && result.path) {
        toast.success(`Субтитры персонажа ${characterName} успешно сохранены!`);
        setStatus(`Файл сохранен: ${result.path}`);
      } else {
        toast.error("Не удалось экспортировать файл субтитров.");
      }
    } catch (error: any) {
      console.error("Character subtitle export error:", error);
      toast.error(`Ошибка при экспорте: ${error.message || String(error)}`);
      setStatus("Ошибка при экспорте: " + (error.message || String(error)));
    }
  }, [currentEpisode, setStatus]);

  return {
    distributeGroups,
    setDistributeGroups,
    distributeMultipleRoles,
    setDistributeMultipleRoles,
    saveSignsInAss,
    setSaveSignsInAss,
    showSigns,
    setShowSigns,
    outputFormat,
    setOutputFormat,
    isSplitting,
    setIsSplitting,
    isMessageModalOpen,
    setIsMessageModalOpen,
    generatedMessage,
    setGeneratedMessage,
    isExportModalOpen,
    setIsExportModalOpen,
    isExporting,
    setIsExporting,
    exportProgress,
    exportRole,
    setExportRole,
    showConsecutiveWarnings,
    setShowConsecutiveWarnings,
    consecutiveWarnings,
    handleExportMapping,
    handleImportMapping,
    handleExport,
    handleSplitAss,
    handleGenerateStartMessage,
    handleCheckConsecutiveLines,
    handleExportFullAss,
    handleExportCharacterSubtitles,
  };
}
