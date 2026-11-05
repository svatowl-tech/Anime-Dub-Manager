import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { ipcSafe } from '../../lib/ipcSafe';
import { useVideoContext } from '../../contexts/VideoContext';
import { Episode } from '../../types';
import { RawSubtitleLine, SubtitleUpdates, UndoRedoState } from './types';
import {
  parseAssTimeToSeconds,
  isSignSubtitleLine,
  applyStressToText
} from './utils';
import { useSubtitleBatchAndRoleActions } from './useSubtitleBatchAndRoleActions';

export { useSubtitleBatchAndRoleActions };

export function useSubtitleEditorState(
  currentEpisode: Episode | null,
  onRefresh: () => void
) {
  const [lines, setLines] = useState<RawSubtitleLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [updates, setUpdates] = useState<SubtitleUpdates>({});
  const [isMultiSubMergeModalOpen, setIsMultiSubMergeModalOpen] = useState(false);
  const [showHonorificsModal, setShowHonorificsModal] = useState(false);

  const [autoApplyAliases, setAutoApplyAliases] = useState(() => {
    return localStorage.getItem('sub_editor_auto_aliases') !== 'false';
  });
  const [autoApplyStresses, setAutoApplyStresses] = useState(() => {
    return localStorage.getItem('sub_editor_auto_stresses') !== 'false';
  });

  const handleToggleAutoApplyAliases = (val: boolean) => {
    setAutoApplyAliases(val);
    localStorage.setItem('sub_editor_auto_aliases', String(val));
    if (val) {
      toast.success('Автоматическая замена алиасов при загрузке включена');
    } else {
      toast.info('Автоматическая замена алиасов при загрузке выключена');
    }
  };

  const handleToggleAutoApplyStresses = (val: boolean) => {
    setAutoApplyStresses(val);
    localStorage.setItem('sub_editor_auto_stresses', String(val));
    if (val) {
      toast.success('Автоматическая расстановка ударений при загрузке включена');
    } else {
      toast.info('Автоматическая расстановка ударений при загрузке выключена');
    }
  };

  const [autoSave, setAutoSave] = useState(false);
  const [undoStack, setUndoStack] = useState<UndoRedoState[]>([]);
  const [redoStack, setRedoStack] = useState<UndoRedoState[]>([]);

  const latestLinesRef = useRef(lines);
  const latestUpdatesRef = useRef(updates);
  useEffect(() => {
    latestLinesRef.current = lines;
    latestUpdatesRef.current = updates;
  }, [lines, updates]);

  const pushStateForUndo = useCallback(() => {
    setUndoStack(prev => {
      const newStack = [...prev, { lines: latestLinesRef.current, updates: latestUpdatesRef.current }];
      if (newStack.length > 50) return newStack.slice(newStack.length - 50);
      return newStack;
    });
    setRedoStack([]);
  }, []);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack(r => [...r, { lines: latestLinesRef.current, updates: latestUpdatesRef.current }]);
    setLines(prev.lines);
    setUpdates(prev.updates);
    setUndoStack(u => u.slice(0, -1));
  }, [undoStack]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack(u => [...u, { lines: latestLinesRef.current, updates: latestUpdatesRef.current }]);
    setLines(next.lines);
    setUpdates(next.updates);
    setRedoStack(r => r.slice(0, -1));
  }, [redoStack]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleUndo, handleRedo]);

  useEffect(() => {
    if (!autoSave || !currentEpisode || lines.length === 0) return;
    const timeout = setTimeout(async () => {
      if (Object.keys(latestUpdatesRef.current).length === 0) return;
      const fullLines = latestLinesRef.current.map(line => {
        const u = latestUpdatesRef.current[line.rawLineIndex] || {};
        return {
          ...line,
          name: u.name !== undefined ? u.name : line.name,
          text: u.text !== undefined ? u.text : line.text,
          start: u.start !== undefined ? u.start : line.start,
          end: u.end !== undefined ? u.end : line.end
        };
      });
      try {
        await ipcSafe.invoke('save-translated-subtitles', {
          assFilePath: currentEpisode.subPath,
          translatedLines: fullLines
        });
      } catch (e) {}
    }, 5000);
    return () => clearTimeout(timeout);
  }, [updates, lines, autoSave, currentEpisode]);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeLineIndex, setActiveLineIndex] = useState<number | null>(null);

  const [bookmarks, setBookmarks] = useState<number[]>(() => {
    try {
      const stored = localStorage.getItem(`bookmarks-${currentEpisode?.id}`);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [showShiftModal, setShowShiftModal] = useState(false);
  const [shiftAmountMs, setShiftAmountMs] = useState<string>('');

  useEffect(() => {
    if (currentEpisode?.id) {
      localStorage.setItem(`bookmarks-${currentEpisode.id}`, JSON.stringify(bookmarks));
    }
  }, [bookmarks, currentEpisode?.id]);

  const handleToggleBookmark = useCallback((rawLineIndex: number) => {
    setBookmarks(prev => {
      if (prev.includes(rawLineIndex)) {
        return prev.filter(id => id !== rawLineIndex);
      } else {
        return [...prev, rawLineIndex].sort((a, b) => a - b);
      }
    });
  }, []);

  const [showSigns, setShowSigns] = useState(false);
  const [stableNames, setStableNames] = useState<string[]>([]);

  const commitNewName = (name: string) => {
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    setStableNames(prev => {
      if (!prev.includes(trimmed)) {
        return [...prev, trimmed];
      }
      return prev;
    });
  };

  const [selectedLines, setSelectedLines] = useState<Set<number>>(new Set());
  const [lastSelectedLine, setLastSelectedLine] = useState<number | null>(null);
  const [massName, setMassName] = useState('');

  const [showScreenshots, setShowScreenshots] = useState<boolean>(() => {
    try {
      return localStorage.getItem('subtitle_editor_show_screenshots') === 'true';
    } catch {
      return false;
    }
  });

  const handleToggleScreenshots = useCallback(() => {
    setShowScreenshots(prev => {
      const next = !prev;
      try {
        localStorage.setItem('subtitle_editor_show_screenshots', String(next));
      } catch {}
      return next;
    });
  }, []);

  const { registerPlayer, unregisterPlayer } = useVideoContext();
  const videoRef = useRef<HTMLVideoElement>(null);

  const unassignedCount = useMemo(() => {
    return lines.filter(l => {
      const u = updates[l.rawLineIndex] || {};
      const name = u.name !== undefined ? u.name : l.name;
      return !name || !name.trim();
    }).length;
  }, [lines, updates]);

  useEffect(() => {
    if (videoRef.current) {
      const player = videoRef.current;

      const handleTimeUpdate = () => setCurrentTime(player.currentTime);
      const handlePlay = () => setIsPlaying(true);
      const handlePause = () => setIsPlaying(false);
      const handleLoadedMetadata = () => setDuration(player.duration || 0);

      player.addEventListener('timeupdate', handleTimeUpdate);
      player.addEventListener('play', handlePlay);
      player.addEventListener('pause', handlePause);
      player.addEventListener('loadedmetadata', handleLoadedMetadata);

      if (player.duration) {
        setDuration(player.duration);
      }
      setIsPlaying(!player.paused);

      registerPlayer({
        togglePlayPause: () => {
          if (player.paused) {
            player.play().catch(e => console.error('Play error', e));
          } else {
            player.pause();
          }
        },
        seekToNext: () => {
          const nextSub = lines.find(l => l.startSec > player.currentTime + 0.1);
          if (nextSub) {
            player.currentTime = nextSub.startSec;
          }
        }
      });

      return () => {
        player.removeEventListener('timeupdate', handleTimeUpdate);
        player.removeEventListener('play', handlePlay);
        player.removeEventListener('pause', handlePause);
        player.removeEventListener('loadedmetadata', handleLoadedMetadata);
        unregisterPlayer();
      };
    }
  }, [registerPlayer, unregisterPlayer, lines]);

  const totalDuration = useMemo(() => {
    if (duration) return duration;
    if (lines.length > 0) {
      const endSecs = lines.map(line => {
        const u = updates[line.rawLineIndex] || {};
        return u.end !== undefined ? parseAssTimeToSeconds(u.end) : line.endSec;
      });
      return Math.max(...endSecs) + 10;
    }
    return 300;
  }, [duration, lines, updates]);

  const isSignLine = useCallback((line: RawSubtitleLine) => {
    return isSignSubtitleLine(line);
  }, []);

  useEffect(() => {
    const active = lines.find(line => {
      if (!showSigns && isSignLine(line)) return false;
      return currentTime >= line.startSec && currentTime <= line.endSec;
    });

    if (active && active.rawLineIndex !== activeLineIndex) {
      setActiveLineIndex(active.rawLineIndex);
      const element = document.getElementById(`line-${active.rawLineIndex}`);
      if (element && !videoRef.current?.paused) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else if (!active && activeLineIndex !== null) {
      setActiveLineIndex(null);
    }
  }, [currentTime, lines, activeLineIndex, showSigns, isSignLine]);

  const loadRawSubtitles = async () => {
    if (!currentEpisode) return;
    setLoading(true);
    setStatus('Загрузка субтитров...');
    try {
      const data = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
      const subtitleLines = (data.lines || data)
        .map((l: any) => ({
          ...l,
          startSec: parseAssTimeToSeconds(l.start),
          endSec: parseAssTimeToSeconds(l.end)
        }))
        .sort((a: any, b: any) => a.startSec - b.startSec);

      setLines(subtitleLines);

      const initialUpdates: SubtitleUpdates = {};
      let autoAppliedCount = 0;
      let stressAppliedCount = 0;

      if (autoApplyAliases && currentEpisode?.project?.characterAliases) {
        try {
          const aliases: Record<string, string> = JSON.parse(currentEpisode.project.characterAliases);
          subtitleLines.forEach((line: any) => {
            const index = line.rawLineIndex;
            const currentName = line.name;
            if (aliases[currentName]) {
              initialUpdates[index] = { ...initialUpdates[index], name: aliases[currentName] };
              autoAppliedCount++;
            }
          });
        } catch (e) {
          console.error('Error auto-applying aliases on load:', e);
        }
      }

      if (autoApplyStresses) {
        try {
          const rawStresses = currentEpisode?.project?.nameStresses || '{}';
          const stresses: Record<string, string> = JSON.parse(rawStresses);

          const projectChars = currentEpisode?.project?.globalMapping || '[]';
          try {
            const parsedChars = JSON.parse(projectChars);
            const charList: string[] = Array.isArray(parsedChars)
              ? parsedChars.map((c: any) => c.characterName)
              : Object.keys(parsedChars);

            for (const char of charList) {
              if (!char) continue;
              if (
                char.includes('́') ||
                char.includes("'") ||
                char.includes('+') ||
                (char.length > 1 && /[А-ЯЁ]/.test(char.slice(1)))
              ) {
                const plain = char.replace(/[́'+]/g, '').toLowerCase();
                const plainParts = plain.split(/[\s-]+/).map(p => p.charAt(0).toUpperCase() + p.slice(1));
                const plainCapitalized = plainParts.join(' ');
                if (!stresses[plainCapitalized] && !stresses[char.replace(/[́'+]/g, '')]) {
                  stresses[char.replace(/[́'+]/g, '')] = char;
                }
              }
            }
          } catch (e) {
            console.error('Error parsing globalMapping for stresses', e);
          }

          if (Object.keys(stresses).length > 0) {
            subtitleLines.forEach((line: any) => {
              const index = line.rawLineIndex;
              const currentText = initialUpdates[index]?.text || line.text;
              const res = applyStressToText(currentText, stresses);
              if (res.modified) {
                initialUpdates[index] = { ...initialUpdates[index], text: res.text };
                stressAppliedCount++;
              }
            });
          }
        } catch (e) {
          console.error('Error auto-applying stresses on load:', e);
        }
      }

      setUpdates(initialUpdates);
      setSelectedLines(new Set());
      setLastSelectedLine(null);

      let statusMsg = `Загружено ${subtitleLines.length} реплик.`;
      if (autoAppliedCount > 0 || stressAppliedCount > 0) {
        statusMsg += ` Авто-применение: алиасы (${autoAppliedCount}), ударения (${stressAppliedCount}).`;
        toast.success(
          `Автоматически применено при загрузке: алиасы (${autoAppliedCount}), ударения (${stressAppliedCount})`
        );
      }
      setStatus(statusMsg);
    } catch (error) {
      console.error(error);
      setStatus('Ошибка загрузки субтитров.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentEpisode?.subPath) {
      loadRawSubtitles();
    } else {
      setLines([]);
      setUpdates({});
      setSelectedLines(new Set());
      setLastSelectedLine(null);
    }
  }, [currentEpisode]);

  const handleSave = async () => {
    if (!currentEpisode || lines.length === 0) return;
    setSaving(true);
    setStatus('Сохранение изменений...');

    const fullLines = lines.map(line => {
      const u = updates[line.rawLineIndex] || {};
      const newStart = u.start !== undefined ? (u.start as string) : line.start;
      const newEnd = u.end !== undefined ? (u.end as string) : line.end;
      return {
        ...line,
        name: u.name !== undefined ? u.name : line.name,
        text: u.text !== undefined ? u.text : line.text,
        start: newStart,
        end: newEnd,
        startSec: parseAssTimeToSeconds(newStart),
        endSec: parseAssTimeToSeconds(newEnd)
      };
    });

    try {
      await ipcSafe.invoke('save-translated-subtitles', {
        assFilePath: currentEpisode.subPath,
        translatedLines: fullLines
      });

      setLines(fullLines);
      setUpdates({});
      latestLinesRef.current = fullLines;
      latestUpdatesRef.current = {};

      setStatus('Изменения сохранены!');
    } catch (error) {
      console.error(error);
      setStatus('Ошибка при сохранении.');
    } finally {
      setSaving(false);
    }
  };

  const handleAutoFix = async () => {
    if (!currentEpisode?.subPath) return;
    pushStateForUndo();
    try {
      setLoading(true);
      setStatus('Исправление ошибок...');
      const res = await ipcSafe.invoke('auto-fix-subtitles', { filePath: currentEpisode.subPath });
      setStatus(
        `Готово. Удалено: ${res.removedCount}, Исправлено наложений: ${res.overlappingCount}, Пробелов: ${res.spaceCount}`
      );
      await loadRawSubtitles();
      onRefresh();
    } catch (err) {
      console.error(err);
      setStatus('Ошибка авто-исправления.');
    } finally {
      setLoading(false);
    }
  };

  const uniqueNames = useMemo(() => {
    const episodeAssignedActors = (currentEpisode?.assignments || []).map(a => a.characterName);
    const lineActors = lines.map(l =>
      updates[l.rawLineIndex]?.name !== undefined ? updates[l.rawLineIndex].name : l.name
    );

    return Array.from(
      new Set([
        ...lineActors.filter(n => n && n.trim() !== '' && n !== 'Default'),
        ...episodeAssignedActors.filter(n => n && n.trim() !== '' && n !== 'Default')
      ])
    ).sort();
  }, [lines, updates, currentEpisode?.assignments]);

  useEffect(() => {
    setStableNames(prev => {
      const validSet = new Set(uniqueNames);
      const filtered = prev.filter(name => validSet.has(name));
      const existingSet = new Set(filtered);
      let changed = filtered.length !== prev.length;

      uniqueNames.forEach(name => {
        if (!existingSet.has(name)) {
          filtered.push(name);
          changed = true;
        }
      });
      return changed ? filtered : prev;
    });
  }, [uniqueNames]);

  const handlePlayFromTime = (timeStr: string) => {
    if (!videoRef.current) return;
    const totalSeconds = parseAssTimeToSeconds(timeStr);
    videoRef.current.currentTime = totalSeconds;
    videoRef.current.play().catch(e => console.error('Play error', e));
  };

  const handleJumpToBookmark = useCallback(
    (rawLineIndex: number) => {
      const line = lines.find(l => l.rawLineIndex === rawLineIndex);
      if (line) {
        setActiveLineIndex(rawLineIndex);
        handlePlayFromTime(line.start);
        setTimeout(() => {
          const element = document.getElementById(`line-${rawLineIndex}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 50);
      }
    },
    [lines]
  );

  const batchActions = useSubtitleBatchAndRoleActions({
    currentEpisode,
    onRefresh,
    lines,
    setLines,
    updates,
    setUpdates,
    setLoading,
    setStatus,
    setShowHonorificsModal,
    setShowShiftModal,
    shiftAmountMs,
    setShiftAmountMs,
    activeLineIndex,
    setActiveLineIndex,
    selectedLines,
    setSelectedLines,
    lastSelectedLine,
    setLastSelectedLine,
    massName,
    setMassName,
    stableNames,
    commitNewName,
    pushStateForUndo
  });

  return {
    lines,
    loading,
    saving,
    status,
    updates,
    autoSave,
    setAutoSave,
    undoStack,
    redoStack,
    currentTime,
    setCurrentTime,
    duration,
    isPlaying,
    activeLineIndex,
    setActiveLineIndex,
    bookmarks,
    showShiftModal,
    setShowShiftModal,
    shiftAmountMs,
    setShiftAmountMs,
    showSigns,
    setShowSigns,
    showScreenshots,
    setShowScreenshots,
    handleToggleScreenshots,
    stableNames,
    selectedLines,
    massName,
    setMassName,
    videoRef,
    unassignedCount,
    totalDuration,
    isMultiSubMergeModalOpen,
    setIsMultiSubMergeModalOpen,
    showHonorificsModal,
    setShowHonorificsModal,
    autoApplyAliases,
    autoApplyStresses,
    handleToggleAutoApplyAliases,
    handleToggleAutoApplyStresses,
    handleUndo,
    handleRedo,
    handleToggleBookmark,
    handleJumpToBookmark,
    commitNewName,
    loadRawSubtitles,
    handleSave,
    handleAutoFix,
    handlePlayFromTime,
    isSignLine,
    ...batchActions
  };
}
