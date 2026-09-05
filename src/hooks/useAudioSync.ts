import { useEffect, useRef, useState } from 'react';

export const useAudioSync = (
  isPlaying: boolean,
  currentTime: number,
  volumes: Record<string, number>,
  isMuted: boolean,
  audioRefsUpdated: number
) => {
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});

  useEffect(() => {
    if (!isPlaying) {
      Object.values(audioRefs.current).forEach(audio => {
        if (audio instanceof HTMLAudioElement) audio.pause();
      });
      return;
    }

    Object.values(audioRefs.current).forEach(audio => {
      if (audio instanceof HTMLAudioElement) {
        audio.currentTime = currentTime;
        audio.play().catch(e => {
          if (e.name !== 'AbortError' && e.name !== 'NotAllowedError') {
            console.error('Audio play error', e);
          }
        });
      }
    });
  }, [isPlaying, audioRefsUpdated]);

  useEffect(() => {
    Object.entries(audioRefs.current).forEach(([id, audio]) => {
      if (audio instanceof HTMLAudioElement) {
        const rawVol = volumes[id] ?? 0.8;
        const volume = isMuted ? 0 : Math.min(1.0, Math.max(0, rawVol));
        try {
          audio.volume = volume;
        } catch (e) {
          console.warn('Audio volume set error:', e);
        }
      }
    });
  }, [volumes, isMuted, audioRefsUpdated]);

  return audioRefs;
};
