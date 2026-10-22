import React, { useEffect, useRef } from "react";

/**
 * Real Audio Waveform Canvas Component for Individual Speech Clips
 * Renders real PCM peaks directly from the decoded AudioBuffer between sourceStartSec and sourceEndSec.
 */
export const ClipWaveform: React.FC<{
  audioBuffer: AudioBuffer | null;
  sourceStartSec: number;
  sourceEndSec: number;
  width: number;
  height: number;
  color?: string;
  volumePercent?: number;
}> = ({ audioBuffer, sourceStartSec, sourceEndSec, width, height, color = '#818cf8', volumePercent = 100 }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    const centerY = height / 2;
    const volMult = Math.min(2.0, Math.max(0.1, (volumePercent || 100) / 100));

    if (audioBuffer && typeof audioBuffer.getChannelData === 'function') {
      const channelData = audioBuffer.getChannelData(0);
      const sampleRate = audioBuffer.sampleRate;
      const startSample = Math.max(0, Math.floor(sourceStartSec * sampleRate));
      const endSample = Math.min(channelData.length, Math.floor(sourceEndSec * sampleRate));
      const totalSamples = Math.max(1, endSample - startSample);

      const barWidth = 2.0;
      const barGap = 1.2;
      const step = barWidth + barGap;
      const numBars = Math.max(2, Math.floor(width / step));
      const samplesPerBar = Math.floor(totalSamples / numBars);

      ctx.fillStyle = color;

      for (let i = 0; i < numBars; i++) {
        const offset = startSample + i * samplesPerBar;
        let maxPeak = 0;
        const count = Math.min(samplesPerBar, endSample - offset);
        for (let j = 0; j < count; j++) {
          const val = Math.abs(channelData[offset + j]);
          if (val > maxPeak) maxPeak = val;
        }

        const barHeight = Math.max(1.5, Math.min(centerY - 1, (centerY - 2) * maxPeak * 2.4 * volMult));
        const x = i * step;
        ctx.fillRect(x, centerY - barHeight, barWidth, barHeight * 2);
      }
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();
    }
  }, [audioBuffer, sourceStartSec, sourceEndSec, width, height, color, volumePercent]);

  return <canvas ref={canvasRef} width={width} height={height} className="w-full h-full pointer-events-none" />;
};
