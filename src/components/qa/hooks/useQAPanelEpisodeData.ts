import { useEffect, useState, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { ipcSafe } from '../../../lib/ipcSafe';
import { Episode, Track, SubtitleLine, Comment, Participant } from '../../../types';
import { sanitizeFolderName } from '../../../lib/pathUtils';
import { SIGN_KEYWORDS } from '../../../constants';
import { prepareQATracksForTiming, normalizeKey } from '../../../lib/qaTimingHelper';
import { resolveLocalPath } from '../../../lib/webFileSystem';

export interface UseQAPanelEpisodeDataParams {
  currentEpisode: Episode | null;
  onRefresh: () => void;
  isSplitMultiTracks: boolean;
  selectedTrackId: string | null;
  setSelectedTrackId: React.Dispatch<React.SetStateAction<string | null>>;
  currentTime: number;
  newComment: string;
  setNewComment: React.Dispatch<React.SetStateAction<string>>;
  isManualDubberOverride: boolean;
  manualDubberId: string;
  setConfirmState: React.Dispatch<React.SetStateAction<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    variant?: 'danger' | 'warning' | 'info';
  }>>;
}

export function useQAPanelEpisodeData({
  currentEpisode,
  onRefresh,
  isSplitMultiTracks,
  selectedTrackId,
  setSelectedTrackId,
  currentTime,
  newComment,
  setNewComment,
  isManualDubberOverride,
  manualDubberId,
  setConfirmState
}: UseQAPanelEpisodeDataParams) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [subLines, setSubLines] = useState<SubtitleLine[]>([]);
  const [currentCharacter, setCurrentCharacter] = useState<string | null>(null);
  const [currentDubberNickname, setCurrentDubberNickname] = useState<string | null>(null);
  const [currentSubtitleText, setCurrentSubtitleText] = useState<string | null>(null);
  const [currentSubId, setCurrentSubId] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | undefined>(undefined);

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

  // Video URL resolving
  useEffect(() => {
    let active = true;
    const resolvePath = async () => {
      if (!currentEpisode?.rawPath) {
        if (active) setVideoUrl(undefined);
        return;
      }
      
      if (!window.electronAPI) {
        const cleanName = currentEpisode.rawPath.replace(/\\/g, '/').split('/').pop() || currentEpisode.rawPath;
        const cached = (window as any).getFileFromCache?.(cleanName);
        if (cached) {
          if (active) setVideoUrl(URL.createObjectURL(cached));
          return;
        }
        try {
          const resolved = await resolveLocalPath(currentEpisode.rawPath);
          if (active) setVideoUrl(resolved);
        } catch (e) {
          if (active) setVideoUrl(currentEpisode.rawPath);
        }
      } else {
        let src = currentEpisode.rawPath;
        if (!src.startsWith('http') && !src.startsWith('file://') && !src.startsWith('blob:')) {
          src = `file://${src}`;
        }
        if (active) setVideoUrl(src);
      }
    };
    resolvePath();
    return () => { active = false; };
  }, [currentEpisode?.rawPath]);

  // Track mapping from episode assignments and uploads
  useEffect(() => {
    if (!currentEpisode) return;
    
    const dubberTracks: Record<string, Track> = {};
    
    currentEpisode.assignments?.forEach(as => {
      const dubberId = as.substituteId || as.dubberId;
      const dubberName = as.substitute?.nickname || as.dubber?.nickname || 'Неизвестно';
      
      const dubberFiles = currentEpisode.uploads?.filter(u => 
        (u.type === 'DUBBER_FILE' || u.type === 'FIXES') && 
        (u.assignmentId === as.id || currentEpisode.assignments?.find(a => a.id === u.assignmentId)?.dubberId === dubberId || currentEpisode.assignments?.find(a => a.id === u.assignmentId)?.substituteId === dubberId)
      ).map(u => ({ id: u.id, path: u.path, createdAt: u.createdAt, type: u.type, size: u.size })) || [];
      
      let comments: Comment[] = [];
      if (as.comments) {
        try {
          comments = JSON.parse(as.comments);
        } catch (e) {
          console.error('Failed to parse comments', e);
        }
      }

      if (!dubberTracks[dubberId]) {
        dubberTracks[dubberId] = {
          id: dubberId,
          participant: dubberName,
          character: as.characterName,
          status: (as.status?.toLowerCase() || 'pending') as Track['status'],
          files: dubberFiles,
          selectedFileId: dubberFiles.length > 0 ? dubberFiles[0].id : undefined,
          comments
        };
      } else {
        if (!dubberTracks[dubberId].character.includes(as.characterName)) {
          dubberTracks[dubberId].character += `, ${as.characterName}`;
        }
        dubberFiles.forEach(f => {
          if (!dubberTracks[dubberId].files.find(existing => existing.id === f.id)) {
            dubberTracks[dubberId].files.push(f);
          }
        });
        dubberTracks[dubberId].comments = [...dubberTracks[dubberId].comments, ...comments];
        
        const currentStatus = dubberTracks[dubberId].status;
        const newStatus = as.status?.toLowerCase() as Track['status'];
        const priorities: Record<string, number> = {
          'rejected': 4,
          'fixes_needed': 3,
          'pending': 2,
          'approved': 1
        };
        const currentPriority = priorities[currentStatus] || 0;
        const newPriority = priorities[newStatus] || 0;
        if (newPriority > currentPriority) {
          dubberTracks[dubberId].status = newStatus;
        }
      }
    });
    
    let mappedTracks: Track[] = [];
    try {
      mappedTracks = prepareQATracksForTiming(currentEpisode, [], isSplitMultiTracks);
    } catch (e) {
      console.warn('Fallback to basic dubberTracks mapping', e);
    }

    if (mappedTracks.length === 0) {
      mappedTracks = Object.values(dubberTracks);
    }
    
    const originalTrack: Track = {
      id: 'original',
      participant: 'Оригинал',
      character: 'Оригинал',
      status: 'approved',
      files: [{ id: 'orig', path: currentEpisode.rawPath, createdAt: '', type: 'DUBBER_FILE' }],
      selectedFileId: 'orig',
      comments: []
    };
    
    setTracks([originalTrack, ...mappedTracks]);
    if (mappedTracks.length > 0 && !selectedTrackId) {
      setSelectedTrackId(mappedTracks[0].id);
    }
  }, [currentEpisode, isSplitMultiTracks, selectedTrackId, setSelectedTrackId]);

  // Load subtitles for QA
  useEffect(() => {
    const loadSubs = async () => {
      if (currentEpisode?.subPath) {
        try {
          const res = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
          if (res && res.lines) {
            const processedLines = (res.lines as SubtitleLine[])
              .filter((l: SubtitleLine) => {
                const name = (l.name || '').toLowerCase();
                const style = (l.style || '').toLowerCase();
                return !SIGN_KEYWORDS.some(k => name.includes(k.toLowerCase()) || style.includes(k.toLowerCase()));
              })
              .map((l: SubtitleLine) => ({
                ...l,
                startSec: typeof l.start === 'number' ? l.start : parseAssTime(l.start || ''),
                endSec: typeof l.end === 'number' ? l.end : parseAssTime(l.end || '')
              })).sort((a: SubtitleLine, b: SubtitleLine) => (a.startSec ?? 0) - (b.startSec ?? 0));
            setSubLines(processedLines);
          }
        } catch (e) {
          console.error('Failed to load subs for QA', e);
        }
      }
    };
    loadSubs();
  }, [currentEpisode?.subPath]);

  // Track active character and subtitle by current time
  useEffect(() => {
    if (subLines.length === 0) return;

    let lastStartedSub: SubtitleLine | null = null;
    for (let i = subLines.length - 1; i >= 0; i--) {
      if (currentTime >= (subLines[i].startSec ?? 0)) {
        lastStartedSub = subLines[i];
        break;
      }
    }

    if (lastStartedSub) {
      const name = (lastStartedSub.name || '').toLowerCase();
      const style = (lastStartedSub.style || '').toLowerCase();
      const isSign = SIGN_KEYWORDS.some(k => name.includes(k.toLowerCase()) || style.includes(k.toLowerCase()));

      if (isSign) {
        setCurrentCharacter(null);
        setCurrentSubId(null);
        setCurrentDubberNickname(null);
        setCurrentSubtitleText(null);
        return;
      }

      const aliases: Record<string, string> = JSON.parse(currentEpisode?.project?.characterAliases || '{}');
      const mainName = aliases[lastStartedSub.name] || lastStartedSub.name;
      setCurrentCharacter(mainName);
      setCurrentSubId(lastStartedSub.id || (lastStartedSub as any).index?.toString() || null);
      
      const assignment = currentEpisode?.assignments?.find(a => a.characterName.toLowerCase() === mainName.toLowerCase());
      if (assignment) {
        setCurrentDubberNickname(assignment.substitute?.nickname || assignment.dubber?.nickname || null);
      } else {
        setCurrentDubberNickname(null);
      }

      if (currentTime <= (lastStartedSub.endSec ?? 0)) {
        setCurrentSubtitleText(lastStartedSub.text);
      } else {
        setCurrentSubtitleText(null);
      }
    } else {
      setCurrentCharacter(null);
      setCurrentDubberNickname(null);
      setCurrentSubtitleText(null);
    }
  }, [currentTime, subLines, currentEpisode?.project?.characterAliases, currentEpisode?.assignments]);

  const handleReassignCharacter = async (newCharacterName: string) => {
    if (!currentEpisode || !currentSubId || !currentEpisode.subPath) return;

    try {
      const lineIndex = parseInt(currentSubId);
      if (isNaN(lineIndex)) return;

      const updates = [{
        rawLineIndex: lineIndex,
        name: newCharacterName
      }];

      await ipcSafe.invoke('save-raw-subtitles', { filePath: currentEpisode.subPath, lines: updates });
      
      setSubLines(prev => prev.map(l => 
        l.rawLineIndex === lineIndex ? { ...l, name: newCharacterName } : l
      ));
      
      setCurrentCharacter(newCharacterName);
      
      const assignment = currentEpisode?.assignments?.find(a => a.characterName.toLowerCase() === newCharacterName.toLowerCase());
      if (assignment) {
        setCurrentDubberNickname(assignment.substitute?.nickname || assignment.dubber?.nickname || null);
      } else {
        setCurrentDubberNickname(null);
      }

      toast.success(`Реплика переназначена на ${newCharacterName}`);
    } catch (error) {
      console.error('Reassign character error:', error);
      toast.error('Ошибка при переназначении персонажа');
    }
  };

  const handleUpdateSubLineFromModal = useCallback(async (updatedLine: { rawLineIndex: number; name?: string; text?: string; start?: string; end?: string }) => {
    if (!currentEpisode?.subPath) {
      toast.error('Файл субтитров отсутствует в серии');
      return;
    }
    try {
      await ipcSafe.invoke('save-raw-subtitles', {
        filePath: currentEpisode.subPath,
        lines: [updatedLine]
      });

      setSubLines(prev => prev.map(l => {
        if (l.rawLineIndex !== updatedLine.rawLineIndex) return l;
        return {
          ...l,
          name: updatedLine.name !== undefined ? updatedLine.name : l.name,
          text: updatedLine.text !== undefined ? updatedLine.text : l.text,
          start: updatedLine.start !== undefined ? updatedLine.start : l.start,
          end: updatedLine.end !== undefined ? updatedLine.end : l.end
        };
      }));
    } catch (err: any) {
      console.error('Failed to update subtitle line:', err);
      throw err;
    }
  }, [currentEpisode?.subPath]);

  const handleExportSubtitlesFromModal = useCallback(async () => {
    if (!currentEpisode?.subPath) {
      toast.error('Файл субтитров отсутствует в серии');
      return;
    }
    try {
      await ipcSafe.invoke('save-raw-subtitles', {
        filePath: currentEpisode.subPath,
        lines: subLines,
        overwrite: true
      });

      if (window.electronAPI) {
        try {
          const res = await ipcSafe.invoke('dialog:save-file', {
            title: 'Экспортировать исправленные субтитры',
            defaultPath: currentEpisode.subPath.replace(/\.ass$/i, '_исправленные.ass'),
            filters: [{ name: 'ASS Subtitles', extensions: ['ass'] }]
          });
          if (res && !res.canceled && res.filePath) {
            await ipcSafe.invoke('save-raw-subtitles', {
              filePath: res.filePath,
              lines: subLines,
              overwrite: true
            });
            toast.success(`Субтитры успешно сохранены в: ${res.filePath}`);
            return;
          }
        } catch (e) {
          // Dialog skipped
        }
      }
      toast.success('Субтитры успешно сохранены и обновлены с учетом всех правок!');
    } catch (err: any) {
      toast.error(`Ошибка при экспорте субтитров: ${err?.message || err}`);
    }
  }, [currentEpisode?.subPath, subLines]);

  const handleAddComment = useCallback(async (textOverride?: string, customTargetDubberId?: string) => {
    const commentText = (textOverride !== undefined ? textOverride : newComment).trim();
    if (!commentText || !currentEpisode) return;

    const effectiveDubberId = customTargetDubberId || (isManualDubberOverride && manualDubberId ? manualDubberId : null);
    let targetTrackId = effectiveDubberId;

    if (!targetTrackId) {
      targetTrackId = selectedTrackId === 'all' ? null : selectedTrackId;
    }
    
    const baseDubberId = targetTrackId ? targetTrackId.split('__')[0] : null;

    if (!targetTrackId && currentCharacter) {
      const autoAssignment = currentEpisode.assignments?.find(
        a => a.characterName.toLowerCase() === currentCharacter.toLowerCase()
      );
      if (autoAssignment) {
        targetTrackId = autoAssignment.substituteId || autoAssignment.dubberId;
      }
    }

    if (!targetTrackId) {
      if (tracks.length > 0) {
        targetTrackId = tracks[0].id;
      } else {
        toast.error("Не удалось определить дабера для фикса. Включите галочку «Указать дабера» и выберите нужного.");
        return;
      }
    }

    const comment: Comment = {
      id: Math.random().toString(36).substr(2, 9),
      text: commentText,
      timestamp: currentTime,
      author: 'Куратор',
      subId: currentSubId || undefined
    };

    const resolvedDubberId = targetTrackId.split('__')[0];

    const updatedTracks = tracks.map(t => {
      const tBase = t.id.split('__')[0];
      if (t.id === targetTrackId || tBase === resolvedDubberId) {
        return { 
          ...t, 
          comments: [...t.comments, comment],
          status: 'fixes_needed' as const
        };
      }
      return t;
    });
    
    setTracks(updatedTracks);
    if (!textOverride) setNewComment('');

    try {
      const targetDubberAssignments = currentEpisode.assignments?.filter(a => (a.substituteId || a.dubberId) === resolvedDubberId) || [];
      const bestAssignmentMatch = targetDubberAssignments.find(
        a => currentCharacter && a.characterName.toLowerCase() === currentCharacter.toLowerCase()
      ) || targetDubberAssignments[0];

      if (!bestAssignmentMatch) {
        toast.warning('Правка сохранена в дорожку (роль дабера в назначениях не найдена)');
        return;
      }

      const updatedAssignments = currentEpisode.assignments?.map(a => {
        if (a.id === bestAssignmentMatch.id) {
          let existingComments: Comment[] = [];
          try {
            existingComments = JSON.parse(a.comments || '[]');
          } catch (e) {}
          
          return { 
            ...a, 
            comments: JSON.stringify([...existingComments, comment]),
            status: 'FIXES_NEEDED'
          };
        }
        return a;
      }) || [];

      await ipcSafe.invoke('save-episode', { 
        ...currentEpisode, 
        assignments: updatedAssignments,
        status: currentEpisode.status === 'FINISHED' ? 'FINISHED' : 'FIXES'
      });
      const dubberNick = bestAssignmentMatch.substitute?.nickname || bestAssignmentMatch.dubber?.nickname || bestAssignmentMatch.characterName;
      toast.success(`Правка успешно выписана дабберу «${dubberNick}»!`);
      onRefresh();
    } catch (error) {
      console.error('Save comment error:', error);
      toast.error('Ошибка сохранения правки в БД');
    }
  }, [newComment, currentEpisode, selectedTrackId, tracks, currentCharacter, currentTime, currentSubId, isManualDubberOverride, manualDubberId, onRefresh, setNewComment]);

  const handleDeleteComment = async (trackId: string, commentId: string) => {
    if (!currentEpisode) return;

    const baseDubberId = (trackId || '').split('__')[0];

    const updatedTracks = tracks.map(t => {
      const tBase = t.id.split('__')[0];
      if (t.id === trackId || (baseDubberId && tBase === baseDubberId) || t.comments.some(c => c.id === commentId)) {
        return { ...t, comments: t.comments.filter(c => c.id !== commentId) };
      }
      return t;
    });

    setTracks(updatedTracks);

    try {
      const updatedAssignments = currentEpisode.assignments?.map(a => {
        const assignedId = a.substituteId || a.dubberId;
        let existingComments: Comment[] = [];
        try {
          existingComments = JSON.parse(a.comments || '[]');
        } catch (e) {}

        const hasComment = existingComments.some(c => c.id === commentId);
        if (hasComment || (assignedId && (assignedId === trackId || assignedId === baseDubberId))) {
          const filtered = existingComments.filter(c => c.id !== commentId);
          return {
            ...a,
            comments: JSON.stringify(filtered),
            status: filtered.length === 0 && a.status === 'FIXES_NEEDED' ? 'RECORDED' : a.status
          };
        }
        return a;
      }) || [];

      await ipcSafe.invoke('save-episode', { 
        ...currentEpisode, 
        assignments: updatedAssignments 
      });
      onRefresh();
    } catch (error) {
      console.error('Delete comment error:', error);
    }
  };

  const handleApproveAll = async () => {
    if (!currentEpisode) return;

    setConfirmState({
      isOpen: true,
      title: 'Одобрить все дорожки',
      message: 'Одобрить ВСЕ дорожки в этом эпизоде?',
      onConfirm: async () => {
        try {
          const updatedAssignments = currentEpisode.assignments?.map(a => ({
            ...a,
            status: 'APPROVED'
          })) || [];

          await ipcSafe.invoke('save-episode', { 
            ...currentEpisode, 
            assignments: updatedAssignments,
            status: 'SOUND_ENGINEERING'
          });

          onRefresh();
          toast.success('Все дорожки одобрены');
        } catch (error) {
          console.error('Approve all error:', error);
          toast.error('Ошибка при одобрении дорожек');
        }
      }
    });
  };

  const handleStatusChange = async (id: string, status: Track['status']) => {
    if (!currentEpisode) return;
    
    const dbStatus = status.toUpperCase();
    
    try {
      const updatedAssignments = currentEpisode.assignments?.map(a => {
        const assignedId = a.substituteId || a.dubberId;
        const normNick = normalizeKey(a.substitute?.nickname || a.dubber?.nickname || '');
        const rawTrackId = id.replace(/^track_/, '').split('_')[0];
        const normTrackId = normalizeKey(rawTrackId);
        const isMatch = (assignedId && (assignedId === id || id.startsWith(assignedId + '__'))) || (normNick && normNick === normTrackId);
        return isMatch ? { ...a, status: dbStatus } : a;
      }) || [];

      const allApproved = updatedAssignments.every(a => a.status === 'APPROVED');
      const needsFixes = dbStatus === 'FIXES_NEEDED' || dbStatus === 'REJECTED';

      let newStatus = currentEpisode.status;
      if (allApproved) {
        newStatus = 'SOUND_ENGINEERING';
      } else if (needsFixes && currentEpisode.status !== 'FIXES') {
        newStatus = 'FIXES';
      }

      await ipcSafe.invoke('save-episode', { 
        ...currentEpisode, 
        assignments: updatedAssignments,
        status: newStatus
      });

      onRefresh();
    } catch (error) {
      console.error('Status update error:', error);
    }
  };

  const handleFileUpload = async (e: any, trackId: string, type: 'DUBBER_FILE' | 'FIXES' = 'DUBBER_FILE') => {
    const file = e.target.files?.[0];
    if (!file || !currentEpisode) return;

    const parts = trackId.split('__');
    const baseDubberId = parts[0];
    const rawNickKey = normalizeKey(trackId.replace(/^track_/, '').split('_')[0]);

    const assignment = currentEpisode.assignments?.find(a => {
      const aDubberId = a.substituteId || a.dubberId;
      if (aDubberId && (aDubberId === baseDubberId || aDubberId === trackId)) return true;
      const aNick = normalizeKey(a.substitute?.nickname || a.dubber?.nickname || '');
      return aNick && (aNick === rawNickKey || aNick === normalizeKey(baseDubberId));
    });
    if (!assignment) return;

    const projectTitle = sanitizeFolderName(currentEpisode.project?.title || 'Project');
    const episodeFolder = sanitizeFolderName(`Episode_${currentEpisode.number}`);
    const subDir = `${projectTitle}/${episodeFolder}/${type === 'FIXES' ? 'Fixes' : 'QAFixes'}`;
    const prefix = type === 'FIXES' ? 'fix' : 'dub';
    const fileName = `${prefix}_${assignment.id}_${Date.now()}.${file.name.split('.').pop() || 'wav'}`;
    
    try {
      let res;
      if (file.path) {
        res = await ipcSafe.invoke('copy-file', {
          sourcePath: file.path,
          targetDir: subDir,
          fileName
        });
      } else {
        const buffer = await file.arrayBuffer();
        res = await ipcSafe.invoke('save-file-buffer', {
          buffer,
          targetDir: subDir,
          fileName
        });
      }
      
      if (!res || !res.path) throw new Error("Не удалось получить путь сохранения файла");
      
      const newUpload = {
        id: Math.random().toString(36).substr(2, 9),
        episodeId: currentEpisode.id,
        type,
        isFix: type === 'FIXES',
        targetTrackId: trackId,
        path: res.path,
        uploadedById: baseDubberId,
        assignmentId: assignment.id,
        createdAt: new Date().toISOString(),
        size: file.size || res.size || 0
      };

      const updatedUploads = [...(currentEpisode.uploads || []), newUpload];
      const updatedAssignments = currentEpisode.assignments?.map(a => 
        (a.substituteId || a.dubberId) === baseDubberId ? { ...a, status: 'RECORDED' } : a
      ) || [];

      const allRecorded = updatedAssignments.every(a => 
        a.status === 'RECORDED' || a.status === 'APPROVED'
      );
      
      let newStatus = currentEpisode.status;
      if (allRecorded && (currentEpisode.status === 'FIXES' || currentEpisode.status === 'RECORDING')) {
        newStatus = 'QA';
      }
      
      await ipcSafe.invoke('save-episode', { 
        ...currentEpisode, 
        uploads: updatedUploads,
        assignments: updatedAssignments,
        status: newStatus
      });

      if (res && res.path) {
        try {
          await ipcSafe.invoke('audio-run-track-analysis', {
            audioPath: res.path,
            options: {
              skipWhisper: true,
              isFix: type === 'FIXES',
              dubberNick: (assignment as any)?.dubber?.nickname || (assignment as any)?.dubber?.username || (assignment as any)?.dubber?.name || baseDubberId,
              characterName: (assignment as any)?.character?.name || (assignment as any)?.characterName || 'Персонаж'
            }
          });
        } catch (err) {
          console.warn('[QA] Pre-analysis sidecar calculation warning:', err);
        }
      }
      
      onRefresh();
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Upload error:', error);
        toast.error('Ошибка загрузки: ' + (error.message || String(error)));
      }
    }
  };

  const handleFileDelete = async (trackId: string, fileId: string) => {
    if (!currentEpisode) return;
    if (fileId === 'orig') return;

    setConfirmState({
      isOpen: true,
      title: 'Удалить загруженный файл?',
      message: 'Вы уверены, что хотите удалить этот файл? Это действие нельзя отменить.',
      variant: 'danger',
      onConfirm: async () => {
        try {
          const uploads = currentEpisode.uploads || [];
          const uploadToDelete = uploads.find(u => u.id === fileId);
          if (!uploadToDelete) return;
          
          const updatedUploads = uploads.filter(u => u.id !== fileId);
          const baseDubberId = trackId.split('__')[0];
          const dubberFilesRemaining = updatedUploads.some(u => 
            u.uploadedById === baseDubberId || 
            (u.assignmentId && currentEpisode.assignments?.find(a => a.id === u.assignmentId && (a.substituteId || a.dubberId) === baseDubberId))
          );
          
          let updatedAssignments = currentEpisode.assignments;
          let newEpisodeStatus = currentEpisode.status;
          
          if (!dubberFilesRemaining && currentEpisode.assignments) {
            updatedAssignments = currentEpisode.assignments.map(a => 
              (a.substituteId || a.dubberId) === baseDubberId ? { ...a, status: 'PENDING' } : a
            );
            if (currentEpisode.status === 'QA') {
              newEpisodeStatus = 'RECORDING';
            }
          }
          
          await ipcSafe.invoke('save-episode', { 
            ...currentEpisode, 
            uploads: updatedUploads,
            ...(updatedAssignments !== currentEpisode.assignments && { assignments: updatedAssignments, status: newEpisodeStatus })
          });
          
          if (uploadToDelete.path && !uploadToDelete.path.startsWith('http')) {
             try {
               await ipcSafe.invoke('delete-file', uploadToDelete.path);
             } catch(e) {
               console.warn("Could not delete file from disk:", e);
             }
          }
          
          onRefresh();
          setConfirmState(prev => ({ ...prev, isOpen: false }));
        } catch (error: any) {
          toast.error('Ошибка при удалении: ' + error.message);
          setConfirmState(prev => ({ ...prev, isOpen: false }));
        }
      }
    });
  };

  return {
    tracks,
    setTracks,
    subLines,
    setSubLines,
    currentCharacter,
    currentDubberNickname,
    currentSubtitleText,
    currentSubId,
    videoUrl,
    handleReassignCharacter,
    handleUpdateSubLineFromModal,
    handleExportSubtitlesFromModal,
    handleAddComment,
    handleDeleteComment,
    handleApproveAll,
    handleStatusChange,
    handleFileUpload,
    handleFileDelete
  };
}
