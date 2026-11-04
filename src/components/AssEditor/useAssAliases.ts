import { useMemo, useCallback } from "react";
import { Episode, Participant, RoleAssignment } from "../../types";
import { ipcSafe } from "../../lib/ipcSafe";
import { latinToCyrillic, polivanovToHepburn } from "../../lib/translit";
import { toast } from 'sonner';

export interface ConfirmState {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  variant?: 'danger' | 'warning' | 'info';
}

export interface UseAssAliasesProps {
  currentEpisode: Episode | null;
  assignments: RoleAssignment[];
  setAssignments: React.Dispatch<React.SetStateAction<RoleAssignment[]>>;
  setActors: React.Dispatch<React.SetStateAction<string[]>>;
  participants: Participant[];
  setConfirmState: React.Dispatch<React.SetStateAction<ConfirmState>>;
  setLinkingCharacter: (val: string | null) => void;
  updateHasUnsavedChanges: (val: boolean) => void;
  setStatus: (msg: string) => void;
  saveToDatabase: (assignments: RoleAssignment[]) => Promise<void>;
  onRefresh: () => void;
}

export function useAssAliases({
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
}: UseAssAliasesProps) {
  const globalMapping = useMemo(() => {
    try {
      const raw = currentEpisode?.project?.globalMapping || '[]';
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed as { characterName: string; dubberId: string; photoUrl?: string; isMain?: boolean }[]
        : Object.entries(parsed).map(([k, v]) => ({ characterName: k, dubberId: v as string, photoUrl: undefined, isMain: undefined }));
    } catch (e) {
      return [];
    }
  }, [currentEpisode?.project?.globalMapping]);

  const characterAliases = useMemo(() => {
    try {
      const raw = currentEpisode?.project?.characterAliases || '{}';
      return JSON.parse(raw) as Record<string, string>;
    } catch (e) {
      return {};
    }
  }, [currentEpisode?.project?.characterAliases]);

  const getCharacterPortrait = useCallback((name: string) => {
    const mainName = characterAliases[name] || name;
    return globalMapping.find(m => m.characterName === mainName)?.photoUrl;
  }, [characterAliases, globalMapping]);

  const handleTransliterateNames = useCallback(() => {
    if (assignments.length === 0) return;
    const newAssignments = assignments.map(a => ({
      ...a,
      characterName: latinToCyrillic(a.characterName)
    }));
    setAssignments(newAssignments);
    updateHasUnsavedChanges(true);
    setStatus("Имена персонажей транслитерированы. Нажмите «Сохранить проект».");
  }, [assignments, setAssignments, setStatus, updateHasUnsavedChanges]);

  const handlePolivanovToHepburn = useCallback(() => {
    if (assignments.length === 0) return;
    const newAssignments = assignments.map(a => ({
      ...a,
      characterName: polivanovToHepburn(a.characterName)
    }));
    setAssignments(newAssignments);
    updateHasUnsavedChanges(true);
    setStatus("Имена персонажей переведены на систему Хэпберна. Нажмите «Сохранить проект».");
  }, [assignments, setAssignments, setStatus, updateHasUnsavedChanges]);

  const handleLinkAsAlias = useCallback(async (aliasName: string, mainName: string) => {
    if (!currentEpisode || !currentEpisode.project) return;
    if (aliasName === mainName) return;

    setConfirmState({
      isOpen: true,
      title: 'Связывание алиаса',
      message: `Связать "${aliasName}" как алиас для "${mainName}"? Все реплики "${aliasName}" будут переназначены на "${mainName}".`,
      onConfirm: async () => {
        try {
          const currentAliases: Record<string, string> = JSON.parse(currentEpisode.project!.characterAliases || '{}');
          let canonicalMain = mainName;
          while (currentAliases[canonicalMain] && currentAliases[canonicalMain] !== canonicalMain) {
            canonicalMain = currentAliases[canonicalMain];
          }
          currentAliases[aliasName] = canonicalMain;

          Object.keys(currentAliases).forEach(k => {
            if (currentAliases[k] === aliasName) {
              currentAliases[k] = canonicalMain;
            }
          });

          let gm: { characterName: string; dubberId: string; photoUrl?: string; isMain?: boolean }[] = [];
          try {
            const raw = currentEpisode.project?.globalMapping || '[]';
            const parsed = JSON.parse(raw);
            gm = Array.isArray(parsed)
              ? parsed
              : Object.entries(parsed).map(([k, v]) => ({ characterName: k, dubberId: v as string }));
          } catch (e) {
            gm = [];
          }

          const aliasMapEntry = gm.find(m => m.characterName.toLowerCase() === aliasName.toLowerCase());
          const mainMapIdx = gm.findIndex(m => m.characterName.toLowerCase() === canonicalMain.toLowerCase());

          const currentAssignedDubber = assignments.find(a =>
            (a.characterName === canonicalMain || a.characterName === aliasName) && a.dubberId
          )?.dubberId;

          const dubberToUse = (mainMapIdx !== -1 && gm[mainMapIdx].dubberId)
            ? gm[mainMapIdx].dubberId
            : (aliasMapEntry?.dubberId || currentAssignedDubber || '');

          const photoToUse = (mainMapIdx !== -1 && gm[mainMapIdx].photoUrl)
            ? gm[mainMapIdx].photoUrl
            : aliasMapEntry?.photoUrl;

          if (mainMapIdx !== -1) {
            gm[mainMapIdx] = {
              ...gm[mainMapIdx],
              characterName: canonicalMain,
              dubberId: dubberToUse,
              photoUrl: photoToUse || gm[mainMapIdx].photoUrl,
              isMain: gm[mainMapIdx].isMain || aliasMapEntry?.isMain || false
            };
          } else {
            gm.push({
              characterName: canonicalMain,
              dubberId: dubberToUse,
              photoUrl: photoToUse,
              isMain: aliasMapEntry?.isMain || false
            });
          }

          const updatedProject = {
            ...currentEpisode.project!,
            characterAliases: JSON.stringify(currentAliases),
            globalMapping: JSON.stringify(gm)
          };
          await ipcSafe.invoke('save-project', updatedProject);
          if (currentEpisode.project) {
            currentEpisode.project.characterAliases = updatedProject.characterAliases;
            currentEpisode.project.globalMapping = updatedProject.globalMapping;
          }

          const aliasAssignments = assignments.filter(a => a.characterName === aliasName);
          const updatedAssignments = assignments.filter(a => a.characterName !== aliasName);

          aliasAssignments.forEach(aa => {
            const dubberIdToUse = aa.dubberId;
            const dubberToUse = aa.dubber;
            const alreadyHasThisDubber = updatedAssignments.some(
              a => a.characterName === canonicalMain && a.dubberId === dubberIdToUse
            );

            if (!alreadyHasThisDubber && dubberIdToUse) {
              updatedAssignments.push({
                ...aa,
                characterName: canonicalMain,
                dubberId: dubberIdToUse,
                dubber: dubberToUse,
                id: Math.random().toString(36).substring(2, 11)
              });
            }
          });

          const mappingEntries = gm.filter(m => m.characterName === canonicalMain && m.dubberId);
          mappingEntries.forEach(me => {
            const alreadyHasThisDubber = updatedAssignments.some(
              a => a.characterName === canonicalMain && a.dubberId === me.dubberId
            );
            if (!alreadyHasThisDubber) {
              updatedAssignments.push({
                id: Math.random().toString(36).substring(2, 11),
                episodeId: currentEpisode.id,
                characterName: canonicalMain,
                dubberId: me.dubberId,
                dubber: participants.find(p => p.id === me.dubberId),
                status: 'PENDING',
                lineCount: 0
              });
            }
          });

          if (updatedAssignments.filter(a => a.characterName === canonicalMain).length === 0) {
            updatedAssignments.push({
              id: Math.random().toString(36).substring(2, 11),
              episodeId: currentEpisode.id,
              characterName: canonicalMain,
              dubberId: dubberToUse || "",
              status: "PENDING"
            });
          }

          try {
            const freshProj = await ipcSafe.invoke('get-project', currentEpisode.projectId);
            if (freshProj && Array.isArray(freshProj.episodes)) {
              for (const ep of freshProj.episodes) {
                if (ep.id === currentEpisode.id) continue;
                if (Array.isArray(ep.assignments) && ep.assignments.some((a: any) => a.characterName === aliasName)) {
                  let epChanged = false;
                  const epAliasAssigns = ep.assignments.filter((a: any) => a.characterName === aliasName);
                  const epUpdatedAssigns = ep.assignments.filter((a: any) => a.characterName !== aliasName);

                  epAliasAssigns.forEach((aa: any) => {
                    const dId = aa.dubberId;
                    const exists = epUpdatedAssigns.some(
                      (a: any) => a.characterName === canonicalMain && a.dubberId === dId
                    );
                    if (!exists && dId) {
                      epUpdatedAssigns.push({
                        ...aa,
                        characterName: canonicalMain,
                        id: Math.random().toString(36).substring(2, 11)
                      });
                      epChanged = true;
                    }
                  });

                  if (epUpdatedAssigns.filter((a: any) => a.characterName === canonicalMain).length === 0) {
                    epUpdatedAssigns.push({
                      id: Math.random().toString(36).substring(2, 11),
                      episodeId: ep.id,
                      characterName: canonicalMain,
                      dubberId: dubberToUse || "",
                      status: "PENDING"
                    });
                    epChanged = true;
                  }

                  if (epChanged || epUpdatedAssigns.length !== ep.assignments.length) {
                    const clean = epUpdatedAssigns.map(({ dubber, substitute, ...r }: any) => r);
                    await ipcSafe.invoke('save-episode', { ...ep, assignments: clean });
                  }
                }
              }
            }
          } catch (cascadeErr) {
            console.warn("Could not cascade alias merge to all project episodes:", cascadeErr);
          }

          if (currentEpisode.subPath) {
            try {
              const data = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
              if (data && data.lines) {
                const updatedLines = data.lines.map((l: any) => {
                  if (l.name === aliasName) {
                    return { ...l, name: canonicalMain };
                  }
                  return l;
                });
                await ipcSafe.invoke('save-translated-subtitles', {
                  assFilePath: currentEpisode.subPath,
                  translatedLines: updatedLines
                });
              }
            } catch (err) {
              console.error("Error updating .ass file with new alias:", err);
            }
          }

          setAssignments(updatedAssignments);
          await saveToDatabase(updatedAssignments);
          setActors(prev => Array.from(new Set(prev.map(a => a === aliasName ? canonicalMain : a))));
          setLinkingCharacter(null);
          toast.success(`Персонаж "${aliasName}" успешно привязан как алиас для "${canonicalMain}" для всего проекта.`);
          onRefresh();
        } catch (error) {
          console.error("Link alias error:", error);
          toast.error("Ошибка при связывании алиаса.");
        }
      }
    });
  }, [assignments, currentEpisode, onRefresh, participants, saveToDatabase, setActors, setAssignments, setConfirmState, setLinkingCharacter]);

  return {
    globalMapping,
    characterAliases,
    getCharacterPortrait,
    handleTransliterateNames,
    handlePolivanovToHepburn,
    handleLinkAsAlias,
  };
}
