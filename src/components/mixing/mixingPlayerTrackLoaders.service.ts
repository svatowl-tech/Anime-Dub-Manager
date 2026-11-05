import React from "react";
import { toast } from "sonner";
import { Episode, MixingManifest, MixingFileItem } from "../../types";
import { resolveLocalPath } from "../../lib/webFileSystem";

export interface UseMixingAudioPlayerParams {
  currentEpisode?: Episode | null;
  workingDir: string;
  customTargetDir: string;
  manifest: MixingManifest | null;
  setManifest: React.Dispatch<React.SetStateAction<MixingManifest | null>>;
  moduleDatabase: import("../../types").MixingModuleDef[];
  mixLog: (level: "info" | "warn" | "error" | "debug" | "success", tag: string, message: string, meta?: any, stepId?: string) => void;
}

export interface SelectedMixingAudioTrack {
  id: string;
  name: string;
  path: string;
  label: string;
  stepId?: string;
  isModuleMix?: boolean;
  isFinalVideo?: boolean;
  mixFiles?: MixingFileItem[];
}

export function sanitizeTempPathHelper(rawPath: string): string {
  if (!rawPath) return '';
  return rawPath.replace(/\.tmp_[0-9]+_[a-z0-9]+_/i, '');
}

export function formatMediaUrlHelper(filePath: string): string {
  if (!filePath) return '';
  if (
    filePath.startsWith('http://') ||
    filePath.startsWith('https://') ||
    filePath.startsWith('blob:') ||
    filePath.startsWith('/api/media-file') ||
    filePath.startsWith('custom-media://local/media?path=')
  ) {
    return filePath;
  }
  const cleanP = sanitizeTempPathHelper(filePath.replace(/^file:\/\//, '').replace(/^custom-media:\/\//, ''));
  if (window.electronAPI) {
    return `custom-media://local/media?path=${encodeURIComponent(cleanP)}`;
  }
  return cleanP;
}

export async function resolveMediaUrlAsyncHelper(filePath: string): Promise<string> {
  if (!filePath) return '';
  const cleaned = sanitizeTempPathHelper(filePath);
  if (window.electronAPI) return formatMediaUrlHelper(cleaned);
  const cleanName = cleaned.replace(/\\/g, '/').split('/').pop() || cleaned;
  const cachedFile = (window as any).getFileFromCache?.(cleanName);
  if (cachedFile) return URL.createObjectURL(cachedFile);
  try {
    const resolved = await resolveLocalPath(cleaned);
    if (resolved) return resolved;
  } catch (e) {}
  return formatMediaUrlHelper(cleaned);
}

export function loadSingleTrackAudioElement({
  audioEl,
  resolvedSrc,
  targetTime,
  autoPlay,
  isTrackMuted,
  trackVolume,
  videoRef,
  videoPlaybackError,
  setAudioPlaybackError,
  setDuration,
  setIsPlaying
}: {
  audioEl: HTMLAudioElement | null;
  resolvedSrc: string;
  targetTime: number;
  autoPlay: boolean;
  isTrackMuted: boolean;
  trackVolume: number;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  videoPlaybackError: string | null;
  setAudioPlaybackError: React.Dispatch<React.SetStateAction<string | null>>;
  setDuration: React.Dispatch<React.SetStateAction<number>>;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
}) {
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
}

export async function buildModuleMixAudioElements({
  audioOutputs,
  targetTime,
  isTrackMuted,
  trackVolume,
  rolesVolumeMap,
  videoRef,
  videoPlaybackError,
  setDuration,
  setCurrentTime,
  setIsPlaying
}: {
  audioOutputs: MixingFileItem[];
  targetTime: number;
  isTrackMuted: boolean;
  trackVolume: number;
  rolesVolumeMap: Record<string, number>;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  videoPlaybackError: string | null;
  setDuration: React.Dispatch<React.SetStateAction<number>>;
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
}): Promise<HTMLAudioElement[]> {
  const baseVol = isTrackMuted ? 0 : Math.min(1, Math.max(0, trackVolume));
  const audioElements: HTMLAudioElement[] = [];

  for (let i = 0; i < audioOutputs.length; i++) {
    const file = audioOutputs[i];
    const cleanPath = sanitizeTempPathHelper(file.path);
    const resolvedSrc = await resolveMediaUrlAsyncHelper(cleanPath);

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

  return audioElements;
}

export function buildVideoErrorMessage(err: MediaError | null): string {
  let errMsg = 'Формат или кодек видео недоступен для прямого воспроизведения в плеере';
  if (err) {
    if (err.code === 1) errMsg = 'Воспроизведение видео прервано пользователем';
    if (err.code === 2) errMsg = 'Сбой сети при получении видеопотока';
    if (err.code === 3) errMsg = 'Ошибка декодирования (несовместимый видеокодек HEVC или контейнер MKV)';
    if (err.code === 4) {
      errMsg = 'Контейнер/кодек видео не поддерживается HTML5-плеером (напр. MKV / AC3 / 10-bit H.264). Прослушивание аудиодорожек продолжает работать штатно!';
    }
  }
  return errMsg;
}
