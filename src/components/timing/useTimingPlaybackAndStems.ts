import React, { useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { Episode, Track } from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';
import { getSharedAudioContext } from '../../lib/qa/sharedAudioContext';
import { NormalizationMetrics } from '../../lib/qa/audioNormalizer';
import { AudioClip, OriginalStemsState } from './timing.types';
import { formatSeconds, getPlayableAudioUrl } from './timing.utils';

export function useTimingPlaybackAndStems(params: {
  currentEpisode: Episode | null;
  tracks: Track[];
  audioClips: Record<string, AudioClip[]>;
  mutedTracks: Set<string>;
  volumes: Record<string, number>;
  isAutoNormalize: boolean;
  normalizationMetrics: Record<string, NormalizationMetrics>;
  isOriginalMuted: boolean;
  originalVolume: number;
  originalStems: OriginalStemsState;
  setOriginalStems: React.Dispatch<React.SetStateAction<OriginalStemsState>>;
  selectedStemModel: string;
  isPlaying: boolean;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  currentTimeRef: React.MutableRefObject<number>;
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>;
  duration: number;
  zoomLevel: number;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  vocalsAudioRef: React.MutableRefObject<HTMLAudioElement | null>;
  instrumentalAudioRef: React.MutableRefObject<HTMLAudioElement | null>;
  playbackRef: React.MutableRefObject<number | null>;
  timelineContainerRef: React.MutableRefObject<HTMLDivElement | null>;
  audioElementsRef: React.MutableRefObject<Record<string, HTMLAudioElement>>;
  audioBuffersRef: React.MutableRefObject<Record<string, AudioBuffer>>;
  activeClipNodesRef: React.MutableRefObject<Map<string, {
    clipId: string;
    trackId: string;
    source: AudioBufferSourceNode;
    gainNode: GainNode;
    clipStart: number;
    clipEnd: number;
    sourceStart: number;
    sourceEnd: number;
  }>>;
  updateProcess: (title: string, detail: string, progress: number, stepCurrent?: number, stepTotal?: number) => void;
  setActiveProcess: React.Dispatch<React.SetStateAction<{
    title: string;
    detail: string;
    progress: number;
    stepCurrent?: number;
    stepTotal?: number;
  } | null>>;
  addLog: (msg: string, level?: 'info' | 'success' | 'warn' | 'error') => void;
}) {
  const {
    currentEpisode,
    tracks,
    audioClips,
    mutedTracks,
    volumes,
    isAutoNormalize,
    normalizationMetrics,
    isOriginalMuted,
    originalVolume,
    originalStems,
    setOriginalStems,
    selectedStemModel,
    isPlaying,
    setIsPlaying,
    currentTimeRef,
    setCurrentTime,
    duration,
    zoomLevel,
    videoRef,
    vocalsAudioRef,
    instrumentalAudioRef,
    playbackRef,
    timelineContainerRef,
    audioElementsRef,
    audioBuffersRef,
    activeClipNodesRef,
    updateProcess,
    setActiveProcess,
    addLog
  } = params;

  const stopAllScheduledClips = useCallback(() => {
    activeClipNodesRef.current.forEach(node => {
      try { node.source.onended = null; node.source.stop(); } catch (e) {}
      try { node.source.disconnect(); } catch (e) {}
      try { node.gainNode.disconnect(); } catch (e) {}
    });
    activeClipNodesRef.current.clear();
  }, [activeClipNodesRef]);

  const computeEffectiveClipGain = useCallback((
    trackId: string,
    sourceAudioKey: string,
    clipVolumePercent = 100,
    clipVolumeGainDb = 0
  ): number => {
    const trackVol = volumes[trackId] ?? 1.0;
    const clipVol = (clipVolumePercent ?? 100) / 100;
    const dbMult = clipVolumeGainDb ? Math.pow(10, clipVolumeGainDb / 20) : 1.0;
    const normGain = isAutoNormalize
      ? (normalizationMetrics[sourceAudioKey]?.gain ?? normalizationMetrics[trackId]?.gain ?? 1.0)
      : 1.0;
    return Math.max(0, Math.min(8.0, trackVol * clipVol * dbMult * normGain));
  }, [volumes, isAutoNormalize, normalizationMetrics]);

  const syncRealtimeClipPlayback = useCallback((playheadSec: number, forceReschedule = false) => {
    // 1. Sync Original Video & Audio element or Separated AI Stems
    const vid = videoRef.current;
    const hasStemsActive = Boolean(originalStems.hasStems && (originalStems.vocalsPath || originalStems.instrumentalPath));

    if (vid) {
      if (hasStemsActive) {
        vid.muted = true;
        vid.volume = 0;
      } else {
        vid.muted = isOriginalMuted || originalVolume <= 0;
        vid.volume = isOriginalMuted ? 0 : Math.max(0, Math.min(1, originalVolume));
      }

      if (!isPlaying) {
        if (!vid.paused) {
          try { vid.pause(); } catch (e) {}
        }
      } else {
        if (forceReschedule || Math.abs(vid.currentTime - playheadSec) > 0.25) {
          try { vid.currentTime = playheadSec; } catch (e) {}
        }
        if (vid.paused) {
          vid.play().catch(() => {});
        }
      }
    }

    // Sync AI Stems Audio Elements
    const vAudio = vocalsAudioRef.current;
    const iAudio = instrumentalAudioRef.current;
    if (hasStemsActive) {
      const vEffVol = originalStems.instrumentalSolo
        ? 0
        : (originalStems.vocalsMuted || isOriginalMuted ? 0 : originalStems.vocalsVolume);
      const iEffVol = originalStems.vocalsSolo
        ? 0
        : (originalStems.instrumentalMuted || isOriginalMuted ? 0 : originalStems.instrumentalVolume);

      if (vAudio) {
        vAudio.volume = Math.max(0, Math.min(1, vEffVol));
        vAudio.muted = vEffVol <= 0;
        if (!isPlaying) {
          if (!vAudio.paused) try { vAudio.pause(); } catch (e) {}
        } else {
          if (forceReschedule || Math.abs(vAudio.currentTime - playheadSec) > 0.25) {
            try { vAudio.currentTime = playheadSec; } catch (e) {}
          }
          if (vAudio.paused) vAudio.play().catch(() => {});
        }
      }

      if (iAudio) {
        iAudio.volume = Math.max(0, Math.min(1, iEffVol));
        iAudio.muted = iEffVol <= 0;
        if (!isPlaying) {
          if (!iAudio.paused) try { iAudio.pause(); } catch (e) {}
        } else {
          if (forceReschedule || Math.abs(iAudio.currentTime - playheadSec) > 0.25) {
            try { iAudio.currentTime = playheadSec; } catch (e) {}
          }
          if (iAudio.paused) iAudio.play().catch(() => {});
        }
      }
    } else {
      if (vAudio && !vAudio.paused) try { vAudio.pause(); } catch (e) {}
      if (iAudio && !iAudio.paused) try { iAudio.pause(); } catch (e) {}
    }

    if (!isPlaying) {
      stopAllScheduledClips();
      Object.values(audioElementsRef.current).forEach(a => {
        try { a.pause(); } catch (e) {}
      });
      if (vAudio && !vAudio.paused) try { vAudio.pause(); } catch (e) {}
      if (iAudio && !iAudio.paused) try { iAudio.pause(); } catch (e) {}
      return;
    }

    Object.entries(audioElementsRef.current).forEach(([trId, a]) => {
      if (audioBuffersRef.current[trId] || mutedTracks.has(trId)) {
        try { if (!a.paused) a.pause(); } catch (e) {}
      }
    });

    const audioCtx = getSharedAudioContext();
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }

    if (forceReschedule) {
      stopAllScheduledClips();
    }

    const currentValidClips = new Map<string, { clip: AudioClip; trackId: string }>();
    tracks.forEach(tr => {
      if (mutedTracks.has(tr.id)) return;
      const trClips = audioClips[tr.id] || [];
      for (const c of trClips) {
        currentValidClips.set(c.id, { clip: c, trackId: tr.id });
      }
    });

    activeClipNodesRef.current.forEach((node, clipId) => {
      const entry = currentValidClips.get(clipId);
      if (!entry) {
        try { node.source.onended = null; node.source.stop(); } catch (e) {}
        try { node.source.disconnect(); node.gainNode.disconnect(); } catch (e) {}
        activeClipNodesRef.current.delete(clipId);
        return;
      }
      const { clip } = entry;
      const curStart = clip.clipStartSec + (clip.offsetSec || 0);
      const curEnd = curStart + clip.durationSec;

      const hasTimingMoved =
        Math.abs(node.clipStart - curStart) > 0.015 ||
        Math.abs(node.clipEnd - curEnd) > 0.015 ||
        Math.abs(node.sourceStart - clip.sourceStartSec) > 0.015 ||
        Math.abs(node.sourceEnd - clip.sourceEndSec) > 0.015;

      const isOutOfBounds = curEnd <= playheadSec || curStart > playheadSec + 0.35;

      if (hasTimingMoved || isOutOfBounds) {
        try { node.source.onended = null; node.source.stop(); } catch (e) {}
        try { node.source.disconnect(); node.gainNode.disconnect(); } catch (e) {}
        activeClipNodesRef.current.delete(clipId);
      }
    });

    const nowCtx = audioCtx.currentTime;
    currentValidClips.forEach(({ clip, trackId }, clipId) => {
      const clipStart = clip.clipStartSec + (clip.offsetSec || 0);
      const clipEnd = clipStart + clip.durationSec;

      if (clipEnd <= playheadSec + 0.01 || clipStart > playheadSec + 0.25) {
        return;
      }

      const sourceKey = clip.sourceAudioTrackId || trackId;
      const targetGain = computeEffectiveClipGain(trackId, sourceKey, clip.volumePercent, clip.volumeGainDb ?? 0);

      const existingNode = activeClipNodesRef.current.get(clipId);
      if (existingNode) {
        try {
          existingNode.gainNode.gain.setTargetAtTime(targetGain, nowCtx, 0.015);
        } catch (e) {
          existingNode.gainNode.gain.value = targetGain;
        }
        return;
      }

      const buf = audioBuffersRef.current[sourceKey];
      if (!buf) {
        const fallbackAudio = audioElementsRef.current[trackId];
        if (fallbackAudio) {
          try {
            if (Math.abs(fallbackAudio.currentTime - playheadSec) > 0.25) {
              fallbackAudio.currentTime = playheadSec;
            }
            fallbackAudio.volume = Math.max(0, Math.min(1, targetGain));
            if (fallbackAudio.paused) fallbackAudio.play().catch(() => {});
          } catch (e) {}
        }
        return;
      }

      try {
        const source = audioCtx.createBufferSource();
        const gainNode = audioCtx.createGain();
        source.buffer = buf;
        gainNode.gain.value = targetGain;
        source.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        if (playheadSec >= clipStart) {
          const elapsedInClip = playheadSec - clipStart;
          const offsetInBuf = Math.max(0, Math.min(buf.duration - 0.01, clip.sourceStartSec + elapsedInClip));
          const remainingDur = Math.max(0.015, Math.min(clip.durationSec - elapsedInClip, buf.duration - offsetInBuf));
          source.start(0, offsetInBuf, remainingDur);
        } else {
          const delaySec = Math.max(0, clipStart - playheadSec);
          const offsetInBuf = Math.max(0, Math.min(buf.duration - 0.01, clip.sourceStartSec));
          const playDur = Math.max(0.015, Math.min(clip.durationSec, buf.duration - offsetInBuf));
          source.start(nowCtx + delaySec, offsetInBuf, playDur);
        }

        const scheduledNode = {
          clipId,
          trackId,
          source,
          gainNode,
          clipStart,
          clipEnd,
          sourceStart: clip.sourceStartSec,
          sourceEnd: clip.sourceEndSec
        };
        activeClipNodesRef.current.set(clipId, scheduledNode);
        source.onended = () => {
          const cur = activeClipNodesRef.current.get(clipId);
          if (cur && cur.source === source) {
            activeClipNodesRef.current.delete(clipId);
          }
        };
      } catch (e) {
        console.warn('[RealtimeClipScheduler] Failed to schedule clip:', clipId, e);
      }
    });
  }, [isPlaying, tracks, audioClips, mutedTracks, computeEffectiveClipGain, stopAllScheduledClips, isOriginalMuted, originalVolume, originalStems, videoRef, vocalsAudioRef, instrumentalAudioRef, audioElementsRef, audioBuffersRef, activeClipNodesRef]);

  const syncRealtimeRef = useRef(syncRealtimeClipPlayback);
  useEffect(() => {
    syncRealtimeRef.current = syncRealtimeClipPlayback;
  }, [syncRealtimeClipPlayback]);

  // Audio element preloading for AI stems
  useEffect(() => {
    let active = true;
    const setupStems = async () => {
      if (originalStems.vocalsPath) {
        const vUrl = await getPlayableAudioUrl(originalStems.vocalsPath);
        if (active && vUrl) {
          if (!vocalsAudioRef.current) {
            vocalsAudioRef.current = new Audio(vUrl);
            vocalsAudioRef.current.preload = 'auto';
          } else if (vocalsAudioRef.current.src !== vUrl) {
            vocalsAudioRef.current.src = vUrl;
            vocalsAudioRef.current.load();
          }
        }
      } else if (vocalsAudioRef.current) {
        try { vocalsAudioRef.current.pause(); } catch (e) {}
        vocalsAudioRef.current = null;
      }

      if (originalStems.instrumentalPath) {
        const iUrl = await getPlayableAudioUrl(originalStems.instrumentalPath);
        if (active && iUrl) {
          if (!instrumentalAudioRef.current) {
            instrumentalAudioRef.current = new Audio(iUrl);
            instrumentalAudioRef.current.preload = 'auto';
          } else if (instrumentalAudioRef.current.src !== iUrl) {
            instrumentalAudioRef.current.src = iUrl;
            instrumentalAudioRef.current.load();
          }
        }
      } else if (instrumentalAudioRef.current) {
        try { instrumentalAudioRef.current.pause(); } catch (e) {}
        instrumentalAudioRef.current = null;
      }
    };
    setupStems();
    return () => {
      active = false;
    };
  }, [originalStems.vocalsPath, originalStems.instrumentalPath, vocalsAudioRef, instrumentalAudioRef]);

  // IPC listener for neural stem separation progress
  useEffect(() => {
    const unsub = ipcSafe.on('timing-stem-separation-progress', (data: any) => {
      if (!data) return;
      const pct = typeof data.percent === 'number' ? data.percent : 0;
      const statusText = data.status || data.message || 'Разделение нейросетью...';
      setOriginalStems(prev => ({
        ...prev,
        separationProgress: pct,
        separationStatus: statusText
      }));
      updateProcess('Разделение стемов (AI)', `${statusText} (${pct}%)`, pct);
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [updateProcess, setOriginalStems]);

  // Immediately apply clip timing changes, mutes, volumes, or normalization in real time while playing
  useEffect(() => {
    if (isPlaying) {
      syncRealtimeClipPlayback(currentTimeRef.current, false);
    } else {
      const hasStemsActive = Boolean(originalStems.hasStems && (originalStems.vocalsPath || originalStems.instrumentalPath));
      if (videoRef.current) {
        if (hasStemsActive) {
          videoRef.current.muted = true;
          videoRef.current.volume = 0;
        } else {
          videoRef.current.muted = isOriginalMuted || originalVolume <= 0;
          videoRef.current.volume = isOriginalMuted ? 0 : Math.max(0, Math.min(1, originalVolume));
        }
      }
      if (vocalsAudioRef.current) {
        const vEffVol = originalStems.instrumentalSolo
          ? 0
          : (originalStems.vocalsMuted || isOriginalMuted ? 0 : originalStems.vocalsVolume);
        vocalsAudioRef.current.volume = Math.max(0, Math.min(1, vEffVol));
        vocalsAudioRef.current.muted = vEffVol <= 0;
      }
      if (instrumentalAudioRef.current) {
        const iEffVol = originalStems.vocalsSolo
          ? 0
          : (originalStems.instrumentalMuted || isOriginalMuted ? 0 : originalStems.instrumentalVolume);
        instrumentalAudioRef.current.volume = Math.max(0, Math.min(1, iEffVol));
        instrumentalAudioRef.current.muted = iEffVol <= 0;
      }
    }
  }, [audioClips, mutedTracks, volumes, isAutoNormalize, normalizationMetrics, isOriginalMuted, originalVolume, isPlaying, originalStems, syncRealtimeClipPlayback, currentTimeRef, videoRef, vocalsAudioRef, instrumentalAudioRef]);

  const seekToTime = useCallback((newTimeSec: number) => {
    const clamped = Math.max(0, Math.min(duration, newTimeSec));
    currentTimeRef.current = clamped;
    setCurrentTime(clamped);
    if (videoRef.current) {
      try { videoRef.current.currentTime = clamped; } catch (e) {}
    }
    if (originalStems.hasStems) {
      if (vocalsAudioRef.current) {
        try { vocalsAudioRef.current.currentTime = clamped; } catch (e) {}
      }
      if (instrumentalAudioRef.current) {
        try { instrumentalAudioRef.current.currentTime = clamped; } catch (e) {}
      }
    }
    if (isPlaying) {
      syncRealtimeRef.current(clamped, true);
    }
  }, [duration, isPlaying, originalStems.hasStems, currentTimeRef, setCurrentTime, videoRef, vocalsAudioRef, instrumentalAudioRef]);

  const jumpToTime = useCallback((timeSec: number) => {
    if (timelineContainerRef.current) {
      const targetPx = Math.max(0, timeSec * zoomLevel - 250);
      timelineContainerRef.current.scrollTo({ left: targetPx, behavior: 'smooth' });
    }
    seekToTime(Math.max(0, timeSec));
  }, [zoomLevel, seekToTime, timelineContainerRef]);

  const handleSeparateOriginalStems = useCallback(async (modelIdToUse?: string) => {
    const chosenModel = modelIdToUse || selectedStemModel || 'uvr_mdx_voc_ft';
    if (!currentEpisode?.rawPath) {
      toast.error('Оригинальное видео серии не найдено.');
      return;
    }

    setOriginalStems(prev => ({
      ...prev,
      isSeparating: true,
      separationProgress: 5,
      separationStatus: 'Инициализация разделения аудио...'
    }));
    updateProcess('Разделение стемов (AI)', 'Инициализация нейросети и извлечение аудио...', 5);
    addLog(`✂️ Запуск разделения оригинала на Голоса и Фон M&E нейросетью [${chosenModel}]...`, 'info');

    try {
      const res: any = await ipcSafe.invoke('timing-separate-original-stems', {
        episode: currentEpisode,
        modelId: chosenModel
      });

      if (res && res.success) {
        setOriginalStems(prev => ({
          ...prev,
          hasStems: true,
          modelId: res.modelId || chosenModel,
          vocalsPath: res.vocalsPath,
          instrumentalPath: res.instrumentalPath,
          vocalsPeaks: Array.isArray(res.vocalsPeaks) ? res.vocalsPeaks : prev.vocalsPeaks,
          instrumentalPeaks: Array.isArray(res.instrumentalPeaks) ? res.instrumentalPeaks : prev.instrumentalPeaks,
          isSeparating: false,
          separationProgress: 100,
          separationStatus: 'Успешно завершено'
        }));
        addLog(`✅ Оригинал успешно разделен на Голоса и Фон M&E (${res.modelId || chosenModel})!`, 'success');
        toast.success('Оригинал успешно разделен на Голоса и Фон M&E!');
      } else {
        throw new Error(res?.error || 'Не удалось завершить разделение');
      }
    } catch (err: any) {
      console.error('[StemSeparation] Error:', err);
      setOriginalStems(prev => ({
        ...prev,
        isSeparating: false,
        separationStatus: `Ошибка: ${err.message}`
      }));
      addLog(`❌ Ошибка разделения стемов оригинала: ${err.message}`, 'error');
      toast.error(`Ошибка разделения оригинала: ${err.message}`);
    } finally {
      setActiveProcess(null);
    }
  }, [currentEpisode, selectedStemModel, updateProcess, addLog, setOriginalStems, setActiveProcess]);

  const handleImportOriginalStem = useCallback(async (stemType: 'vocals' | 'instrumental', customPath?: string) => {
    if (!currentEpisode?.rawPath) {
      toast.error('Нет выбранной серии для импорта стема.');
      return;
    }
    try {
      addLog(`📥 Импорт дорожки ${stemType === 'vocals' ? 'Голоса оригинала' : 'Фон M&E'}...`, 'info');
      const res: any = await ipcSafe.invoke('timing-import-original-stem', {
        episode: currentEpisode,
        stemType,
        customPath
      });
      if (res && res.success) {
        setOriginalStems(prev => {
          const next = { ...prev, hasStems: true };
          if (stemType === 'vocals') {
            next.vocalsPath = res.filePath;
            if (Array.isArray(res.peaks)) next.vocalsPeaks = res.peaks;
          } else {
            next.instrumentalPath = res.filePath;
            if (Array.isArray(res.peaks)) next.instrumentalPeaks = res.peaks;
          }
          return next;
        });
        toast.success(`Дорожка ${stemType === 'vocals' ? 'Голоса оригинала' : 'Фон M&E'} успешно импортирована!`);
        addLog(`✅ Дорожка ${stemType === 'vocals' ? 'Голоса оригинала' : 'Фон M&E'} подключена к таймингу`, 'success');
      } else if (!res?.canceled) {
        toast.error(res?.error || 'Не удалось импортировать файл стема');
      }
    } catch (err: any) {
      console.error('[StemImport] Error:', err);
      toast.error(`Ошибка импорта стема: ${err.message}`);
    }
  }, [currentEpisode, addLog, setOriginalStems]);

  const handleExportStemsToFolder = useCallback(async (format: 'wav' | 'flac' = 'wav') => {
    if (!currentEpisode?.rawPath) return;
    try {
      const res: any = await ipcSafe.invoke('timing-export-stems-to-folder', {
        episode: currentEpisode,
        format
      });
      if (res && res.success) {
        toast.success(`Стемы сохранены в папку: ${res.targetDir}`);
        addLog(`📁 Стемы оригинала успешно экспортированы в ${res.targetDir}`, 'success');
      } else if (!res?.canceled) {
        toast.error(res?.error || 'Ошибка экспорта стемов');
      }
    } catch (err: any) {
      toast.error(`Ошибка экспорта стемов: ${err.message}`);
    }
  }, [currentEpisode, addLog]);

  // Real-Time Clip Audio & Video Playback Loop
  useEffect(() => {
    if (!isPlaying) {
      if (playbackRef.current) cancelAnimationFrame(playbackRef.current);
      stopAllScheduledClips();
      if (videoRef.current && !videoRef.current.paused) {
        try { videoRef.current.pause(); } catch (e) {}
      }
      Object.values(audioElementsRef.current).forEach(audio => {
        try { audio.pause(); } catch (e) {}
      });
      return;
    }

    syncRealtimeRef.current(currentTimeRef.current, true);

    let lastTimestamp = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastTimestamp) / 1000;
      lastTimestamp = now;

      const next = currentTimeRef.current + dt;
      if (next >= duration) {
        currentTimeRef.current = 0;
        setCurrentTime(0);
        setIsPlaying(false);
        stopAllScheduledClips();
        if (videoRef.current) {
          try { videoRef.current.pause(); videoRef.current.currentTime = 0; } catch (e) {}
        }
        addLog(`⏹ Достигнут конец таймлайна (${formatSeconds(duration)})`, 'info');
        return;
      }

      currentTimeRef.current = next;
      setCurrentTime(next);
      syncRealtimeRef.current(next, false);

      playbackRef.current = requestAnimationFrame(tick);
    };

    playbackRef.current = requestAnimationFrame(tick);

    return () => {
      if (playbackRef.current) cancelAnimationFrame(playbackRef.current);
      stopAllScheduledClips();
      if (videoRef.current && !videoRef.current.paused) {
        try { videoRef.current.pause(); } catch (e) {}
      }
      Object.values(audioElementsRef.current).forEach(audio => {
        try { audio.pause(); } catch (e) {}
      });
    };
  }, [isPlaying, duration, addLog, stopAllScheduledClips, playbackRef, videoRef, audioElementsRef, currentTimeRef, setCurrentTime, setIsPlaying]);

  return {
    stopAllScheduledClips,
    computeEffectiveClipGain,
    syncRealtimeClipPlayback,
    seekToTime,
    jumpToTime,
    handleSeparateOriginalStems,
    handleImportOriginalStem,
    handleExportStemsToFolder
  };
}
