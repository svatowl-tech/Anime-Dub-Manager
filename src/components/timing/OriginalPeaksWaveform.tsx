import React, { useEffect, useMemo, useRef } from 'react';

export interface OriginalPeaksWaveformProps {
  peaks: number[];
  width: number;
  height: number;
  volume: number;
  isMuted: boolean;
  waveScale?: number;
  autoNormalize?: boolean;
  theme?: 'sky' | 'amber' | 'emerald';
}

export const OriginalPeaksWaveform: React.FC<OriginalPeaksWaveformProps> = ({
  peaks,
  width,
  height,
  volume,
  isMuted,
  waveScale = 1.8,
  autoNormalize = true,
  theme = 'sky'
}) => {
  const tileWidth = 4096;
  const numTiles = Math.max(1, Math.ceil(width / tileWidth));
  const tiles = useMemo(() => Array.from({ length: numTiles }, (_, i) => i), [numTiles]);

  // Compute global peak distribution once so quiet original tracks are normalized
  // and spoken phrases visually stand out from background room noise / silence.
  const peakStats = useMemo(() => {
    if (!peaks || peaks.length === 0) {
      return { normGain: 1, noiseFloor: 0.005, speechThreshold: 0.02 };
    }
    const sampleStep = Math.max(1, Math.floor(peaks.length / 4000));
    const nonZero: number[] = [];
    for (let i = 0; i < peaks.length; i += sampleStep) {
      const v = Math.abs(peaks[i] || 0);
      if (v > 0.0003) nonZero.push(v);
    }
    if (nonZero.length === 0) {
      return { normGain: 1, noiseFloor: 0.005, speechThreshold: 0.02 };
    }
    nonZero.sort((a, b) => a - b);
    const p15 = nonZero[Math.floor(nonZero.length * 0.15)] || 0.002;
    const p50 = nonZero[Math.floor(nonZero.length * 0.50)] || 0.02;
    const p96 = nonZero[Math.min(nonZero.length - 1, Math.floor(nonZero.length * 0.96))] || 0.1;

    // Normalize 96th percentile to 0.92 full scale so quiet anime tracks (-24..-14 dBFS) fill the lane
    const normGain = Math.min(25, Math.max(1.0, 0.92 / Math.max(0.015, p96)));
    const noiseFloor = Math.min(0.04, p15 * 1.15);
    const speechThreshold = Math.max(noiseFloor * 1.8, Math.min(p50 * 0.85, p96 * 0.22));
    return { normGain, noiseFloor, speechThreshold };
  }, [peaks]);

  return (
    <div className="relative flex h-full pointer-events-none" style={{ width: `${width}px` }}>
      {tiles.map((tileIdx) => {
        const startX = tileIdx * tileWidth;
        const w = Math.min(tileWidth, Math.max(1, width - startX));
        return (
          <OriginalPeaksTile
            key={tileIdx}
            peaks={peaks}
            totalWidth={width}
            startX={startX}
            tileWidth={w}
            height={height}
            volume={volume}
            isMuted={isMuted}
            waveScale={waveScale}
            autoNormalize={autoNormalize}
            peakStats={peakStats}
            theme={theme}
          />
        );
      })}
    </div>
  );
};

const OriginalPeaksTile: React.FC<{
  peaks: number[];
  totalWidth: number;
  startX: number;
  tileWidth: number;
  height: number;
  volume: number;
  isMuted: boolean;
  waveScale: number;
  autoNormalize: boolean;
  peakStats: { normGain: number; noiseFloor: number; speechThreshold: number };
  theme?: 'sky' | 'amber' | 'emerald';
}> = ({ peaks, totalWidth, startX, tileWidth, height, isMuted, waveScale, autoNormalize, peakStats, theme = 'sky' }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || tileWidth <= 0 || height <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, tileWidth, height);
    const centerY = height / 2;

    // Subtle center axis line
    const axisColor = isMuted
      ? 'rgba(115, 115, 115, 0.2)'
      : theme === 'amber'
      ? 'rgba(245, 158, 11, 0.18)'
      : 'rgba(56, 189, 248, 0.18)';
    ctx.strokeStyle = axisColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(tileWidth, centerY);
    ctx.stroke();

    if (!peaks || peaks.length === 0) {
      return;
    }

    const barWidth = 2;
    const barGap = 1.2;
    const step = barWidth + barGap;
    const numBars = Math.floor(tileWidth / step);
    const maxRadius = Math.max(4, centerY - 2);
    const effectiveScale = Math.max(0.25, Math.min(12, waveScale || 1.8));
    const baseNorm = autoNormalize ? peakStats.normGain : 2.0;

    let silenceColor = isMuted ? 'rgba(115, 115, 115, 0.22)' : 'rgba(56, 189, 248, 0.22)';
    let lowSoundColor = isMuted ? 'rgba(148, 163, 184, 0.42)' : 'rgba(56, 189, 248, 0.55)';
    let phraseOuterColor = isMuted ? 'rgba(148, 163, 184, 0.65)' : 'rgba(245, 158, 11, 0.88)';
    let phraseCoreColor = isMuted ? 'rgba(203, 213, 225, 0.75)' : 'rgba(253, 224, 71, 0.95)';

    if (theme === 'amber') {
      silenceColor = isMuted ? 'rgba(115, 115, 115, 0.22)' : 'rgba(245, 158, 11, 0.22)';
      lowSoundColor = isMuted ? 'rgba(148, 163, 184, 0.42)' : 'rgba(245, 158, 11, 0.55)';
      phraseOuterColor = isMuted ? 'rgba(148, 163, 184, 0.65)' : 'rgba(217, 119, 6, 0.88)';
      phraseCoreColor = isMuted ? 'rgba(203, 213, 225, 0.75)' : 'rgba(251, 191, 36, 0.95)';
    }

    for (let i = 0; i < numBars; i++) {
      const globalX = startX + i * step;
      const ratioStart = globalX / Math.max(1, totalWidth);
      const ratioEnd = (globalX + step) / Math.max(1, totalWidth);
      const idxStart = Math.max(0, Math.floor(ratioStart * peaks.length));
      const idxEnd = Math.min(peaks.length, Math.max(idxStart + 1, Math.ceil(ratioEnd * peaks.length)));

      let maxPeak = 0;
      let sumPeak = 0;
      let count = 0;
      for (let p = idxStart; p < idxEnd; p++) {
        const val = Math.abs(peaks[p] || 0);
        if (val > maxPeak) maxPeak = val;
        sumPeak += val;
        count++;
      }
      const avgPeak = count > 0 ? sumPeak / count : maxPeak;

      // Keep true silence flat (1px) so gaps between phrases are unmistakable
      if (maxPeak <= peakStats.noiseFloor) {
        ctx.fillStyle = silenceColor;
        ctx.fillRect(i * step, centerY - 0.5, barWidth, 1);
        continue;
      }

      // Normalize and apply gentle non-linear curve (gamma 0.72) when autoNormalize is active
      // so quiet spoken dialogue syllables are clearly visible without clipping loud peaks
      const normPeak = maxPeak * baseNorm;
      const shapedPeak = autoNormalize
        ? Math.pow(Math.min(1.35, normPeak), 0.72) * effectiveScale * 0.62
        : normPeak * effectiveScale * 0.55;

      const barH = Math.max(2.0, Math.min(maxRadius, shapedPeak * maxRadius));
      const isSpeechPhrase = maxPeak >= peakStats.speechThreshold;

      ctx.fillStyle = isSpeechPhrase ? phraseOuterColor : lowSoundColor;
      ctx.fillRect(i * step, centerY - barH, barWidth, barH * 2);

      // Draw bright RMS inner core on speech phrases for crisp syllable definition
      if (isSpeechPhrase && barH >= 4) {
        const coreH = Math.max(1.5, Math.min(barH * 0.65, (avgPeak / Math.max(0.001, maxPeak)) * barH * 0.8));
        ctx.fillStyle = phraseCoreColor;
        ctx.fillRect(i * step, centerY - coreH, barWidth, coreH * 2);
      }
    }
  }, [peaks, totalWidth, startX, tileWidth, height, isMuted, waveScale, autoNormalize, peakStats]);

  return <canvas ref={canvasRef} width={tileWidth} height={height} className="shrink-0 h-full" />;
};
