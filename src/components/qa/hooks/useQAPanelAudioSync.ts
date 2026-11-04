import { useEffect, useRef, useState, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { SubtitleLine, Track } from '../../../types';
import { getSharedAudioContext, ensureAudioContextResumed } from '../../../lib/qa/sharedAudioContext';
import { analyzeAudioForPreview, NormalizationMetrics, getCachedNormalization } from '../../../lib/qa/audioNormalizer';
import { useVideoContext } from '../../../contexts/VideoContext';

export interface UseQAPanelAudioSyncParams {
  tracks: Track[];
  selectedTrackId: string | null;
  subLines: SubtitleLine[];
  currentTime: number;
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>;
  duration: number;
  setDuration: React.Dispatch<React.SetStateAction<number>>;
  isPlaying: boolean;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  volumes: Record<string, number>;
  isAutoNormalize: boolean;
  normalizationMetrics: Record<string, NormalizationMetrics>;
  setNormalizationMetrics: React.Dispatch<React.SetStateAction<Record<string, NormalizationMetrics>>>;
  isMuted: boolean;
  currentEpisodeId?: string;
  currentSubtitleText?: string | null;
  currentSubId?: string | null;
  onAddQuickFixComment?: (textOverride?: string) => Promise<void>;
}

export function useQAPanelAudioSync({
  tracks,
  selectedTrackId,
  subLines,
  currentTime,
  setCurrentTime,
  duration,
  setDuration,
  isPlaying,
  setIsPlaying,
  volumes,
  isAutoNormalize,
  normalizationMetrics,
  setNormalizationMetrics,
  isMuted,
  currentEpisodeId,
  currentSubtitleText,
  currentSubId,
  onAddQuickFixComment
}: UseQAPanelAudioSyncParams) {
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<any>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});
  const audioGainNodesRef = useRef<Record<string, { gain: GainNode }>>({});
  const [audioRefsUpdated, setAudioRefsUpdated] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isAnalyzingSilence, setIsAnalyzingSilence] = useState(false);
  const [silenceThreshold] = useState(0.01);

  const { registerPlayer, unregisterPlayer } = useVideoContext();

  // Synchronize all secondary audio sources (HTMLAudioElement tracks & WaveSurfer) to video master time
  const syncAudioSources = useCallback((targetTime: number, shouldPlay: boolean) => {
    if (shouldPlay) {
      ensureAudioContextResumed();
    }

    Object.values(audioRefs.current).forEach(audio => {
      if (audio instanceof HTMLAudioElement) {
        if (Math.abs(audio.currentTime - targetTime) > 0.05) {
          audio.currentTime = targetTime;
        }
        audio.playbackRate = 1.0;
        if (shouldPlay) {
          audio.play().catch(e => {
            if (e?.name !== 'AbortError') console.error('Audio track play error:', e);
          });
        } else {
          audio.pause();
        }
      }
    });

    if (wavesurferRef.current) {
      try {
        if (Math.abs(wavesurferRef.current.getCurrentTime() - targetTime) > 0.05) {
          wavesurferRef.current.setTime(targetTime);
        }
        if (shouldPlay) {
          wavesurferRef.current.play().catch(e => {
            if (e?.name !== 'AbortError') console.error('WaveSurfer play error:', e);
          });
        } else {
          wavesurferRef.current.pause();
        }
      } catch (err) {
        // Ignored during teardown
      }
    }
  }, []);

  useEffect(() => {
    const time = videoRef.current?.currentTime ?? currentTime;
    syncAudioSources(time, isPlaying);
  }, [isPlaying, audioRefsUpdated, syncAudioSources, currentTime]);

  const handleVideoPlay = useCallback(() => {
    setIsPlaying(true);
    const time = videoRef.current?.currentTime ?? currentTime;
    setCurrentTime(time);
    syncAudioSources(time, true);
  }, [currentTime, syncAudioSources, setCurrentTime, setIsPlaying]);

  const handleVideoPause = useCallback(() => {
    setIsPlaying(false);
    const time = videoRef.current?.currentTime ?? currentTime;
    setCurrentTime(time);
    syncAudioSources(time, false);
  }, [currentTime, syncAudioSources, setCurrentTime, setIsPlaying]);

  const handleVideoTimeUpdate = useCallback((e?: React.SyntheticEvent<HTMLVideoElement>) => {
    const time = e ? e.currentTarget.currentTime : (videoRef.current?.currentTime ?? currentTime);
    setCurrentTime(time);

    if (e ? !e.currentTarget.paused : !videoRef.current?.paused) {
      ensureAudioContextResumed();
      Object.values(audioRefs.current).forEach(audio => {
        if (audio instanceof HTMLAudioElement && !audio.paused) {
          const diff = time - audio.currentTime;
          if (Math.abs(diff) > 0.4) {
            audio.currentTime = time;
            audio.playbackRate = 1.0;
          } else if (Math.abs(diff) > 0.05) {
            audio.playbackRate = Math.max(0.92, Math.min(1.08, 1.0 + diff * 0.4));
          } else {
            audio.playbackRate = 1.0;
          }
        }
      });

      if (wavesurferRef.current && wavesurferRef.current.isPlaying()) {
        const wsTime = wavesurferRef.current.getCurrentTime();
        if (Math.abs(wsTime - time) > 0.4) {
          wavesurferRef.current.setTime(time);
        }
      }
    }
  }, [currentTime, setCurrentTime]);

  const handleVideoSeeking = useCallback(() => {
    const time = videoRef.current?.currentTime ?? currentTime;
    setCurrentTime(time);
    const isPaused = videoRef.current ? videoRef.current.paused : !isPlaying;
    syncAudioSources(time, !isPaused);
  }, [currentTime, isPlaying, syncAudioSources, setCurrentTime]);

  const handleVideoEnded = useCallback(() => {
    setIsPlaying(false);
    const time = videoRef.current?.duration ?? currentTime;
    setCurrentTime(time);
    syncAudioSources(time, false);
  }, [currentTime, syncAudioSources, setCurrentTime, setIsPlaying]);

  const handleSeekToTime = useCallback((targetTime: number) => {
    setCurrentTime(targetTime);
    if (videoRef.current) {
      videoRef.current.currentTime = targetTime;
    }
    const shouldPlay = videoRef.current ? !videoRef.current.paused : isPlaying;
    syncAudioSources(targetTime, shouldPlay);
  }, [isPlaying, syncAudioSources, setCurrentTime]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      if (video.paused) {
        video.play().catch(e => {
          if (e?.name !== 'AbortError') console.error('Video play error:', e);
        });
      } else {
        video.pause();
      }
    } else {
      setIsPlaying(prev => {
        const next = !prev;
        syncAudioSources(currentTime, next);
        return next;
      });
    }
  }, [currentTime, syncAudioSources, setIsPlaying]);

  const seekToNext = useCallback(() => {
    if (subLines.length === 0) return;

    const nextSub = subLines.find(l => {
      return (l.startSec ?? 0) > currentTime + 0.1;
    });

    if (nextSub) {
      const nextTime = nextSub.startSec ?? 0;
      if (wavesurferRef.current) {
        wavesurferRef.current.setTime(nextTime);
      }
      if (videoRef.current) {
        videoRef.current.currentTime = nextTime;
      }
      setCurrentTime(nextTime);
    }
  }, [subLines, currentTime, setCurrentTime]);

  const seekToPrev = useCallback(() => {
    if (subLines.length === 0) return;

    let prevSub: SubtitleLine | null = null;
    for (let i = subLines.length - 1; i >= 0; i--) {
      if ((subLines[i].startSec ?? 0) < currentTime - 0.25) {
        prevSub = subLines[i];
        break;
      }
    }

    if (!prevSub && subLines.length > 0 && currentTime > (subLines[0].startSec ?? 0) + 0.1) {
      prevSub = subLines[0];
    }

    if (prevSub) {
      const prevTime = Math.max(0, prevSub.startSec ?? 0);
      if (wavesurferRef.current) {
        wavesurferRef.current.setTime(prevTime);
      }
      if (videoRef.current) {
        videoRef.current.currentTime = prevTime;
      }
      setCurrentTime(prevTime);
    }
  }, [subLines, currentTime, setCurrentTime]);

  const handlePause = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.pause();
    } else {
      setIsPlaying(false);
      syncAudioSources(currentTime, false);
    }
  }, [currentTime, syncAudioSources, setIsPlaying]);

  const handleStop = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
    syncAudioSources(0, false);
  }, [syncAudioSources, setCurrentTime, setIsPlaying]);

  // Video context registration for global shortcuts
  useEffect(() => {
    registerPlayer({ togglePlayPause: togglePlay, seekToNext, seekToPrev });
    return () => unregisterPlayer();
  }, [registerPlayer, unregisterPlayer, togglePlay, seekToNext, seekToPrev]);

  // Hotkeys for instant edit and transport
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'KeyF') {
        e.preventDefault();
        const text = currentSubtitleText ? `Правка: ${currentSubtitleText}` : 'Правка';
        onAddQuickFixComment?.(text);
      }

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }

      if ((e.code === 'ArrowRight' && (e.altKey || e.ctrlKey || e.shiftKey)) || ((e.code === 'KeyD' || e.code === 'KeyN') && (e.altKey || e.shiftKey))) {
        e.preventDefault();
        seekToNext();
      }

      if ((e.code === 'ArrowLeft' && (e.altKey || e.ctrlKey || e.shiftKey)) || ((e.code === 'KeyA' || e.code === 'KeyP') && (e.altKey || e.shiftKey))) {
        e.preventDefault();
        seekToPrev();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentTime, currentSubtitleText, currentSubId, togglePlay, onAddQuickFixComment, seekToNext, seekToPrev]);

  // Sync wavesurfer with video when scrubbing while paused
  useEffect(() => {
    if (!wavesurferRef.current || isPlaying) return;

    const wsTime = wavesurferRef.current.getCurrentTime();
    if (Math.abs(wsTime - currentTime) > 0.05) {
      wavesurferRef.current.setTime(currentTime);
    }
  }, [currentTime, isPlaying]);

  // Run normalization analysis for all track audio files for preview
  useEffect(() => {
    if (!currentEpisodeId || tracks.length === 0) return;
    let isCancelled = false;

    tracks.forEach(track => {
      if (track.id === 'original') return;
      const selectedFile = track.files.find(f => f.id === track.selectedFileId) || track.files[0];
      if (!selectedFile || !selectedFile.path) return;

      let audioUrl = selectedFile.path;
      if (!window.electronAPI) {
        const cleanName = selectedFile.path.replace(/\\/g, '/').split('/').pop() || selectedFile.path;
        const cached = (window as any).getFileFromCache?.(cleanName);
        if (cached) {
          audioUrl = URL.createObjectURL(cached);
        }
      } else {
        audioUrl = selectedFile.path.startsWith('file://') || selectedFile.path.startsWith('http') ? selectedFile.path : `file://${selectedFile.path}`;
      }

      const isPlayable = audioUrl && (
        audioUrl.startsWith('blob:') ||
        audioUrl.startsWith('http://') ||
        audioUrl.startsWith('https://') ||
        audioUrl.startsWith('data:') ||
        audioUrl.startsWith('/api/') ||
        (window.electronAPI && audioUrl.startsWith('file://'))
      );
      if (!isPlayable) return;

      const cacheKey = `${track.id}_${selectedFile.id || selectedFile.path}`;
      const existing = getCachedNormalization(cacheKey);
      if (existing && existing.status === 'ready') {
        setNormalizationMetrics(prev => ({ ...prev, [track.id]: existing }));
        return;
      }

      setNormalizationMetrics(prev => ({
        ...prev,
        [track.id]: {
          gain: 1.0,
          gainDb: 0,
          peak: 1.0,
          peakDb: 0,
          rms: 0.125,
          rmsDb: -18,
          status: 'analyzing'
        }
      }));

      analyzeAudioForPreview(audioUrl, cacheKey, selectedFile?.path).then(metrics => {
        if (!isCancelled) {
          setNormalizationMetrics(prev => ({ ...prev, [track.id]: metrics }));
        }
      }).catch(err => {
        if (!isCancelled) {
          console.warn('Normalization analysis error:', err);
        }
      });
    });

    return () => {
      isCancelled = true;
    };
  }, [tracks, currentEpisodeId, setNormalizationMetrics]);

  // Update audio volumes with auto-normalization gain
  useEffect(() => {
    Object.entries(audioRefs.current).forEach(([id, audio]) => {
      if (audio instanceof HTMLAudioElement) {
        const userVol = volumes[id] ?? 0.8;
        const normGain = (isAutoNormalize && normalizationMetrics[id]?.status === 'ready')
          ? normalizationMetrics[id].gain
          : 1.0;

        const gainNodeData = audioGainNodesRef.current[id];
        if (gainNodeData) {
          audio.volume = 1.0;
          gainNodeData.gain.gain.value = isMuted ? 0 : Math.max(0, userVol * normGain);
        } else {
          const volume = isMuted ? 0 : Math.min(1.0, Math.max(0, userVol * normGain));
          audio.volume = volume;
        }
      }
    });

    if (wavesurferRef.current && selectedTrackId) {
      const userVol = volumes[selectedTrackId] ?? 0.8;
      const normGain = (isAutoNormalize && normalizationMetrics[selectedTrackId]?.status === 'ready')
        ? normalizationMetrics[selectedTrackId].gain
        : 1.0;
      const volume = isMuted ? 0 : Math.min(1.0, Math.max(0, userVol * normGain));
      try {
        wavesurferRef.current.setVolume(volume);
      } catch (e) {
        console.warn('WaveSurfer setVolume warning:', e);
      }
    }
  }, [volumes, isMuted, selectedTrackId, isAutoNormalize, normalizationMetrics, audioRefsUpdated]);

  // Clean up audio elements on unmount or track change
  useEffect(() => {
    return () => {
      Object.keys(audioRefs.current).forEach(id => {
        const audio = audioRefs.current[id];
        if (audio instanceof HTMLAudioElement) {
          audio.pause();
          audio.src = '';
        }
        const gainData = audioGainNodesRef.current[id];
        if (gainData) {
          try {
            gainData.gain.disconnect();
          } catch (e) {}
        }
      });
      audioRefs.current = {};
      audioGainNodesRef.current = {};
      setAudioRefsUpdated(prev => prev + 1);
    };
  }, [currentEpisodeId]);

  // Initialize audio elements for all tracks
  useEffect(() => {
    if (!currentEpisodeId) return;

    let updated = false;
    tracks.forEach(track => {
      if (selectedTrackId !== 'all' || track.id === selectedTrackId || track.id === 'original') {
        if (audioRefs.current[track.id]) {
          audioRefs.current[track.id].pause();
          delete audioRefs.current[track.id];
          updated = true;
        }
        return;
      }

      const selectedFile = track.files.find(f => f.id === track.selectedFileId) || track.files[0];
      if (selectedFile && selectedFile.path && !audioRefs.current[track.id]) {
        let audioUrl = selectedFile.path;
        if (!window.electronAPI) {
          const cleanName = selectedFile.path.replace(/\\/g, '/').split('/').pop() || selectedFile.path;
          const cached = (window as any).getFileFromCache?.(cleanName);
          if (cached) {
            audioUrl = URL.createObjectURL(cached);
          }
        } else {
          audioUrl = selectedFile.path.startsWith('file://') || selectedFile.path.startsWith('http') ? selectedFile.path : `file://${selectedFile.path}`;
        }

        const isPlayable = audioUrl && (
          audioUrl.startsWith('blob:') ||
          audioUrl.startsWith('http://') ||
          audioUrl.startsWith('https://') ||
          audioUrl.startsWith('data:') ||
          audioUrl.startsWith('/api/') ||
          (window.electronAPI && audioUrl.startsWith('file://'))
        );
        if (!isPlayable) return;

        const audio = new Audio(audioUrl);
        audio.volume = Math.min(1.0, Math.max(0, volumes[track.id] ?? 0.8));
        audioRefs.current[track.id] = audio;

        try {
          const ctx = getSharedAudioContext();
          if (ctx) {
            const source = ctx.createMediaElementSource(audio);
            const gain = ctx.createGain();
            source.connect(gain);
            gain.connect(ctx.destination);
            audioGainNodesRef.current[track.id] = { gain };
          }
        } catch (e) {
          console.warn('Web Audio gain init notice for track', track.id, e);
        }

        updated = true;
      } else if (selectedFile && selectedFile.path && audioRefs.current[track.id]) {
        let audioUrl = selectedFile.path;
        if (!window.electronAPI) {
          const cleanName = selectedFile.path.replace(/\\/g, '/').split('/').pop() || selectedFile.path;
          const cached = (window as any).getFileFromCache?.(cleanName);
          if (cached) {
            audioUrl = URL.createObjectURL(cached);
          }
        } else {
          audioUrl = selectedFile.path.startsWith('file://') || selectedFile.path.startsWith('http') ? selectedFile.path : `file://${selectedFile.path}`;
        }

        const isPlayable = audioUrl && (
          audioUrl.startsWith('blob:') ||
          audioUrl.startsWith('http://') ||
          audioUrl.startsWith('https://') ||
          audioUrl.startsWith('data:') ||
          audioUrl.startsWith('/api/') ||
          (window.electronAPI && audioUrl.startsWith('file://'))
        );
        if (!isPlayable) return;

        if (audioRefs.current[track.id].src !== audioUrl) {
          audioRefs.current[track.id].src = audioUrl;
          updated = true;
        }
      }
    });
    if (updated) setAudioRefsUpdated(prev => prev + 1);
  }, [tracks, currentEpisodeId, selectedTrackId, volumes]);

  const detectSilence = async () => {
    if (!wavesurferRef.current || !regionsRef.current) return;

    setIsAnalyzingSilence(true);
    regionsRef.current.clearRegions();

    try {
      const buffer = wavesurferRef.current.getDecodedData();
      if (!buffer) return;

      const channelData = buffer.getChannelData(0);
      const sampleRate = buffer.sampleRate;
      const silenceRegions: { start: number; end: number }[] = [];

      let isSilence = false;
      let silenceStart = 0;

      const chunkSize = Math.floor(sampleRate * 0.1);
      for (let i = 0; i < channelData.length; i += chunkSize) {
        let maxAmp = 0;
        for (let j = 0; j < chunkSize && i + j < channelData.length; j++) {
          maxAmp = Math.max(maxAmp, Math.abs(channelData[i + j]));
        }

        const time = i / sampleRate;

        if (maxAmp < silenceThreshold) {
          if (!isSilence) {
            isSilence = true;
            silenceStart = time;
          }
        } else {
          if (isSilence) {
            isSilence = false;
            if (time - silenceStart > 0.5) {
              silenceRegions.push({ start: silenceStart, end: time });
            }
          }
        }
      }

      silenceRegions.forEach(region => {
        regionsRef.current.addRegion({
          start: region.start,
          end: region.end,
          color: 'rgba(255, 0, 0, 0.2)',
          drag: false,
          resize: false,
          content: 'Silence'
        });
      });
    } catch (e) {
      console.error('Silence detection error', e);
    } finally {
      setIsAnalyzingSilence(false);
    }
  };

  return {
    wavesurferRef,
    regionsRef,
    videoRef,
    audioRefs,
    audioGainNodesRef,
    audioRefsUpdated,
    isAnalyzingSilence,
    syncAudioSources,
    handleVideoPlay,
    handleVideoPause,
    handleVideoTimeUpdate,
    handleVideoSeeking,
    handleVideoEnded,
    handleSeekToTime,
    togglePlay,
    handlePause,
    handleStop,
    seekToNext,
    seekToPrev,
    detectSilence
  };
}
