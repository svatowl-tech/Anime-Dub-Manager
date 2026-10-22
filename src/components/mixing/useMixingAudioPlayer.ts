import React, { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { Episode, MixingManifest, MixingFileItem, PipelineStep, MixingModuleDef } from "../../types";
import { ipcSafe } from "../../lib/ipcSafe";
import { resolveLocalPath } from "../../lib/webFileSystem";

interface UseMixingAudioPlayerParams {
  currentEpisode?: Episode | null;
  workingDir: string;
  customTargetDir: string;
  manifest: MixingManifest | null;
  setManifest: React.Dispatch<React.SetStateAction<MixingManifest | null>>;
  moduleDatabase: MixingModuleDef[];
  mixLog: (level: "info" | "warn" | "error" | "debug" | "success", tag: string, message: string, meta?: any, stepId?: string) => void;
}

export function useMixingAudioPlayer({
  currentEpisode,
  workingDir,
  customTargetDir,
  manifest,
  setManifest,
  moduleDatabase,
  mixLog
}: UseMixingAudioPlayerParams) {
  // Player state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackAudioRef = useRef<HTMLAudioElement | null>(null);
  const mixAudioElementsRef = useRef<HTMLAudioElement[]>([]);
  const currentTimeRef = useRef<number>(0);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoViewMode, setVideoViewMode] = useState<'source' | 'final'>('source');
  const [videoPlaybackError, setVideoPlaybackError] = useState<string | null>(null);
  const [audioPlaybackError, setAudioPlaybackError] = useState<string | null>(null);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<{
    id: string;
    name: string;
    path: string;
    label: string;
    stepId?: string;
    isModuleMix?: boolean;
    isFinalVideo?: boolean;
    mixFiles?: MixingFileItem[];
  } | null>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  // Volume controls for player (Pure layering, zero real-time DSP)
  const [playWithVideo, setPlayWithVideo] = useState<boolean>(true);
  const [videoVolume, setVideoVolume] = useState<number>(0.35);
  const [isVideoMuted, setIsVideoMuted] = useState<boolean>(false);
  const [trackVolume, setTrackVolume] = useState<number>(0.95);
  const [isTrackMuted, setIsTrackMuted] = useState<boolean>(false);
  const [rolesVolumeMap, setRolesVolumeMap] = useState<Record<string, number>>({});

  const handleUpdateDubberVolume = useCallback(async (trackKey: string, newPct: number) => {
    setRolesVolumeMap(prev => {
      const updated = { ...prev, [trackKey]: newPct };
      if (currentEpisode) {
        ipcSafe.invoke('mixing-save-timing-metadata', {
          episode: currentEpisode,
          targetDir: workingDir || undefined,
          timingMetadata: {
            rolesVolumeMap: updated,
            updatedAt: new Date().toISOString()
          }
        }).catch(() => {});
      }
      return updated;
    });
  }, [currentEpisode, workingDir]);

  // Helper to stop and clear multi-track module mix audio
  const stopAndClearModuleMix = useCallback(() => {
    mixAudioElementsRef.current.forEach(audio => {
      try {
        audio.onloadedmetadata = null;
        audio.ontimeupdate = null;
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      } catch (e) {}
    });
    mixAudioElementsRef.current = [];
  }, []);

  // Release all audio elements to avoid Win32 / EACCES file lock errors when reprocessing
  const releasePlayerAudioLocks = useCallback(() => {
    try {
      setIsPlaying(false);
      if (videoRef.current) {
        videoRef.current.pause();
      }
      if (trackAudioRef.current) {
        trackAudioRef.current.pause();
        trackAudioRef.current.removeAttribute('src');
        try { trackAudioRef.current.load(); } catch (e) {}
      }
      stopAndClearModuleMix();
    } catch (e) {}
  }, [stopAndClearModuleMix]);

  // Sanitize any leftover temporary .tmp_ prefix from paths
  const sanitizeTempPath = useCallback((rawPath: string) => {
    if (!rawPath) return '';
    return rawPath.replace(/\.tmp_[0-9]+_[a-z0-9]+_/i, '');
  }, []);

  // Format media file URL (video or audio) for HTML5 elements safely across Windows/macOS/Linux
  const formatMediaUrl = useCallback((filePath: string) => {
    if (!filePath) return '';
    if (
      filePath.startsWith('http://') ||
      filePath.startsWith('https://') ||
      filePath.startsWith('blob:') ||
      filePath.startsWith('/api/media-file')
    ) {
      return filePath;
    }
    if (filePath.startsWith('custom-media://local/media?path=')) {
      return filePath;
    }
    const cleanP = sanitizeTempPath(
      filePath
        .replace(/^file:\/\//, '')
        .replace(/^custom-media:\/\//, '')
    );
    if (window.electronAPI) {
      // Use query-parameter encoding on valid host 'local' so Windows drive letters (I:\), Cyrillic, brackets [СВЕДЕНО], and spaces never break URL parsing
      return `custom-media://local/media?path=${encodeURIComponent(cleanP)}`;
    }
    return cleanP;
  }, [sanitizeTempPath]);

  const resolveMediaUrlAsync = useCallback(async (filePath: string): Promise<string> => {
    if (!filePath) return '';
    const cleaned = sanitizeTempPath(filePath);
    if (window.electronAPI) {
      return formatMediaUrl(cleaned);
    }
    const cleanName = cleaned.replace(/\\/g, '/').split('/').pop() || cleaned;
    const cachedFile = (window as any).getFileFromCache?.(cleanName);
    if (cachedFile) {
      return URL.createObjectURL(cachedFile);
    }
    try {
      const resolved = await resolveLocalPath(cleaned);
      if (resolved) return resolved;
    } catch (e) {}
    return formatMediaUrl(cleaned);
  }, [formatMediaUrl, sanitizeTempPath]);

  // Reset player state when episode changes
  useEffect(() => {
    releasePlayerAudioLocks();
    setSelectedAudioTrack(null);
    setVideoViewMode('source');
    setCurrentTime(0);
    setDuration(0);
  }, [currentEpisode?.id, releasePlayerAudioLocks]);

  // Automatically switch to 'final' view mode when finalVideo first appears and no custom track is selected
  const prevFinalVideoPathRef = useRef<string | null>(null);
  useEffect(() => {
    const finalPath = manifest?.finalVideo?.path ? sanitizeTempPath(manifest.finalVideo.path) : null;
    if (finalPath && finalPath !== prevFinalVideoPathRef.current) {
      prevFinalVideoPathRef.current = finalPath;
      if (!selectedAudioTrack || selectedAudioTrack.isFinalVideo) {
        setVideoViewMode('final');
        setIsVideoMuted(false);
        setVideoVolume(prev => (prev < 0.3 ? 0.85 : prev));
        setSelectedAudioTrack({
          id: 'final_mixed_video',
          name: manifest?.finalVideo?.name || finalPath.split(/[/\\]/).pop() || 'Сведенное видео',
          path: finalPath,
          label: 'Сведено [MP4]',
          isFinalVideo: true
        });
      }
    } else if (!finalPath) {
      prevFinalVideoPathRef.current = null;
      if (videoViewMode === 'final') {
        setVideoViewMode('source');
      }
    }
  }, [manifest?.finalVideo?.path, manifest?.finalVideo?.name, selectedAudioTrack, videoViewMode, sanitizeTempPath]);

  // Resolve video URL for HTML5 video element based on videoViewMode ('source' vs 'final')
  useEffect(() => {
    let active = true;
    setVideoPlaybackError(null);

    const resolveVideo = async () => {
      const sourcePath = manifest?.sourceFiles?.video?.path || currentEpisode?.rawPath;
      const rawFinalPath = manifest?.finalVideo?.path;
      const finalPath = rawFinalPath ? sanitizeTempPath(rawFinalPath) : null;

      let targetPath = sourcePath;

      if (videoViewMode === 'final' && finalPath) {
        let finalExists = true;
        if (window.electronAPI) {
          try {
            finalExists = await ipcSafe.invoke('file-exists', finalPath);
          } catch (e) {
            finalExists = true;
          }
        }
        if (finalExists) {
          targetPath = finalPath;
        } else if (sourcePath) {
          targetPath = sourcePath;
        }
      }

      if (!targetPath) {
        if (active) setVideoSrc(null);
        return;
      }

      const resolved = await resolveMediaUrlAsync(targetPath);
      if (active) {
        setVideoSrc(prev => {
          if (prev !== resolved) {
            const fileName = targetPath.split(/[/\\]/).pop() || targetPath;
            mixLog('debug', 'Видео', `Видеопоток подключен (${videoViewMode === 'final' ? 'Сведенный' : 'Исходник'}): ${fileName}`);
          }
          return resolved;
        });
      }
    };

    resolveVideo();
    return () => { active = false; };
  }, [videoViewMode, manifest?.finalVideo?.path, manifest?.sourceFiles?.video?.path, currentEpisode?.rawPath, mixLog, resolveMediaUrlAsync, sanitizeTempPath]);

  // Restore currentTime when videoSrc changes
  const handleVideoLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const vid = e.currentTarget;
    if (vid.duration && !isNaN(vid.duration) && isFinite(vid.duration)) {
      setDuration(vid.duration);
    }
    if (currentTimeRef.current > 0 && Math.abs(vid.currentTime - currentTimeRef.current) > 0.5) {
      try {
        vid.currentTime = Math.min(currentTimeRef.current, vid.duration || currentTimeRef.current);
      } catch (_) {}
    }
    vid.muted = isVideoMuted;
    vid.volume = isVideoMuted ? 0 : Math.min(1, Math.max(0, videoVolume));
    if (isPlaying && vid.paused) {
      vid.play().catch(() => {});
    }
  };

  const handleVideoError = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    const videoEl = e.currentTarget;
    const err = videoEl.error;
    console.warn('[MixingPanel] Video element playback error:', err, 'src:', videoSrc);

    // Fallback: If current mode was 'final' video and it failed, fall back to 'source' video
    const sourcePath = manifest?.sourceFiles?.video?.path || currentEpisode?.rawPath;
    if (videoViewMode === 'final' && sourcePath) {
      mixLog('warn', 'Видео', `Сбой открытия сведенного видео. Автопереключение на исходный видеоряд: ${sourcePath}`);
      setVideoViewMode('source');
      setVideoPlaybackError(null);
      return;
    }

    let errMsg = 'Формат или кодек видео недоступен для прямого воспроизведения в плеере';
    if (err) {
      if (err.code === 1) errMsg = 'Воспроизведение видео прервано пользователем';
      if (err.code === 2) errMsg = 'Сбой сети при получении видеопотока';
      if (err.code === 3) errMsg = 'Ошибка декодирования (несовместимый видеокодек HEVC или контейнер MKV)';
      if (err.code === 4) errMsg = 'Контейнер/кодек видео не поддерживается HTML5-плеером (напр. MKV / AC3 / 10-bit H.264). Прослушивание аудиодорожек продолжает работать штатно!';
    }
    setVideoPlaybackError(errMsg);
    mixLog('warn', 'Видео', `Несовместимость видеоконтейнера: ${errMsg}`);
  };

  // Connect video volume and mute state
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isVideoMuted;
      videoRef.current.volume = isVideoMuted ? 0 : Math.min(1, Math.max(0, videoVolume));
    }
  }, [videoVolume, isVideoMuted, videoSrc]);

  // Connect track & module mix volume and mute state (including per-dubber rolesVolumeMap)
  useEffect(() => {
    const baseVol = isTrackMuted ? 0 : Math.min(1, Math.max(0, trackVolume));
    if (trackAudioRef.current) {
      trackAudioRef.current.muted = isTrackMuted;
      trackAudioRef.current.volume = Math.min(1, baseVol);
    }
    mixAudioElementsRef.current.forEach(a => {
      const roleFactor = Number((a as any)._roleVolumeFactor ?? 1);
      a.muted = isTrackMuted;
      a.volume = Math.min(1, Math.max(0, baseVol * roleFactor));
    });
  }, [trackVolume, isTrackMuted, rolesVolumeMap]);

  // Helper: Load a URL into trackAudioRef, seek to targetTime when ready, and optionally start playing
  const loadSingleTrackAudio = useCallback((resolvedSrc: string, targetTime: number, autoPlay: boolean) => {
    const audioEl = trackAudioRef.current;
    if (!audioEl) return;

    setAudioPlaybackError(null);
    audioEl.pause();
    audioEl.src = resolvedSrc;
    audioEl.muted = isTrackMuted;
    audioEl.volume = isTrackMuted ? 0 : Math.min(1, Math.max(0, trackVolume));

    const onLoaded = () => {
      audioEl.removeEventListener('loadedmetadata', onLoaded);
      audioEl.removeEventListener('error', onError);
      if (audioEl.duration && !isNaN(audioEl.duration) && isFinite(audioEl.duration)) {
        setDuration(prev => (prev > 0 ? prev : audioEl.duration));
      }
      if (targetTime > 0) {
        try {
          audioEl.currentTime = Math.min(targetTime, audioEl.duration || targetTime);
        } catch (_) {}
      }
      if (autoPlay) {
        audioEl.play().catch(err => {
          console.warn('[MixingPanel] Audio play warning:', err);
        });
        if (videoRef.current && !videoPlaybackError) {
          try {
            if (Math.abs(videoRef.current.currentTime - targetTime) > 0.3) {
              videoRef.current.currentTime = targetTime;
            }
            videoRef.current.play().catch(() => {});
          } catch (_) {}
        }
        setIsPlaying(true);
      }
    };

    const onError = () => {
      audioEl.removeEventListener('loadedmetadata', onLoaded);
      audioEl.removeEventListener('error', onError);
      const errCode = audioEl.error?.code;
      const msg = `Не удалось загрузить аудиофайл (код ${errCode || 'неизвестен'})`;
      console.warn('[MixingPanel] Track audio load error:', audioEl.error, 'src:', resolvedSrc);
      setAudioPlaybackError(msg);
      toast.error(msg);
    };

    audioEl.addEventListener('loadedmetadata', onLoaded);
    audioEl.addEventListener('error', onError);
    audioEl.load();
  }, [isTrackMuted, trackVolume, videoPlaybackError]);

  // Switch player to Final Mixed Video mode ([СВЕДЕНО].mp4)
  const selectFinalVideoForPlayback = useCallback(async (videoItem?: MixingFileItem, customLabel?: string, stepId?: string) => {
    const targetItem = videoItem || manifest?.finalVideo;
    if (!targetItem || !targetItem.path) {
      toast.error('Финальное сведенное видео ещё не создано');
      return;
    }

    stopAndClearModuleMix();
    if (trackAudioRef.current) {
      trackAudioRef.current.pause();
      trackAudioRef.current.removeAttribute('src');
      try { trackAudioRef.current.load(); } catch (_) {}
    }

    const cleanPath = sanitizeTempPath(targetItem.path);
    setAudioPlaybackError(null);
    setVideoPlaybackError(null);
    setVideoViewMode('final');
    setIsVideoMuted(false);
    if (videoVolume < 0.35) {
      setVideoVolume(0.9);
    }

    const resolvedUrl = await resolveMediaUrlAsync(cleanPath);
    setVideoSrc(resolvedUrl);

    setSelectedAudioTrack({
      id: targetItem.path,
      name: sanitizeTempPath(targetItem.name || cleanPath.split(/[/\\]/).pop() || 'Сведенное видео'),
      path: resolvedUrl,
      label: customLabel || 'Сведено [MP4]',
      stepId: stepId || 'video_mux',
      isFinalVideo: true
    });

    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.muted = false;
        videoRef.current.volume = Math.min(1, Math.max(0.35, videoVolume));
        if (currentTimeRef.current > 0) {
          try { videoRef.current.currentTime = currentTimeRef.current; } catch (_) {}
        }
        videoRef.current.play().then(() => {
          setIsPlaying(true);
        }).catch(() => {});
      }
    }, 80);

    toast.success(`Включен просмотр сведенного видео: ${sanitizeTempPath(targetItem.name)}`, { duration: 2500 });
  }, [manifest?.finalVideo, stopAndClearModuleMix, sanitizeTempPath, videoVolume, resolveMediaUrlAsync]);

  // Select original audio source for playback
  const selectOriginalAudioTrack = useCallback(async () => {
    let origPath = manifest?.sourceFiles?.originalAudio?.path;
    if (!origPath) {
      try {
        const res: any = await ipcSafe.invoke('mixing-refresh-sources', {
          episode: currentEpisode,
          targetDir: workingDir || customTargetDir || undefined
        });
        if (res && res.manifest?.sourceFiles?.originalAudio?.path) {
          setManifest(res.manifest);
          origPath = res.manifest.sourceFiles.originalAudio.path;
        }
      } catch (e) {}
    }

    stopAndClearModuleMix();
    setVideoViewMode('source');

    if (!origPath) {
      // Fallback: unmute source video audio element directly so user can hear original sound
      if (trackAudioRef.current) {
        trackAudioRef.current.pause();
        trackAudioRef.current.removeAttribute('src');
      }
      setIsVideoMuted(false);
      if (videoVolume < 0.3) setVideoVolume(0.85);
      setSelectedAudioTrack({
        id: 'original_audio_source',
        name: 'Оригинальный звук из видеофайла серии',
        path: '',
        label: 'Оригинал (Видео)',
      });
      if (videoRef.current && !videoPlaybackError) {
        videoRef.current.muted = false;
        videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
      }
      toast.info('Звук оригинала воспроизводится напрямую из исходного видеофайла 🎬');
      return;
    }

    // Mute video element's own audio so it doesn't double-play with 00_original_audio.wav
    setIsVideoMuted(true);
    const resolvedSrc = await resolveMediaUrlAsync(origPath);

    setSelectedAudioTrack({
      id: 'original_audio_source',
      name: 'Оригинальный звук серии (00_original_audio.wav)',
      path: resolvedSrc,
      label: 'Оригинал',
    });

    loadSingleTrackAudio(resolvedSrc, currentTimeRef.current, true);
    toast.info('Включена оригинальная звуковая дорожка серии', { duration: 2500 });
  }, [manifest?.sourceFiles?.originalAudio?.path, currentEpisode, workingDir, customTargetDir, stopAndClearModuleMix, videoVolume, videoPlaybackError, resolveMediaUrlAsync, loadSingleTrackAudio]);

  // Select an individual audio or video file for inspection in the player
  const selectTrackForInspection = useCallback(async (item: MixingFileItem, label: string, stepId?: string) => {
    if (!item || !item.path) return;

    const cleanName = sanitizeTempPath(item.name || '');
    const cleanPath = sanitizeTempPath(item.path);

    // If the user clicked a video file (e.g. output of 14_video_mux), switch to Final Video playback mode!
    if (/\.(mp4|mkv|mov|avi|webm)$/i.test(cleanName || cleanPath)) {
      await selectFinalVideoForPlayback({ ...item, name: cleanName, path: cleanPath }, label, stepId);
      return;
    }

    // If user clicked the already-selected single track, toggle play/pause for convenience
    if (selectedAudioTrack && !selectedAudioTrack.isModuleMix && !selectedAudioTrack.isFinalVideo && selectedAudioTrack.id === item.path) {
      if (isPlaying) {
        if (videoRef.current) videoRef.current.pause();
        if (trackAudioRef.current) trackAudioRef.current.pause();
        setIsPlaying(false);
      } else {
        if (videoRef.current && !videoPlaybackError) {
          videoRef.current.play().catch(() => {});
        }
        if (trackAudioRef.current) {
          trackAudioRef.current.play().catch(() => {});
        }
        setIsPlaying(true);
      }
      return;
    }

    stopAndClearModuleMix();

    // Switch video display to raw source video so we don't play voices over the already-mixed final video
    if (videoViewMode === 'final') {
      setVideoViewMode('source');
    }

    // If inspecting master_audio_mix or ducking output (which already contains background audio), mute raw video audio to prevent doubling
    const lowerName = cleanName.toLowerCase();
    if (lowerName.includes('master_audio_mix') || lowerName.includes('ducking') || lowerName.includes('original_audio')) {
      setIsVideoMuted(true);
    }

    const resolvedSrc = await resolveMediaUrlAsync(cleanPath);

    setSelectedAudioTrack({
      id: item.path,
      name: cleanName || item.name,
      path: resolvedSrc,
      label,
      stepId,
      isFinalVideo: false
    });

    loadSingleTrackAudio(resolvedSrc, currentTimeRef.current, true);
    toast.info(`Воспроизведение дорожки: ${cleanName || item.name}`, { duration: 2500 });
  }, [sanitizeTempPath, selectFinalVideoForPlayback, selectedAudioTrack, isPlaying, videoPlaybackError, stopAndClearModuleMix, videoViewMode, resolveMediaUrlAsync, loadSingleTrackAudio]);

  // Select module mix for multi-track playback
  const selectModuleMixForInspection = useCallback(async (step: PipelineStep) => {
    if (!step.outputFiles || step.outputFiles.length === 0) {
      toast.error('У этого модуля ещё нет сохраненных обработанных дорожек');
      return;
    }

    const meta = moduleDatabase.find(m => m.id === step.moduleId);

    // If this is the video_mux step or only outputs video files, play the final video!
    const videoOutputs = step.outputFiles.filter(f => /\.(mp4|mkv|mov|avi|webm)$/i.test(f.name || f.path));
    const audioOutputs = step.outputFiles.filter(f => !/\.(mp4|mkv|mov|avi|webm)$/i.test(f.name || f.path));

    if (audioOutputs.length === 0 && videoOutputs.length > 0) {
      await selectFinalVideoForPlayback(videoOutputs[0], `${meta?.title || step.moduleId}: ${videoOutputs[0].name}`, step.stepId);
      return;
    }

    if (audioOutputs.length === 1) {
      await selectTrackForInspection(audioOutputs[0], `${meta?.title || step.moduleId}: ${audioOutputs[0].name}`, step.stepId);
      return;
    }

    // Stop single track audio
    if (trackAudioRef.current) {
      trackAudioRef.current.pause();
      trackAudioRef.current.removeAttribute('src');
      try { trackAudioRef.current.load(); } catch (_) {}
    }

    // Clear previous mix elements
    stopAndClearModuleMix();
    setAudioPlaybackError(null);

    if (videoViewMode === 'final') {
      setVideoViewMode('source');
    }

    const targetTime = currentTimeRef.current;
    const baseVol = isTrackMuted ? 0 : Math.min(1, Math.max(0, trackVolume));
    const audioElements: HTMLAudioElement[] = [];

    for (let i = 0; i < audioOutputs.length; i++) {
      const file = audioOutputs[i];
      const cleanPath = sanitizeTempPath(file.path);
      const resolvedSrc = await resolveMediaUrlAsync(cleanPath);

      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = resolvedSrc;

      // Apply per-dubber role volume if configured
      let rolePct = 100;
      if (file.dubberNick && rolesVolumeMap[file.dubberNick] !== undefined) {
        rolePct = Number(rolesVolumeMap[file.dubberNick]) || 100;
      }
      const roleFactor = Math.max(0, Math.min(2, rolePct / 100));
      (audio as any)._roleVolumeFactor = roleFactor;
      audio.muted = isTrackMuted;
      audio.volume = Math.min(1, Math.max(0, baseVol * roleFactor));

      audio.onloadedmetadata = () => {
        if (i === 0 && audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
          setDuration(prev => (prev > 0 ? prev : audio.duration));
        }
        if (targetTime > 0) {
          try {
            audio.currentTime = Math.min(targetTime, audio.duration || targetTime);
          } catch (_) {}
        }
      };

      // First mix track drives clock if video is unavailable or has error
      if (i === 0) {
        audio.ontimeupdate = () => {
          const vid = videoRef.current;
          const videoDriving = vid && !vid.paused && !videoPlaybackError && vid.readyState >= 2;
          if (!videoDriving) {
            setCurrentTime(audio.currentTime);
          }
        };
        audio.onended = () => {
          const vid = videoRef.current;
          const videoDriving = vid && !vid.paused && !videoPlaybackError;
          if (!videoDriving) {
            setIsPlaying(false);
          }
        };
      }

      audio.load();
      audioElements.push(audio);
    }

    mixAudioElementsRef.current = audioElements;

    setSelectedAudioTrack({
      id: `module_mix_${step.stepId}`,
      name: `Микс всех дорожек модуля «${meta?.title || step.moduleId}» (${audioOutputs.length} шт.)`,
      path: '',
      label: `Микс модуля (${audioOutputs.length} шт.)`,
      stepId: step.stepId,
      isModuleMix: true,
      isFinalVideo: false,
      mixFiles: audioOutputs
    });

    // Start playing all mix tracks + video synchronously
    setTimeout(() => {
      if (videoRef.current && !videoPlaybackError) {
        try {
          if (Math.abs(videoRef.current.currentTime - targetTime) > 0.3) {
            videoRef.current.currentTime = targetTime;
          }
          videoRef.current.play().catch(() => {});
        } catch (_) {}
      }
      audioElements.forEach(a => {
        if (targetTime > 0 && a.readyState >= 1) {
          try { a.currentTime = Math.min(targetTime, a.duration || targetTime); } catch (_) {}
        }
        a.play().catch(e => console.warn('Mix track play warning:', e));
      });
      setIsPlaying(true);
    }, 60);

    toast.success(`В плеере включен совместный микс всех ${audioOutputs.length} дорожек модуля!`, { duration: 3000 });
  }, [moduleDatabase, selectFinalVideoForPlayback, selectTrackForInspection, stopAndClearModuleMix, videoViewMode, isTrackMuted, trackVolume, sanitizeTempPath, resolveMediaUrlAsync, rolesVolumeMap, videoPlaybackError]);

  // Handle Play / Pause synchronization
  const togglePlay = useCallback(() => {
    if (isPlaying) {
      if (videoRef.current) videoRef.current.pause();
      if (trackAudioRef.current) trackAudioRef.current.pause();
      mixAudioElementsRef.current.forEach(a => a.pause());
      setIsPlaying(false);
    } else {
      const targetTime = currentTimeRef.current;

      if (selectedAudioTrack?.isFinalVideo || videoViewMode === 'final') {
        if (videoRef.current) {
          videoRef.current.muted = isVideoMuted;
          videoRef.current.volume = isVideoMuted ? 0 : Math.min(1, Math.max(0, videoVolume));
          videoRef.current.play().catch(e => console.warn('Video play warning:', e));
        }
        setIsPlaying(true);
        return;
      }

      if (videoRef.current && !videoPlaybackError) {
        videoRef.current.muted = isVideoMuted;
        videoRef.current.volume = isVideoMuted ? 0 : Math.min(1, Math.max(0, videoVolume));
        if (Math.abs(videoRef.current.currentTime - targetTime) > 0.3) {
          try { videoRef.current.currentTime = targetTime; } catch (_) {}
        }
        videoRef.current.play().catch(e => console.warn('Video play warning:', e));
      }

      if (!selectedAudioTrack) {
        if (manifest?.finalVideo?.path) {
          selectFinalVideoForPlayback(manifest.finalVideo);
          return;
        } else if (manifest?.sourceFiles?.originalAudio?.path) {
          selectOriginalAudioTrack();
          return;
        }
      } else if (selectedAudioTrack.isModuleMix) {
        mixAudioElementsRef.current.forEach(a => {
          if (Math.abs(a.currentTime - targetTime) > 0.25) {
            try { a.currentTime = targetTime; } catch (_) {}
          }
          a.play().catch(e => console.warn('Mix audio play warning:', e));
        });
      } else if (trackAudioRef.current && selectedAudioTrack.path) {
        if (!trackAudioRef.current.src || trackAudioRef.current.src === window.location.href) {
          loadSingleTrackAudio(selectedAudioTrack.path, targetTime, true);
          return;
        }
        if (Math.abs(trackAudioRef.current.currentTime - targetTime) > 0.25) {
          try { trackAudioRef.current.currentTime = targetTime; } catch (_) {}
        }
        trackAudioRef.current.play().catch(e => console.warn('Track audio play warning:', e));
      }

      setIsPlaying(true);
    }
  }, [isPlaying, selectedAudioTrack, videoViewMode, isVideoMuted, videoVolume, videoPlaybackError, manifest?.finalVideo, manifest?.sourceFiles?.originalAudio?.path, selectFinalVideoForPlayback, selectOriginalAudioTrack, loadSingleTrackAudio]);

  // Sync seek position across video, single audio track, and module mix tracks
  const handleSeek = useCallback((time: number) => {
    const clampedTime = Math.max(0, isFinite(time) ? time : 0);
    setCurrentTime(clampedTime);
    currentTimeRef.current = clampedTime;

    if (videoRef.current && videoRef.current.readyState >= 1) {
      try { videoRef.current.currentTime = clampedTime; } catch (_) {}
    }
    if (trackAudioRef.current && trackAudioRef.current.readyState >= 1) {
      try { trackAudioRef.current.currentTime = clampedTime; } catch (_) {}
    }
    mixAudioElementsRef.current.forEach(a => {
      if (a.readyState >= 1) {
        try { a.currentTime = clampedTime; } catch (_) {}
      }
    });
  }, []);

  // Video timeUpdate handler — keeps overlay audio tracks tightly synced
  const handleVideoTimeUpdate = useCallback(() => {
    if (!videoRef.current) return;
    const vTime = videoRef.current.currentTime;
    setCurrentTime(vTime);

    if (videoViewMode === 'final' || selectedAudioTrack?.isFinalVideo) {
      return;
    }

    // Keep trackAudio in tight sync with video
    if (trackAudioRef.current && !trackAudioRef.current.paused && trackAudioRef.current.readyState >= 2) {
      const diff = Math.abs(trackAudioRef.current.currentTime - vTime);
      if (diff > 0.2) {
        try { trackAudioRef.current.currentTime = vTime; } catch (_) {}
      }
    }

    // Keep module mix audio elements in tight sync with video
    if (mixAudioElementsRef.current.length > 0) {
      mixAudioElementsRef.current.forEach(a => {
        if (!a.paused && a.readyState >= 2) {
          const diff = Math.abs(a.currentTime - vTime);
          if (diff > 0.2) {
            try { a.currentTime = vTime; } catch (_) {}
          }
        }
      });
    }
  }, [videoViewMode, selectedAudioTrack?.isFinalVideo]);

  return {
    videoRef,
    trackAudioRef,
    mixAudioElementsRef,
    currentTimeRef,
    videoSrc,
    setVideoSrc,
    videoViewMode,
    setVideoViewMode,
    videoPlaybackError,
    setVideoPlaybackError,
    audioPlaybackError,
    selectedAudioTrack,
    setSelectedAudioTrack,
    isPlaying,
    setIsPlaying,
    currentTime,
    setCurrentTime,
    duration,
    setDuration,
    playWithVideo,
    setPlayWithVideo,
    videoVolume,
    setVideoVolume,
    isVideoMuted,
    setIsVideoMuted,
    trackVolume,
    setTrackVolume,
    isTrackMuted,
    setIsTrackMuted,
    rolesVolumeMap,
    setRolesVolumeMap,
    handleUpdateDubberVolume,
    stopAndClearModuleMix,
    releasePlayerAudioLocks,
    sanitizeTempPath,
    formatMediaUrl,
    resolveMediaUrlAsync,
    handleVideoLoadedMetadata,
    handleVideoError,
    loadSingleTrackAudio,
    selectFinalVideoForPlayback,
    selectOriginalAudioTrack,
    selectTrackForInspection,
    selectModuleMixForInspection,
    togglePlay,
    handleSeek,
    handleVideoTimeUpdate
  };
}
