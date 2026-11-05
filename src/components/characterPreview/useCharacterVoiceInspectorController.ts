import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  CharacterInspectionProps,
  CharacterDialogueLine,
  VoicePlaybackSettings
} from '../../lib/characterPreview/characterPreviewTypes';
import {
  fetchCharacterDialogueLines,
  resolveVideoUrl,
  captureVideoFrame
} from '../../lib/characterPreview/characterMediaManager';
import { cleanDialogueText } from '../../lib/characterPreview/timeUtils';
import { ipcSafe } from '../../lib/ipcSafe';
import { toast } from 'sonner';

export function useCharacterVoiceInspectorController({
  isOpen,
  onClose,
  characterName,
  currentEpisode,
  participants,
  assignments,
  globalMapping,
  characterAliases = {},
  onUpdatePortrait,
  onReassignLine,
  onRefreshData,
  characterList = []
}: CharacterInspectionProps) {
  const [lines, setLines] = useState<CharacterDialogueLine[]>([]);
  const [selectedLineIndex, setSelectedLineIndex] = useState<number>(0);
  const [isLoadingLines, setIsLoadingLines] = useState<boolean>(false);
  const [videoSrc, setVideoSrc] = useState<string>('');
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);
  const [isLoadingFrame, setIsLoadingFrame] = useState<boolean>(false);
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);
  const [playbackProgressSec, setPlaybackProgressSec] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [activeLinePlayingIndex, setActiveLinePlayingIndex] = useState<number | null>(null);
  const [isReassigning, setIsReassigning] = useState<boolean>(false);
  const [isCropModalOpen, setIsCropModalOpen] = useState<boolean>(false);
  const [showHotkeysHelp, setShowHotkeysHelp] = useState(false);

  // Playback settings
  const [settings, setSettings] = useState<VoicePlaybackSettings>({
    preRollSec: 0.15,
    postRollSec: 0.25,
    playbackRate: 1.0,
    volume: 1.0,
    loop: false,
    autoPlayOnSelect: true
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playTimerRef = useRef<number | null>(null);

  // Find assignment and mapped data
  const currentAssignment = assignments.find(
    (a) => a.characterName.toLowerCase() === characterName.toLowerCase()
  );
  const mainCharacterName = characterAliases[characterName] || characterName;
  const mappedEntry = globalMapping.find(
    (m) => m.characterName.toLowerCase() === mainCharacterName.toLowerCase()
  );
  const currentDubberId = currentAssignment?.dubberId || mappedEntry?.dubberId || '';
  const isMain = currentAssignment?.isMain !== undefined ? currentAssignment.isMain : !!mappedEntry?.isMain;
  const portraitUrl = mappedEntry?.photoUrl;

  // 1. Initialize video source
  useEffect(() => {
    let isCancelled = false;

    async function initVideo() {
      const rawPath = currentEpisode?.rawPath || '';
      if (!rawPath) return;
      try {
        const resolved = await resolveVideoUrl(rawPath);
        if (!isCancelled && resolved) {
          setVideoSrc(resolved);
        }
      } catch (err) {
        console.error('Error resolving video src:', err);
      }
    }

    if (isOpen) {
      initVideo();
    }

    return () => {
      isCancelled = true;
    };
  }, [isOpen, currentEpisode?.rawPath]);

  // 2. Load dialogue lines for this character
  useEffect(() => {
    let isCancelled = false;

    async function loadLines() {
      if (!currentEpisode?.subPath || !characterName) {
        setLines([]);
        return;
      }
      setIsLoadingLines(true);
      try {
        const fetched = await fetchCharacterDialogueLines(
          currentEpisode.subPath,
          characterName,
          characterAliases
        );
        if (!isCancelled) {
          setLines(fetched);
          setSelectedLineIndex(0);
          if (fetched.length > 0) {
            const initialTime = fetched[0].startSec + Math.min(0.5, fetched[0].durationSec / 2);
            setCurrentTimeSec(initialTime);
            setPlaybackProgressSec(fetched[0].startSec);
          }
        }
      } catch (err) {
        console.error('Error loading character lines:', err);
      } finally {
        if (!isCancelled) setIsLoadingLines(false);
      }
    }

    if (isOpen) {
      loadLines();
    }
  }, [isOpen, characterName, currentEpisode?.subPath, characterAliases]);

  // Current active line
  const currentLine = lines[selectedLineIndex] || null;

  // 3. Extract frame whenever currentLine or currentTimeSec changes
  const updateSnapshot = useCallback(async (timeSec: number) => {
    const video = videoRef.current;
    if (!video || !videoSrc) return;

    setIsLoadingFrame(true);
    try {
      const dataUrl = await captureVideoFrame(video, timeSec);
      if (dataUrl) {
        setSnapshotUrl(dataUrl);
      }
    } catch (err) {
      console.warn('Frame capture error:', err);
    } finally {
      setIsLoadingFrame(false);
    }
  }, [videoSrc]);

  useEffect(() => {
    if (currentLine && videoSrc) {
      const targetTime = Math.max(0, currentLine.startSec + Math.min(0.5, currentLine.durationSec / 2));
      setCurrentTimeSec(targetTime);
      updateSnapshot(targetTime);
    }
  }, [currentLine, videoSrc, updateSnapshot]);

  // 4. Handle audio/video snippet playback
  const stopPlayback = useCallback(() => {
    if (playTimerRef.current) {
      cancelAnimationFrame(playTimerRef.current);
      playTimerRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      video.pause();
    }
    setIsPlaying(false);
    setActiveLinePlayingIndex(null);
  }, []);

  const playSnippet = useCallback((line: CharacterDialogueLine, lineIndex: number) => {
    const video = videoRef.current;
    if (!video || !videoSrc) {
      toast.error('Видеофайл серии не загружен');
      return;
    }

    stopPlayback();

    const startTime = Math.max(0, line.startSec - settings.preRollSec);
    const endTime = line.endSec + settings.postRollSec;

    video.currentTime = startTime;
    video.playbackRate = settings.playbackRate;
    try {
      video.volume = Math.min(1.0, Math.max(0, settings.volume ?? 1.0));
    } catch (e) {
      console.warn('Video volume set error:', e);
    }

    const startPlaying = () => {
      video.play().then(() => {
        setIsPlaying(true);
        setActiveLinePlayingIndex(lineIndex);

        const checkTime = () => {
          if (!video) return;
          setPlaybackProgressSec(video.currentTime);

          if (video.currentTime >= endTime) {
            if (settings.loop) {
              video.currentTime = startTime;
              playTimerRef.current = requestAnimationFrame(checkTime);
            } else {
              stopPlayback();
              setPlaybackProgressSec(line.endSec);
            }
          } else {
            playTimerRef.current = requestAnimationFrame(checkTime);
          }
        };

        playTimerRef.current = requestAnimationFrame(checkTime);
      }).catch((err) => {
        console.warn('Playback error:', err);
        setIsPlaying(false);
      });
    };

    if (video.readyState >= 2) {
      startPlaying();
    } else {
      video.addEventListener('canplay', startPlaying, { once: true });
    }
  }, [videoSrc, settings, stopPlayback]);

  // Toggle play/pause
  const handleTogglePlay = () => {
    if (!currentLine) return;
    if (isPlaying) {
      stopPlayback();
    } else {
      playSnippet(currentLine, selectedLineIndex);
    }
  };

  // Replay
  const handleReplay = () => {
    if (!currentLine) return;
    playSnippet(currentLine, selectedLineIndex);
  };

  // Line selection
  const handleSelectLine = (index: number) => {
    setSelectedLineIndex(index);
    const line = lines[index];
    if (line) {
      const midTime = line.startSec + Math.min(0.5, line.durationSec / 2);
      setCurrentTimeSec(midTime);
      setPlaybackProgressSec(line.startSec);
      updateSnapshot(midTime);

      if (settings.autoPlayOnSelect) {
        playSnippet(line, index);
      } else {
        stopPlayback();
      }
    }
  };

  // Scrub frame time
  const handleScrubTime = (time: number) => {
    setCurrentTimeSec(time);
    updateSnapshot(time);
  };

  // Next / Prev lines
  const handlePrevLine = () => {
    if (selectedLineIndex > 0) {
      handleSelectLine(selectedLineIndex - 1);
    }
  };

  const handleNextLine = () => {
    if (selectedLineIndex < lines.length - 1) {
      handleSelectLine(selectedLineIndex + 1);
    }
  };

  // Set snapshot as character portrait
  const handleSetPortrait = (dataUrl: string) => {
    if (onUpdatePortrait) {
      onUpdatePortrait(mainCharacterName, dataUrl);
      toast.success(`Аватар для "${mainCharacterName}" успешно обновлен!`);
    }
  };

  // Manual video file pick fallback if needed
  const handleManualVideoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoSrc(url);
      toast.success('Видеофайл успешно подключен для предпросмотра');
    }
  };

  // 5. Handle reassigning dialogue line(s) to a different character
  const handleReassignLine = async (targetCharacter: string, reassignAllMatching: boolean) => {
    if (!currentLine || !currentEpisode?.subPath || !targetCharacter) return;
    
    const targetTrimmed = targetCharacter.trim();
    if (!targetTrimmed) return;
    if (targetTrimmed.toLowerCase() === characterName.toLowerCase()) {
      toast.info('Реплика уже принадлежит этому персонажу');
      return;
    }

    setIsReassigning(true);
    try {
      const rawSubData = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
      const rawLines: any[] = rawSubData.lines || rawSubData || [];
      
      const updates: { rawLineIndex: number; name: string }[] = [];

      if (reassignAllMatching && currentLine.cleanText) {
        rawLines.forEach((l: any, idx: number) => {
          const actor = (l.name || l.style || '').trim();
          const mappedActor = characterAliases[actor] || actor;
          const isCurrentActor = 
            actor.toLowerCase() === characterName.toLowerCase() || 
            mappedActor.toLowerCase() === characterName.toLowerCase();
          
          if (isCurrentActor && l.text) {
            const clean = cleanDialogueText(l.text);
            if (clean === currentLine.cleanText) {
              updates.push({
                rawLineIndex: l.rawLineIndex !== undefined ? l.rawLineIndex : idx,
                name: targetTrimmed
              });
            }
          }
        });
      }

      if (updates.length === 0) {
        updates.push({
          rawLineIndex: currentLine.rawIndex,
          name: targetTrimmed
        });
      }

      // 1. Save updated subtitle file
      await ipcSafe.invoke('save-raw-subtitles', {
        filePath: currentEpisode.subPath,
        lines: updates
      });

      // 2. Update assignments for currentEpisode
      const currentAssignments = [...assignments];
      const updatedLineIndices = new Set(updates.map((u) => u.rawLineIndex));

      // Ensure targetCharacter exists in assignments
      const existingTargetIndex = currentAssignments.findIndex(
        (a) => a.characterName.toLowerCase() === targetTrimmed.toLowerCase()
      );

      if (existingTargetIndex === -1) {
        // Priority 1: Check globalMapping
        const gMap = globalMapping.find(
          (m) => m.characterName.toLowerCase() === targetTrimmed.toLowerCase()
        );
        let dubberId = gMap?.dubberId || '';
        const isMainRole = gMap?.isMain || false;

        // Priority 2: Check matching participant
        if (!dubberId) {
          const matched = participants.find(
            (p) => p.nickname.toLowerCase() === targetTrimmed.toLowerCase()
          );
          if (matched) dubberId = matched.id;
        }

        currentAssignments.push({
          id: Math.random().toString(),
          episodeId: currentEpisode.id,
          characterName: targetTrimmed,
          dubberId,
          dubber: participants.find((p) => p.id === dubberId),
          status: 'PENDING',
          lineCount: updates.length,
          isMain: isMainRole
        });
      } else {
        currentAssignments[existingTargetIndex] = {
          ...currentAssignments[existingTargetIndex],
          lineCount: (currentAssignments[existingTargetIndex].lineCount || 0) + updates.length
        };
      }

      // Update current character lineCount
      const currentCharIndex = currentAssignments.findIndex(
        (a) => a.characterName.toLowerCase() === characterName.toLowerCase()
      );
      if (currentCharIndex !== -1) {
        const remainingCount = Math.max(
          0,
          (currentAssignments[currentCharIndex].lineCount || lines.length) - updates.length
        );
        currentAssignments[currentCharIndex] = {
          ...currentAssignments[currentCharIndex],
          lineCount: remainingCount
        };
      }

      // 3. Save updated episode in DB
      const cleanAssignments = currentAssignments.map((a) => {
        const { dubber, substitute, ...rest } = a;
        return rest;
      });

      const updatedEpisode = {
        ...currentEpisode,
        assignments: cleanAssignments
      };
      await ipcSafe.invoke('save-episode', updatedEpisode);

      // 4. Update local lines state in modal
      const remainingLines = lines.filter((l) => !updatedLineIndices.has(l.rawIndex));
      setLines(remainingLines);

      if (remainingLines.length > 0) {
        const nextIndex = Math.min(selectedLineIndex, remainingLines.length - 1);
        setSelectedLineIndex(nextIndex);
        const nextLine = remainingLines[nextIndex];
        const midTime = nextLine.startSec + Math.min(0.5, nextLine.durationSec / 2);
        setCurrentTimeSec(midTime);
        setPlaybackProgressSec(nextLine.startSec);
        updateSnapshot(midTime);
      } else {
        setSelectedLineIndex(0);
        stopPlayback();
      }

      toast.success(
        updates.length > 1
          ? `Переназначено ${updates.length} реплик персонажу "${targetTrimmed}"`
          : `Реплика переназначена персонажу "${targetTrimmed}"`
      );

      if (onReassignLine) {
        await onReassignLine(currentLine.rawIndex, targetTrimmed, characterName);
      }
      if (onRefreshData) {
        onRefreshData();
      }
    } catch (err: any) {
      console.error('Error reassigning line:', err);
      toast.error(`Ошибка переназначения: ${err?.message || 'Неизвестная ошибка'}`);
    } finally {
      setIsReassigning(false);
    }
  };

  const handleReassignLineFromList = async (originalIndex: number, targetCharacter: string) => {
    const targetLine = lines[originalIndex];
    if (!targetLine || !currentEpisode?.subPath || !targetCharacter) return;
    
    const targetTrimmed = targetCharacter.trim();
    if (!targetTrimmed) return;
    if (targetTrimmed.toLowerCase() === characterName.toLowerCase()) {
      toast.info('Реплика уже принадлежит этому персонажу');
      return;
    }

    setIsReassigning(true);
    try {
      const rawSubData = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
      const _rawLines: any[] = rawSubData.lines || rawSubData || [];
      void _rawLines;
      
      const updates = [{
        rawLineIndex: targetLine.rawIndex,
        name: targetTrimmed
      }];

      // 1. Save updated subtitle file
      await ipcSafe.invoke('save-raw-subtitles', {
        filePath: currentEpisode.subPath,
        lines: updates
      });

      // 2. Update assignments for currentEpisode
      const currentAssignments = [...assignments];

      // Ensure targetCharacter exists in assignments
      const existingTargetIndex = currentAssignments.findIndex(
        (a) => a.characterName.toLowerCase() === targetTrimmed.toLowerCase()
      );

      if (existingTargetIndex === -1) {
        const gMap = globalMapping.find(
          (m) => m.characterName.toLowerCase() === targetTrimmed.toLowerCase()
        );
        let dubberId = gMap?.dubberId || '';
        const isMainRole = gMap?.isMain || false;

        if (!dubberId) {
          const matched = participants.find(
            (p) => p.nickname.toLowerCase() === targetTrimmed.toLowerCase()
          );
          if (matched) dubberId = matched.id;
        }

        currentAssignments.push({
          id: Math.random().toString(),
          episodeId: currentEpisode.id,
          characterName: targetTrimmed,
          dubberId,
          dubber: participants.find((p) => p.id === dubberId),
          status: 'PENDING',
          lineCount: 1,
          isMain: isMainRole
        });
      } else {
        currentAssignments[existingTargetIndex] = {
          ...currentAssignments[existingTargetIndex],
          lineCount: (currentAssignments[existingTargetIndex].lineCount || 0) + 1
        };
      }

      // Update current character lineCount
      const currentCharIndex = currentAssignments.findIndex(
        (a) => a.characterName.toLowerCase() === characterName.toLowerCase()
      );
      if (currentCharIndex !== -1) {
        const remainingCount = Math.max(
          0,
          (currentAssignments[currentCharIndex].lineCount || lines.length) - 1
        );
        currentAssignments[currentCharIndex] = {
          ...currentAssignments[currentCharIndex],
          lineCount: remainingCount
        };
      }

      // 3. Save updated episode in DB
      const cleanAssignments = currentAssignments.map((a) => {
        const { dubber, substitute, ...rest } = a;
        return rest;
      });

      const updatedEpisode = {
        ...currentEpisode,
        assignments: cleanAssignments
      };
      await ipcSafe.invoke('save-episode', updatedEpisode);

      // 4. Update local lines state in modal
      const remainingLines = lines.filter((l) => l.rawIndex !== targetLine.rawIndex);
      setLines(remainingLines);

      if (remainingLines.length > 0) {
        const nextIndex = Math.min(selectedLineIndex, remainingLines.length - 1);
        setSelectedLineIndex(nextIndex);
        const nextLine = remainingLines[nextIndex];
        const midTime = nextLine.startSec + Math.min(0.5, nextLine.durationSec / 2);
        setCurrentTimeSec(midTime);
        setPlaybackProgressSec(nextLine.startSec);
        updateSnapshot(midTime);
      } else {
        setSelectedLineIndex(0);
        stopPlayback();
      }

      toast.success(`Реплика переназначена персонажу "${targetTrimmed}"`);

      if (onReassignLine) {
        await onReassignLine(targetLine.rawIndex, targetTrimmed, characterName);
      }
      if (onRefreshData) {
        onRefreshData();
      }
    } catch (err: any) {
      console.error('Error reassigning line from list:', err);
      toast.error(`Ошибка переназначения: ${err?.message || 'Неизвестная ошибка'}`);
    } finally {
      setIsReassigning(false);
    }
  };

  // Available characters for quick assignment (excluding current character)
  const availableTargetCharacters = React.useMemo(() => {
    const set = new Set<string>();
    characterList.forEach(c => {
      if (c && c.toLowerCase() !== characterName.toLowerCase()) {
        set.add(c);
      }
    });
    assignments.forEach(a => {
      if (a.characterName && a.characterName.toLowerCase() !== characterName.toLowerCase()) {
        set.add(a.characterName);
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [characterList, assignments, characterName]);

  // Key shortcuts (Escape, Space, Left/Right, 1-9 quick reassign, R replay, S snapshot to avatar, M/F gender prefix)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return;
      }
      if (e.key === 'Escape') {
        if (showHotkeysHelp) {
          setShowHotkeysHelp(false);
          return;
        }
        stopPlayback();
        onClose();
      } else if (e.key === ' ') {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrevLine();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNextLine();
      } else if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') {
        e.preventDefault();
        handleReplay();
      } else if (e.key === 's' || e.key === 'S' || e.key === 'ы' || e.key === 'Ы') {
        e.preventDefault();
        if (snapshotUrl) {
          setIsCropModalOpen(true);
        } else {
          toast.info('Кадр еще загружается...');
        }
      } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShowHotkeysHelp(prev => !prev);
      } else if (e.key >= '1' && e.key <= '9') {
        const numIdx = parseInt(e.key, 10) - 1;
        if (numIdx < availableTargetCharacters.length) {
          const targetChar = availableTargetCharacters[numIdx];
          e.preventDefault();
          handleReassignLine(targetChar, false);
          toast.success(`Реплика переназначена: ${targetChar} (клавиша ${e.key})`);
        }
      } else if (e.key === 'm' || e.key === 'M' || e.key === 'ь' || e.key === 'Ь') {
        // Quick gender tagging for current character name if prefix is not present
        if (!characterName.startsWith('(М) ') && !characterName.startsWith('(Ж) ')) {
          const newName = `(М) ${characterName}`;
          if (currentLine && onReassignLine) {
            e.preventDefault();
            handleReassignLine(newName, true);
            toast.success(`Персонаж размечен как Мужской: ${newName}`);
          }
        }
      } else if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А' || e.key === 'ж' || e.key === 'Ж') {
        if (!characterName.startsWith('(М) ') && !characterName.startsWith('(Ж) ')) {
          const newName = `(Ж) ${characterName}`;
          if (currentLine && onReassignLine) {
            e.preventDefault();
            handleReassignLine(newName, true);
            toast.success(`Персонаж размечен как Женский: ${newName}`);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    isOpen, onClose, handleTogglePlay, handlePrevLine, handleNextLine, handleReplay,
    handleSetPortrait, snapshotUrl, stopPlayback, availableTargetCharacters,
    characterName, currentLine, onReassignLine, showHotkeysHelp
  ]);

  // Clean up on modal close
  useEffect(() => {
    if (!isOpen) {
      stopPlayback();
    }
  }, [isOpen, stopPlayback]);

  return {
    lines,
    selectedLineIndex,
    isLoadingLines,
    videoSrc,
    snapshotUrl,
    isLoadingFrame,
    currentTimeSec,
    playbackProgressSec,
    isPlaying,
    activeLinePlayingIndex,
    isReassigning,
    isCropModalOpen,
    setIsCropModalOpen,
    showHotkeysHelp,
    setShowHotkeysHelp,
    settings,
    setSettings,
    videoRef,
    mainCharacterName,
    currentDubberId,
    isMain,
    portraitUrl,
    currentLine,
    stopPlayback,
    playSnippet,
    handleTogglePlay,
    handleReplay,
    handleSelectLine,
    handleScrubTime,
    handlePrevLine,
    handleNextLine,
    handleSetPortrait,
    handleManualVideoSelect,
    handleReassignLine,
    handleReassignLineFromList
  };
}
