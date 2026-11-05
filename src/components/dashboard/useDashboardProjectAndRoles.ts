import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { Participant, Project, Episode, EpisodeStatus } from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';
import {
  getNextEpisodeDate,
  checkNewEpisodesForProject,
  getCachedTrackerNewEpisode
} from '../../services/animeService';
import { initNewProjectWithPreset } from '../../lib/releasePresetsService';
import { calculateDeadline } from '../../lib/dateUtils';
import { SIGN_KEYWORDS } from '../../constants';

export async function extractActorsAndAssignFromSubtitles(
  subPath: string,
  latestEp: Episode,
  selectedProject: Project | undefined,
  participants: Participant[]
) {
  try {
    const result = await ipcSafe.invoke('get-raw-subtitles', subPath);
    if (result && result.actors) {
      const rawActors: string[] = result.actors;
      const lines: any[] = result.lines || [];

      let aliases: Record<string, string> = {};
      try {
        aliases = JSON.parse(selectedProject?.characterAliases || '{}');
      } catch (e) {}

      const lineCounts: Record<string, number> = {};
      lines.forEach(line => {
        const nameToUse = line.name || line.actor || line.style || 'Unknown';
        const mainName = aliases[nameToUse] || nameToUse;
        lineCounts[mainName] = (lineCounts[mainName] || 0) + 1;
      });

      const mainActors = Array.from(
        new Set(
          rawActors.map(name => {
            const nameToUse = name || 'Unknown';
            return aliases[nameToUse] || nameToUse;
          })
        )
      ).filter(name => !SIGN_KEYWORDS.includes(name as string)) as string[];

      const globalMappingRaw = selectedProject?.globalMapping || '[]';
      let globalMapping: { characterName: string; dubberId: string; isMain?: boolean }[] = [];
      try {
        const parsed = JSON.parse(globalMappingRaw);
        if (Array.isArray(parsed)) {
          globalMapping = parsed;
        } else if (parsed && typeof parsed === 'object') {
          globalMapping = Object.entries(parsed).map(([k, v]) => ({
            characterName: k,
            dubberId: v as string
          }));
        }
      } catch (e) {}

      const existingAssignments = Array.isArray(latestEp.assignments) ? latestEp.assignments : [];
      const existingNames = new Set(existingAssignments.map(a => a.characterName));
      const toAdd = mainActors.filter(name => !existingNames.has(name));

      const newAssignments = toAdd.map((actor: string) => {
        const mappingEntry = globalMapping.find(m => m.characterName === actor);
        let dubberId = mappingEntry?.dubberId || '';
        const isMain = mappingEntry?.isMain || false;

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
          id: `${latestEp.id}-${actor}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          episodeId: latestEp.id,
          characterName: actor,
          dubberId: dubberId,
          dubber: dubber,
          status: 'PENDING' as const,
          lineCount: lineCounts[actor] || 0,
          isMain: isMain
        };
      });

      return [...existingAssignments, ...newAssignments];
    }
  } catch (e) {
    console.error('Auto-extract characters failed:', e);
  }
  return latestEp.assignments || [];
}

export interface UseDashboardProjectAndRolesParams {
  projects: Project[];
  selectedProjectId: string | null;
  selectedProject: Project | undefined;
  currentEpisode: Episode | null;
  participants: Participant[];
  selectedUserId: string;
  setSelectedUserId: React.Dispatch<React.SetStateAction<string>>;
  characterName: string;
  setCharacterName: React.Dispatch<React.SetStateAction<string>>;
  onProjectSelect: (id: string) => void;
  onEpisodeSelect: (num: number) => void;
  onRefresh: () => void;
  setIsNewProjectModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsNewEpisodeModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsDeleteProjectModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsDeleteEpisodeModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsAssignDubbersModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsAssignModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsAssignSoundEngineerModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setConfirmState: React.Dispatch<
    React.SetStateAction<{
      isOpen: boolean;
      title: string;
      message: string;
      onConfirm: () => void;
      variant?: 'danger' | 'warning' | 'info';
    }>
  >;
}

export function useDashboardProjectAndRoles({
  projects,
  selectedProjectId,
  selectedProject,
  currentEpisode,
  participants,
  selectedUserId,
  setSelectedUserId,
  characterName,
  setCharacterName,
  onProjectSelect,
  onEpisodeSelect,
  onRefresh,
  setIsNewProjectModalOpen,
  setIsNewEpisodeModalOpen,
  setIsDeleteProjectModalOpen,
  setIsDeleteEpisodeModalOpen,
  setIsAssignDubbersModalOpen,
  setIsAssignModalOpen,
  setIsAssignSoundEngineerModalOpen,
  setConfirmState
}: UseDashboardProjectAndRolesParams) {
  const [nextEpisodeDate, setNextEpisodeDate] = useState<string | null>(null);
  const [newEpisodeAvailable, setNewEpisodeAvailable] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const fetchNextDate = async () => {
      if (!selectedProject) {
        setNextEpisodeDate(null);
        return;
      }

      if (selectedProject.nextEpisodeDate) {
        setNextEpisodeDate(selectedProject.nextEpisodeDate);
      } else {
        setNextEpisodeDate(null);
      }

      const isFinishedAiring =
        selectedProject.status === 'COMPLETED' ||
        selectedProject.isOngoing === false ||
        (Boolean(selectedProject.totalEpisodes) &&
          (selectedProject.episodes?.reduce((max, ep) => Math.max(max, ep.number), 0) || 0) >=
            (selectedProject.totalEpisodes || 0));

      if (isFinishedAiring) return;

      const queryTitle = selectedProject.originalTitle || selectedProject.title;
      if (queryTitle) {
        try {
          const date = await getNextEpisodeDate(queryTitle);
          if (active && date) {
            setNextEpisodeDate(date);
          }
        } catch (e) {
          console.error('Error fetching/updating next episode date on layout match:', e);
        }
      }
    };
    fetchNextDate();
    return () => {
      active = false;
    };
  }, [selectedProject?.id]);

  useEffect(() => {
    if (!selectedProject) {
      setNewEpisodeAvailable(null);
      return;
    }

    const cached = getCachedTrackerNewEpisode(selectedProject);
    if (cached.hit) {
      setNewEpisodeAvailable(cached.value);
      return;
    }

    const currentMaxEp = selectedProject.episodes?.reduce((max, ep) => Math.max(max, ep.number), 0) || 0;
    const isFinishedAiring =
      selectedProject.status === 'COMPLETED' ||
      selectedProject.isOngoing === false ||
      Boolean(selectedProject.totalEpisodes && currentMaxEp >= selectedProject.totalEpisodes);

    if (isFinishedAiring) {
      setNewEpisodeAvailable(null);
      return;
    }

    let active = true;
    checkNewEpisodesForProject(selectedProject, false)
      .then(ep => {
        if (active) setNewEpisodeAvailable(ep);
      })
      .catch(() => {
        if (active) setNewEpisodeAvailable(null);
      });

    return () => {
      active = false;
    };
  }, [selectedProject?.id, selectedProject?.originalTitle, selectedProject?.episodes?.length]);

  const stats = useMemo(
    () => ({
      totalProjects: projects.length,
      activeEpisodes: projects.reduce(
        (acc, p) => acc + (p.episodes?.filter(e => e.status !== 'FINISHED')?.length || 0),
        0
      ),
      finishedEpisodes: projects.reduce(
        (acc, p) => acc + (p.episodes?.filter(e => e.status === 'FINISHED')?.length || 0),
        0
      ),
      pendingFixes: projects.reduce(
        (acc, p) => acc + (p.episodes?.filter(e => e.status === 'FIXES')?.length || 0),
        0
      )
    }),
    [projects]
  );

  const recentEpisodes = useMemo(
    () =>
      projects
        .flatMap(p => (p.episodes || []).map(e => ({ ...e, projectTitle: p.title })))
        .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
        .slice(0, 5),
    [projects]
  );

  const handleSaveProjectDubbers = async (selectedDubbers: string[]) => {
    if (!selectedProject) return;
    const allowedDubbers = new Set(selectedDubbers);

    let cleanedGlobalMapping = selectedProject.globalMapping;
    if (selectedProject.globalMapping) {
      try {
        const mapping =
          typeof selectedProject.globalMapping === 'string'
            ? JSON.parse(selectedProject.globalMapping)
            : selectedProject.globalMapping;
        if (Array.isArray(mapping)) {
          mapping.forEach((m: any) => {
            if (m.dubberId && !allowedDubbers.has(m.dubberId)) {
              m.dubberId = '';
            }
          });
          cleanedGlobalMapping = JSON.stringify(mapping);
        }
      } catch (e) {
        console.error('Error cleaning globalMapping in local state:', e);
      }
    }

    const cleanedEpisodes = (selectedProject.episodes || []).map(ep => ({
      ...ep,
      assignments: (ep.assignments || []).map(a => ({
        ...a,
        dubberId: a.dubberId && !allowedDubbers.has(a.dubberId) ? undefined : a.dubberId,
        substituteId: a.substituteId && !allowedDubbers.has(a.substituteId) ? undefined : a.substituteId,
        dubber: a.dubberId && !allowedDubbers.has(a.dubberId) ? undefined : a.dubber,
        substitute: a.substituteId && !allowedDubbers.has(a.substituteId) ? undefined : a.substitute
      }))
    }));

    const updatedProject = {
      ...selectedProject,
      assignedDubberIds: selectedDubbers,
      globalMapping: cleanedGlobalMapping,
      episodes: cleanedEpisodes
    };
    await ipcSafe.invoke('save-project', updatedProject);
    toast.success('Состав даберов обновлен. Привязки снятых даберов очищены.');
    onRefresh();
    setIsAssignDubbersModalOpen(false);
  };

  const handleCreateProject = async (projectData: any) => {
    try {
      const baseProject = {
        id: Date.now().toString(),
        title: projectData.title,
        originalTitle: projectData.originalTitle || '',
        releaseType: projectData.releaseType || 'VOICEOVER',
        emoji: projectData.emoji || '❤️',
        isOngoing: projectData.isOngoing ?? true,
        synopsis: projectData.synopsis || '',
        posterUrl: projectData.posterUrl || '',
        typeAndSeason: projectData.typeAndSeason || '',
        totalEpisodes: projectData.totalEpisodes || 12,
        globalMapping: JSON.stringify(
          Array.isArray(projectData.characters)
            ? projectData.characters.map((c: any) => ({
                characterName: c.name,
                dubberId: c.dubberId,
                photoUrl: c.photoUrl
              }))
            : []
        ),
        links: JSON.stringify({ tg: '', vk: '', anime365: '', shikimori: '', kodik: '' }),
        status: 'ACTIVE' as const,
        lastActiveEpisode: 1,
        assignedDubberIds: [],
        episodes: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const newProject = initNewProjectWithPreset(baseProject);
      await ipcSafe.invoke('save-project', newProject);
      toast.success('Проект успешно создан!');
      onRefresh();
      onProjectSelect(newProject.id);
      setIsNewProjectModalOpen(false);
    } catch (e) {
      console.error('Failed to create project:', e);
      toast.error('Ошибка при создании проекта');
    }
  };

  const handleDeleteProject = async () => {
    if (!selectedProjectId) return;
    setConfirmState({
      isOpen: true,
      title: 'Удаление проекта',
      message: 'Вы уверены, что хотите удалить этот проект и все его серии? Это действие необратимо.',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await ipcSafe.invoke('delete-project', selectedProjectId);
          onProjectSelect('');
          onRefresh();
          setIsDeleteProjectModalOpen(false);
          toast.success('Проект удален');
        } catch (error) {
          console.error('Failed to delete project:', error);
          toast.error('Ошибка при удалении проекта');
        }
      }
    });
  };

  const handleDeleteEpisode = async () => {
    if (!currentEpisode) return;
    setConfirmState({
      isOpen: true,
      title: 'Удаление серии',
      message: `Вы уверены, что хотите удалить серию ${currentEpisode.number}?`,
      variant: 'danger',
      onConfirm: async () => {
        try {
          await ipcSafe.invoke('delete-episode', currentEpisode.id);
          onRefresh();
          setIsDeleteEpisodeModalOpen(false);
          toast.success('Серия удалена');
        } catch (error) {
          console.error('Failed to delete episode:', error);
          toast.error('Ошибка при удалении серии');
        }
      }
    });
  };

  const handleFinishEpisode = async () => {
    if (!currentEpisode) return;

    setConfirmState({
      isOpen: true,
      title: 'Завершение серии',
      message: `Вы уверены, что хотите отметить серию ${currentEpisode.number} как завершенную?`,
      variant: 'info',
      onConfirm: async () => {
        try {
          const updatedEpisode = {
            ...currentEpisode,
            status: 'FINISHED' as EpisodeStatus
          };
          await ipcSafe.invoke('save-episode', updatedEpisode);
          onRefresh();
          toast.success('Серия завершена!');
        } catch (error) {
          console.error('Failed to finish episode:', error);
          toast.error('Ошибка при завершении серии');
        }
      }
    });
  };

  const handleCreateEpisode = async (episodeNumber: number, customTitle?: string, customDeadline?: string) => {
    if (!selectedProjectId || !selectedProject) return;

    const alreadyExists = selectedProject.episodes?.some(e => e.number === episodeNumber);
    if (alreadyExists) {
      toast.error(`Серия ${episodeNumber} уже добавлена в этот проект!`);
      return;
    }

    try {
      let episodeTitle = customTitle?.trim() || '';

      if (!episodeTitle) {
        try {
          const timeoutPromise = new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 1500)
          );
          const fetchPromise = ipcSafe.invoke('get-episode-title', {
            title: selectedProject.title,
            originalTitle: selectedProject.originalTitle,
            episodeNumber,
            anime365Id: selectedProject.anime365Id
          });
          const fetchedTitle = await Promise.race([fetchPromise, timeoutPromise]);
          if (fetchedTitle && typeof fetchedTitle === 'string') {
            episodeTitle = fetchedTitle;
          }
        } catch {
          // Graceful non-blocking fallback
        }
      }

      const initialDeadline = customDeadline || calculateDeadline(selectedProject);
      const newEpisode: Episode = {
        id: Date.now().toString(),
        projectId: selectedProjectId,
        number: episodeNumber,
        title: episodeTitle,
        status: 'UPLOAD',
        deadline: initialDeadline,
        assignments: [],
        uploads: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await ipcSafe.invoke('save-episode', newEpisode);

      await ipcSafe.invoke('save-project', {
        ...selectedProject,
        lastActiveEpisode: episodeNumber
      });

      await onRefresh();
      if (onEpisodeSelect) {
        onEpisodeSelect(episodeNumber);
      }
      setIsNewEpisodeModalOpen(false);
      toast.success(`Серия ${episodeNumber} успешно добавлена!`);
    } catch (e: any) {
      console.error('Failed to create episode:', e);
      toast.error(`Ошибка при создании серии: ${e?.message || 'Неизвестная ошибка'}`);
    }
  };

  const handleExportProject = async () => {
    if (!selectedProject) return;

    const allParticipants = await ipcSafe.invoke('get-participants');

    const exportData = {
      type: 'PROJECT_RELEASE_BUNDLE',
      version: '1.2',
      exportDate: new Date().toISOString(),
      project: selectedProject,
      participants: allParticipants,
      audit: {
        totalEpisodes: selectedProject.episodes?.length || 0,
        totalAssignments:
          selectedProject.episodes?.reduce((acc, ep) => acc + (ep.assignments?.length || 0), 0) || 0,
        totalUploads:
          selectedProject.episodes?.reduce((acc, ep) => acc + (ep.uploads?.length || 0), 0) || 0,
        completedEpisodes: selectedProject.episodes?.filter(ep => ep.status === 'FINISHED')?.length || 0
      }
    };

    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute('href', dataStr);
    downloadAnchorNode.setAttribute(
      'download',
      `${selectedProject.title}_release_audit_${new Date().toISOString().split('T')[0]}.json`
    );
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleAssignRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentEpisode || !selectedUserId || !characterName || !selectedProject) return;

    const aliases: Record<string, string> = JSON.parse(selectedProject.characterAliases || '{}');
    const mainName = aliases[characterName] || characterName;

    const updateProjectGlobalMapping = async (char: string, dubberId: string) => {
      let gMap: { characterName: string; dubberId: string; isMain?: boolean }[] = [];
      try {
        const parsed = JSON.parse(selectedProject.globalMapping || '[]');
        gMap = Array.isArray(parsed)
          ? parsed
          : Object.entries(parsed).map(([k, v]) => ({ characterName: k, dubberId: v as string }));
      } catch (e) {
        gMap = [];
      }

      const seen = new Set<string>();
      let found = false;
      const updatedGMap: typeof gMap = [];

      for (const item of gMap) {
        if (!item.characterName || seen.has(item.characterName)) continue;
        seen.add(item.characterName);
        if (item.characterName === char) {
          found = true;
          updatedGMap.push({ ...item, dubberId });
        } else {
          updatedGMap.push(item);
        }
      }
      if (!found) {
        updatedGMap.push({ characterName: char, dubberId });
      }

      const assignedDubberIds = Array.isArray(selectedProject.assignedDubberIds)
        ? [...selectedProject.assignedDubberIds]
        : [];
      if (!assignedDubberIds.includes(dubberId)) {
        assignedDubberIds.push(dubberId);
      }

      const updatedMappingStr = JSON.stringify(updatedGMap);
      selectedProject.globalMapping = updatedMappingStr;
      selectedProject.assignedDubberIds = assignedDubberIds;

      const { episodes: _eps, soundEngineer: _se, assignedDubbers: _ad, ...projToSave } = selectedProject;
      await ipcSafe.invoke('save-project', {
        ...projToSave,
        assignedDubberIds,
        globalMapping: updatedMappingStr
      });
    };

    const existing = Array.isArray(currentEpisode.assignments)
      ? currentEpisode.assignments.find(a => a.characterName === mainName)
      : undefined;
    if (existing) {
      if (existing.dubberId === selectedUserId) {
        toast.error('Этот дабер уже назначен на этого персонажа в этой серии.');
        return;
      }

      setConfirmState({
        isOpen: true,
        title: 'Переназначение роли',
        message: `Персонаж "${mainName}" уже назначен на ${participants.find(p => p.id === existing.dubberId)?.nickname}. Переназначить на ${participants.find(p => p.id === selectedUserId)?.nickname}?`,
        onConfirm: async () => {
          const currentAssignments = Array.isArray(currentEpisode.assignments)
            ? currentEpisode.assignments.filter(a => a.characterName !== mainName)
            : [];

          const newAssignment = {
            id: Date.now().toString(),
            episodeId: currentEpisode.id,
            characterName: mainName,
            dubberId: selectedUserId,
            status: 'PENDING'
          };

          const updatedEpisode = {
            ...currentEpisode,
            assignments: [...currentAssignments, newAssignment]
          };

          await ipcSafe.invoke('save-episode', updatedEpisode);
          await updateProjectGlobalMapping(mainName, selectedUserId);
          onRefresh();
          toast.success('Роль переназначена');
        }
      });
      return;
    }

    const newAssignment = {
      id: Date.now().toString(),
      episodeId: currentEpisode.id,
      characterName: mainName,
      dubberId: selectedUserId,
      status: 'PENDING'
    };

    const updatedEpisode = {
      ...currentEpisode,
      assignments: [...(Array.isArray(currentEpisode.assignments) ? currentEpisode.assignments : []), newAssignment]
    };

    await ipcSafe.invoke('save-episode', updatedEpisode);
    await updateProjectGlobalMapping(mainName, selectedUserId);

    onRefresh();
    setIsAssignModalOpen(false);
    setSelectedUserId('');
    setCharacterName('');
  };

  const handleAssignSoundEngineer = async (soundEngineerId: string) => {
    if (selectedProject) {
      const updatedProject = { ...selectedProject, soundEngineerId };
      await ipcSafe.invoke('save-project', updatedProject);
    }
    onRefresh();
    setIsAssignSoundEngineerModalOpen(false);
  };

  return {
    nextEpisodeDate,
    newEpisodeAvailable,
    stats,
    recentEpisodes,
    handleSaveProjectDubbers,
    handleCreateProject,
    handleDeleteProject,
    handleDeleteEpisode,
    handleFinishEpisode,
    handleCreateEpisode,
    handleExportProject,
    handleAssignRole,
    handleAssignSoundEngineer
  };
}
