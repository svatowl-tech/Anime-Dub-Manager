import React, { useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Episode } from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';
import { getSharedAudioContext } from '../../lib/qa/sharedAudioContext';
import { analyzeAudioBufferForPreview, NormalizationMetrics } from '../../lib/qa/audioNormalizer';
import { AudioClip, MissingSubtitleMarker, TimingIssue } from './timing.types';
import { formatSeconds } from './timing.utils';

export function useTimingTimelineInteractions(params: {
  currentEpisode: Episode | null;
  audioClips: Record<string, AudioClip[]>;
  setAudioClips: React.Dispatch<React.SetStateAction<Record<string, AudioClip[]>>>;
  draggingClip: {
    type: 'move' | 'resize-start' | 'resize-end';
    trackId: string;
    clipId: string;
    startMouseX: number;
    initialClipStartSec: number;
    initialDurationSec: number;
    initialSourceStartSec: number;
    initialSourceEndSec: number;
  } | null;
  setDraggingClip: React.Dispatch<React.SetStateAction<{
    type: 'move' | 'resize-start' | 'resize-end';
    trackId: string;
    clipId: string;
    startMouseX: number;
    initialClipStartSec: number;
    initialDurationSec: number;
    initialSourceStartSec: number;
    initialSourceEndSec: number;
  } | null>>;
  selectedClipId: string | null;
  setSelectedClipId: React.Dispatch<React.SetStateAction<string | null>>;
  activeMissingMarker: MissingSubtitleMarker | null;
  setActiveMissingMarker: React.Dispatch<React.SetStateAction<MissingSubtitleMarker | null>>;
  missingFileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  setMissingSubtitles: React.Dispatch<React.SetStateAction<MissingSubtitleMarker[]>>;
  setTimingIssues: React.Dispatch<React.SetStateAction<TimingIssue[]>>;
  setNormalizationMetrics: React.Dispatch<React.SetStateAction<Record<string, NormalizationMetrics>>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  duration: number;
  zoomLevel: number;
  timelineContainerRef: React.MutableRefObject<HTMLDivElement | null>;
  timeRulerContainerRef: React.MutableRefObject<HTMLDivElement | null>;
  audioBuffersRef: React.MutableRefObject<Record<string, AudioBuffer>>;
  seekToTime: (newTimeSec: number) => void;
  updateProcess: (title: string, detail: string, progress: number, stepCurrent?: number, stepTotal?: number) => void;
  clearProcess: () => void;
  addLog: (msg: string, level?: 'info' | 'success' | 'warn' | 'error') => void;
}) {
  const {
    currentEpisode,
    audioClips,
    setAudioClips,
    draggingClip,
    setDraggingClip,
    selectedClipId,
    setSelectedClipId,
    activeMissingMarker,
    setActiveMissingMarker,
    missingFileInputRef,
    setMissingSubtitles,
    setTimingIssues,
    setNormalizationMetrics,
    setIsLoading,
    setIsPlaying,
    duration,
    zoomLevel,
    timelineContainerRef,
    timeRulerContainerRef,
    audioBuffersRef,
    seekToTime,
    updateProcess,
    clearProcess,
    addLog
  } = params;

  const handleTriggerUploadMissing = (marker: MissingSubtitleMarker) => {
    setActiveMissingMarker(marker);
    if (missingFileInputRef.current) {
      missingFileInputRef.current.value = '';
      missingFileInputRef.current.click();
    }
  };

  const handleMissingFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeMissingMarker) return;
    const marker = activeMissingMarker;

    try {
      setIsLoading(true);
      updateProcess('Загрузка недостающей реплики', `Декодирование «${file.name}» для «${marker.characterName}»...`, 25, 1, 2);
      const arrayBuf = await file.arrayBuffer();
      const sharedAudioCtx = getSharedAudioContext();
      if (!sharedAudioCtx) throw new Error('AudioContext недоступен');

      const audioBuf = await sharedAudioCtx.decodeAudioData(arrayBuf);
      const audioKey = `${marker.trackId}_uploaded_${marker.id}`;
      audioBuffersRef.current[audioKey] = audioBuf;
      const norm = analyzeAudioBufferForPreview(audioBuf, audioKey);
      setNormalizationMetrics(prev => ({ ...prev, [audioKey]: norm }));

      updateProcess('Загрузка недостающей реплики', `Сохранение файла и вставка на таймкод ${formatSeconds(marker.startSec)}...`, 75, 2, 2);
      let savedPath = (file as any).path || '';
      if (!savedPath) {
        try {
          const safeName = `uploaded_${marker.dubberName}_${Date.now()}_${file.name.replace(/[^\w.-]/g, '_')}`;
          const targetDir = (currentEpisode as any)?.folderPath || 'temp_uploads';
          const saveRes: any = await ipcSafe.invoke('save-file-buffer', {
            buffer: Array.from(new Uint8Array(arrayBuf)),
            targetDir,
            fileName: safeName
          });
          if (saveRes?.path) {
            savedPath = saveRes.path;
          }
        } catch (e) {}
      }

      const newClip: AudioClip = {
        id: `clip_up_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        trackId: marker.trackId,
        dubberName: marker.dubberName,
        characterName: marker.characterName,
        clipStartSec: marker.startSec,
        durationSec: Number(audioBuf.duration.toFixed(3)),
        sourceStartSec: 0,
        sourceEndSec: Number(audioBuf.duration.toFixed(3)),
        rawSourceStartSec: 0,
        rawSourceEndSec: Number(audioBuf.duration.toFixed(3)),
        sourceAudioTrackId: audioKey,
        sourceAudioPath: savedPath || undefined,
        text: marker.text,
        volumePercent: 100,
        offsetSec: 0,
        timingIssue: null
      };

      setAudioClips(prev => ({
        ...prev,
        [marker.trackId]: [...(prev[marker.trackId] || []), newClip].sort((a, b) => a.clipStartSec - b.clipStartSec)
      }));

      setMissingSubtitles(prev => prev.filter(m => m.id !== marker.id));
      setTimingIssues(prev => prev.filter(i => i.id !== `issue_missing_${marker.trackId}_${marker.subId}`));

      addLog(`✓ Реплика «${marker.text.slice(0, 30)}» успешно загружена из «${file.name}» (${audioBuf.duration.toFixed(2)}с) на таймкод ${formatSeconds(marker.startSec)}`, 'success');
      toast.success(`Реплика загружена и вставлена на ${formatSeconds(marker.startSec)}!`);
    } catch (err: any) {
      addLog(`❌ Ошибка загрузки реплики: ${err.message}`, 'error');
      toast.error(`Ошибка загрузки аудио: ${err.message}`);
    } finally {
      setIsLoading(false);
      clearProcess();
      setActiveMissingMarker(null);
    }
  };

  const handleDismissMissing = (markerId: string) => {
    setMissingSubtitles(prev => prev.filter(m => m.id !== markerId));
    setTimingIssues(prev => prev.filter(i => !i.id.includes(markerId)));
    toast.success('Пропущенная реплика скрыта с таймлайна');
  };

  const handleTimelineScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (timeRulerContainerRef.current) {
      timeRulerContainerRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  }, [timeRulerContainerRef]);

  const handleTimelineWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      if (timelineContainerRef.current) {
        timelineContainerRef.current.scrollLeft += (e.deltaX || e.deltaY);
        if (timeRulerContainerRef.current) {
          timeRulerContainerRef.current.scrollLeft = timelineContainerRef.current.scrollLeft;
        }
      }
    }
  }, [timelineContainerRef, timeRulerContainerRef]);

  useEffect(() => {
    if (!draggingClip) return;
    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - draggingClip.startMouseX;
      const deltaSec = deltaX / zoomLevel;

      if (draggingClip.type === 'move') {
        setAudioClips(prev => {
          const trClips = prev[draggingClip.trackId] || [];
          const updated = trClips.map(clip => {
            if (clip.id === draggingClip.clipId) {
              const newStart = Math.max(0, Number((draggingClip.initialClipStartSec + deltaSec).toFixed(2)));
              return { ...clip, clipStartSec: newStart, offsetSec: 0 };
            }
            return clip;
          });
          return { ...prev, [draggingClip.trackId]: updated };
        });
      } else if (draggingClip.type === 'resize-start') {
        const maxBackwardsExpandSec = draggingClip.initialSourceStartSec;
        const clampedDelta = Math.max(-maxBackwardsExpandSec, deltaSec);
        const maxTrimInwards = draggingClip.initialDurationSec - 0.10;
        const finalDelta = Math.min(maxTrimInwards, clampedDelta);

        const newClipStart = Math.max(0, Number((draggingClip.initialClipStartSec + finalDelta).toFixed(2)));
        const newSourceStart = Math.max(0, Number((draggingClip.initialSourceStartSec + finalDelta).toFixed(2)));
        const newDuration = Math.max(0.10, Number((draggingClip.initialDurationSec - finalDelta).toFixed(2)));

        setAudioClips(prev => {
          const trClips = prev[draggingClip.trackId] || [];
          const updated = trClips.map(clip => {
            if (clip.id === draggingClip.clipId) {
              return {
                ...clip,
                clipStartSec: newClipStart,
                sourceStartSec: newSourceStart,
                durationSec: newDuration,
                sourceEndSec: Number((newSourceStart + newDuration).toFixed(2)),
                offsetSec: 0
              };
            }
            return clip;
          });
          return { ...prev, [draggingClip.trackId]: updated };
        });
      } else if (draggingClip.type === 'resize-end') {
        const trackBuffer = audioBuffersRef.current[draggingClip.trackId];
        const maxSourceDuration = trackBuffer ? trackBuffer.duration : 3600;
        const maxForwardsExpandSec = Math.max(0, maxSourceDuration - draggingClip.initialSourceEndSec);

        const clampedDelta = Math.min(maxForwardsExpandSec, deltaSec);
        const maxTrimBackwards = -(draggingClip.initialDurationSec - 0.10);
        const finalDelta = Math.max(maxTrimBackwards, clampedDelta);

        const newDuration = Math.max(0.10, Number((draggingClip.initialDurationSec + finalDelta).toFixed(2)));
        const newSourceEnd = Math.min(maxSourceDuration, Number((draggingClip.initialSourceEndSec + finalDelta).toFixed(2)));

        setAudioClips(prev => {
          const trClips = prev[draggingClip.trackId] || [];
          const updated = trClips.map(clip => {
            if (clip.id === draggingClip.clipId) {
              return {
                ...clip,
                durationSec: newDuration,
                sourceEndSec: newSourceEnd
              };
            }
            return clip;
          });
          return { ...prev, [draggingClip.trackId]: updated };
        });
      }
    };

    const handleMouseUp = () => {
      setDraggingClip(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingClip, zoomLevel, setAudioClips, setDraggingClip, audioBuffersRef]);

  const handleClipMouseDown = (e: React.MouseEvent, trackId: string, clip: AudioClip) => {
    e.stopPropagation();
    setSelectedClipId(clip.id);
    setDraggingClip({
      type: 'move',
      trackId,
      clipId: clip.id,
      startMouseX: e.clientX,
      initialClipStartSec: clip.clipStartSec + (clip.offsetSec || 0),
      initialDurationSec: clip.durationSec,
      initialSourceStartSec: clip.sourceStartSec,
      initialSourceEndSec: clip.sourceEndSec
    });
  };

  const handleResizeMouseDown = (e: React.MouseEvent, trackId: string, clip: AudioClip, edge: 'start' | 'end') => {
    e.stopPropagation();
    setSelectedClipId(clip.id);
    setDraggingClip({
      type: edge === 'start' ? 'resize-start' : 'resize-end',
      trackId,
      clipId: clip.id,
      startMouseX: e.clientX,
      initialClipStartSec: clip.clipStartSec + (clip.offsetSec || 0),
      initialDurationSec: clip.durationSec,
      initialSourceStartSec: clip.sourceStartSec,
      initialSourceEndSec: clip.sourceEndSec
    });
  };

  const handleExpandClip = (trackId: string, clipId: string, side: 'start' | 'end', deltaSec: number) => {
    setAudioClips(prev => {
      const trClips = prev[trackId] || [];
      const trackBuffer = audioBuffersRef.current[trackId];
      const maxSourceDuration = trackBuffer ? trackBuffer.duration : 3600;

      const updated = trClips.map(clip => {
        if (clip.id === clipId) {
          if (side === 'start') {
            const actualDelta = Math.min(clip.sourceStartSec, deltaSec);
            const newClipStart = Math.max(0, Number((clip.clipStartSec - actualDelta).toFixed(2)));
            const newSourceStart = Math.max(0, Number((clip.sourceStartSec - actualDelta).toFixed(2)));
            const newDuration = Number((clip.durationSec + actualDelta).toFixed(2));
            return {
              ...clip,
              clipStartSec: newClipStart,
              sourceStartSec: newSourceStart,
              durationSec: newDuration,
              sourceEndSec: Number((newSourceStart + newDuration).toFixed(2))
            };
          } else {
            const availableEnd = Math.max(0, maxSourceDuration - clip.sourceEndSec);
            const actualDelta = Math.min(availableEnd, deltaSec);
            const newDuration = Number((clip.durationSec + actualDelta).toFixed(2));
            const newSourceEnd = Number((clip.sourceEndSec + actualDelta).toFixed(2));
            return {
              ...clip,
              durationSec: newDuration,
              sourceEndSec: newSourceEnd
            };
          }
        }
        return clip;
      });
      return { ...prev, [trackId]: updated };
    });
    toast.success(`Клип расширен на +${deltaSec}с (${side === 'start' ? 'начало' : 'хвост'})`);
  };

  const handleResetClipToOriginal = (trackId: string, clipId: string) => {
    setAudioClips(prev => {
      const trClips = prev[trackId] || [];
      const updated = trClips.map(clip => {
        if (clip.id === clipId && clip.rawSourceStartSec !== undefined && clip.rawSourceEndSec !== undefined) {
          const origDur = Math.max(0.1, clip.rawSourceEndSec - clip.rawSourceStartSec);
          return {
            ...clip,
            sourceStartSec: clip.rawSourceStartSec,
            sourceEndSec: clip.rawSourceEndSec,
            durationSec: origDur
          };
        }
        return clip;
      });
      return { ...prev, [trackId]: updated };
    });
    toast.info('Границы клипа сброшены к начальной детекции');
  };

  const handleDeleteClip = (clipId: string, explicitTrackId?: string) => {
    let targetTrackId = explicitTrackId;
    let deletedClip: AudioClip | null = null;

    if (!targetTrackId) {
      for (const trId of Object.keys(audioClips)) {
        const found = (audioClips[trId] || []).find(c => c.id === clipId);
        if (found) {
          targetTrackId = trId;
          deletedClip = found;
          break;
        }
      }
    } else {
      deletedClip = (audioClips[targetTrackId] || []).find(c => c.id === clipId) || null;
    }

    if (!targetTrackId || !deletedClip) return;

    setAudioClips(prev => {
      const trClips = prev[targetTrackId!] || [];
      const updated = trClips.filter(c => c.id !== clipId);
      return { ...prev, [targetTrackId!]: updated };
    });

    if (selectedClipId === clipId) {
      setSelectedClipId(null);
    }

    addLog(`🗑 Удалена фраза/шум: «${deletedClip.text}» (${deletedClip.dubberName}, ${formatSeconds(deletedClip.clipStartSec)}, ${deletedClip.durationSec.toFixed(2)}с). Фраза исключена из монтажа.`, 'info');

    toast.success(`Фраза удалена из тайминга и исключена из финального монтажа`, {
      action: {
        label: 'Отменить',
        onClick: () => {
          if (deletedClip && targetTrackId) {
            setAudioClips(prev => {
              const trClips = prev[targetTrackId!] || [];
              const restored = [...trClips, deletedClip!].sort((a, b) => a.clipStartSec - b.clipStartSec);
              return { ...prev, [targetTrackId!]: restored };
            });
            toast.info(`Фраза «${deletedClip.text}» восстановлена`);
            addLog(`↩ Восстановлена фраза «${deletedClip.text}» на дорожке ${deletedClip.dubberName}`, 'info');
          }
        }
      }
    });
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('.group\\/edge') || target.tagName === 'BUTTON') return;
    const lane = e.currentTarget;
    const rect = lane.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const newTime = Math.max(0, Math.min(duration, clickX / zoomLevel));
    seekToTime(newTime);
    addLog(`⏩ Перемещение плейбэка на ${formatSeconds(newTime)}`, 'info');
  };

  const handleTimeRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const ruler = timeRulerContainerRef.current;
    if (!ruler) return;
    const rect = ruler.getBoundingClientRect();
    const clickX = e.clientX - rect.left + ruler.scrollLeft;
    const newTime = Math.max(0, Math.min(duration, clickX / zoomLevel));
    seekToTime(newTime);
    addLog(`⏩ Перемещение плейбэка на ${formatSeconds(newTime)}`, 'info');
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (isInput) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying(prev => {
          const next = !prev;
          addLog(next ? `▶ Воспроизведение запущено` : `⏸ Воспроизведение остановлено`, 'info');
          return next;
        });
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        if (selectedClipId) {
          e.preventDefault();
          handleDeleteClip(selectedClipId);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedClipId, audioClips, addLog, setIsPlaying]);

  return {
    handleTriggerUploadMissing,
    handleMissingFileSelected,
    handleDismissMissing,
    handleTimelineScroll,
    handleTimelineWheel,
    handleClipMouseDown,
    handleResizeMouseDown,
    handleExpandClip,
    handleResetClipToOriginal,
    handleDeleteClip,
    handleTimelineClick,
    handleTimeRulerClick
  };
}
