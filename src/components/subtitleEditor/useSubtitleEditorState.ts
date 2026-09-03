import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { ipcSafe } from "../../lib/ipcSafe";
import { latinToCyrillic, polivanovToHepburn } from "../../lib/translit";
import { useVideoContext } from "../../contexts/VideoContext";
import { Episode } from "../../types";
import { RawSubtitleLine, SubtitleUpdates, UndoRedoState } from "./types";
import {
  parseAssTimeToSeconds,
  secondsToAssTime,
  isSignSubtitleLine,
  applyStressToText,
  SHORTCUT_CODES,
} from "./utils";
import { applyGenderPrefix, getNextNumberedRole } from "./roleHelpers";
import { bulkFilterHonorifics, HonorificsOptions } from "../../lib/honorificsFilter";

export function useSubtitleEditorState(
  currentEpisode: Episode | null,
  onRefresh: () => void
) {
  const [lines, setLines] = useState<RawSubtitleLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
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
      toast.success("Автоматическая замена алиасов при загрузке включена");
    } else {
      toast.info("Автоматическая замена алиасов при загрузке выключена");
    }
  };

  const handleToggleAutoApplyStresses = (val: boolean) => {
    setAutoApplyStresses(val);
    localStorage.setItem('sub_editor_auto_stresses', String(val));
    if (val) {
      toast.success("Автоматическая расстановка ударений при загрузке включена");
    } else {
      toast.info("Автоматическая расстановка ударений при загрузке выключена");
    }
  };

  const [autoSave, setAutoSave] = useState(true);
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
          end: u.end !== undefined ? u.end : line.end,
        };
      });
      try {
        await ipcSafe.invoke('save-translated-subtitles', {
          assFilePath: currentEpisode.subPath,
          translatedLines: fullLines
        });
      } catch(e) {}
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
    setStableNames(prev => {
      if (!prev.includes(name)) {
        return [...prev, name].sort();
      }
      return prev;
    });
  };

  const [selectedLines, setSelectedLines] = useState<Set<number>>(new Set());
  const [lastSelectedLine, setLastSelectedLine] = useState<number | null>(null);
  const [massName, setMassName] = useState("");

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
      
      const handleTimeUpdate = () => {
        setCurrentTime(player.currentTime);
      };

      const handlePlay = () => setIsPlaying(true);
      const handlePause = () => setIsPlaying(false);
      const handleLoadedMetadata = () => {
        setDuration(player.duration || 0);
      };
      
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
          const nextSub = lines.find(l => {
            return l.startSec > player.currentTime + 0.1;
          });
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
    setStatus("Загрузка субтитров...");
    try {
      const data = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
      const subtitleLines = (data.lines || data).map((l: any) => ({
        ...l,
        startSec: parseAssTimeToSeconds(l.start),
        endSec: parseAssTimeToSeconds(l.end)
      })).sort((a: any, b: any) => a.startSec - b.startSec);
      
      setLines(subtitleLines);
      
      const initialUpdates: SubtitleUpdates = {};
      let autoAppliedCount = 0;
      let stressAppliedCount = 0;

      // 1. Apply Aliases
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
          console.error("Error auto-applying aliases on load:", e);
        }
      }

      // 2. Apply Stresses
      if (autoApplyStresses) {
        try {
          const rawStresses = currentEpisode?.project?.nameStresses || '{}';
          const stresses: Record<string, string> = JSON.parse(rawStresses);
          
          const projectChars = currentEpisode?.project?.globalMapping || '[]';
          try {
            const parsedChars = JSON.parse(projectChars);
            let charList: string[] = [];
            if (Array.isArray(parsedChars)) {
              charList = parsedChars.map((c: any) => c.characterName);
            } else {
              charList = Object.keys(parsedChars);
            }
            
            for (const char of charList) {
              if (!char) continue;
              if (char.includes('́') || char.includes("'") || char.includes('+') || (char.length > 1 && /[А-ЯЁ]/.test(char.slice(1)))) {
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
          console.error("Error auto-applying stresses on load:", e);
        }
      }

      setUpdates(initialUpdates);
      setSelectedLines(new Set());
      setLastSelectedLine(null);
      
      let statusMsg = `Загружено ${subtitleLines.length} реплик.`;
      if (autoAppliedCount > 0 || stressAppliedCount > 0) {
        statusMsg += ` Авто-применение: алиасы (${autoAppliedCount}), ударения (${stressAppliedCount}).`;
        toast.success(`Автоматически применено при загрузке: алиасы (${autoAppliedCount}), ударения (${stressAppliedCount})`);
      }
      setStatus(statusMsg);
    } catch (error) {
      console.error(error);
      setStatus("Ошибка загрузки субтитров.");
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

  const isTypingRef = useRef(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleLineUpdate = (rawLineIndex: number, update: { name?: string; text?: string; start?: string; end?: string; }) => {
    if (!isTypingRef.current) {
      pushStateForUndo();
      isTypingRef.current = true;
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
    }, 1500);

    setUpdates((prev) => {
      const current = prev[rawLineIndex] || {};
      const next = { ...prev, [rawLineIndex]: { ...current, ...update } };
      return next;
    });
  };

  const toggleLineSelection = (rawLineIndex: number, isShiftKey: boolean = false) => {
    setSelectedLines((prev) => {
      const next = new Set(prev);
      if (isShiftKey && lastSelectedLine !== null) {
        const currentIndex = lines.findIndex((l) => l.rawLineIndex === rawLineIndex);
        const lastIndex = lines.findIndex((l) => l.rawLineIndex === lastSelectedLine);

        if (currentIndex !== -1 && lastIndex !== -1) {
          const start = Math.min(currentIndex, lastIndex);
          const end = Math.max(currentIndex, lastIndex);
          for (let i = start; i <= end; i++) {
            next.add(lines[i].rawLineIndex);
          }
          return next;
        }
      }

      if (next.has(rawLineIndex)) {
        next.delete(rawLineIndex);
      } else {
        next.add(rawLineIndex);
      }
      return next;
    });
    setLastSelectedLine(rawLineIndex);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedLines(new Set(lines.map((l) => l.rawLineIndex)));
    } else {
      setSelectedLines(new Set());
    }
  };

  const handleMassAssign = () => {
    if (selectedLines.size === 0 || !massName.trim()) return;
    pushStateForUndo();

    const newUpdates = { ...updates };
    selectedLines.forEach((index) => {
      newUpdates[index] = { ...newUpdates[index], name: massName.trim() };
    });
    setUpdates(newUpdates);
    commitNewName(massName.trim());
    setSelectedLines(new Set());
    setMassName("");
  };

  const handleMassTransliterate = () => {
    if (lines.length === 0) return;
    pushStateForUndo();
    
    const newUpdates = { ...updates };
    lines.forEach(line => {
      const current = newUpdates[line.rawLineIndex] || {};
      const currentName = current.name !== undefined ? current.name : line.name;
      const currentText = current.text !== undefined ? current.text : line.text;

      const newName = latinToCyrillic(currentName);
      const newText = latinToCyrillic(currentText);
      
      if (newName !== currentName) {
        newUpdates[line.rawLineIndex] = { ...newUpdates[line.rawLineIndex], name: newName };
      }
      
      if (newText !== currentText) {
        newUpdates[line.rawLineIndex] = { ...newUpdates[line.rawLineIndex], text: newText };
      }
    });
    
    setUpdates(newUpdates);
    setStatus("Имена и текст транслитерированы.");
  };

  const handleDeleteLine = (index: number) => {
    if (!confirm('Удалить эту реплику?')) return;
    pushStateForUndo();
    setLines(prev => {
      const newLines = [...prev];
      newLines.splice(index, 1);
      return newLines;
    });
    setUpdates(prev => ({ ...prev, _forceSave: true } as any));
  };

  const handleDuplicateLine = (index: number) => {
    pushStateForUndo();
    const line = lines[index];
    if (!line) return;

    const start = parseAssTimeToSeconds(line.start);
    const end = parseAssTimeToSeconds(line.end);
    const duration = end - start;
    if (duration < 0.05) return;

    const mid = start + duration / 2;
    const midTime = secondsToAssTime(mid);
    const newId = Date.now() + Math.random();
    
    setLines(prev => {
      const newLines = [...prev];
      newLines[index] = { ...line, end: midTime, endSec: mid };
      
      const newLine = { 
        ...line, 
        start: midTime,
        startSec: mid,
        rawLineIndex: newId,
        id: undefined,
        originalIndex: undefined
      } as RawSubtitleLine;
      
      newLines.splice(index + 1, 0, newLine);
      return newLines;
    });

    setUpdates(u => ({
      ...u,
      [line.rawLineIndex]: { ...(u[line.rawLineIndex] || {}), end: midTime },
      [newId]: { start: midTime }
    }));
  };

  const handleAddLine = (index: number) => {
    pushStateForUndo();
    const prevLine = lines[index];
    if (!prevLine) return;

    const nextLine = lines[index + 1];
    
    const startA = parseAssTimeToSeconds(prevLine.start);
    const endA = parseAssTimeToSeconds(prevLine.end);
    const durationA = endA - startA;
    const takeA = durationA / 2;
    const newEndA = endA - takeA;
    const newEndATime = secondsToAssTime(newEndA);

    const newId = Date.now() + Math.random();
    let newStart = newEndA;
    let newEnd = endA;

    if (nextLine) {
      const startB = parseAssTimeToSeconds(nextLine.start);
      const endB = parseAssTimeToSeconds(nextLine.end);
      const durationB = endB - startB;
      const takeB = durationB / 2;
      const newStartB = startB + takeB;
      const newStartBTime = secondsToAssTime(newStartB);
      
      newEnd = newStartB;

      setLines(prev => {
        const newLines = [...prev];
        newLines[index] = { ...prev[index], end: newEndATime, endSec: newEndA };
        newLines[index+1] = { ...prev[index+1], start: newStartBTime, startSec: newStartB };
        
        const newLine = { 
          ...prevLine, 
          text: '', 
          name: '',
          style: prevLine.style || 'Default',
          start: secondsToAssTime(newStart),
          end: secondsToAssTime(newEnd),
          startSec: newStart,
          endSec: newEnd,
          rawLineIndex: newId, 
          id: undefined,
          originalIndex: undefined
        } as RawSubtitleLine;
        
        newLines.splice(index + 1, 0, newLine);
        return newLines;
      });

      setUpdates(u => ({
        ...u,
        [prevLine.rawLineIndex]: { ...(u[prevLine.rawLineIndex] || {}), end: newEndATime },
        [nextLine.rawLineIndex]: { ...(u[nextLine.rawLineIndex] || {}), start: newStartBTime },
        [newId]: { start: newEndATime, end: newStartBTime }
      }));
    } else {
      setLines(prev => {
        const newLines = [...prev];
        newLines[index] = { ...prev[index], end: newEndATime, endSec: newEndA };
        
        const newLine = { 
          ...prevLine, 
          text: '', 
          name: '',
          style: prevLine.style || 'Default',
          start: secondsToAssTime(newStart),
          end: secondsToAssTime(newEnd),
          startSec: newStart,
          endSec: newEnd,
          rawLineIndex: newId, 
          id: undefined,
          originalIndex: undefined
        } as RawSubtitleLine;
        
        newLines.splice(index + 1, 0, newLine);
        return newLines;
      });

      setUpdates(u => ({
        ...u,
        [prevLine.rawLineIndex]: { ...(u[prevLine.rawLineIndex] || {}), end: newEndATime },
        [newId]: { start: newEndATime, end: secondsToAssTime(newEnd) }
      }));
    }
  };

  const handleDrawLine = useCallback((startSec: number, endSec: number) => {
    pushStateForUndo();
    const newId = Date.now();
    const startTimeStr = secondsToAssTime(startSec);
    const endTimeStr = secondsToAssTime(endSec);
    
    const newLine = {
      text: '',
      name: '',
      style: 'Default',
      start: startTimeStr,
      end: endTimeStr,
      startSec,
      endSec,
      rawLineIndex: newId,
      id: undefined,
      originalIndex: undefined
    } as RawSubtitleLine;
    
    setLines(prev => {
      const newLines = [...prev, newLine];
      newLines.sort((a, b) => {
        const uA = updates[a.rawLineIndex];
        const uB = updates[b.rawLineIndex];
        const sA = uA?.start !== undefined ? parseAssTimeToSeconds(uA.start as string) : a.startSec;
        const sB = uB?.start !== undefined ? parseAssTimeToSeconds(uB.start as string) : b.startSec;
        return sA - sB;
      });
      return newLines;
    });
    
    setUpdates(u => ({
      ...u,
      [newId]: { start: startTimeStr, end: endTimeStr }
    }));
    
    setActiveLineIndex(newId);
    
    setTimeout(() => {
      const element = document.getElementById(`line-${newId}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const textarea = element.querySelector('textarea');
        if (textarea) textarea.focus();
      }
    }, 100);
  }, [updates, pushStateForUndo]);

  const handleMassPolivanovToHepburn = () => {
    if (lines.length === 0) return;
    
    const newUpdates = { ...updates };
    lines.forEach(line => {
      const current = newUpdates[line.rawLineIndex] || {};
      const currentName = current.name !== undefined ? current.name : line.name;
      const newName = polivanovToHepburn(currentName);
      
      if (newName !== currentName) {
        newUpdates[line.rawLineIndex] = { ...newUpdates[line.rawLineIndex], name: newName };
      }
    });
    
    setUpdates(newUpdates);
    setStatus("Имена персонажей переведены на систему Хэпберна.");
  };

  const handleSave = async () => {
    if (!currentEpisode || lines.length === 0) return;
    setSaving(true);
    setStatus("Сохранение изменений...");

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

      setStatus("Изменения сохранены!");
    } catch (error) {
      console.error(error);
      setStatus("Ошибка при сохранении.");
    } finally {
      setSaving(false);
    }
  };

  const projectCharacters = useMemo(() => {
    const raw = currentEpisode?.project?.globalMapping || '[]';
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((c: any) => c.characterName);
      } else {
        return Object.keys(parsed);
      }
    } catch (e) {
      return [];
    }
  }, [currentEpisode?.project?.globalMapping]);

  const handleAutoFix = async () => {
    if (!currentEpisode?.subPath) return;
    pushStateForUndo();
    try {
      setLoading(true);
      setStatus("Исправление ошибок...");
      const res = await ipcSafe.invoke('auto-fix-subtitles', { filePath: currentEpisode.subPath });
      setStatus(`Готово. Удалено: ${res.removedCount}, Исправлено наложений: ${res.overlappingCount}, Пробелов: ${res.spaceCount}`);
      await loadRawSubtitles();
      onRefresh();
    } catch (err) {
      console.error(err);
      setStatus("Ошибка авто-исправления.");
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveHonorifics = async (options: HonorificsOptions) => {
    if (!lines || lines.length === 0) return;
    pushStateForUndo();
    setLoading(true);
    setStatus("Фильтрация обращений...");
    try {
      const { updatedLines, changedCount } = bulkFilterHonorifics(lines, options);
      setLines(updatedLines);
      
      if (currentEpisode?.subPath) {
        await ipcSafe.invoke('remove-honorifics-subtitles', {
          filePath: currentEpisode.subPath,
          options
        });
      }
      toast.success(`Успешно очищено ${changedCount} реплик от японских обращений`);
      setStatus(`Удалены обращения в ${changedCount} репликах.`);
      setShowHonorificsModal(false);
      onRefresh();
    } catch (err: any) {
      console.error("Error removing honorifics:", err);
      toast.error("Ошибка при удалении обращений");
      setStatus("Ошибка при удалении обращений.");
    } finally {
      setLoading(false);
    }
  };

  const handleShiftTime = () => {
    if (!currentEpisode?.subPath) return;
    setShiftAmountMs('');
    setShowShiftModal(true);
  };

  const confirmShiftTime = () => {
    if (!currentEpisode?.subPath) return;
    
    const offsetMs = parseInt(shiftAmountMs, 10);
    if (isNaN(offsetMs)) {
      alert('Неверный формат!');
      return;
    }
    
    setShowShiftModal(false);
    pushStateForUndo();
    const offsetSec = offsetMs / 1000;
    
    const targetIndices = selectedLines.size > 0 
      ? Array.from(selectedLines)
      : lines.map(l => l.rawLineIndex);
      
    setUpdates(prev => {
      const next = { ...prev };
      for (const idx of targetIndices) {
        const line = lines.find(l => l.rawLineIndex === idx);
        if (!line) continue;
        
        const currentStartSec = prev[idx]?.start !== undefined ? parseAssTimeToSeconds(prev[idx].start as string) : line.startSec;
        const currentEndSec = prev[idx]?.end !== undefined ? parseAssTimeToSeconds(prev[idx].end as string) : line.endSec;
        
        const newStartSec = Math.max(0, currentStartSec + offsetSec);
        const newEndSec = Math.max(0, currentEndSec + offsetSec);
        
        next[idx] = {
          ...next[idx],
          start: secondsToAssTime(newStartSec),
          end: secondsToAssTime(newEndSec)
        };
      }
      return next;
    });
    
    setStatus(`Сдвиг ${offsetMs} мс применен к ${targetIndices.length} строкам. Не забудьте сохранить.`);
  };

  const uniqueNames = useMemo(() => {
    // Only include roles present in the current episode (subtitles lines and current episode assignments)
    const episodeAssignedActors = (currentEpisode?.assignments || []).map(a => a.characterName);
    const lineActors = lines.map(l => updates[l.rawLineIndex]?.name !== undefined ? updates[l.rawLineIndex].name : l.name);

    return Array.from(
      new Set([
        ...lineActors.filter(n => n && n.trim() !== "" && n !== "Default"),
        ...episodeAssignedActors.filter(n => n && n.trim() !== "" && n !== "Default")
      ]),
    ).sort();
  }, [lines, updates, currentEpisode?.assignments]);

  useEffect(() => {
    setStableNames(prev => {
      const next = [...prev];
      let changed = false;
      uniqueNames.forEach(name => {
        if (!next.includes(name)) {
          next.push(name);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [uniqueNames]);

  const handleQuickAssign = useCallback((name: string) => {
    pushStateForUndo();
    if (selectedLines.size > 0) {
      const newUpdates = { ...updates };
      selectedLines.forEach((index) => {
        newUpdates[index] = { ...newUpdates[index], name };
      });
      setUpdates(newUpdates);
      setSelectedLines(new Set());
    } else if (activeLineIndex !== null) {
      const newUpdates = { ...updates };
      newUpdates[activeLineIndex] = { ...newUpdates[activeLineIndex], name };
      setUpdates(newUpdates);
    } else {
      setMassName(name);
    }
  }, [selectedLines, updates, activeLineIndex, pushStateForUndo]);

  const handleApplyGenderPrefix = useCallback((gender: 'M' | 'F') => {
    pushStateForUndo();
    const newUpdates = { ...updates };

    if (selectedLines.size > 0) {
      selectedLines.forEach((idx) => {
        const line = lines.find((l) => l.rawLineIndex === idx);
        const currentName = updates[idx]?.name !== undefined ? updates[idx].name : (line?.name || '');
        newUpdates[idx] = { ...newUpdates[idx], name: applyGenderPrefix(currentName, gender) };
      });
      setUpdates(newUpdates);
    } else if (activeLineIndex !== null) {
      const line = lines.find((l) => l.rawLineIndex === activeLineIndex);
      const currentName = updates[activeLineIndex]?.name !== undefined ? updates[activeLineIndex].name : (line?.name || '');
      newUpdates[activeLineIndex] = { ...newUpdates[activeLineIndex], name: applyGenderPrefix(currentName, gender) };
      setUpdates(newUpdates);
    } else if (massName) {
      setMassName(applyGenderPrefix(massName, gender));
    }
  }, [selectedLines, activeLineIndex, lines, updates, massName, pushStateForUndo]);

  const handleApplyNextNumber = useCallback(() => {
    pushStateForUndo();
    const allRolesInEp = lines.map((l) => updates[l.rawLineIndex]?.name !== undefined ? updates[l.rawLineIndex].name : l.name);
    const newUpdates = { ...updates };

    if (selectedLines.size > 0) {
      selectedLines.forEach((idx) => {
        const line = lines.find((l) => l.rawLineIndex === idx);
        const currentName = updates[idx]?.name !== undefined ? updates[idx].name : (line?.name || '');
        const nextNumbered = getNextNumberedRole(currentName, allRolesInEp);
        newUpdates[idx] = { ...newUpdates[idx], name: nextNumbered };
        allRolesInEp.push(nextNumbered);
      });
      setUpdates(newUpdates);
    } else if (activeLineIndex !== null) {
      const line = lines.find((l) => l.rawLineIndex === activeLineIndex);
      const currentName = updates[activeLineIndex]?.name !== undefined ? updates[activeLineIndex].name : (line?.name || '');
      const nextNumbered = getNextNumberedRole(currentName, allRolesInEp);
      newUpdates[activeLineIndex] = { ...newUpdates[activeLineIndex], name: nextNumbered };
      setUpdates(newUpdates);
    } else if (massName) {
      setMassName(getNextNumberedRole(massName, allRolesInEp));
    }
  }, [selectedLines, activeLineIndex, lines, updates, massName, pushStateForUndo]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA' || 
        target.isContentEditable
      ) {
        return;
      }

      // Hotkey 1: 'М' (Male prefix '(М)')
      // Supports Cyrillic 'М' / 'м' and Latin 'M' / 'm' / KeyM
      const keyLower = e.key.toLowerCase();
      if (!e.ctrlKey && !e.metaKey && (keyLower === 'м' || keyLower === 'm' || keyLower === 'v' || e.code === 'KeyM')) {
        e.preventDefault();
        handleApplyGenderPrefix('M');
        return;
      }

      // Hotkey 2: 'Ж' (Female prefix '(Ж)')
      // Supports Cyrillic 'Ж' / 'ж' and Latin 'W' / 'w' / 'F' / 'f' / KeyJ / Semicolon
      if (!e.ctrlKey && !e.metaKey && (keyLower === 'ж' || keyLower === 'w' || keyLower === 'f' || e.code === 'KeyJ' || e.code === 'KeyW' || e.code === 'Semicolon')) {
        e.preventDefault();
        handleApplyGenderPrefix('F');
        return;
      }

      // Hotkey 3: '№' / '#' / 'N' (Incremental numbering)
      if (!e.ctrlKey && !e.metaKey && (e.key === '№' || e.key === '#' || (e.code === 'Digit3' && e.shiftKey) || keyLower === 'n')) {
        e.preventDefault();
        handleApplyNextNumber();
        return;
      }

      const code = e.code;
      const index = SHORTCUT_CODES.indexOf(code);
      
      if (index !== -1 && index < stableNames.length) {
        e.preventDefault();
        handleQuickAssign(stableNames[index]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [stableNames, handleQuickAssign, handleApplyGenderPrefix, handleApplyNextNumber]);

  const handleApplyAliases = () => {
    if (!currentEpisode?.project?.characterAliases) return;
    pushStateForUndo();
    const aliases: Record<string, string> = JSON.parse(currentEpisode.project.characterAliases);
    const newUpdates = { ...updates };
    lines.forEach((line) => {
      const index = line.rawLineIndex;
      const currentName = updates[index]?.name || line.name;
      if (aliases[currentName]) {
        newUpdates[index] = { ...newUpdates[index], name: aliases[currentName] };
      }
    });
    setUpdates(newUpdates);
  };

  const handleConvertCaptionsToSigns = (charName?: string) => {
    pushStateForUndo();
    const targetName = "НАДПИСЬ";
    const signKeys = charName ? [charName.toLowerCase()] : ["caption", "captions", "sign", "signs", "title", "text"];
    const newUpdates = { ...updates };
    let count = 0;

    lines.forEach((line) => {
      const index = line.rawLineIndex;
      const currentName = (updates[index]?.name || line.name || '').trim();
      const currentLower = currentName.toLowerCase();

      if (currentName && currentName !== targetName && signKeys.some(k => currentLower === k || currentLower.includes(k))) {
        newUpdates[index] = { ...newUpdates[index], name: targetName };
        count++;
      }
    });

    setUpdates(newUpdates);
    if (count > 0) {
      toast.success(`Перенаправлено ${count} реплик в "${targetName}"`);
    } else {
      toast.info(`Реплики персонажей вида ${charName || 'caption'} не найдены.`);
    }
  };

  const handleApplyStresses = () => {
    try {
      const rawStresses = currentEpisode?.project?.nameStresses || '{}';
      const stresses: Record<string, string> = JSON.parse(rawStresses);
      
      const projectChars = currentEpisode?.project?.globalMapping || '[]';
      try {
        const parsedChars = JSON.parse(projectChars);
        let charList: string[] = [];
        if (Array.isArray(parsedChars)) {
          charList = parsedChars.map((c: any) => c.characterName);
        } else {
          charList = Object.keys(parsedChars);
        }
        
        for (const char of charList) {
          if (!char) continue;
          if (char.includes('́') || char.includes("'") || char.includes('+') || (char.length > 1 && /[А-ЯЁ]/.test(char.slice(1)))) {
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

      if (Object.keys(stresses).length === 0) {
        toast.info('Словарь ударений пуст');
        return;
      }
      pushStateForUndo();
      const newUpdates = { ...updates };
      let totalModified = 0;
      
      lines.forEach((line) => {
        const index = line.rawLineIndex;
        const currentText = updates[index]?.text || line.text;
        const res = applyStressToText(currentText, stresses);
        if (res.modified) {
          newUpdates[index] = { ...newUpdates[index], text: res.text };
          totalModified++;
        }
      });

      setUpdates(newUpdates);
      if (totalModified > 0) {
        toast.success(`Расставлены ударения в ${totalModified} строках`);
      } else {
        toast.info('Не найдено имен для расстановки ударений');
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка при расстановке ударений');
    }
  };

  const handlePlayFromTime = (timeStr: string) => {
    if (!videoRef.current) return;
    const totalSeconds = parseAssTimeToSeconds(timeStr);
    videoRef.current.currentTime = totalSeconds;
    videoRef.current.play().catch(e => console.error('Play error', e));
  };

  const handleJumpToBookmark = useCallback((rawLineIndex: number) => {
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
  }, [lines]);

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
    handleRemoveHonorifics,
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
    handleLineUpdate,
    toggleLineSelection,
    handleSelectAll,
    handleMassAssign,
    handleMassTransliterate,
    handleDeleteLine,
    handleDuplicateLine,
    handleAddLine,
    handleDrawLine,
    handleMassPolivanovToHepburn,
    handleSave,
    handleAutoFix,
    handleShiftTime,
    confirmShiftTime,
    handleQuickAssign,
    handleApplyGenderPrefix,
    handleApplyNextNumber,
    handleApplyAliases,
    handleConvertCaptionsToSigns,
    handleApplyStresses,
    handlePlayFromTime,
    isSignLine,
  };
}
