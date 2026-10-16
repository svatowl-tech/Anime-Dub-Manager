import { useState, useEffect, useRef, useCallback } from 'react';
import { getSharedAudioContext, ensureAudioContextResumed } from '../../lib/qa/sharedAudioContext';

interface ActiveSourceNode {
  trackId: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export interface TimingAudioEngineState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  audioBuffers: Record<string, AudioBuffer>;
  loadingTracks: Record<string, boolean>;
  volumeByTrack: Record<string, number>; // 0 to 2
  mutedByTrack: Record<string, boolean>;
  soloByTrack: Record<string, boolean>;
  playbackRate: number;
}

export function useTimingAudioEngine() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioBuffers, setAudioBuffers] = useState<Record<string, AudioBuffer>>({});
  const [loadingTracks, setLoadingTracks] = useState<Record<string, boolean>>({});
  const [volumeByTrack, setVolumeByTrack] = useState<Record<string, number>>({});
  const [mutedByTrack, setMutedByTrack] = useState<Record<string, boolean>>({});
  const [soloByTrack, setSoloByTrack] = useState<Record<string, boolean>>({});
  const [playbackRate, setPlaybackRate] = useState(1.0);

  // References to keep in sync with Web Audio API clock
  const playStartTimeRef = useRef<number>(0);
  const playStartOffsetRef = useRef<number>(0);
  const activeSourcesRef = useRef<ActiveSourceNode[]>([]);
  const animFrameRef = useRef<number | null>(null);
  const currentTimeRef = useRef<number>(0);
  currentTimeRef.current = currentTime;

  // Cleanup helper to stop active nodes
  const stopAllSources = useCallback(() => {
    activeSourcesRef.current.forEach(({ source }) => {
      try {
        source.stop();
        source.disconnect();
      } catch (e) {
        // Source might already have finished
      }
    });
    activeSourcesRef.current = [];
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  }, []);

  // Update duration whenever new buffers are loaded
  useEffect(() => {
    let maxDur = 0;
    Object.values(audioBuffers).forEach(buf => {
      if (buf && buf.duration > maxDur) {
        maxDur = buf.duration;
      }
    });
    if (maxDur > 0) {
      setDuration(maxDur);
    }
  }, [audioBuffers]);

  // High precision animation loop for playhead
  const tickPlayhead = useCallback(() => {
    const ctx = getSharedAudioContext();
    if (!ctx) return;

    const elapsed = (ctx.currentTime - playStartTimeRef.current) * playbackRate;
    const nextTime = playStartOffsetRef.current + elapsed;

    if (duration > 0 && nextTime >= duration) {
      setCurrentTime(duration);
      setIsPlaying(false);
      stopAllSources();
      return;
    }

    setCurrentTime(nextTime);
    animFrameRef.current = requestAnimationFrame(tickPlayhead);
  }, [playbackRate, duration, stopAllSources]);

  // Start playback
  const play = useCallback(async (startOffset?: number) => {
    await ensureAudioContextResumed();
    const ctx = getSharedAudioContext();
    if (!ctx) return;

    stopAllSources();

    const seekTime = startOffset !== undefined ? startOffset : currentTimeRef.current;
    playStartOffsetRef.current = seekTime;
    playStartTimeRef.current = ctx.currentTime;

    // Check if any track is soloed
    const hasSolo = Object.values(soloByTrack).some(Boolean);

    // Spawn source nodes for each loaded track
    const newSources: ActiveSourceNode[] = [];

    Object.entries(audioBuffers).forEach(([trackId, buffer]) => {
      if (!buffer) return;

      const isMuted = mutedByTrack[trackId];
      const isSolo = soloByTrack[trackId];

      if (isMuted || (hasSolo && !isSolo)) {
        return; // Skip playback for muted or non-solo tracks
      }

      if (seekTime >= buffer.duration) {
        return;
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = playbackRate;

      const gain = ctx.createGain();
      const trackVol = volumeByTrack[trackId] !== undefined ? volumeByTrack[trackId] : 1.0;
      gain.gain.value = Math.max(0, Math.min(2.0, trackVol));

      source.connect(gain);
      gain.connect(ctx.destination);

      source.start(0, seekTime);
      newSources.push({ trackId, source, gain });
    });

    activeSourcesRef.current = newSources;
    setIsPlaying(true);
    animFrameRef.current = requestAnimationFrame(tickPlayhead);
  }, [audioBuffers, mutedByTrack, soloByTrack, volumeByTrack, playbackRate, stopAllSources, tickPlayhead]);

  // Pause playback
  const pause = useCallback(() => {
    stopAllSources();
    setIsPlaying(false);
  }, [stopAllSources]);

  // Toggle playback
  const togglePlay = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, pause, play]);

  // Seek to specific position
  const seek = useCallback((targetSec: number) => {
    const clamped = Math.max(0, duration > 0 ? Math.min(duration, targetSec) : targetSec);
    setCurrentTime(clamped);
    if (isPlaying) {
      play(clamped);
    }
  }, [duration, isPlaying, play]);

  // Adjust volume
  const setTrackVolume = useCallback((trackId: string, vol: number) => {
    setVolumeByTrack(prev => ({ ...prev, [trackId]: vol }));
    const active = activeSourcesRef.current.find(s => s.trackId === trackId);
    if (active) {
      active.gain.gain.value = Math.max(0, Math.min(2.0, vol));
    }
  }, []);

  // Toggle mute
  const toggleTrackMute = useCallback((trackId: string) => {
    setMutedByTrack(prev => {
      const next = { ...prev, [trackId]: !prev[trackId] };
      return next;
    });
  }, []);

  // Toggle solo
  const toggleTrackSolo = useCallback((trackId: string) => {
    setSoloByTrack(prev => {
      const next = { ...prev, [trackId]: !prev[trackId] };
      return next;
    });
  }, []);

  // Load an audio file into audioBuffers
  const loadAudioBuffer = useCallback(async (trackId: string, url: string) => {
    if (!url) return;
    setLoadingTracks(prev => ({ ...prev, [trackId]: true }));
    try {
      await ensureAudioContextResumed();
      const ctx = getSharedAudioContext();
      if (!ctx) throw new Error('AudioContext not available');

      const resp = await fetch(url);
      const arrayBuf = await resp.arrayBuffer();
      const audioBuf = await ctx.decodeAudioData(arrayBuf);

      setAudioBuffers(prev => ({ ...prev, [trackId]: audioBuf }));
    } catch (err) {
      console.error(`Failed to decode audio for track ${trackId}:`, err);
    } finally {
      setLoadingTracks(prev => ({ ...prev, [trackId]: false }));
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAllSources();
    };
  }, [stopAllSources]);

  return {
    isPlaying,
    currentTime,
    duration,
    audioBuffers,
    loadingTracks,
    volumeByTrack,
    mutedByTrack,
    soloByTrack,
    playbackRate,
    play,
    pause,
    togglePlay,
    seek,
    setTrackVolume,
    toggleTrackMute,
    toggleTrackSolo,
    setPlaybackRate,
    loadAudioBuffer,
    setAudioBuffers
  };
}
