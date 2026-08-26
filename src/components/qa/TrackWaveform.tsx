import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { Track, SubtitleLine } from '../../types';

function generateSyntheticPeaks(lines: SubtitleLine[], duration: number) {
  const pointsPerSecond = 10;
  const numPoints = Math.max(100, Math.min(Math.ceil(duration * pointsPerSecond), 10000));
  const peaks = new Float32Array(numPoints);
  
  // Base ambient hum
  for (let i = 0; i < numPoints; i++) {
    peaks[i] = 0.05 + Math.sin(i * 0.15) * 0.02 + Math.random() * 0.03;
  }
  
  // Speech peaks
  for (const line of lines) {
    const startSec = line.startSec || 0;
    const endSec = line.endSec || 0;
    
    const startIdx = Math.max(0, Math.floor((startSec / duration) * numPoints));
    const endIdx = Math.min(numPoints - 1, Math.floor((endSec / duration) * numPoints));
    
    for (let j = startIdx; j <= endIdx; j++) {
      const progress = (j - startIdx) / Math.max(1, endIdx - startIdx);
      const envelope = Math.sin(progress * Math.PI);
      const wave = 0.4 + Math.sin(j * 0.9) * 0.3 + Math.sin(j * 2.1) * 0.12 + (Math.random() - 0.5) * 0.15;
      peaks[j] = Math.max(0.1, Math.min(0.95, wave * envelope + 0.06));
    }
  }
  
  return Array.from(peaks);
}

interface TrackWaveformProps {
  track: Track;
  currentTime: number;
  isPlaying: boolean;
  subLines: SubtitleLine[];
  onTimeUpdate: (time: number) => void;
  onPlayPause: () => void;
  volume: number;
  isMuted: boolean;
  onRegionClick: (region: any) => void;
  onSeek?: (time: number) => void;
}

export const TrackWaveform = ({ track, currentTime, isPlaying, subLines, onTimeUpdate, onPlayPause, volume, isMuted, onRegionClick, onSeek }: TrackWaveformProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    wavesurferRef.current = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#3b82f6',
      progressColor: '#1d4ed8',
      cursorColor: '#ffffff',
      barWidth: 2,
      barGap: 3,
      height: 80,
      normalize: true,
    });

    regionsRef.current = wavesurferRef.current.registerPlugin(RegionsPlugin.create());

    wavesurferRef.current.on('error', (err: any) => {
      if (err.name === 'AbortError' || err.message?.includes('aborted')) return;
      console.error('WaveSurfer error:', err);
    });

    // Region click handler
    regionsRef.current.on('region-click', (region: any, e: MouseEvent) => {
      e.stopPropagation();
      onRegionClick(region);
    });

    const isVideoFile = (path?: string) => {
      if (!path) return false;
      const lower = path.toLowerCase();
      return lower.endsWith('.mp4') || 
             lower.endsWith('.mkv') || 
             lower.endsWith('.avi') || 
             lower.endsWith('.mov') || 
             lower.endsWith('.webm') || 
             lower.endsWith('.flv') ||
             lower.endsWith('.m4v');
    };

    const selectedFile = track.files.find(f => f.id === track.selectedFileId) || track.files[0];
    const loadSyntheticPeaks = () => {
      const maxEnd = subLines.length > 0 ? Math.max(...subLines.map(l => l.endSec || 0)) : 10;
      const duration = maxEnd + 3;
      const peaks = generateSyntheticPeaks(subLines, duration);
      if (wavesurferRef.current) {
        try {
          const silentWav = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
          wavesurferRef.current.load(silentWav, [peaks], duration);
        } catch (err) {
          console.error('TrackWaveform sync load error:', err);
        }
      }
    };

    if (selectedFile && selectedFile.path && !isVideoFile(selectedFile.path)) {
      (async () => {
        let audioUrl = selectedFile.path;
        if (!window.electronAPI) {
          const cleanName = selectedFile.path.replace(/\\/g, '/').split('/').pop() || selectedFile.path;
          const cached = (window as any).getFileFromCache?.(cleanName);
          if (cached) {
            audioUrl = URL.createObjectURL(cached);
          } else {
            try {
              const { resolveLocalPath } = await import('../../lib/webFileSystem');
              const resolved = await resolveLocalPath(selectedFile.path);
              if (resolved) audioUrl = resolved;
            } catch (err) {}
          }
        } else {
          audioUrl = selectedFile.path.startsWith('file://') || selectedFile.path.startsWith('http') ? selectedFile.path : `file://${selectedFile.path}`;
        }

        wavesurferRef.current?.load(audioUrl).catch(err => {
          if (err.name === 'AbortError' || err.message?.includes('aborted')) return;
          console.warn('Quality-track WAV load failed, using synthetic peaks fallback:', err);
          loadSyntheticPeaks();
        });
      })();
    } else {
      loadSyntheticPeaks();
    }

    wavesurferRef.current.on('audioprocess', () => {
      const time = wavesurferRef.current?.getCurrentTime() || 0;
      onTimeUpdate(time);
    });

    wavesurferRef.current.on('interaction', () => {
      const time = wavesurferRef.current?.getCurrentTime() || 0;
      if (onSeek) onSeek(time);
      else onTimeUpdate(time);
    });

    wavesurferRef.current.on('seeking', () => {
      const time = wavesurferRef.current?.getCurrentTime() || 0;
      if (onSeek) onSeek(time);
      else onTimeUpdate(time);
    });

    wavesurferRef.current.on('play', () => {
      if (!isPlaying) onPlayPause();
    });
    wavesurferRef.current.on('pause', () => {
      if (isPlaying) onPlayPause();
    });

    let isUnmounted = false;

    // Add regions
    wavesurferRef.current.on('ready', () => {
      if (isUnmounted) return;
      wavesurferRef.current?.setTime(currentTime);
      if (isPlaying) {
        wavesurferRef.current?.play().catch(() => {});
      }
      subLines.forEach(line => {
        try {
          regionsRef.current.addRegion({
            start: line.startSec,
            end: line.endSec,
            color: 'rgba(59, 130, 246, 0.1)',
            drag: false,
            resize: false,
            content: line.text
          });
        } catch (e: any) {
          if (e.message !== 'WaveSurfer is not initialized') {
            console.error('Failed to add region:', e);
          }
        }
      });
    });

    return () => {
      isUnmounted = true;
      wavesurferRef.current?.destroy();
    };
  }, [track.id]);

  useEffect(() => {
    if (wavesurferRef.current) {
      wavesurferRef.current.setVolume(isMuted ? 0 : volume);
    }
  }, [volume, isMuted]);

  useEffect(() => {
    if (wavesurferRef.current) {
      if (isPlaying) {
        wavesurferRef.current.play().catch(e => {
          if (e?.name !== 'AbortError') console.error(e);
        });
      } else {
        wavesurferRef.current.pause();
      }
    }
  }, [isPlaying]);

  useEffect(() => {
    if (wavesurferRef.current && Math.abs(wavesurferRef.current.getCurrentTime() - currentTime) > 0.1) {
      wavesurferRef.current.setTime(currentTime);
    }
  }, [currentTime]);

  return <div ref={containerRef} className="w-full" />;
};
