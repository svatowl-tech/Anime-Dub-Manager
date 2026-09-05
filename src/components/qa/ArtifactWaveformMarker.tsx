import React, { useMemo } from 'react';
import { AudioArtifactType } from '../../lib/qa/artifactDetector';

interface ArtifactWaveformMarkerProps {
  audioBuffer?: AudioBuffer | null;
  startSec: number;
  endSec: number;
  defectTimestampSec?: number;
  isPlaying: boolean;
  artifactType?: AudioArtifactType;
  onSeek?: (timeSec: number) => void;
}

export const ArtifactWaveformMarker: React.FC<ArtifactWaveformMarkerProps> = ({
  audioBuffer,
  startSec,
  endSec,
  defectTimestampSec,
  isPlaying,
  artifactType = 'clipping',
  onSeek
}) => {
  const duration = Math.max(0.1, endSec - startSec);
  const defectPosPercent = useMemo(() => {
    if (!defectTimestampSec) return 50;
    const offset = defectTimestampSec - startSec;
    const pct = (offset / duration) * 100;
    return Math.max(4, Math.min(96, pct));
  }, [defectTimestampSec, startSec, duration]);

  // Compute 50 visual amplitude bars from the actual AudioBuffer slice
  const bars = useMemo(() => {
    const numBars = 54;
    if (!audioBuffer) {
      // Synthetic fallback bars if buffer not yet decoded
      return Array.from({ length: numBars }, (_, i) => {
        const centerDist = Math.abs(i - numBars / 2);
        const height = Math.max(0.15, Math.sin(i * 0.4) * 0.4 + 0.35 - (centerDist / numBars) * 0.2);
        return Math.min(1.0, Math.max(0.12, height));
      });
    }

    const sampleRate = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0);
    const startSample = Math.max(0, Math.floor(startSec * sampleRate));
    const endSample = Math.min(channelData.length, Math.floor(endSec * sampleRate));
    const totalSliceSamples = Math.max(1, endSample - startSample);
    const samplesPerBar = Math.max(1, Math.floor(totalSliceSamples / numBars));

    const result: number[] = [];
    let maxVal = 0.01;

    for (let b = 0; b < numBars; b++) {
      const barStart = startSample + b * samplesPerBar;
      const barEnd = Math.min(endSample, barStart + samplesPerBar);
      let peak = 0;
      for (let s = barStart; s < barEnd; s++) {
        const val = Math.abs(channelData[s] || 0);
        if (val > peak) peak = val;
      }
      result.push(peak);
      if (peak > maxVal) maxVal = peak;
    }

    // Normalize heights between 0.15 and 0.95
    return result.map(p => Math.min(0.98, Math.max(0.12, p / maxVal)));
  }, [audioBuffer, startSec, endSec]);

  const markerColor = 
    artifactType === 'clipping' ? '#f43f5e' : // Rose red
    artifactType === 'mouse_click' ? '#f59e0b' : // Amber
    artifactType === 'plosive' ? '#38bdf8' : // Sky blue
    '#a855f7'; // Purple (cutoff)

  return (
    <div 
      className="relative w-full h-14 bg-neutral-950/80 rounded-xl border border-neutral-800/80 overflow-hidden cursor-pointer select-none group"
      onClick={(e) => {
        if (!onSeek) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const clickPct = (e.clientX - rect.left) / rect.width;
        onSeek(startSec + clickPct * duration);
      }}
      title="Нажмите для перехода к таймкоду на вейвформе"
    >
      {/* Background subtle grid */}
      <div className="absolute inset-0 opacity-10 bg-[linear-gradient(to_right,#808080_1px,transparent_1px),linear-gradient(to_bottom,#808080_1px,transparent_1px)] bg-[size:12px_12px]" />

      {/* Waveform Bars Container */}
      <div className="absolute inset-x-2 inset-y-1.5 flex items-center justify-between gap-[2px]">
        {bars.map((height, idx) => {
          const barPct = (idx / (bars.length - 1)) * 100;
          const isNearDefect = Math.abs(barPct - defectPosPercent) < 4;

          return (
            <div
              key={idx}
              className="flex-1 rounded-full transition-all duration-150"
              style={{
                height: `${height * 100}%`,
                backgroundColor: isNearDefect
                  ? markerColor
                  : height > 0.8
                  ? '#a3a3a3'
                  : '#525252',
                boxShadow: isNearDefect ? `0 0 8px ${markerColor}` : undefined
              }}
            />
          );
        })}
      </div>

      {/* Defect Marker Vertical Line & Badge */}
      <div
        className="absolute top-0 bottom-0 z-10 pointer-events-none flex flex-col items-center"
        style={{ left: `${defectPosPercent}%`, transform: 'translateX(-50%)' }}
      >
        {/* Glow column */}
        <div 
          className="w-0.5 h-full"
          style={{
            backgroundColor: markerColor,
            boxShadow: `0 0 10px 1.5px ${markerColor}`
          }}
        />

        {/* Pin tag top */}
        <div 
          className="absolute -top-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold font-mono text-black shadow-md uppercase tracking-wider flex items-center gap-0.5"
          style={{ backgroundColor: markerColor }}
        >
          <span>АРТЕФАКТ</span>
        </div>
      </div>

      {/* Active playing pulse indicator */}
      {isPlaying && (
        <div className="absolute inset-0 bg-white/5 pointer-events-none animate-pulse" />
      )}

      {/* Hover overlay hint */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-white/[0.02] pointer-events-none transition-opacity" />
    </div>
  );
};
