import { useState, useCallback, useRef } from 'react';
import { AudioClip } from '../../types/timing';
import { findNearestZeroCrossing } from '../../services/timing/AudioVADEngine';

export function useTimingClips(initialClips: Record<string, AudioClip[]> = {}) {
  const [clipsByTrack, setClipsByTrack] = useState<Record<string, AudioClip[]>>(initialClips);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);

  // Undo / Redo history
  const undoStackRef = useRef<Array<Record<string, AudioClip[]>>>([]);
  const redoStackRef = useRef<Array<Record<string, AudioClip[]>>>([]);

  // Push current state to undo history before mutations
  const pushHistory = useCallback((current: Record<string, AudioClip[]>) => {
    undoStackRef.current.push(JSON.parse(JSON.stringify(current)));
    if (undoStackRef.current.length > 35) {
      undoStackRef.current.shift();
    }
    redoStackRef.current = [];
  }, []);

  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const prev = undoStackRef.current.pop()!;
    redoStackRef.current.push(JSON.parse(JSON.stringify(clipsByTrack)));
    setClipsByTrack(prev);
  }, [clipsByTrack]);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const next = redoStackRef.current.pop()!;
    undoStackRef.current.push(JSON.parse(JSON.stringify(clipsByTrack)));
    setClipsByTrack(next);
  }, [clipsByTrack]);

  // Set all clips (e.g. after detection or loading project)
  const setAllClips = useCallback((newClips: Record<string, AudioClip[]>) => {
    pushHistory(clipsByTrack);
    setClipsByTrack(newClips);
  }, [clipsByTrack, pushHistory]);

  // Split clip at exact splitTimeSec
  const splitClip = useCallback((
    trackId: string,
    clipId: string,
    splitTimeSec: number,
    audioBuffer?: AudioBuffer
  ) => {
    setClipsByTrack(prev => {
      const trackClips = prev[trackId] || [];
      const clipIndex = trackClips.findIndex(c => c.id === clipId);
      if (clipIndex === -1) return prev;

      const clip = trackClips[clipIndex];
      const clipEnd = clip.clipStartSec + clip.durationSec;

      // Only split if splitTime is comfortably inside the clip
      if (splitTimeSec <= clip.clipStartSec + 0.05 || splitTimeSec >= clipEnd - 0.05) {
        return prev;
      }

      pushHistory(prev);

      // Fine-tune split point to nearest zero-crossing
      let accurateSplitTime = splitTimeSec;
      if (audioBuffer) {
        const fileSplitTime = clip.sourceStartSec + (splitTimeSec - clip.clipStartSec);
        const zeroTime = findNearestZeroCrossing(audioBuffer, fileSplitTime);
        accurateSplitTime = clip.clipStartSec + (zeroTime - clip.sourceStartSec);
      }

      const leftDuration = accurateSplitTime - clip.clipStartSec;
      const rightDuration = clipEnd - accurateSplitTime;
      const fileSplitOffset = clip.sourceStartSec + leftDuration;

      const leftClip: AudioClip = {
        ...clip,
        id: `${clip.id}_pt1`,
        durationSec: Number(leftDuration.toFixed(3)),
        sourceEndSec: Number(fileSplitOffset.toFixed(3))
      };

      const rightClip: AudioClip = {
        ...clip,
        id: `${clip.id}_pt2`,
        clipStartSec: Number(accurateSplitTime.toFixed(3)),
        durationSec: Number(rightDuration.toFixed(3)),
        sourceStartSec: Number(fileSplitOffset.toFixed(3))
      };

      const nextClips = [...trackClips];
      nextClips.splice(clipIndex, 1, leftClip, rightClip);

      return {
        ...prev,
        [trackId]: nextClips
      };
    });
  }, [pushHistory]);

  // Trim clip start
  const trimClipStart = useCallback((trackId: string, clipId: string, newStartSec: number) => {
    setClipsByTrack(prev => {
      const trackClips = prev[trackId] || [];
      const clipIndex = trackClips.findIndex(c => c.id === clipId);
      if (clipIndex === -1) return prev;

      const clip = trackClips[clipIndex];
      const clipEnd = clip.clipStartSec + clip.durationSec;
      if (newStartSec >= clipEnd - 0.05) return prev;

      pushHistory(prev);

      const delta = newStartSec - clip.clipStartSec;
      const nextClip: AudioClip = {
        ...clip,
        clipStartSec: Number(newStartSec.toFixed(3)),
        durationSec: Number((clipEnd - newStartSec).toFixed(3)),
        sourceStartSec: Number((clip.sourceStartSec + delta).toFixed(3))
      };

      const nextClips = [...trackClips];
      nextClips[clipIndex] = nextClip;

      return {
        ...prev,
        [trackId]: nextClips
      };
    });
  }, [pushHistory]);

  // Trim clip end
  const trimClipEnd = useCallback((trackId: string, clipId: string, newEndSec: number) => {
    setClipsByTrack(prev => {
      const trackClips = prev[trackId] || [];
      const clipIndex = trackClips.findIndex(c => c.id === clipId);
      if (clipIndex === -1) return prev;

      const clip = trackClips[clipIndex];
      if (newEndSec <= clip.clipStartSec + 0.05) return prev;

      pushHistory(prev);

      const newDuration = newEndSec - clip.clipStartSec;
      const nextClip: AudioClip = {
        ...clip,
        durationSec: Number(newDuration.toFixed(3)),
        sourceEndSec: Number((clip.sourceStartSec + newDuration).toFixed(3))
      };

      const nextClips = [...trackClips];
      nextClips[clipIndex] = nextClip;

      return {
        ...prev,
        [trackId]: nextClips
      };
    });
  }, [pushHistory]);

  // Nudge clip left or right
  const nudgeClip = useCallback((trackId: string, clipId: string, deltaSec: number) => {
    setClipsByTrack(prev => {
      const trackClips = prev[trackId] || [];
      const clipIndex = trackClips.findIndex(c => c.id === clipId);
      if (clipIndex === -1) return prev;

      const clip = trackClips[clipIndex];
      const nextStart = Math.max(0, clip.clipStartSec + deltaSec);

      pushHistory(prev);

      const nextClip: AudioClip = {
        ...clip,
        clipStartSec: Number(nextStart.toFixed(3)),
        offsetSec: Number((clip.offsetSec + deltaSec).toFixed(3))
      };

      const nextClips = [...trackClips];
      nextClips[clipIndex] = nextClip;

      return {
        ...prev,
        [trackId]: nextClips
      };
    });
  }, [pushHistory]);

  // Delete clip
  const deleteClip = useCallback((trackId: string, clipId: string) => {
    setClipsByTrack(prev => {
      const trackClips = prev[trackId] || [];
      const filtered = trackClips.filter(c => c.id !== clipId);
      if (filtered.length === trackClips.length) return prev;

      pushHistory(prev);
      return {
        ...prev,
        [trackId]: filtered
      };
    });
  }, [pushHistory]);

  // Reset clip to original detected bounds
  const resetClip = useCallback((trackId: string, clipId: string) => {
    setClipsByTrack(prev => {
      const trackClips = prev[trackId] || [];
      const clipIndex = trackClips.findIndex(c => c.id === clipId);
      if (clipIndex === -1) return prev;

      const clip = trackClips[clipIndex];
      if (clip.rawSourceStartSec === undefined || clip.rawSourceEndSec === undefined) return prev;

      pushHistory(prev);

      const rawDur = clip.rawSourceEndSec - clip.rawSourceStartSec;
      const nextClip: AudioClip = {
        ...clip,
        sourceStartSec: clip.rawSourceStartSec,
        sourceEndSec: clip.rawSourceEndSec,
        durationSec: Number(rawDur.toFixed(3)),
        offsetSec: 0
      };

      const nextClips = [...trackClips];
      nextClips[clipIndex] = nextClip;

      return {
        ...prev,
        [trackId]: nextClips
      };
    });
  }, [pushHistory]);

  return {
    clipsByTrack,
    selectedClipId,
    setSelectedClipId,
    setAllClips,
    splitClip,
    trimClipStart,
    trimClipEnd,
    nudgeClip,
    deleteClip,
    resetClip,
    undo,
    redo,
    canUndo: undoStackRef.current.length > 0,
    canRedo: redoStackRef.current.length > 0
  };
}
