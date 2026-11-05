import React, { useRef, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { ipcSafe } from '../../lib/ipcSafe';
import { latinToCyrillic, polivanovToHepburn } from '../../lib/translit';
import { Episode } from '../../types';
import { RawSubtitleLine, SubtitleUpdates } from './types';
import {
  parseAssTimeToSeconds,
  secondsToAssTime,
  applyStressToText,
  SHORTCUT_CODES
} from './utils';
import { applyGenderPrefix, getNextNumberedRole } from './roleHelpers';
import { bulkFilterHonorifics, HonorificsOptions } from '../../lib/honorificsFilter';

export interface UseSubtitleBatchAndRoleActionsParams {
  currentEpisode: Episode | null;
  onRefresh: () => void;
  lines: RawSubtitleLine[];
  setLines: React.Dispatch<React.SetStateAction<RawSubtitleLine[]>>;
  updates: SubtitleUpdates;
  setUpdates: React.Dispatch<React.SetStateAction<SubtitleUpdates>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setStatus: React.Dispatch<React.SetStateAction<string>>;
  setShowHonorificsModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowShiftModal: React.Dispatch<React.SetStateAction<boolean>>;
  shiftAmountMs: string;
  setShiftAmountMs: React.Dispatch<React.SetStateAction<string>>;
  activeLineIndex: number | null;
  setActiveLineIndex: React.Dispatch<React.SetStateAction<number | null>>;
  selectedLines: Set<number>;
  setSelectedLines: React.Dispatch<React.SetStateAction<Set<number>>>;
  lastSelectedLine: number | null;
  setLastSelectedLine: React.Dispatch<React.SetStateAction<number | null>>;
  massName: string;
  setMassName: React.Dispatch<React.SetStateAction<string>>;
  stableNames: string[];
  commitNewName: (name: string) => void;
  pushStateForUndo: () => void;
}

export function useSubtitleBatchAndRoleActions({
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
}: UseSubtitleBatchAndRoleActionsParams) {
  const isTypingRef = useRef(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleLineUpdate = (
    rawLineIndex: number,
    update: { name?: string; text?: string; start?: string; end?: string }
  ) => {
    if (!isTypingRef.current) {
      pushStateForUndo();
      isTypingRef.current = true;
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
    }, 1500);

    setUpdates(prev => {
      const current = prev[rawLineIndex] || {};
      return { ...prev, [rawLineIndex]: { ...current, ...update } };
    });
  };

  const toggleLineSelection = (rawLineIndex: number, isShiftKey: boolean = false) => {
    setSelectedLines(prev => {
      const next = new Set(prev);
      if (isShiftKey && lastSelectedLine !== null) {
        const currentIndex = lines.findIndex(l => l.rawLineIndex === rawLineIndex);
        const lastIndex = lines.findIndex(l => l.rawLineIndex === lastSelectedLine);

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
      setSelectedLines(new Set(lines.map(l => l.rawLineIndex)));
    } else {
      setSelectedLines(new Set());
    }
  };

  const handleMassAssign = () => {
    if (selectedLines.size === 0 || !massName.trim()) return;
    pushStateForUndo();

    const newUpdates = { ...updates };
    selectedLines.forEach(index => {
      newUpdates[index] = { ...newUpdates[index], name: massName.trim() };
    });
    setUpdates(newUpdates);
    commitNewName(massName.trim());
    setSelectedLines(new Set());
    setMassName('');
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
    setStatus('Имена и текст транслитерированы.');
  };

  const handleDeleteLine = (index: number) => {
    if (!confirm('Удалить эту реплику?')) return;
    pushStateForUndo();
    setLines(prev => {
      const newLines = [...prev];
      newLines.splice(index, 1);
      return newLines;
    });
    setUpdates(prev => ({ ...prev, _forceSave: true }) as any);
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
    const newStart = newEndA;
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
        newLines[index + 1] = { ...prev[index + 1], start: newStartBTime, startSec: newStartB };

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

  const handleDrawLine = useCallback(
    (startSec: number, endSec: number) => {
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
    },
    [updates, pushStateForUndo, setLines, setUpdates, setActiveLineIndex]
  );

  const handleAddSubtitleAtTiming = useCallback(
    (
      startSec: number,
      endSec: number,
      text: string,
      characterName: string = '',
      mode: 'new' | 'replace' = 'new'
    ) => {
      pushStateForUndo();

      if (mode === 'replace' && activeLineIndex !== null) {
        setUpdates(u => ({
          ...u,
          [activeLineIndex]: {
            ...(u[activeLineIndex] || {}),
            text,
            ...(characterName ? { name: characterName } : {})
          }
        }));
        return;
      }

      const newId = Date.now();
      const startTimeStr = secondsToAssTime(startSec);
      const endTimeStr = secondsToAssTime(endSec);

      const newLine = {
        text,
        name: characterName,
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
        [newId]: { text, name: characterName, start: startTimeStr, end: endTimeStr }
      }));

      setActiveLineIndex(newId);

      setTimeout(() => {
        const element = document.getElementById(`line-${newId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 150);
    },
    [updates, activeLineIndex, pushStateForUndo, setLines, setUpdates, setActiveLineIndex]
  );

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
    setStatus('Имена персонажей переведены на систему Хэпберна.');
  };

  const handleRemoveHonorifics = async (options: HonorificsOptions) => {
    if (!lines || lines.length === 0) return;
    pushStateForUndo();
    setLoading(true);
    setStatus('Фильтрация обращений...');
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
      console.error('Error removing honorifics:', err);
      toast.error('Ошибка при удалении обращений');
      setStatus('Ошибка при удалении обращений.');
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

    const targetIndices =
      selectedLines.size > 0 ? Array.from(selectedLines) : lines.map(l => l.rawLineIndex);

    setUpdates(prev => {
      const next = { ...prev };
      for (const idx of targetIndices) {
        const line = lines.find(l => l.rawLineIndex === idx);
        if (!line) continue;

        const currentStartSec =
          prev[idx]?.start !== undefined ? parseAssTimeToSeconds(prev[idx].start as string) : line.startSec;
        const currentEndSec =
          prev[idx]?.end !== undefined ? parseAssTimeToSeconds(prev[idx].end as string) : line.endSec;

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

  const handleQuickAssign = useCallback(
    (name: string) => {
      pushStateForUndo();
      if (selectedLines.size > 0) {
        const newUpdates = { ...updates };
        selectedLines.forEach(index => {
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
    },
    [selectedLines, updates, activeLineIndex, pushStateForUndo, setUpdates, setSelectedLines, setMassName]
  );

  const handleApplyGenderPrefix = useCallback(
    (gender: 'M' | 'F') => {
      pushStateForUndo();
      const newUpdates = { ...updates };

      if (selectedLines.size > 0) {
        selectedLines.forEach(idx => {
          const line = lines.find(l => l.rawLineIndex === idx);
          const currentName = updates[idx]?.name !== undefined ? updates[idx].name : line?.name || '';
          newUpdates[idx] = { ...newUpdates[idx], name: applyGenderPrefix(currentName, gender) };
        });
        setUpdates(newUpdates);
      } else if (activeLineIndex !== null) {
        const line = lines.find(l => l.rawLineIndex === activeLineIndex);
        const currentName =
          updates[activeLineIndex]?.name !== undefined ? updates[activeLineIndex].name : line?.name || '';
        newUpdates[activeLineIndex] = {
          ...newUpdates[activeLineIndex],
          name: applyGenderPrefix(currentName, gender)
        };
        setUpdates(newUpdates);
      } else if (massName) {
        setMassName(applyGenderPrefix(massName, gender));
      }
    },
    [selectedLines, activeLineIndex, lines, updates, massName, pushStateForUndo, setUpdates, setMassName]
  );

  const handleApplyNextNumber = useCallback(() => {
    pushStateForUndo();
    const allRolesInEp = lines.map(l =>
      updates[l.rawLineIndex]?.name !== undefined ? updates[l.rawLineIndex].name : l.name
    );
    const newUpdates = { ...updates };

    if (selectedLines.size > 0) {
      selectedLines.forEach(idx => {
        const line = lines.find(l => l.rawLineIndex === idx);
        const currentName = updates[idx]?.name !== undefined ? updates[idx].name : line?.name || '';
        const nextNumbered = getNextNumberedRole(currentName, allRolesInEp);
        newUpdates[idx] = { ...newUpdates[idx], name: nextNumbered };
        allRolesInEp.push(nextNumbered);
      });
      setUpdates(newUpdates);
    } else if (activeLineIndex !== null) {
      const line = lines.find(l => l.rawLineIndex === activeLineIndex);
      const currentName =
        updates[activeLineIndex]?.name !== undefined ? updates[activeLineIndex].name : line?.name || '';
      const nextNumbered = getNextNumberedRole(currentName, allRolesInEp);
      newUpdates[activeLineIndex] = { ...newUpdates[activeLineIndex], name: nextNumbered };
      setUpdates(newUpdates);
    } else if (massName) {
      setMassName(getNextNumberedRole(massName, allRolesInEp));
    }
  }, [selectedLines, activeLineIndex, lines, updates, massName, pushStateForUndo, setUpdates, setMassName]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const keyLower = e.key.toLowerCase();
      if (!e.ctrlKey && !e.metaKey && (keyLower === 'м' || keyLower === 'm' || keyLower === 'v' || e.code === 'KeyM')) {
        e.preventDefault();
        handleApplyGenderPrefix('M');
        return;
      }

      if (
        !e.ctrlKey &&
        !e.metaKey &&
        (keyLower === 'ж' ||
          keyLower === 'w' ||
          keyLower === 'f' ||
          e.code === 'KeyJ' ||
          e.code === 'KeyW' ||
          e.code === 'Semicolon')
      ) {
        e.preventDefault();
        handleApplyGenderPrefix('F');
        return;
      }

      if (
        !e.ctrlKey &&
        !e.metaKey &&
        (e.key === '№' || e.key === '#' || (e.code === 'Digit3' && e.shiftKey) || keyLower === 'n')
      ) {
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
    lines.forEach(line => {
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
    const targetName = 'НАДПИСЬ';
    const signKeys = charName ? [charName.toLowerCase()] : ['caption', 'captions', 'sign', 'signs', 'title', 'text'];
    const newUpdates = { ...updates };
    let count = 0;

    lines.forEach(line => {
      const index = line.rawLineIndex;
      const currentName = (updates[index]?.name || line.name || '').trim();
      const currentLower = currentName.toLowerCase();

      if (
        currentName &&
        currentName !== targetName &&
        signKeys.some(k => currentLower === k || currentLower.includes(k))
      ) {
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

      if (Object.keys(stresses).length === 0) {
        toast.info('Словарь ударений пуст');
        return;
      }
      pushStateForUndo();
      const newUpdates = { ...updates };
      let totalModified = 0;

      lines.forEach(line => {
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

  return {
    handleLineUpdate,
    toggleLineSelection,
    handleSelectAll,
    handleMassAssign,
    handleMassTransliterate,
    handleDeleteLine,
    handleDuplicateLine,
    handleAddLine,
    handleDrawLine,
    handleAddSubtitleAtTiming,
    handleMassPolivanovToHepburn,
    handleRemoveHonorifics,
    handleShiftTime,
    confirmShiftTime,
    handleQuickAssign,
    handleApplyGenderPrefix,
    handleApplyNextNumber,
    handleApplyAliases,
    handleConvertCaptionsToSigns,
    handleApplyStresses
  };
}
