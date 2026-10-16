import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Track } from '../../types';
import { AudioClip } from '../../types/timing';
import { formatSeconds } from '../../services/timing/SubtitleAlignmentService';

interface TimingWaveformCanvasProps {
  tracks: Track[];
  clipsByTrack: Record<string, AudioClip[]>;
  audioBuffers: Record<string, AudioBuffer>;
  currentTime: number;
  duration: number;
  zoomPixelsPerSec: number;
  selectedClipId: string | null;
  trackColors: Record<string, string>;
  onSeek: (timeSec: number) => void;
  onSelectClip: (clipId: string, trackId: string) => void;
  onTrimClipStart: (trackId: string, clipId: string, newStartSec: number) => void;
  onTrimClipEnd: (trackId: string, clipId: string, newEndSec: number) => void;
  onNudgeClip: (trackId: string, clipId: string, deltaSec: number) => void;
  onSplitClip: (trackId: string, clipId: string, splitTimeSec: number) => void;
}

export const TimingWaveformCanvas: React.FC<TimingWaveformCanvasProps> = ({
  tracks,
  clipsByTrack,
  audioBuffers,
  currentTime,
  duration,
  zoomPixelsPerSec,
  selectedClipId,
  trackColors,
  onSeek,
  onSelectClip,
  onTrimClipStart,
  onTrimClipEnd,
  onNudgeClip,
  onSplitClip
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Drag interaction state
  const [dragState, setDragState] = useState<{
    mode: 'seek' | 'move' | 'trim-start' | 'trim-end' | null;
    clipId?: string;
    trackId?: string;
    startX: number;
    initialStartSec?: number;
    initialDurationSec?: number;
  }>({ mode: null, startX: 0 });

  const TRACK_HEIGHT = 96;
  const RULER_HEIGHT = 28;
  const totalHeight = RULER_HEIGHT + tracks.length * TRACK_HEIGHT;
  const totalWidth = Math.max(800, Math.ceil(duration * zoomPixelsPerSec) + 200);

  // Render timeline canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = totalWidth * dpr;
    canvas.height = totalHeight * dpr;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, totalWidth, totalHeight);

    // 1. Draw Time Ruler
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, totalWidth, RULER_HEIGHT);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, RULER_HEIGHT);
    ctx.lineTo(totalWidth, RULER_HEIGHT);
    ctx.stroke();

    // Determine ruler step based on zoom
    let rulerStepSec = 5;
    if (zoomPixelsPerSec > 120) rulerStepSec = 1;
    else if (zoomPixelsPerSec > 40) rulerStepSec = 2;
    else if (zoomPixelsPerSec < 15) rulerStepSec = 10;

    const totalSeconds = Math.ceil(duration) + 10;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';

    for (let s = 0; s <= totalSeconds; s += rulerStepSec) {
      const x = s * zoomPixelsPerSec;
      ctx.beginPath();
      ctx.moveTo(x, RULER_HEIGHT - 8);
      ctx.lineTo(x, RULER_HEIGHT);
      ctx.strokeStyle = '#475569';
      ctx.stroke();

      ctx.fillText(formatSeconds(s), x + 3, RULER_HEIGHT - 10);
    }

    // 2. Draw Tracks & Clips
    tracks.forEach((track, trackIdx) => {
      const trackTop = RULER_HEIGHT + trackIdx * TRACK_HEIGHT;
      const trackBottom = trackTop + TRACK_HEIGHT;

      // Track separator line
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, trackBottom);
      ctx.lineTo(totalWidth, trackBottom);
      ctx.stroke();

      // Track alternating background
      ctx.fillStyle = trackIdx % 2 === 0 ? 'rgba(15, 23, 42, 0.4)' : 'rgba(30, 41, 59, 0.2)';
      ctx.fillRect(0, trackTop, totalWidth, TRACK_HEIGHT);

      const clips = clipsByTrack[track.id] || [];
      const trackColor = trackColors[track.id] || '#6366f1';
      const audioBuf = audioBuffers[track.id];

      clips.forEach(clip => {
        const clipX = clip.clipStartSec * zoomPixelsPerSec;
        const clipW = Math.max(4, clip.durationSec * zoomPixelsPerSec);
        const clipY = trackTop + 8;
        const clipH = TRACK_HEIGHT - 16;
        const isSelected = selectedClipId === clip.id;

        // Clip container background
        ctx.fillStyle = isSelected ? 'rgba(99, 102, 241, 0.25)' : 'rgba(30, 41, 59, 0.7)';
        ctx.strokeStyle = isSelected ? '#a5b4fc' : trackColor;
        ctx.lineWidth = isSelected ? 2 : 1;

        ctx.beginPath();
        ctx.roundRect(clipX, clipY, clipW, clipH, 4);
        ctx.fill();
        ctx.stroke();

        // Waveform preview inside clip
        const centerY = clipY + clipH / 2;
        ctx.fillStyle = trackColor;

        if (audioBuf && typeof audioBuf.getChannelData === 'function') {
          const channelData = audioBuf.getChannelData(0);
          const sampleRate = audioBuf.sampleRate;
          const startSample = Math.max(0, Math.floor(clip.sourceStartSec * sampleRate));
          const endSample = Math.min(channelData.length, Math.floor(clip.sourceEndSec * sampleRate));
          const totalSamples = Math.max(1, endSample - startSample);

          const barWidth = 2;
          const barGap = 1;
          const step = barWidth + barGap;
          const numBars = Math.max(2, Math.floor(clipW / step));
          const samplesPerBar = Math.floor(totalSamples / numBars);

          for (let i = 0; i < numBars; i++) {
            const offset = startSample + i * samplesPerBar;
            let peak = 0;
            const count = Math.min(samplesPerBar, endSample - offset);
            for (let j = 0; j < count; j++) {
              const val = Math.abs(channelData[offset + j]);
              if (val > peak) peak = val;
            }

            const barH = Math.max(1.5, Math.min(clipH / 2 - 2, (clipH / 2 - 2) * peak * 2.2));
            const barX = clipX + i * step;
            ctx.fillRect(barX, centerY - barH, barWidth, barH * 2);
          }
        } else {
          // Synthetic speech envelope preview while audio buffer is decoding/loading
          const barWidth = 2;
          const barGap = 1;
          const step = barWidth + barGap;
          const numBars = Math.max(2, Math.floor(clipW / step));
          for (let i = 0; i < numBars; i++) {
            const progress = i / numBars;
            const envelope = Math.sin(progress * Math.PI);
            const variation = 0.3 + 0.7 * Math.abs(Math.sin(i * 0.7) * Math.cos(i * 1.3));
            const barH = Math.max(2, (clipH / 2 - 4) * envelope * variation);
            const barX = clipX + i * step;
            ctx.fillRect(barX, centerY - barH, barWidth, barH * 2);
          }
        }

        // Subtitle text label on top of clip
        if (clip.text && clipW > 30) {
          ctx.fillStyle = '#f8fafc';
          ctx.font = '10px sans-serif';
          const txt = clip.text.length > 25 ? clip.text.substring(0, 24) + '…' : clip.text;
          ctx.fillText(txt, clipX + 6, clipY + 14);
        }

        // Target subtitle range indicator (if aligned)
        if (clip.targetSubStartSec && clip.targetSubEndSec) {
          const subX = clip.targetSubStartSec * zoomPixelsPerSec;
          const subW = (clip.targetSubEndSec - clip.targetSubStartSec) * zoomPixelsPerSec;

          ctx.strokeStyle = '#10b981';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.strokeRect(subX, clipY - 3, subW, clipH + 6);
          ctx.setLineDash([]);
        }

        // Selection handles
        if (isSelected) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(clipX - 2, clipY + clipH / 2 - 8, 4, 16);
          ctx.fillRect(clipX + clipW - 2, clipY + clipH / 2 - 8, 4, 16);
        }
      });
    });

    // 3. Playhead cursor
    const playheadX = currentTime * zoomPixelsPerSec;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, totalHeight);
    ctx.stroke();

    // Playhead handle on ruler
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(playheadX - 6, 0);
    ctx.lineTo(playheadX + 6, 0);
    ctx.lineTo(playheadX, 12);
    ctx.closePath();
    ctx.fill();
  }, [tracks, clipsByTrack, audioBuffers, currentTime, duration, zoomPixelsPerSec, selectedClipId, trackColors, totalWidth, totalHeight]);

  // Handle Mouse Down
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Clicked in ruler -> Seek
    if (clickY <= RULER_HEIGHT) {
      const seekTime = Math.max(0, clickX / zoomPixelsPerSec);
      onSeek(seekTime);
      setDragState({ mode: 'seek', startX: clickX });
      return;
    }

    // Check which track was clicked
    const trackIdx = Math.floor((clickY - RULER_HEIGHT) / TRACK_HEIGHT);
    if (trackIdx < 0 || trackIdx >= tracks.length) return;

    const track = tracks[trackIdx];
    const trackClips = clipsByTrack[track.id] || [];

    // Check if clicked inside a clip or its edge handles
    for (const clip of trackClips) {
      const clipX = clip.clipStartSec * zoomPixelsPerSec;
      const clipW = clip.durationSec * zoomPixelsPerSec;

      if (clickX >= clipX - 6 && clickX <= clipX + clipW + 6) {
        onSelectClip(clip.id, track.id);

        // Near left edge -> trim start
        if (Math.abs(clickX - clipX) <= 6) {
          setDragState({
            mode: 'trim-start',
            clipId: clip.id,
            trackId: track.id,
            startX: clickX,
            initialStartSec: clip.clipStartSec,
            initialDurationSec: clip.durationSec
          });
          return;
        }

        // Near right edge -> trim end
        if (Math.abs(clickX - (clipX + clipW)) <= 6) {
          setDragState({
            mode: 'trim-end',
            clipId: clip.id,
            trackId: track.id,
            startX: clickX,
            initialStartSec: clip.clipStartSec,
            initialDurationSec: clip.durationSec
          });
          return;
        }

        // Clicked inside body -> move/nudge
        setDragState({
          mode: 'move',
          clipId: clip.id,
          trackId: track.id,
          startX: clickX,
          initialStartSec: clip.clipStartSec
        });
        return;
      }
    }

    // Clicked empty space on track -> Seek
    const seekTime = Math.max(0, clickX / zoomPixelsPerSec);
    onSeek(seekTime);
    setDragState({ mode: 'seek', startX: clickX });
  }, [tracks, clipsByTrack, zoomPixelsPerSec, onSeek, onSelectClip]);

  // Handle Mouse Move
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement | HTMLCanvasElement>) => {
    if (!dragState.mode) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const deltaX = currentX - dragState.startX;
    const deltaSec = deltaX / zoomPixelsPerSec;

    if (dragState.mode === 'seek') {
      const seekTime = Math.max(0, currentX / zoomPixelsPerSec);
      onSeek(seekTime);
    } else if (dragState.mode === 'move' && dragState.clipId && dragState.trackId) {
      if (Math.abs(deltaSec) >= 0.01) {
        onNudgeClip(dragState.trackId, dragState.clipId, deltaSec);
        setDragState(prev => ({ ...prev, startX: currentX }));
      }
    } else if (dragState.mode === 'trim-start' && dragState.clipId && dragState.trackId && dragState.initialStartSec !== undefined) {
      const newStart = Math.max(0, dragState.initialStartSec + deltaSec);
      onTrimClipStart(dragState.trackId, dragState.clipId, newStart);
    } else if (dragState.mode === 'trim-end' && dragState.clipId && dragState.trackId && dragState.initialStartSec !== undefined && dragState.initialDurationSec !== undefined) {
      const newEnd = Math.max(dragState.initialStartSec + 0.05, dragState.initialStartSec + dragState.initialDurationSec + deltaSec);
      onTrimClipEnd(dragState.trackId, dragState.clipId, newEnd);
    }
  }, [dragState, zoomPixelsPerSec, onSeek, onNudgeClip, onTrimClipStart, onTrimClipEnd]);

  // Handle Mouse Up
  const handleMouseUp = useCallback(() => {
    setDragState({ mode: null, startX: 0 });
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto bg-neutral-950 relative select-none cursor-default"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <canvas
        ref={canvasRef}
        style={{ width: `${totalWidth}px`, height: `${totalHeight}px` }}
        onMouseDown={handleMouseDown}
        className="block"
      />
    </div>
  );
};
