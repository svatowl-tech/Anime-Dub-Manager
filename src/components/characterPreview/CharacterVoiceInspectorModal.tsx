import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  X, User, ChevronLeft, ChevronRight, Volume2, Sparkles, Video, 
  Upload, Check, AlertCircle, RefreshCw, ArrowRightLeft, Keyboard, HelpCircle
} from 'lucide-react';
import { 
  CharacterInspectionProps, CharacterDialogueLine, VoicePlaybackSettings 
} from '../../lib/characterPreview/characterPreviewTypes';
import { 
  fetchCharacterDialogueLines, resolveVideoUrl, captureVideoFrame 
} from '../../lib/characterPreview/characterMediaManager';
import { cleanDialogueText } from '../../lib/characterPreview/timeUtils';
import { ipcSafe } from '../../lib/ipcSafe';
import CharacterLineList from './CharacterLineList';
import CharacterSnapshotViewer from './CharacterSnapshotViewer';
import CharacterVoicePlayer from './CharacterVoicePlayer';
import LineReassignControl from './LineReassignControl';
import { toast } from 'sonner';

export default function CharacterVoiceInspectorModal({
  isOpen,
  onClose,
  characterName,
  currentEpisode,
  project,
  participants,
  assignments,
  globalMapping,
  characterAliases = {},
  onAssignDubber,
  onToggleMainRole,
  onUpdatePortrait,
  onNavigateCharacter,
  onReassignLine,
  onRefreshData,
  characterList = [],
  currentIndex = 0,
  totalCharacters = 0,
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

  // Playback settings
  const [settings, setSettings] = useState<VoicePlaybackSettings>({
    preRollSec: 0.15,
    postRollSec: 0.25,
    playbackRate: 1.0,
    volume: 1.0,
    loop: false,
    autoPlayOnSelect: true,
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
                name: targetTrimmed,
              });
            }
          }
        });
      }

      if (updates.length === 0) {
        updates.push({
          rawLineIndex: currentLine.rawIndex,
          name: targetTrimmed,
        });
      }

      // 1. Save updated subtitle file
      await ipcSafe.invoke('save-raw-subtitles', {
        filePath: currentEpisode.subPath,
        lines: updates,
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
        let isMain = gMap?.isMain || false;

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
          isMain,
        });
      } else {
        currentAssignments[existingTargetIndex] = {
          ...currentAssignments[existingTargetIndex],
          lineCount: (currentAssignments[existingTargetIndex].lineCount || 0) + updates.length,
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
          lineCount: remainingCount,
        };
      }

      // 3. Save updated episode in DB
      const cleanAssignments = currentAssignments.map((a) => {
        const { dubber, substitute, ...rest } = a;
        return rest;
      });

      const updatedEpisode = {
        ...currentEpisode,
        assignments: cleanAssignments,
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

  const [showHotkeysHelp, setShowHotkeysHelp] = useState(false);

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
          handleSetPortrait(snapshotUrl);
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      {/* Hidden Video Engine for Frame Grabbing & Audio Snippets */}
      {videoSrc && (
        <video
          ref={videoRef}
          src={videoSrc}
          className="hidden"
          preload="auto"
          crossOrigin="anonymous"
          playsInline
        />
      )}

      {/* Main Modal Card */}
      <div 
        className="w-full max-w-5xl max-h-[94vh] flex flex-col bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden text-neutral-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="p-4 border-b border-neutral-800 bg-neutral-950/80 flex flex-wrap items-center justify-between gap-3 shrink-0">
          {/* Character Info & Navigation */}
          <div className="flex items-center gap-3">
            {/* Avatar */}
            <div className="relative w-11 h-11 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 shrink-0 flex items-center justify-center">
              {portraitUrl || snapshotUrl ? (
                <img
                  src={portraitUrl || snapshotUrl || undefined}
                  alt={characterName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-5 h-5 text-neutral-400" />
              )}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">
                  {characterName}
                </h2>
                {characterAliases[characterName] && (
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30">
                    Алиас для {characterAliases[characterName]}
                  </span>
                )}
                {onToggleMainRole && (
                  <button
                    type="button"
                    onClick={() => onToggleMainRole(characterName, !isMain)}
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors border ${
                      isMain
                        ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                        : 'bg-neutral-800 text-neutral-400 border-neutral-700 hover:text-neutral-200'
                    }`}
                  >
                    {isMain ? '★ Главная роль' : 'Второстепенная'}
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 text-xs text-neutral-400 mt-0.5">
                <span>Реплик в серии: <strong className="text-indigo-400 font-mono">{lines.length}</strong></span>
                {totalCharacters > 0 && (
                  <>
                    <span>•</span>
                    <span>Персонаж {currentIndex + 1} из {totalCharacters}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Quick Dubber Assignment & Actions */}
          <div className="flex items-center gap-2">
            {/* Dubber selector */}
            <div className="flex items-center gap-1.5 bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1 text-xs">
              <span className="text-[11px] text-neutral-400 font-medium">Даббер:</span>
              <select
                value={currentDubberId}
                onChange={(e) => {
                  if (onAssignDubber) {
                    onAssignDubber(characterName, e.target.value);
                    toast.success('Даббер назначен');
                  }
                }}
                className="bg-transparent text-neutral-100 font-semibold focus:outline-none text-xs cursor-pointer"
              >
                <option value="" className="bg-neutral-900 text-neutral-400">
                  -- Не назначен --
                </option>
                {participants.map((p) => (
                  <option key={p.id} value={p.id} className="bg-neutral-900 text-neutral-200">
                    {p.nickname}
                  </option>
                ))}
              </select>
            </div>

            {/* Character navigation buttons */}
            {onNavigateCharacter && totalCharacters > 1 && (
              <div className="flex items-center gap-1 bg-neutral-900 border border-neutral-800 rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => onNavigateCharacter('prev')}
                  title="Предыдущий персонаж"
                  className="p-1.5 hover:bg-neutral-800 text-neutral-300 rounded transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateCharacter('next')}
                  title="Следующий персонаж"
                  className="p-1.5 hover:bg-neutral-800 text-neutral-300 rounded transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Keyboard Shortcuts button */}
            <button
              type="button"
              onClick={() => setShowHotkeysHelp(prev => !prev)}
              title="Быстрая разметка: Горячие клавиши (?)"
              className={`p-2 rounded-lg transition-colors flex items-center gap-1 text-xs font-medium border ${
                showHotkeysHelp
                  ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                  : 'bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border-neutral-800 hover:border-neutral-700'
              }`}
            >
              <Keyboard className="w-4 h-4 text-amber-400" />
              <span className="hidden sm:inline">Горячие клавиши</span>
            </button>

            {/* Close button */}
            <button
              type="button"
              onClick={() => {
                stopPlayback();
                onClose();
              }}
              title="Закрыть (Esc)"
              className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Hotkeys Quick Helper Overlay Banner */}
        {showHotkeysHelp && (
          <div className="bg-indigo-950/90 border-b border-indigo-800/80 px-4 py-3 text-xs text-indigo-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-inner">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex items-center gap-1.5 font-semibold text-white">
                <Keyboard className="w-4 h-4 text-amber-300" />
                <span>Быстрая разметка реплик:</span>
              </div>
              <div className="flex items-center gap-1.5 text-neutral-300">
                <kbd className="px-1.5 py-0.5 bg-neutral-900 rounded border border-neutral-700 font-mono text-[10px] text-amber-300">Пробел</kbd>
                <span>Слушать/Пауза</span>
              </div>
              <div className="flex items-center gap-1.5 text-neutral-300">
                <kbd className="px-1.5 py-0.5 bg-neutral-900 rounded border border-neutral-700 font-mono text-[10px] text-amber-300">← / →</kbd>
                <span>Пред / След фраза</span>
              </div>
              <div className="flex items-center gap-1.5 text-neutral-300">
                <kbd className="px-1.5 py-0.5 bg-neutral-900 rounded border border-neutral-700 font-mono text-[10px] text-amber-300">R</kbd>
                <span>Повтор фразы</span>
              </div>
              <div className="flex items-center gap-1.5 text-neutral-300">
                <kbd className="px-1.5 py-0.5 bg-neutral-900 rounded border border-neutral-700 font-mono text-[10px] text-amber-300">S</kbd>
                <span>Кадр в аватарку</span>
              </div>
              <div className="flex items-center gap-1.5 text-neutral-300">
                <kbd className="px-1.5 py-0.5 bg-neutral-900 rounded border border-neutral-700 font-mono text-[10px] text-amber-300">1 - 9</kbd>
                <span>Передать реплику персонажу 1..9</span>
              </div>
              <div className="flex items-center gap-1.5 text-neutral-300">
                <kbd className="px-1.5 py-0.5 bg-neutral-900 rounded border border-neutral-700 font-mono text-[10px] text-amber-300">M / Ж</kbd>
                <span>Пол персонажа (М) / (Ж)</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowHotkeysHelp(false)}
              className="text-indigo-300 hover:text-white text-xs underline shrink-0"
            >
              Скрыть
            </button>
          </div>
        )}

        {/* Video warning / Fallback notice if video not attached */}
        {!videoSrc && (
          <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center justify-between text-xs text-amber-300">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Видеофайл серии (rawPath) не подключен. Вы можете вручную выбрать видео для предпросмотра:</span>
            </div>
            <label className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded cursor-pointer transition-colors font-medium flex items-center gap-1.5 shrink-0">
              <Upload className="w-3.5 h-3.5" />
              <span>Выбрать видео</span>
              <input
                type="file"
                accept="video/*"
                onChange={handleManualVideoSelect}
                className="hidden"
              />
            </label>
          </div>
        )}

        {/* Content Body: Left Column (Snapshot & Voice Player) | Right Column (Lines List) */}
        <div className="flex-1 overflow-hidden p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left Column: Visual & Auditory Preview */}
          <div className="lg:col-span-7 flex flex-col gap-3 overflow-y-auto">
            <CharacterSnapshotViewer
              currentLine={currentLine}
              snapshotUrl={snapshotUrl}
              isLoadingFrame={isLoadingFrame}
              onScrubTime={handleScrubTime}
              currentTimeSec={currentTimeSec}
              onPrevLine={handlePrevLine}
              onNextLine={handleNextLine}
              hasPrevLine={selectedLineIndex > 0}
              hasNextLine={selectedLineIndex < lines.length - 1}
              onSetAsPortrait={handleSetPortrait}
            />

            <CharacterVoicePlayer
              isPlaying={isPlaying}
              onTogglePlay={handleTogglePlay}
              onReplay={handleReplay}
              currentLine={currentLine}
              playbackProgressSec={playbackProgressSec}
              settings={settings}
              onUpdateSettings={(newVals) => setSettings((prev) => ({ ...prev, ...newVals }))}
            />

            <LineReassignControl
              currentLine={currentLine}
              currentCharacterName={characterName}
              knownCharacters={characterList}
              assignments={assignments}
              participants={participants}
              globalMapping={globalMapping}
              onReassign={handleReassignLine}
              isReassigning={isReassigning}
            />
          </div>

          {/* Right Column: Dialogue Lines List */}
          <div className="lg:col-span-5 flex flex-col h-full overflow-hidden">
            <CharacterLineList
              lines={lines}
              selectedLineIndex={selectedLineIndex}
              onSelectLine={handleSelectLine}
              isPlaying={isPlaying}
              activeLinePlayingIndex={activeLinePlayingIndex}
              onPlayLine={(idx) => {
                const l = lines[idx];
                if (l) playSnippet(l, idx);
              }}
              knownCharacters={characterList}
              currentCharacterName={characterName}
              isReassigning={isReassigning}
              onReassignLine={async (originalIndex, targetCharacter) => {
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
                  const rawLines: any[] = rawSubData.lines || rawSubData || [];
                  
                  const updates = [{
                    rawLineIndex: targetLine.rawIndex,
                    name: targetTrimmed,
                  }];

                  // 1. Save updated subtitle file
                  await ipcSafe.invoke('save-raw-subtitles', {
                    filePath: currentEpisode.subPath,
                    lines: updates,
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
                    let isMain = gMap?.isMain || false;

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
                      isMain,
                    });
                  } else {
                    currentAssignments[existingTargetIndex] = {
                      ...currentAssignments[existingTargetIndex],
                      lineCount: (currentAssignments[existingTargetIndex].lineCount || 0) + 1,
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
                      lineCount: remainingCount,
                    };
                  }

                  // 3. Save updated episode in DB
                  const cleanAssignments = currentAssignments.map((a) => {
                    const { dubber, substitute, ...rest } = a;
                    return rest;
                  });

                  const updatedEpisode = {
                    ...currentEpisode,
                    assignments: cleanAssignments,
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
              }}
            />
          </div>
        </div>

        {/* Footer Hint Bar */}
        <div className="px-4 py-2 border-t border-neutral-800 bg-neutral-950 text-[11px] text-neutral-500 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span>Клавиши: <kbd className="bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-300 font-mono">Пробел</kbd> — Слушать речь</span>
            <span><kbd className="bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-300 font-mono">← / →</kbd> — Реплики</span>
            <span><kbd className="bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-300 font-mono">Esc</kbd> — Закрыть</span>
          </div>
          <div className="text-neutral-400">
            Кадры и звук синхронизированы по таймингам субтитров
          </div>
        </div>
      </div>
    </div>
  );
}
