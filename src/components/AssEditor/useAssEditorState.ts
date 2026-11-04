import React, { useState, useEffect, useRef, useCallback } from "react";
import { Episode, Participant, RoleAssignment } from "../../types";
import { getParticipants } from "../../services/dbService";
import { ipcSafe } from "../../lib/ipcSafe";
import { SIGN_KEYWORDS } from "../../constants";
import { toast } from 'sonner';
import { useModuleLogs } from "../../hooks/useModuleLogs";
import { useAssAliases, ConfirmState } from "./useAssAliases";

export interface AssLine {
  id: string;
  actor: string;
  text: string;
  assignedTo?: string;
}

export type AssTabType = "roles" | "raw" | "translate" | "ocr" | "whisper" | "diarization";

export function useAssEditorState(
  currentEpisode: Episode | null,
  onRefresh: () => void,
  onRegisterUnsavedHandler?: (handler: {
    hasChanges: () => boolean;
    save: () => Promise<void>;
    discard: () => void;
  } | null) => void
) {
  const [file, setFile] = useState<File | null>(null);
  const [lines, setLines] = useState<AssLine[]>([]);
  const [actors, setActors] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<RoleAssignment[]>([]);
  const [status, setStatus] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<AssTabType>("roles");
  const [linkingCharacter, setLinkingCharacter] = useState<string | null>(null);
  const lastAnalyzedEpisodeId = useRef<string | null>(null);

  // Unsaved changes state & guard
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const hasUnsavedChangesRef = useRef(false);
  const updateHasUnsavedChanges = useCallback((val: boolean) => {
    hasUnsavedChangesRef.current = val;
    setHasUnsavedChanges(val);
  }, []);

  const [pendingInternalTab, setPendingInternalTab] = useState<AssTabType | null>(null);
  const [showInternalUnsavedModal, setShowInternalUnsavedModal] = useState(false);
  const [unassignedLinesCount, setUnassignedLinesCount] = useState(0);
  const [inspectingCharacter, setInspectingCharacter] = useState<string | null>(null);
  const [isLogsOpen, setIsLogsOpen] = useState(false);

  const { logs: assLogs, clearLogs: clearAssLogs } = useModuleLogs('ass');
  const assErrorCount = assLogs.filter(l => l.level === 'error').length;

  const [confirmState, setConfirmState] = useState<ConfirmState>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // Monitor unassigned lines count
  useEffect(() => {
    const checkUnassigned = async () => {
      if (!currentEpisode?.subPath) {
        setUnassignedLinesCount(0);
        return;
      }
      try {
        const data = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
        const linesData = data.lines || data;
        const count = linesData.filter((l: any) => !l.name || !l.name.trim()).length;
        setUnassignedLinesCount(count);
      } catch (e) {
        console.error("Error checking unassigned lines:", e);
      }
    };
    checkUnassigned();
  }, [currentEpisode, activeTab]);

  useEffect(() => {
    getParticipants().then(setParticipants);
  }, []);

  const saveToDatabase = useCallback(async (currentAssignments: RoleAssignment[]) => {
    if (!currentEpisode) return;

    try {
      const cleanAssignments = currentAssignments.map(a => {
        const { dubber, substitute, ...rest } = a;
        return rest;
      });

      const updatedEpisode = {
        ...currentEpisode,
        assignments: cleanAssignments
      };

      currentEpisode.assignments = cleanAssignments;
      await ipcSafe.invoke('save-episode', updatedEpisode);

      if (currentEpisode.projectId && currentEpisode.project) {
        const charAssignmentsMap = new Map<string, { dubberId: string; isMain?: boolean }>();
        currentAssignments.forEach(a => {
          if (a.characterName) {
            charAssignmentsMap.set(a.characterName, {
              dubberId: a.dubberId || '',
              isMain: a.isMain
            });
          }
        });

        const existingMappingRaw = currentEpisode.project.globalMapping || '[]';
        let existingMapping: { characterName: string; dubberId: string; isMain?: boolean; photoUrl?: string }[] = [];
        try {
          const parsed = JSON.parse(existingMappingRaw);
          existingMapping = Array.isArray(parsed)
            ? parsed
            : Object.entries(parsed).map(([k, v]) => ({ characterName: k, dubberId: v as string, isMain: undefined }));
        } catch (e) {
          existingMapping = [];
        }

        const mergedMapping: typeof existingMapping = [];
        const seenNames = new Set<string>();

        existingMapping.forEach(em => {
          if (!em.characterName || seenNames.has(em.characterName)) return;
          seenNames.add(em.characterName);

          if (charAssignmentsMap.has(em.characterName)) {
            const current = charAssignmentsMap.get(em.characterName)!;
            mergedMapping.push({
              ...em,
              dubberId: current.dubberId,
              isMain: current.isMain !== undefined ? current.isMain : em.isMain
            });
          } else {
            mergedMapping.push(em);
          }
        });

        charAssignmentsMap.forEach((val, charName) => {
          if (!seenNames.has(charName)) {
            seenNames.add(charName);
            mergedMapping.push({
              characterName: charName,
              dubberId: val.dubberId,
              isMain: val.isMain
            });
          }
        });

        const updatedGlobalMappingStr = JSON.stringify(mergedMapping);
        currentEpisode.project.globalMapping = updatedGlobalMappingStr;
        const assignedDubberIds = Array.isArray(currentEpisode.project.assignedDubberIds)
          ? [...currentEpisode.project.assignedDubberIds]
          : [];
        mergedMapping.forEach(m => {
          if (m.dubberId && !assignedDubberIds.includes(m.dubberId)) {
            assignedDubberIds.push(m.dubberId);
          }
        });
        currentEpisode.project.assignedDubberIds = assignedDubberIds;

        const { episodes: _eps, soundEngineer: _se, assignedDubbers: _ad, ...cleanProj } = currentEpisode.project;
        const updatedProject = {
          ...cleanProj,
          assignedDubberIds,
          globalMapping: updatedGlobalMappingStr
        };
        await ipcSafe.invoke('save-project', updatedProject);
      }

      onRefresh();
    } catch (error) {
      console.error("Save error:", error);
      throw error;
    }
  }, [currentEpisode, onRefresh]);

  // Integrated aliases, portraits, transliteration
  const {
    globalMapping,
    characterAliases,
    getCharacterPortrait,
    handleTransliterateNames,
    handlePolivanovToHepburn,
    handleLinkAsAlias,
  } = useAssAliases({
    currentEpisode,
    assignments,
    setAssignments,
    setActors,
    participants,
    setConfirmState,
    setLinkingCharacter,
    updateHasUnsavedChanges,
    setStatus,
    saveToDatabase,
    onRefresh,
  });

  const handleManualSave = useCallback(async () => {
    if (!currentEpisode) return;
    setIsSaving(true);
    try {
      await saveToDatabase(assignments);
      updateHasUnsavedChanges(false);
      toast.success("Изменения ролей и проекта успешно сохранены!");
    } catch (err: any) {
      console.error("Manual save failed:", err);
      toast.error(`Ошибка сохранения: ${err?.message || err}`);
    } finally {
      setIsSaving(false);
    }
  }, [assignments, currentEpisode, saveToDatabase, updateHasUnsavedChanges]);

  const handleDiscardChanges = useCallback(() => {
    if (!currentEpisode) return;
    if (Array.isArray(currentEpisode.assignments)) {
      const reverted = currentEpisode.assignments.map(a => ({
        ...a,
        dubber: a.dubberId ? participants.find(p => p.id === a.dubberId) : undefined,
        substitute: a.substituteId ? participants.find(p => p.id === a.substituteId) : undefined,
      }));
      setAssignments(reverted);
      setActors(reverted.map(a => a.characterName));
    }
    updateHasUnsavedChanges(false);
    toast.info("Несохраненные изменения сброшены к сохраненной версии.");
  }, [currentEpisode, participants, updateHasUnsavedChanges]);

  const requestInternalTab = useCallback((targetTab: AssTabType) => {
    if (targetTab === activeTab) return;
    if (hasUnsavedChanges) {
      setPendingInternalTab(targetTab);
      setShowInternalUnsavedModal(true);
    } else {
      setActiveTab(targetTab);
    }
  }, [activeTab, hasUnsavedChanges]);

  useEffect(() => {
    if (onRegisterUnsavedHandler) {
      onRegisterUnsavedHandler({
        hasChanges: () => hasUnsavedChangesRef.current,
        save: handleManualSave,
        discard: handleDiscardChanges,
      });
      return () => {
        onRegisterUnsavedHandler(null);
      };
    }
  }, [onRegisterUnsavedHandler, handleManualSave, handleDiscardChanges]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleManualSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleManualSave]);

  const handleAnalyzeExisting = useCallback(async (currentAssignments: RoleAssignment[] = assignments): Promise<RoleAssignment[]> => {
    if (!currentEpisode?.subPath) return [];

    setStatus("Анализ существующих субтитров...");
    try {
      const result = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);

      if (result && result.actors) {
        const aliases: Record<string, string> = JSON.parse(currentEpisode?.project?.characterAliases || '{}');
        const rawActors: string[] = result.actors;
        const subLines: any[] = result.lines || [];

        const lineCounts: Record<string, number> = {};
        subLines.forEach(line => {
          const nameToUse = line.name || line.style || "Unknown";
          const mainName = aliases[nameToUse] || nameToUse;
          lineCounts[mainName] = (lineCounts[mainName] || 0) + 1;
        });

        const mainActors = Array.from(new Set(rawActors.map(name => {
          const nameToUse = name || "Unknown";
          return aliases[nameToUse] || nameToUse;
        }))).filter(name => !SIGN_KEYWORDS.includes(name as string)) as string[];

        setActors(mainActors);

        const globalMappingRaw = currentEpisode?.project?.globalMapping || '[]';
        let gm: { characterName: string; dubberId: string; isMain?: boolean }[] = [];
        try {
          const parsed = JSON.parse(globalMappingRaw);
          if (Array.isArray(parsed)) {
            gm = parsed;
          } else if (parsed && typeof parsed === 'object') {
            gm = Object.entries(parsed).map(([k, v]) => ({ characterName: k, dubberId: v as string, isMain: undefined }));
          }
        } catch (e) {
          console.error("Error parsing global mapping:", e);
        }

        const existingNames = new Set(currentAssignments.map(a => a.characterName));
        const toAdd = mainActors.filter((name: string) => !existingNames.has(name));

        const updatedPrev = currentAssignments.map(a => {
          const mapping = gm.find(m => m.characterName === a.characterName && m.dubberId === a.dubberId);
          return {
            ...a,
            lineCount: lineCounts[a.characterName] || 0,
            isMain: mapping?.isMain !== undefined ? mapping.isMain : a.isMain
          };
        });

        let finalAssignments: RoleAssignment[] = [];
        if (toAdd?.length > 0) {
          const newAssignments = toAdd.map((actor: string) => {
            const mappingEntry = gm.find(m => m.characterName === actor);
            let dubberId = mappingEntry?.dubberId || "";
            let isMain = mappingEntry?.isMain || false;

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
              lineCount: lineCounts[actor] || 0,
              isMain: isMain
            };
          });

          finalAssignments = [...updatedPrev, ...newAssignments];
        } else {
          finalAssignments = updatedPrev;
        }

        const finalAssignmentsCleaned = finalAssignments.filter(a => (a.lineCount || 0) > 0);

        setAssignments(finalAssignmentsCleaned);
        saveToDatabase(finalAssignmentsCleaned);

        lastAnalyzedEpisodeId.current = currentEpisode.id;
        setStatus(`Анализ завершен. Найдено ${mainActors?.length || 0} персонажей. Удалено пустых ролей: ${finalAssignments.length - finalAssignmentsCleaned.length}`);
        return finalAssignmentsCleaned;
      }
      return assignments;
    } catch (error) {
      console.error("Parse error:", error);
      setStatus("Ошибка при анализе файла.");
      return assignments;
    }
  }, [assignments, currentEpisode, participants, saveToDatabase]);

  useEffect(() => {
    if (!currentEpisode) return;

    if (Array.isArray(currentEpisode.assignments) && currentEpisode.assignments.length > 0) {
      let gm: { characterName: string; dubberId: string; isMain?: boolean }[] = [];
      try {
        const raw = currentEpisode.project?.globalMapping || '[]';
        const parsed = JSON.parse(raw);
        gm = Array.isArray(parsed)
          ? parsed
          : Object.entries(parsed).map(([k, v]) => ({ characterName: k, dubberId: v as string, isMain: undefined }));
      } catch (e) {
        console.error("Error parsing global mapping:", e);
      }

      const assignedDubbersPerCharacter: Record<string, Set<string>> = {};
      currentEpisode.assignments.forEach(a => {
        if (a.dubberId) {
          if (!assignedDubbersPerCharacter[a.characterName]) {
            assignedDubbersPerCharacter[a.characterName] = new Set();
          }
          assignedDubbersPerCharacter[a.characterName].add(a.dubberId);
        }
      });

      const updatedAssignments = currentEpisode.assignments.map(a => {
        const newA = { ...a };
        const mappings = gm.filter(m => m.characterName === newA.characterName && m.dubberId);

        if (!newA.dubberId) {
          const assignedSet = assignedDubbersPerCharacter[newA.characterName] || new Set();
          const availableMapping = mappings.find(m => !assignedSet.has(m.dubberId));

          if (availableMapping) {
            newA.dubberId = availableMapping.dubberId;
            newA.isMain = availableMapping.isMain !== undefined ? availableMapping.isMain : newA.isMain;
            assignedSet.add(availableMapping.dubberId);
            assignedDubbersPerCharacter[newA.characterName] = assignedSet;
          }
        } else {
          const mapping = mappings.find(m => m.dubberId === newA.dubberId);
          if (mapping && mapping.isMain !== undefined) {
            newA.isMain = mapping.isMain;
          }
        }

        newA.dubber = newA.dubberId ? participants.find(p => p.id === newA.dubberId) : undefined;
        newA.substitute = newA.substituteId ? participants.find(p => p.id === newA.substituteId) : undefined;
        return newA;
      });

      const cleanUpdated = updatedAssignments.map(a => {
        const { dubber, substitute, ...rest } = a;
        return rest;
      });
      const cleanCurrent = currentEpisode.assignments.map(a => {
        const { dubber, substitute, ...rest } = a;
        return rest;
      });

      const hasChanges = JSON.stringify(cleanUpdated) !== JSON.stringify(cleanCurrent);
      setAssignments(updatedAssignments);
      setActors(updatedAssignments.map(a => a.characterName));
      updateHasUnsavedChanges(hasChanges);

      lastAnalyzedEpisodeId.current = currentEpisode.id;

      const hasLineCounts = updatedAssignments.some(a => (a.lineCount || 0) > 0);
      if (!hasLineCounts && currentEpisode.subPath && lastAnalyzedEpisodeId.current !== currentEpisode.id + '_auto') {
        lastAnalyzedEpisodeId.current = currentEpisode.id + '_auto';
        handleAnalyzeExisting(updatedAssignments);
      }
    } else {
      if (lastAnalyzedEpisodeId.current !== currentEpisode.id) {
        setAssignments([]);
        setActors([]);
        if (currentEpisode.subPath) {
          lastAnalyzedEpisodeId.current = currentEpisode.id + '_auto';
          handleAnalyzeExisting([]);
        } else {
          lastAnalyzedEpisodeId.current = currentEpisode.id;
        }
      }
    }
  }, [currentEpisode?.id, currentEpisode?.subPath, currentEpisode?.project?.globalMapping, participants.length]);

  const handleAssignById = async (assignmentId: string, dubberId: string) => {
    const dubber = participants.find(p => p.id === dubberId);
    const newAssignments = assignments.map(a => a.id === assignmentId ? { ...a, dubberId, dubber } : a);
    setAssignments(newAssignments);
    updateHasUnsavedChanges(true);
  };

  const handleAddDubberToCharacter = async (characterName: string) => {
    const newAssignment: RoleAssignment = {
      id: Math.random().toString(),
      episodeId: currentEpisode!.id,
      characterName,
      dubberId: "",
      status: "PENDING"
    };

    const lastIdx = [...assignments].reverse().findIndex(a => a.characterName === characterName);
    const actualIdx = lastIdx === -1 ? assignments.length : assignments.length - lastIdx;

    const newAssignments = [...assignments];
    newAssignments.splice(actualIdx, 0, newAssignment);
    setAssignments(newAssignments);
    updateHasUnsavedChanges(true);
  };

  const handleRemoveAssignment = async (assignmentId: string, _characterName: string) => {
    const newAssignments = assignments.filter(a => a.id !== assignmentId);
    setAssignments(newAssignments);
    setActors(newAssignments.map(a => a.characterName));
    updateHasUnsavedChanges(true);
  };

  const handleSetSubstitute = async (assignmentId: string, substituteId: string) => {
    const substitute = participants.find(p => p.id === substituteId);
    const newAssignments = assignments.map(a => a.id === assignmentId ? { ...a, substituteId, substitute } : a);
    setAssignments(newAssignments);
    updateHasUnsavedChanges(true);
  };

  const handleClearAssignments = async () => {
    setConfirmState({
      isOpen: true,
      title: 'Очистка распределений',
      message: 'Вы уверены, что хотите очистить ВСЕ распределения ролей для этого эпизода?',
      variant: 'danger',
      onConfirm: async () => {
        setAssignments([]);
        setActors([]);
        if (currentEpisode) {
          await saveToDatabase([]);
        }
        toast.success("Все распределения ролей очищены.");
      }
    });
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

  return {
    file,
    setFile,
    lines,
    setLines,
    actors,
    setActors,
    assignments,
    setAssignments,
    status,
    setStatus,
    participants,
    setParticipants,
    isSaving,
    setIsSaving,
    activeTab,
    setActiveTab,
    linkingCharacter,
    setLinkingCharacter,
    hasUnsavedChanges,
    updateHasUnsavedChanges,
    pendingInternalTab,
    setPendingInternalTab,
    showInternalUnsavedModal,
    setShowInternalUnsavedModal,
    unassignedLinesCount,
    setUnassignedLinesCount,
    inspectingCharacter,
    setInspectingCharacter,
    isLogsOpen,
    setIsLogsOpen,
    assLogs,
    clearAssLogs,
    assErrorCount,
    confirmState,
    setConfirmState,
    globalMapping,
    characterAliases,
    getCharacterPortrait,
    saveToDatabase,
    handleManualSave,
    handleDiscardChanges,
    requestInternalTab,
    handleAnalyzeExisting,
    handleTransliterateNames,
    handlePolivanovToHepburn,
    handleAssignById,
    handleAddDubberToCharacter,
    handleRemoveAssignment,
    handleSetSubstitute,
    handleLinkAsAlias,
    handleClearAssignments,
    handleStartRecording,
  };
}
