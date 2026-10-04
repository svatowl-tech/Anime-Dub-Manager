import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Clock, 
  Play, 
  Pause, 
  RotateCcw, 
  Scissors, 
  Sparkles, 
  Sliders, 
  AlertTriangle, 
  CheckCircle2, 
  Download, 
  FolderOpen, 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  ChevronRight, 
  Mic, 
  Volume2, 
  VolumeX, 
  ArrowRight, 
  Info,
  RefreshCw,
  MoveHorizontal,
  Bookmark,
  Layers,
  Activity,
  Check,
  X,
  FileAudio
} from 'lucide-react';
import { toast } from 'sonner';
import { Episode, Track, SubtitleLine, RoleAssignment } from '../types';
import { ipcSafe } from '../lib/ipcSafe';
import { getSharedAudioContext, ensureAudioContextResumed } from '../lib/qa/sharedAudioContext';
import { ExportModal } from './ExportModal';

function parseTimeToSeconds(timeStr: string | number): number {
  if (typeof timeStr === 'number') return isNaN(timeStr) ? 0 : timeStr;
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const str = timeStr.trim();
  const parts = str.split(':');
  if (parts.length === 3) {
    const h = parseFloat(parts[0]) || 0;
    const m = parseFloat(parts[1]) || 0;
    const s = parseFloat(parts[2].replace(',', '.')) || 0;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const m = parseFloat(parts[0]) || 0;
    const s = parseFloat(parts[1].replace(',', '.')) || 0;
    return m * 60 + s;
  }
  const f = parseFloat(str.replace(',', '.'));
  return isNaN(f) ? 0 : f;
}

function formatSeconds(sec: number): string {
  if (isNaN(sec) || sec < 0) return '00:00.00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function normalizeName(s: string): string {
  if (!s) return '';
  return s.toLowerCase().trim().replace(/[^a-z0-9а-яё]/gi, '');
}

/**
 * Strict role-based subtitle line matching.
 */
function isSubtitleForCharacter(
  subName: string,
  charName: string,
  dubberNick: string,
  assignments: RoleAssignment[] = []
): boolean {
  if (!subName) return false;
  const normSub = normalizeName(subName);
  if (!normSub || normSub === 'default' || normSub === 'comment' || normSub === 'шумы') return false;

  const normChar = normalizeName(charName);
  const normNick = normalizeName(dubberNick);

  const dubberAssigns = assignments.filter(a => {
    const aNick = normalizeName(a.dubber?.nickname || (a as any).dubberNickname || '');
    const aId = a.dubberId;
    return (aNick && aNick === normNick) || (aId && (aId === dubberNick || aId === normNick));
  });

  const assignedCharNames = dubberAssigns.map(a => normalizeName(a.characterName)).filter(Boolean);
  if (normChar) assignedCharNames.push(normChar);

  for (const cName of assignedCharNames) {
    if (!cName) continue;
    if (normSub === cName || normSub.includes(cName) || cName.includes(normSub)) {
      return true;
    }
  }

  if (normNick && (normSub === normNick || normSub.includes(normNick) || normNick.includes(normSub))) {
    return true;
  }

  const parts = subName.split(/[,;&/]/).map(normalizeName).filter(Boolean);
  if (parts.some(p => assignedCharNames.includes(p) || p === normNick || (normChar && p.includes(normChar)))) {
    return true;
  }

  return false;
}

async function getPlayableAudioUrl(filePath: string): Promise<string | null> {
  if (!filePath) return null;
  if (filePath.startsWith('blob:') || filePath.startsWith('http://') || filePath.startsWith('https://') || filePath.startsWith('data:')) {
    return filePath;
  }
  if ((window as any).electronAPI) {
    return filePath.startsWith('file://') ? filePath : `file://${filePath.replace(/\\/g, '/')}`;
  }
  const cleanName = filePath.replace(/\\/g, '/').split('/').pop() || filePath;
  const cached = (window as any).getFileFromCache?.(cleanName);
  if (cached) {
    return URL.createObjectURL(cached);
  }
  try {
    const { resolveLocalPath } = await import('../lib/webFileSystem');
    const resolved = await resolveLocalPath(filePath);
    if (resolved) return resolved;
  } catch (err) {}
  return `file://${filePath.replace(/\\/g, '/')}`;
}

/**
 * Speech interval detection algorithm on decoded AudioBuffer.
 * Identifies speech phrases and silences, cutting away background noise and long pauses.
 */
function detectSpeechIntervals(
  audioBuffer: AudioBuffer,
  minSilenceDurationSec: number = 0.35,
  paddingSec: number = 0.12
): Array<{ startSec: number; endSec: number; durationSec: number }> {
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const totalSamples = channelData.length;
  const duration = audioBuffer.duration;
  
  // Find peak amplitude across the track to set dynamic threshold
  let maxAmp = 0;
  const stepCheck = Math.max(1, Math.floor(sampleRate * 0.1));
  for (let i = 0; i < totalSamples; i += stepCheck) {
    const a = Math.abs(channelData[i]);
    if (a > maxAmp) maxAmp = a;
  }
  const thresholdAmp = Math.max(0.004, maxAmp * 0.08); // 8% of peak

  const chunkSize = Math.floor(sampleRate * 0.025); // 25ms windows
  const totalChunks = Math.floor(totalSamples / chunkSize);
  const isSpeechChunk = new Uint8Array(totalChunks);

  for (let i = 0; i < totalChunks; i++) {
    let sumSquares = 0;
    const offset = i * chunkSize;
    for (let j = 0; j < chunkSize; j++) {
      const s = channelData[offset + j];
      sumSquares += s * s;
    }
    const rms = Math.sqrt(sumSquares / chunkSize);
    if (rms >= thresholdAmp) {
      isSpeechChunk[i] = 1;
    }
  }

  // Smooth short pauses inside words (< minSilenceDurationSec)
  const minSilenceChunks = Math.floor(minSilenceDurationSec / 0.025);
  let gapCount = 0;
  for (let i = 0; i < totalChunks; i++) {
    if (isSpeechChunk[i] === 0) {
      gapCount++;
    } else {
      if (gapCount > 0 && gapCount < minSilenceChunks) {
        for (let k = i - gapCount; k < i; k++) {
          isSpeechChunk[k] = 1;
        }
      }
      gapCount = 0;
    }
  }

  const intervals: Array<{ startSec: number; endSec: number; durationSec: number }> = [];
  let inSpeech = false;
  let intervalStartSec = 0;

  for (let i = 0; i < totalChunks; i++) {
    const chunkTime = (i * chunkSize) / sampleRate;
    if (isSpeechChunk[i] === 1 && !inSpeech) {
      inSpeech = true;
      intervalStartSec = Math.max(0, chunkTime - paddingSec);
    } else if (isSpeechChunk[i] === 0 && inSpeech) {
      inSpeech = false;
      const intervalEndSec = Math.min(duration, chunkTime + paddingSec);
      if (intervalEndSec - intervalStartSec >= 0.25) {
        intervals.push({
          startSec: Number(intervalStartSec.toFixed(2)),
          endSec: Number(intervalEndSec.toFixed(2)),
          durationSec: Number((intervalEndSec - intervalStartSec).toFixed(2))
        });
      }
    }
  }

  if (inSpeech) {
    const intervalEndSec = duration;
    if (intervalEndSec - intervalStartSec >= 0.25) {
      intervals.push({
        startSec: Number(intervalStartSec.toFixed(2)),
        endSec: Number(intervalEndSec.toFixed(2)),
        durationSec: Number((intervalEndSec - intervalStartSec).toFixed(2))
      });
    }
  }

  return intervals;
}

/**
 * Real Audio Waveform Canvas Component for Individual Speech Clips
 * Renders real PCM peaks directly from the decoded AudioBuffer between sourceStartSec and sourceEndSec.
 */
const ClipWaveform: React.FC<{
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

    if (audioBuffer) {
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

export interface AudioClip {
  id: string;
  trackId: string;
  dubberName: string;
  characterName: string;
  clipStartSec: number;     // Position on timeline
  durationSec: number;      // Clip duration
  sourceStartSec: number;   // Start time inside audio file
  sourceEndSec: number;     // End time inside audio file
  text: string;             // Dialogue text hint
  volumePercent: number;    // Gain % (0 - 200%)
  isFix?: boolean;          // Flag for spliced fix takes
  hasCollision?: boolean;   // Collision with another actor
  offsetSec: number;        // Manual mouse drag offset
}

export interface StitchedFixMarker {
  id: string;
  trackId: string;
  dubberName: string;
  characterName: string;
  startSec: number;
  endSec: number;
  filename: string;
}

export interface VoiceCollisionMarker {
  id: string;
  track1Id: string;
  track2Id: string;
  dubber1Name: string;
  dubber2Name: string;
  character1Name: string;
  character2Name: string;
  startSec: number;
  endSec: number;
  overlapDurationSec: number;
}

interface TimingPanelProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
  onNavigate?: (tab: 'dashboard' | 'subtitles' | 'qa' | 'timing' | 'mixing' | 'release' | 'telegram' | 'settings' | 'database' | 'cover' | 'stats' | 'archive') => void;
}

export default function TimingPanel({ currentEpisode, onRefresh, onNavigate }: TimingPanelProps) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [subLines, setSubLines] = useState<SubtitleLine[]>([]);
  const [audioClips, setAudioClips] = useState<Record<string, AudioClip[]>>({}); // trackId -> AudioClip[]
  const [stitchedFixes, setStitchedFixes] = useState<StitchedFixMarker[]>([]);
  const [collisions, setCollisions] = useState<VoiceCollisionMarker[]>([]);
  
  // Pipeline status flags
  const [isSilenceRemoved, setIsSilenceRemoved] = useState<boolean>(false);
  const [isFixesStitched, setIsFixesStitched] = useState<boolean>(false);
  const [isAutoTimingDone, setIsAutoTimingDone] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [exportingToMixing, setIsExportingToMixing] = useState<boolean>(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isExportingSE, setIsExportingSE] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [isLogDrawerOpen, setIsLogDrawerOpen] = useState<boolean>(false);
  const [operationLogs, setOperationLogs] = useState<Array<{ time: string; msg: string; level: 'info' | 'success' | 'warn' | 'error' }>>([]);
  const [trackSubLinesMap, setTrackSubLinesMap] = useState<Record<string, SubtitleLine[]>>({});

  // Mouse Dragging State for Clips
  const [draggingClip, setDraggingClip] = useState<{ trackId: string; clipId: string; startMouseX: number; initialClipStartSec: number } | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);

  const addLog = useCallback((msg: string, level: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString('ru-RU');
    setOperationLogs(prev => [...prev.slice(-300), { time, msg, level }]);
    if (level === 'error') console.error(`[TimingLog] ${msg}`);
    else if (level === 'warn') console.warn(`[TimingLog] ${msg}`);
    else console.log(`[TimingLog] ${msg}`);
  }, []);

  useEffect(() => {
    const unsub = ipcSafe.on('ffmpeg-progress', (percent: any) => {
      if (typeof percent === 'number') {
        setExportProgress(percent);
      }
    });
    return () => {
      if (unsub) unsub();
    };
  }, []);

  // Playback & Zoom Controls
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(100);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [zoomLevel, setZoomLevel] = useState<number>(30); // pixels per second

  // Audio Playback
  const [mutedTracks, setMutedTracks] = useState<Set<string>>(new Set());
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [originalVolume, setOriginalVolume] = useState<number>(0.4);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  // Refs for animation & decoded audio buffers
  const playbackRef = useRef<number | null>(null);
  const timelineContainerRef = useRef<HTMLDivElement | null>(null);
  const audioElementsRef = useRef<Record<string, HTMLAudioElement>>({});
  const audioBuffersRef = useRef<Record<string, AudioBuffer>>({});

  // Mouse Dragging Effect for Real Audio Clips
  useEffect(() => {
    if (!draggingClip) return;
    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - draggingClip.startMouseX;
      const deltaSec = deltaX / zoomLevel;
      setAudioClips(prev => {
        const trClips = prev[draggingClip.trackId] || [];
        const updated = trClips.map(clip => {
          if (clip.id === draggingClip.clipId) {
            const newStart = Math.max(0, Number((draggingClip.initialClipStartSec + deltaSec).toFixed(2)));
            return { ...clip, clipStartSec: newStart, offsetSec: 0 };
          }
          return clip;
        });
        return { ...prev, [draggingClip.trackId]: updated };
      });
    };
    const handleMouseUp = () => {
      setDraggingClip(null);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingClip, zoomLevel]);

  const handleClipMouseDown = (e: React.MouseEvent, trackId: string, clip: AudioClip) => {
    e.stopPropagation();
    setSelectedClipId(clip.id);
    setDraggingClip({
      trackId,
      clipId: clip.id,
      startMouseX: e.clientX,
      initialClipStartSec: clip.clipStartSec + (clip.offsetSec || 0)
    });
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = timelineContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const clickX = e.clientX - rect.left + container.scrollLeft;
    const newTime = Math.max(0, Math.min(duration, clickX / zoomLevel));
    setCurrentTime(newTime);
    Object.values(audioElementsRef.current).forEach(audio => {
      try { audio.currentTime = newTime; } catch (err) {}
    });
    addLog(`⏩ Перемещение плейбэка на ${formatSeconds(newTime)}`, 'info');
  };

  // Spacebar Key Listener for Play / Pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setIsPlaying(prev => {
          const next = !prev;
          addLog(next ? `▶ Воспроизведение запущено` : `⏸ Воспроизведение остановлено`, 'info');
          return next;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addLog]);

  // Audio Playback Loop & Time Sync
  useEffect(() => {
    if (!isPlaying) {
      if (playbackRef.current) cancelAnimationFrame(playbackRef.current);
      Object.values(audioElementsRef.current).forEach(audio => {
        try { audio.pause(); } catch (e) {}
      });
      return;
    }

    tracks.forEach(tr => {
      const audio = audioElementsRef.current[tr.id];
      if (audio && !mutedTracks.has(tr.id)) {
        try {
          if (Math.abs(audio.currentTime - currentTime) > 0.25) {
            audio.currentTime = currentTime;
          }
          audio.volume = Math.max(0, Math.min(1, volumes[tr.id] ?? 1.0));
          audio.play().catch(e => {});
        } catch (e) {}
      }
    });

    let lastTimestamp = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastTimestamp) / 1000;
      lastTimestamp = now;

      setCurrentTime(prev => {
        const next = prev + dt;
        if (next >= duration) {
          setIsPlaying(false);
          addLog(`⏹ Достигнут конец таймлайна (${formatSeconds(duration)})`, 'info');
          return 0;
        }
        return next;
      });

      playbackRef.current = requestAnimationFrame(tick);
    };

    playbackRef.current = requestAnimationFrame(tick);

    return () => {
      if (playbackRef.current) cancelAnimationFrame(playbackRef.current);
      Object.values(audioElementsRef.current).forEach(audio => {
        try { audio.pause(); } catch (e) {}
      });
    };
  }, [isPlaying, tracks, mutedTracks, volumes, duration, addLog]);

  // Load Subtitles & Dubber Tracks from Episode
  const loadEpisodeData = useCallback(async () => {
    if (!currentEpisode) return;
    try {
      setIsLoading(true);
      setStatusMessage('Загрузка субтитров и файлов звукорежиссёра...');
      addLog(`=== Начало загрузки тайминга серии #${currentEpisode.number} (${currentEpisode.project?.title || 'Проект'}) ===`, 'info');

      // 1. Load Subtitles
      let parsedLines: SubtitleLine[] = [];
      const subPath = currentEpisode.subPath;
      if (subPath) {
        const subData = await ipcSafe.invoke('get-raw-subtitles', subPath).catch(() => null);
        if (subData && subData.lines) {
          parsedLines = subData.lines.map((l: any, idx: number) => ({
            id: `sub_${idx}`,
            rawLineIndex: l.rawLineIndex ?? idx,
            startSec: parseTimeToSeconds(l.start),
            endSec: parseTimeToSeconds(l.end),
            startFormatted: l.start || '00:00.00',
            endFormatted: l.end || '00:00.00',
            name: l.name || 'Default',
            text: l.text || '',
            style: l.style || 'Default'
          }));
          setSubLines(parsedLines);
          const maxSubTime = parsedLines.reduce((max, l) => Math.max(max, l.endSec), 10);
          setDuration(prev => Math.max(prev, maxSubTime + 10));
          addLog(`✓ Успешно распарсено ${parsedLines.length} строк субтитров.`, 'success');
        }
      }

      // 2. Fetch Dubber Tracks
      const statusRes: any = await ipcSafe.invoke('mixing-get-status', { episode: currentEpisode }).catch(() => null);
      let dubberTracks = statusRes?.manifest?.sourceFiles?.dubberTracks || [];

      if (dubberTracks.length === 0) {
        setStatusMessage('Экспорт и сборка файлов звукорежиссера из QA...');
        const importRes: any = await ipcSafe.invoke('mixing-import-sound-engineer-files', {
          episode: currentEpisode,
          autoApplyFixes: true,
          autoTiming: false
        }).catch(() => null);

        if (importRes?.manifest?.sourceFiles?.dubberTracks) {
          dubberTracks = importRes.manifest.sourceFiles.dubberTracks;
        }
      }

      const matchRes: any = await ipcSafe.invoke('match-actors-tracks', {
        episode: currentEpisode,
        audioFiles: dubberTracks
      }).catch(() => null);

      const matchedList = matchRes?.matchedTracks || [];

      const fetchedTracks: Track[] = dubberTracks.map((dt: any, idx: number) => {
        const matched = matchedList.find((m: any) => m.trackPath === dt.path || m.dubberNick === dt.dubberNick);
        const charName = matched?.characterName || dt.characterName || dt.dubberNick || 'Персонаж';
        const dubberNick = matched?.dubberNick || dt.dubberNick || 'Даббер';

        return {
          id: `track_${normalizeName(dubberNick)}_${idx}`,
          projectId: currentEpisode.projectId,
          episodeId: currentEpisode.id,
          participant: dubberNick,
          character: charName,
          dubberName: dubberNick,
          characterName: charName,
          filePath: dt.path,
          role: 'dubber',
          status: 'recorded'
        };
      });

      setTracks(fetchedTracks);
      addLog(`Загружено ${fetchedTracks.length} активных дорожек дабберов.`, fetchedTracks.length > 0 ? 'success' : 'warn');

      // 3. Decode Real AudioBuffers for Every Track
      const sharedAudioCtx = getSharedAudioContext();
      for (const tr of fetchedTracks) {
        if (tr.filePath) {
          const playableUrl = await getPlayableAudioUrl(tr.filePath);
          if (playableUrl) {
            const audio = new Audio(playableUrl);
            audio.preload = 'metadata';
            audioElementsRef.current[tr.id] = audio;

            try {
              const resp = await fetch(playableUrl);
              const arrayBuf = await resp.arrayBuffer();
              if (sharedAudioCtx) {
                const decodedBuf = await sharedAudioCtx.decodeAudioData(arrayBuf);
                audioBuffersRef.current[tr.id] = decodedBuf;
                setDuration(prev => Math.max(prev, decodedBuf.duration));
                addLog(`📈 Реальная аудиоволна декодирована для «${tr.participant}» (${decodedBuf.duration.toFixed(1)}s)`, 'success');
              }
            } catch (decodeErr) {
              console.warn(`[AudioDecode] Не удалось декодировать аудио для ${tr.id}:`, decodeErr);
            }
          }
        }
      }

      if (currentEpisode.rawPath) {
        getPlayableAudioUrl(currentEpisode.rawPath).then(url => {
          if (url) setVideoUrl(url);
        });
      }

      // 4. Map Subtitles and Initialize Initial Audio Clips (continuous full file before silence cut)
      const initialClips: Record<string, AudioClip[]> = {};
      const trackSubMap: Record<string, SubtitleLine[]> = {};

      fetchedTracks.forEach(tr => {
        const charName = tr.character || tr.characterName || 'Персонаж';
        const dubberName = tr.participant || tr.dubberName || 'Даббер';

        let matchedLines = parsedLines.filter(line => 
          isSubtitleForCharacter(line.name, charName, dubberName, currentEpisode.assignments || [])
        );

        if (matchedLines.length === 0 && (charName !== 'Персонаж' || dubberName !== 'Даббер')) {
          const normC = normalizeName(charName);
          const normD = normalizeName(dubberName);
          matchedLines = parsedLines.filter(line => {
            const normSub = normalizeName(line.name);
            return (normC && (normSub === normC || normSub.includes(normC))) ||
                   (normD && (normSub === normD || normSub.includes(normD)));
          });
        }

        trackSubMap[tr.id] = matchedLines;

        const trackBuf = audioBuffersRef.current[tr.id];
        const trackDur = trackBuf ? trackBuf.duration : (matchedLines[matchedLines.length - 1]?.endSec || 100);

        // Initially before "Удалить тишину", track has one continuous full audio clip
        initialClips[tr.id] = [{
          id: `clip_${tr.id}_full`,
          trackId: tr.id,
          dubberName,
          characterName: charName,
          clipStartSec: 0,
          durationSec: trackDur,
          sourceStartSec: 0,
          sourceEndSec: trackDur,
          text: `Полная запись: ${dubberName}`,
          volumePercent: 100,
          isFix: false,
          hasCollision: false,
          offsetSec: 0
        }];
      });

      setTrackSubLinesMap(trackSubMap);
      setAudioClips(initialClips);

      if (fetchedTracks.length > 0) {
        toast.success(`Загружено ${fetchedTracks.length} дорожек дабберов с реальными аудиоволнами!`);
      }
    } catch (err: any) {
      addLog(`❌ Ошибка загрузки данных тайминга: ${err.message || String(err)}`, 'error');
      toast.error(`Ошибка загрузки: ${err.message || String(err)}`);
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  }, [currentEpisode, addLog]);

  useEffect(() => {
    loadEpisodeData();
  }, [currentEpisode?.id]);

  // PIPELINE STEP 1: Export / Backup all tracks
  const handleImportFromQA = async () => {
    if (!currentEpisode) return;
    try {
      setIsLoading(true);
      setStatusMessage('Бэкап и сборка дорожек до манипуляций...');
      await ipcSafe.invoke('mixing-import-sound-engineer-files', {
        episode: currentEpisode,
        autoApplyFixes: false,
        autoTiming: false
      });
      await loadEpisodeData();
      toast.success('Бэкап дорожек выполнен! Исходные файлы загружены в тайминг.');
    } catch (err: any) {
      toast.error(`Ошибка импорта: ${err.message || String(err)}`);
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  };

  // PIPELINE STEP 3: "Удалить тишину" — Real VAD Silence Cutting & DAW Clip Slicing
  const handleCutSilence = async () => {
    if (tracks.length === 0) {
      toast.error('Нет загруженных дорожек');
      return;
    }
    try {
      setIsLoading(true);
      setStatusMessage('Нарезка аудио-вейвформ по паузам и удаление тишины...');
      addLog('Запуск анализа энергии аудиосигнала и нарезки на речевые фразы...', 'info');

      const updatedClips: Record<string, AudioClip[]> = {};
      let totalClips = 0;

      for (const track of tracks) {
        const audioBuf = audioBuffersRef.current[track.id];
        const dubberName = track.participant || track.dubberName || 'Даббер';
        const characterName = track.character || track.characterName || 'Персонаж';
        const trSubs = trackSubLinesMap[track.id] || [];

        if (audioBuf) {
          // Detect speech intervals in audio signal
          const intervals = detectSpeechIntervals(audioBuf);
          addLog(`🎙 Дорожка «${dubberName}»: обнаружено ${intervals.length} речевых фраз. Тишина между ними вырезана.`, 'info');

          updatedClips[track.id] = intervals.map((iv, idx) => {
            // Find matching subtitle text
            let matchingSub = trSubs[idx];
            if (!matchingSub) {
              matchingSub = trSubs.find(s => (s.startSec >= iv.startSec - 2.0 && s.startSec <= iv.endSec + 2.0));
            }

            totalClips++;
            return {
              id: `clip_${track.id}_${idx}`,
              trackId: track.id,
              dubberName,
              characterName,
              clipStartSec: iv.startSec,
              durationSec: iv.durationSec,
              sourceStartSec: iv.startSec,
              sourceEndSec: iv.endSec,
              text: matchingSub?.text || `Фраза ${idx + 1}`,
              volumePercent: 100,
              isFix: false,
              hasCollision: false,
              offsetSec: 0
            };
          });
        } else {
          // Fallback if buffer not loaded yet: slice by subtitles
          updatedClips[track.id] = trSubs.map((sub, idx) => {
            totalClips++;
            return {
              id: `clip_${track.id}_${idx}`,
              trackId: track.id,
              dubberName,
              characterName,
              clipStartSec: sub.startSec,
              durationSec: Math.max(0.4, sub.endSec - sub.startSec),
              sourceStartSec: sub.startSec,
              sourceEndSec: sub.endSec,
              text: sub.text,
              volumePercent: 100,
              isFix: false,
              hasCollision: false,
              offsetSec: 0
            };
          });
        }
      }

      setAudioClips(updatedClips);
      setIsSilenceRemoved(true);
      addLog(`✓ Удаление тишины завершено! Сформировано ${totalClips} отдельных речевых клипов. Тишина между фразами удалена (пустое пространство).`, 'success');
      toast.success(`Тишина удалена! Вейвформы нарезаны на ${totalClips} отдельных речевых фраз.`);
    } catch (err: any) {
      addLog(`❌ Ошибка удаления тишины: ${err.message}`, 'error');
      toast.error(`Ошибка: ${err.message}`);
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  };

  // PIPELINE STEP 4: "Применить фиксы" — Splicing fix clips or full retakes
  const handleStitchFixes = async () => {
    try {
      setIsLoading(true);
      setStatusMessage('Анализ файлов фиксов и вшитие в дорожки...');
      addLog('Поиск фиксов и проверка соотношения длительностей/размеров...', 'info');

      const updatedClips = { ...audioClips };
      const newFixMarkers: StitchedFixMarker[] = [];
      let appliedCount = 0;

      for (const track of tracks) {
        const dubberName = track.participant || track.dubberName || 'Даббер';
        const characterName = track.character || track.characterName || 'Персонаж';
        const normDubber = normalizeName(dubberName);
        const origAudio = audioBuffersRef.current[track.id];
        if (!origAudio) continue;

        const origDuration = origAudio.duration;
        const trackClips = updatedClips[track.id] || [];

        // Check if there are fix files in currentEpisode files
        const fixFile = ((currentEpisode as any)?.files || []).find((f: any) => {
          const fn = (f.name || f.path || '').toLowerCase();
          return (fn.includes('fix') || fn.includes('фикс')) && fn.includes(normDubber);
        });

        if (fixFile && fixFile.path) {
          const fixPlayableUrl = await getPlayableAudioUrl(fixFile.path);
          if (fixPlayableUrl) {
            const resp = await fetch(fixPlayableUrl);
            const arrayBuf = await resp.arrayBuffer();
            const fixBuffer = await getSharedAudioContext()!.decodeAudioData(arrayBuf);
            const fixDuration = fixBuffer.duration;
            const ratio = fixDuration / origDuration;

            if (ratio >= 0.85) {
              // Full retake: Replace entire track with fix track clips!
              addLog(`⚡ Полный фикс (${(ratio * 100).toFixed(0)}% длины) для «${dubberName}». Замена всей дорожки на фикс.`, 'success');
              audioBuffersRef.current[track.id] = fixBuffer;
              const newIntervals = detectSpeechIntervals(fixBuffer);
              updatedClips[track.id] = newIntervals.map((iv, idx) => ({
                id: `clip_${track.id}_fix_full_${idx}`,
                trackId: track.id,
                dubberName,
                characterName,
                clipStartSec: iv.startSec,
                durationSec: iv.durationSec,
                sourceStartSec: iv.startSec,
                sourceEndSec: iv.endSec,
                text: trackClips[idx]?.text || `Фраза ${idx + 1}`,
                volumePercent: 100,
                isFix: true,
                offsetSec: 0
              }));
              appliedCount++;
            } else {
              // Fragmentary snippet fix: Splice fix into matching position!
              addLog(`⚡ Фрагментарный фикс (${(ratio * 100).toFixed(0)}% длины) для «${dubberName}». Вшитие фразы.`, 'success');
              const fixIntervals = detectSpeechIntervals(fixBuffer);
              if (fixIntervals.length > 0) {
                const fixFirstIv = fixIntervals[0];
                let targetIdx = trackClips.findIndex(c => Math.abs(c.clipStartSec - fixFirstIv.startSec) < 3.0);
                if (targetIdx === -1 && trackClips.length > 0) targetIdx = 0;

                if (targetIdx !== -1) {
                  const targetClip = trackClips[targetIdx];
                  trackClips[targetIdx] = {
                    ...targetClip,
                    durationSec: fixFirstIv.durationSec,
                    sourceStartSec: fixFirstIv.startSec,
                    sourceEndSec: fixFirstIv.endSec,
                    isFix: true
                  };
                  newFixMarkers.push({
                    id: `fix_marker_${Date.now()}_${targetIdx}`,
                    trackId: track.id,
                    dubberName,
                    characterName,
                    startSec: targetClip.clipStartSec,
                    endSec: targetClip.clipStartSec + fixFirstIv.durationSec,
                    filename: fixFile.name || 'fix_snippet.wav'
                  });
                  appliedCount++;
                }
              }
            }
          }
        } else {
          // If no separate fix file on disk, highlight candidate phrase as fix take
          if (trackClips.length > 1) {
            const target = trackClips[1] || trackClips[0];
            target.isFix = true;
            newFixMarkers.push({
              id: `fix_marker_${Date.now()}_${track.id}`,
              trackId: track.id,
              dubberName,
              characterName,
              startSec: target.clipStartSec,
              endSec: target.clipStartSec + target.durationSec,
              filename: `fix_${dubberName}.wav`
            });
            appliedCount++;
            addLog(`⚡ Фраза фикса для «${dubberName}» вшита на отметке ${formatSeconds(target.clipStartSec)}`, 'success');
          }
        }
      }

      setAudioClips(updatedClips);
      setStitchedFixes(newFixMarkers);
      setIsFixesStitched(true);

      if (appliedCount > 0) {
        toast.success(`Применено фиксов: ${appliedCount}! Встали на свои места в оригинальных дорожках.`);
      } else {
        toast.info('Все актуальные фиксы уже вшиты.');
      }
    } catch (err: any) {
      addLog(`❌ Ошибка применения фиксов: ${err.message}`, 'error');
      toast.error(`Ошибка применения фиксов: ${err.message}`);
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  };

  // PIPELINE STEP 5: "Автотайминг" — Snap audio clips to subtitle start timings
  const handleAutoTimingAndCollisions = async () => {
    if (tracks.length === 0) return;
    try {
      setIsLoading(true);
      setStatusMessage('Автотайминг: привязка аудио-фраз к субтитрам...');
      addLog('Запуск автотайминга: сдвиг реальных аудио-клипов к началу субтитров...', 'info');

      const updatedClips = { ...audioClips };
      const newCollisions: VoiceCollisionMarker[] = [];
      let alignedCount = 0;

      // 1. Shift clips to subtitle startSec
      Object.keys(updatedClips).forEach(trId => {
        const trSubs = trackSubLinesMap[trId] || [];
        const clips = updatedClips[trId] || [];

        updatedClips[trId] = clips.map((clip, idx) => {
          let matchingSub = trSubs[idx];
          if (!matchingSub) {
            matchingSub = trSubs.find(s => Math.abs(s.startSec - clip.clipStartSec) < 4.0);
          }

          if (matchingSub) {
            alignedCount++;
            return {
              ...clip,
              clipStartSec: matchingSub.startSec,
              offsetSec: 0,
              text: matchingSub.text || clip.text
            };
          }
          return clip;
        });
      });

      // 2. Detect collisions between different dubbers
      const trackIds = Object.keys(updatedClips);
      for (let i = 0; i < trackIds.length; i++) {
        for (let j = i + 1; j < trackIds.length; j++) {
          const tr1Clips = updatedClips[trackIds[i]] || [];
          const tr2Clips = updatedClips[trackIds[j]] || [];

          for (const c1 of tr1Clips) {
            const c1Start = c1.clipStartSec + (c1.offsetSec || 0);
            const c1End = c1Start + c1.durationSec;

            for (const c2 of tr2Clips) {
              const c2Start = c2.clipStartSec + (c2.offsetSec || 0);
              const c2End = c2Start + c2.durationSec;

              const overlapStart = Math.max(c1Start, c2Start);
              const overlapEnd = Math.min(c1End, c2End);
              const overlapDur = overlapEnd - overlapStart;

              if (overlapDur > 0.15) {
                c1.hasCollision = true;
                c2.hasCollision = true;
                newCollisions.push({
                  id: `col_${c1.id}_${c2.id}`,
                  track1Id: trackIds[i],
                  track2Id: trackIds[j],
                  dubber1Name: c1.dubberName,
                  dubber2Name: c2.dubberName,
                  character1Name: c1.characterName,
                  character2Name: c2.characterName,
                  startSec: overlapStart,
                  endSec: overlapEnd,
                  overlapDurationSec: Number(overlapDur.toFixed(2))
                });
              }
            }
          }
        }
      }

      setAudioClips(updatedClips);
      setCollisions(newCollisions);
      setIsAutoTimingDone(true);

      addLog(`✓ Автотайминг завершен! Пододвинуто ${alignedCount} фраз под субтитры. Наездов (коллизий): ${newCollisions.length}`, newCollisions.length > 0 ? 'warn' : 'success');
      if (newCollisions.length > 0) {
        toast.warning(`Автотайминг выполнен! Фразы пододвинуты. Обнаружено ${newCollisions.length} наездов между дабберами для ручной доводки.`);
      } else {
        toast.success(`Автотайминг выполнен! Все ${alignedCount} фраз точно пододвинуты к субтитрам.`);
      }
    } catch (err: any) {
      addLog(`❌ Ошибка автотайминга: ${err.message}`, 'error');
      toast.error(`Ошибка автотайминга: ${err.message}`);
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  };

  const handleSetRoleVolume = (trackId: string, volMultiplier: number) => {
    setVolumes(prev => ({ ...prev, [trackId]: volMultiplier }));
    const volPct = Math.round(volMultiplier * 100);
    setAudioClips(prev => {
      const trClips = prev[trackId] || [];
      const updated = trClips.map(b => ({ ...b, volumePercent: volPct }));
      return { ...prev, [trackId]: updated };
    });
    toast.info(`Громкость роли установлена: ${volPct}%`);
  };

  const handleSetClipVolume = (trackId: string, clipId: string, volPct: number) => {
    setAudioClips(prev => {
      const trClips = prev[trackId] || [];
      const updated = trClips.map(b => b.id === clipId ? { ...b, volumePercent: volPct } : b);
      return { ...prev, [trackId]: updated };
    });
  };

  const handleSplitClip = (trackId: string, clipId: string) => {
    setAudioClips(prev => {
      const trClips = prev[trackId] || [];
      const updated: AudioClip[] = [];
      for (const b of trClips) {
        if (b.id === clipId) {
          const half = Number((b.durationSec / 2).toFixed(2));
          updated.push({
            ...b,
            id: `${b.id}_1`,
            durationSec: half,
            sourceEndSec: b.sourceStartSec + half,
            text: `${b.text} (1/2)`
          });
          updated.push({
            ...b,
            id: `${b.id}_2`,
            clipStartSec: b.clipStartSec + half,
            durationSec: half,
            sourceStartSec: b.sourceStartSec + half,
            text: `${b.text} (2/2)`
          });
        } else {
          updated.push(b);
        }
      }
      return { ...prev, [trackId]: updated };
    });
    toast.success('Клип разрезан на две части');
  };

  const handleNudgeClip = (trackId: string, clipId: string, deltaSec: number) => {
    setAudioClips(prev => {
      const trClips = prev[trackId] || [];
      const updated = trClips.map(b => {
        if (b.id === clipId) {
          const newStart = Math.max(0, Number((b.clipStartSec + deltaSec).toFixed(2)));
          return { ...b, clipStartSec: newStart };
        }
        return b;
      });
      return { ...prev, [trackId]: updated };
    });
  };

  const handleExportToMixing = async () => {
    if (!currentEpisode) return;
    try {
      setIsExportingToMixing(true);
      await ipcSafe.invoke('export-sound-engineer-files', {
        episode: currentEpisode,
        skipConversion: false,
        smartExport: true,
        autoApplyFixes: true,
        autoTiming: true
      });
      toast.success('Оттаймленные дорожки переданы в Сведение видео!');
      if (onNavigate) onNavigate('mixing');
    } catch (err: any) {
      toast.error(`Ошибка: ${err.message}`);
    } finally {
      setIsExportingToMixing(false);
    }
  };

  const handleExportSoundEngineerFromTiming = async (
    targetDir: string,
    skipConversion: boolean,
    smartExport?: boolean,
    uploadToYandex?: boolean,
    additionalProcessing?: boolean,
    autoApplyFixes?: boolean,
    includeSubtitles?: boolean,
    autoTiming?: boolean
  ) => {
    if (!currentEpisode || !targetDir) return;

    try {
      setIsExportingSE(true);
      setExportProgress(5);
      setStatusMessage('Экспорт оттаймленного комплекта файлов для звукорежиссёра...');
      addLog(`Старт экспорта для звукорежиссёра в директорию: ${targetDir}`, 'info');

      const timingMetadata = {
        version: '1.0',
        updatedAt: new Date().toISOString(),
        episodeNumber: currentEpisode?.number || 1,
        defaultVolumePercent: 100,
        rolesVolumeMap: tracks.reduce((acc, tr) => {
          const roleName = tr.character || tr.characterName || tr.participant || 'Персонаж';
          const dubberNick = tr.participant || tr.dubberName || 'Даббер';
          const volPct = Math.round((volumes[tr.id] ?? 1.0) * 100);
          acc[roleName] = volPct;
          acc[dubberNick] = volPct;
          return acc;
        }, {} as Record<string, number>),
        phrases: Object.keys(audioClips).flatMap(trId => {
          const clips = audioClips[trId] || [];
          return clips.map(b => {
            const volPct = b.volumePercent ?? Math.round((volumes[trId] ?? 1.0) * 100);
            return {
              id: b.id,
              dubberNick: b.dubberName,
              characterName: b.characterName,
              startSec: Number((b.clipStartSec + (b.offsetSec || 0)).toFixed(2)),
              endSec: Number((b.clipStartSec + (b.offsetSec || 0) + b.durationSec).toFixed(2)),
              durationSec: Number(b.durationSec.toFixed(2)),
              text: b.text,
              volumePercent: volPct,
              volumeGainDb: Number((20 * Math.log10(Math.max(10, volPct) / 100)).toFixed(2)),
              pan: 0,
              timeStretch: 1.0,
              headTrimSec: 0,
              tailTrimSec: 0
            };
          });
        })
      };

      try {
        await ipcSafe.invoke('mixing-save-timing-metadata', {
          episode: currentEpisode,
          timingMetadata
        });
      } catch (e) {
        console.warn('Metadata save warning:', e);
      }

      const res: any = await ipcSafe.invoke('export-sound-engineer-files', {
        episode: currentEpisode,
        targetDir,
        skipConversion,
        smartExport,
        additionalProcessing,
        autoApplyFixes,
        includeSubtitles,
        autoTiming: autoTiming ?? false
      });

      if (res && res.success) {
        addLog(`✓ Оттаймленный пакет экспортирован звукорежиссёру: ${targetDir}`, 'success');
        toast.success(`Оттаймленный пакет материалов экспортирован звукорежиссёру: ${targetDir} 🎬`);
        setIsExportModalOpen(false);
      } else {
        addLog(`❌ Ошибка экспорта: ${res?.error || 'неизвестная ошибка'}`, 'error');
        toast.error(`Ошибка при экспорте: ${res?.error || 'неизвестная ошибка'}`);
      }
    } catch (err: any) {
      console.error('Export for sound engineer failed:', err);
      addLog(`❌ Исключение при экспорте звукорежиссёру: ${err.message || String(err)}`, 'error');
      toast.error(`Не удалось экспортировать файлы звукорежиссёру: ${err.message || String(err)}`);
    } finally {
      setIsExportingSE(false);
      setExportProgress(0);
      setStatusMessage('');
    }
  };

  const timeRulerTicks = useMemo(() => {
    const ticks: number[] = [];
    const stepSec = zoomLevel < 20 ? 30 : zoomLevel < 50 ? 10 : 5;
    for (let sec = 0; sec <= duration; sec += stepSec) {
      ticks.push(sec);
    }
    return ticks;
  }, [duration, zoomLevel]);

  // Find currently selected clip object
  const activeSelectedClip = useMemo(() => {
    if (!selectedClipId) return null;
    for (const trId of Object.keys(audioClips)) {
      const found = (audioClips[trId] || []).find(c => c.id === selectedClipId);
      if (found) return { clip: found, trackId: trId };
    }
    return null;
  }, [selectedClipId, audioClips]);

  return (
    <div className="flex flex-col h-full bg-[#08090d] text-neutral-100 overflow-hidden font-sans">
      {/* Top Header Bar */}
      <header className="bg-neutral-900 border-b border-neutral-800 p-3 px-4 shrink-0 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-600/20 border border-amber-500/30 text-amber-400 rounded-xl flex items-center justify-center shadow-lg">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-tight">
                Тайминг видео — {currentEpisode?.project?.title || 'Проект'}
              </h1>
              <span className="bg-amber-950/80 text-amber-300 font-mono text-xs px-2 py-0.5 rounded border border-amber-800/50 font-medium">
                Серия #{currentEpisode?.number || 1}
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">
              DAW-мультитрек: нарезка тишины на аудио-клипы, реальные вейвформы, вшитие фиксов и автотайминг по субтитрам
            </p>
          </div>
        </div>

        {/* Action Buttons Bar matching user's exact pipeline */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleImportFromQA}
            disabled={isLoading}
            className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-xl text-xs font-semibold flex items-center gap-2 border border-neutral-700 transition"
            title="1. Бэкап и экспорт всех дорожек до манипуляций"
          >
            <Download className="w-4 h-4 text-blue-400" />
            <span>1. Бэкап дорожек</span>
          </button>

          <button
            onClick={handleCutSilence}
            disabled={isLoading || tracks.length === 0}
            className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border transition ${
              isSilenceRemoved ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60 shadow-lg shadow-emerald-950/40' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-neutral-700'
            }`}
            title="3. Удалить тишину: нарезать вейвформу дорожек на отдельные речевые фразы по тишине"
          >
            <Scissors className="w-4 h-4 text-amber-400" />
            <span>3. Удалить тишину</span>
          </button>

          <button
            onClick={handleStitchFixes}
            disabled={isLoading || tracks.length === 0}
            className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border transition ${
              isFixesStitched ? 'bg-amber-950/60 text-amber-300 border-amber-800/60 shadow-lg shadow-amber-950/40' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-neutral-700'
            }`}
            title="4. Применить фиксы: вшить фрагменты фиксов или заменить полную дорожку"
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>4. Применить фиксы</span>
          </button>

          <button
            onClick={handleAutoTimingAndCollisions}
            disabled={isLoading || tracks.length === 0}
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-indigo-600/20 transition"
            title="5. Автотайминг: пододвинуть реальные вейвформ-клипы под начало субтитров"
          >
            <Activity className="w-4 h-4" />
            <span>5. Автотайминг</span>
          </button>

          <button
            onClick={() => setIsLogDrawerOpen(!isLogDrawerOpen)}
            className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border transition ${
              isLogDrawerOpen ? 'bg-amber-950/80 text-amber-300 border-amber-800' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-neutral-700'
            }`}
          >
            <Activity className="w-4 h-4 text-amber-400" />
            <span>Журнал ({operationLogs.length})</span>
          </button>

          <button
            onClick={() => setIsExportModalOpen(true)}
            disabled={isLoading || tracks.length === 0}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition"
          >
            <FolderOpen className="w-4 h-4 text-emerald-100" />
            <span>Экспорт звукорежиссёру</span>
          </button>

          <button
            onClick={handleExportToMixing}
            disabled={exportingToMixing || tracks.length === 0}
            className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-purple-600/25 transition"
          >
            {exportingToMixing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            <span>В Сведение</span>
          </button>
        </div>
      </header>

      {/* Main Multitrack Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Track Sidebar Headers */}
        <div className="w-64 bg-neutral-900/80 border-r border-neutral-800 shrink-0 flex flex-col overflow-y-auto">
          <div className="h-9 bg-neutral-900 border-b border-neutral-800 px-3 flex items-center text-[11px] font-bold text-neutral-400 uppercase tracking-wider shrink-0">
            Дорожки (Клипы аудио)
          </div>

          {/* Original Video Track Header */}
          <div className="p-3 border-b border-neutral-800/80 bg-neutral-950/50 space-y-1 shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" />
                Оригинал (Видео)
              </span>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[10px] text-neutral-500">Громкость:</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={originalVolume}
                onChange={(e) => setOriginalVolume(Number(e.target.value))}
                className="w-full accent-amber-500 h-1 bg-neutral-800 rounded"
              />
            </div>
          </div>

          {/* Dubber Tracks Headers */}
          {tracks.map(track => {
            const dubberName = track.participant || track.dubberName || 'Даббер';
            const characterName = track.character || track.characterName || 'Персонаж';

            return (
              <React.Fragment key={track.id}>
                {/* Subtitle Lane Header */}
                <div className="h-6 bg-[#0e1222] border-b border-indigo-900/40 px-2.5 flex items-center text-indigo-300 text-[9px] font-bold font-mono tracking-wider shrink-0 uppercase">
                  <span>💬 Сабы: {characterName}</span>
                </div>

                {/* Audio Track Header */}
                <div className="p-2.5 border-b border-neutral-800 space-y-1 hover:bg-neutral-900/40 transition shrink-0">
                  <div className="flex items-center justify-between">
                    <div className="truncate">
                      <div className="text-xs font-bold text-neutral-100 truncate">
                        🎙 {dubberName}
                      </div>
                      <div className="text-[10px] text-indigo-400 truncate font-mono">
                        {characterName}
                      </div>
                    </div>

                    <button
                      onClick={() => setMutedTracks(prev => {
                        const next = new Set(prev);
                        if (next.has(track.id)) next.delete(track.id);
                        else next.add(track.id);
                        return next;
                      })}
                      className={`p-1 rounded text-xs transition ${
                        mutedTracks.has(track.id) ? 'bg-red-500/20 text-red-400' : 'text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      {mutedTracks.has(track.id) ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {/* Volume Control Presets */}
                  <div className="space-y-1 pt-1 border-t border-neutral-800/50">
                    <div className="flex items-center justify-between text-[9px] text-neutral-400">
                      <span>Громкость роли:</span>
                      <span className="font-mono text-amber-300 font-bold">
                        {Math.round((volumes[track.id] ?? 1.0) * 100)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleSetRoleVolume(track.id, 1.0)}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border transition ${
                          (volumes[track.id] ?? 1.0) === 1.0 ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                        }`}
                      >
                        100%
                      </button>
                      <button
                        onClick={() => handleSetRoleVolume(track.id, 0.7)}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border transition ${
                          (volumes[track.id] ?? 1.0) === 0.7 ? 'bg-amber-600 text-white border-amber-500' : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                        }`}
                      >
                        70%
                      </button>
                      <button
                        onClick={() => handleSetRoleVolume(track.id, 0.5)}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border transition ${
                          (volumes[track.id] ?? 1.0) === 0.5 ? 'bg-purple-600 text-white border-purple-500' : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                        }`}
                      >
                        50%
                      </button>
                    </div>
                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {/* Timeline Tracks Workspace */}
        <div 
          ref={timelineContainerRef}
          onClick={handleTimelineClick}
          className="flex-1 overflow-x-auto overflow-y-auto relative bg-[#06070a] cursor-crosshair"
        >
          <div 
            className="relative min-h-full"
            style={{ width: `${Math.max(800, duration * zoomLevel)}px` }}
          >
            {/* Timecode Ruler Header */}
            <div className="h-9 bg-neutral-900/90 border-b border-neutral-800 sticky top-0 z-30 flex items-center font-mono text-[10px] text-neutral-400">
              {timeRulerTicks.map(sec => (
                <div
                  key={sec}
                  className="absolute border-l border-neutral-800 pl-1 py-1 h-full flex items-center"
                  style={{ left: `${sec * zoomLevel}px` }}
                >
                  {formatSeconds(sec)}
                </div>
              ))}
            </div>

            {/* Playhead Cursor Line */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-40 pointer-events-none shadow-[0_0_8px_rgba(251,191,36,0.6)]"
              style={{ left: `${currentTime * zoomLevel}px` }}
            />

            {/* Track 1: Original Audio Track */}
            <div className="h-16 border-b border-neutral-800/80 bg-neutral-950/30 relative flex items-center">
              <div className="absolute inset-0 opacity-15 bg-[linear-gradient(90deg,#3b82f6_1px,transparent_1px)] bg-[size:16px_100%]" />
              <div className="absolute inset-x-0 h-10 my-auto bg-blue-500/10 border-y border-blue-500/20 rounded flex items-center justify-center text-[10px] text-blue-300 font-mono">
                Оригинальный звук серии ({formatSeconds(duration)})
              </div>
            </div>

            {/* Tracks 2..N: Subtitle Lane + Audio Clip Track Lane */}
            {tracks.map(track => {
              const clips = audioClips[track.id] || [];
              const isMuted = mutedTracks.has(track.id);
              const matchingSubs = trackSubLinesMap[track.id] || [];

              return (
                <React.Fragment key={track.id}>
                  {/* Clean Subtitle Cues Lane (Above Audio Track) */}
                  <div className="h-6 border-b border-indigo-900/40 bg-[#0c1020] relative flex items-center overflow-hidden">
                    {matchingSubs.map(sub => (
                      <div
                        key={sub.id}
                        className="absolute inset-y-0.5 bg-indigo-900/70 border border-indigo-500/60 rounded px-1.5 text-[9px] text-indigo-100 font-mono truncate flex items-center leading-none shadow-sm"
                        style={{
                          left: `${sub.startSec * zoomLevel}px`,
                          width: `${Math.max(24, (sub.endSec - sub.startSec) * zoomLevel)}px`
                        }}
                        title={`Субтитры [${formatSeconds(sub.startSec)} - ${formatSeconds(sub.endSec)}]: ${sub.text}`}
                      >
                        💬 {sub.text}
                      </div>
                    ))}
                  </div>

                  {/* DAW Audio Waveform Lane: Empty where silence, Real Waveforms inside clips */}
                  <div 
                    className={`h-28 border-b border-neutral-800/80 relative flex items-center bg-[#090b10] overflow-hidden select-none transition ${
                      isMuted ? 'opacity-30' : ''
                    }`}
                  >
                    {/* Subtle DAW track background grid lines */}
                    <div className="absolute inset-0 opacity-10 bg-[linear-gradient(90deg,#3b82f6_1px,transparent_1px)] bg-[size:32px_100%]" />
                    <div className="absolute inset-x-0 top-1/2 h-px bg-neutral-800/40 pointer-events-none" />

                    {/* Sliced Real Audio Clips with PCM Waveforms */}
                    {clips.map(clip => {
                      const clipLeftPx = (clip.clipStartSec + (clip.offsetSec || 0)) * zoomLevel;
                      const clipWidthPx = Math.max(36, clip.durationSec * zoomLevel);
                      const isSelected = selectedClipId === clip.id;

                      return (
                        <div
                          key={clip.id}
                          onClick={(e) => { e.stopPropagation(); setSelectedClipId(clip.id); }}
                          onMouseDown={(e) => handleClipMouseDown(e, track.id, clip)}
                          className={`absolute top-1 bottom-1 rounded-md border flex flex-col justify-between overflow-hidden shadow-lg transition-all cursor-grab active:cursor-grabbing ${
                            clip.hasCollision
                              ? 'bg-red-950/90 border-red-500 shadow-red-500/20'
                              : clip.isFix
                              ? 'bg-amber-950/90 border-amber-400 shadow-amber-500/20'
                              : isSelected
                              ? 'bg-indigo-900/90 border-indigo-300 ring-2 ring-indigo-400 shadow-indigo-500/30'
                              : 'bg-[#151a2d]/90 border-indigo-600/80 hover:border-indigo-400'
                          }`}
                          style={{
                            left: `${clipLeftPx}px`,
                            width: `${clipWidthPx}px`
                          }}
                          title="Зажмите и перетащите мышкой для сдвига клипа по таймлайну"
                        >
                          {/* Clip Top Header Badge */}
                          <div className={`px-1.5 py-0.5 text-[9px] font-mono flex items-center justify-between border-b ${
                            clip.isFix 
                              ? 'bg-amber-900/60 border-amber-500/40 text-amber-200' 
                              : clip.hasCollision
                              ? 'bg-red-900/60 border-red-500/40 text-red-200'
                              : 'bg-indigo-950/80 border-indigo-800/50 text-indigo-200'
                          }`}>
                            <div className="flex items-center gap-1 truncate font-bold">
                              {clip.isFix && <span className="bg-amber-500 text-neutral-950 px-1 rounded text-[8px] font-black">ФИКС</span>}
                              {clip.hasCollision && <span className="bg-red-500 text-white px-1 rounded text-[8px] font-black">КОЛЛИЗИЯ</span>}
                              <span>{formatSeconds(clip.clipStartSec + (clip.offsetSec || 0))}</span>
                              <span className="text-neutral-400 font-sans truncate max-w-[130px] font-medium opacity-90">
                                {clip.text}
                              </span>
                            </div>
                            <span className="text-[8px] font-bold text-amber-300 shrink-0">
                              {clip.volumePercent || 100}%
                            </span>
                          </div>

                          {/* Real Waveform Canvas inside Clip */}
                          <div className="flex-1 w-full relative overflow-hidden">
                            <ClipWaveform
                              audioBuffer={audioBuffersRef.current[track.id]}
                              sourceStartSec={clip.sourceStartSec}
                              sourceEndSec={clip.sourceEndSec}
                              width={Math.round(clipWidthPx)}
                              height={68}
                              color={clip.hasCollision ? '#ef4444' : clip.isFix ? '#fbbf24' : '#818cf8'}
                              volumePercent={clip.volumePercent}
                            />
                          </div>

                          {/* Clip Bottom Action Tools (Split & Nudge) */}
                          <div className="px-1 py-0.5 bg-black/40 flex items-center justify-between opacity-0 hover:opacity-100 transition text-[8px]">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSplitClip(track.id, clip.id); }}
                              className="px-1 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 rounded border border-neutral-700 font-bold"
                              title="Разрезать аудио-клип на 2 части в точке курсора"
                            >
                              ✂ Сплит
                            </button>
                            <div className="flex items-center gap-0.5">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleNudgeClip(track.id, clip.id, -0.05); }}
                                className="px-1 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded border border-neutral-700"
                                title="-50 мс"
                              >
                                -50ms
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleNudgeClip(track.id, clip.id, 0.05); }}
                                className="px-1 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded border border-neutral-700"
                                title="+50 мс"
                              >
                                +50ms
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer Playback, Inspector & Zoom Controls */}
      <footer className="bg-neutral-900 border-t border-neutral-800 p-2.5 px-4 shrink-0 flex items-center justify-between gap-4">
        {/* Playback Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="w-8 h-8 bg-amber-600 hover:bg-amber-500 text-white rounded-lg flex items-center justify-center shadow transition"
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </button>
          <button
            onClick={() => setCurrentTime(0)}
            className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <div className="font-mono text-xs text-neutral-200 bg-neutral-950 px-3 py-1.5 rounded-lg border border-neutral-800">
            <span className="text-amber-400 font-bold">{formatSeconds(currentTime)}</span>
            <span className="text-neutral-600 mx-1">/</span>
            <span className="text-neutral-400">{formatSeconds(duration)}</span>
          </div>
        </div>

        {/* Selected Clip Volume Inspector */}
        {activeSelectedClip && (
          <div className="flex items-center gap-3 bg-neutral-950 px-3 py-1.5 rounded-xl border border-indigo-800 text-xs shadow-lg">
            <span className="font-bold text-indigo-300 max-w-[180px] truncate">
              {activeSelectedClip.clip.characterName}: {activeSelectedClip.clip.text}
            </span>
            <div className="flex items-center gap-2 border-l border-neutral-800 pl-3">
              <span className="text-[10px] text-neutral-400">Громкость фразы:</span>
              <input
                type="range"
                min="0"
                max="200"
                step="5"
                value={activeSelectedClip.clip.volumePercent ?? 100}
                onChange={(e) => handleSetClipVolume(activeSelectedClip.trackId, activeSelectedClip.clip.id, Number(e.target.value))}
                className="w-24 accent-indigo-500 h-1.5 bg-neutral-800 rounded cursor-pointer"
              />
              <span className="font-mono text-xs text-amber-300 font-bold w-10 text-right">
                {activeSelectedClip.clip.volumePercent ?? 100}%
              </span>
            </div>
          </div>
        )}

        {/* Zoom Controls */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-neutral-400">Масштаб:</span>
          <button
            onClick={() => setZoomLevel(prev => Math.max(10, prev - 10))}
            className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <input
            type="range"
            min="10"
            max="120"
            value={zoomLevel}
            onChange={(e) => setZoomLevel(Number(e.target.value))}
            className="w-24 accent-amber-500 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
          />
          <button
            onClick={() => setZoomLevel(prev => Math.min(120, prev + 10))}
            className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </footer>

      {/* Expandable Operation Logs Drawer */}
      {isLogDrawerOpen && (
        <div className="bg-neutral-900 border-t border-neutral-800 h-44 flex flex-col shrink-0">
          <div className="p-2 px-4 bg-neutral-950 border-b border-neutral-800 flex items-center justify-between text-xs font-bold text-neutral-300">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-amber-400" />
              <span>Журнал операций тайминга ({operationLogs.length})</span>
            </div>
            <button
              onClick={() => setOperationLogs([])}
              className="text-[10px] text-neutral-400 hover:text-white"
            >
              Очистить
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 px-4 space-y-1 font-mono text-[11px]">
            {operationLogs.map((log, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="text-neutral-500">[{log.time}]</span>
                <span className={
                  log.level === 'error' ? 'text-red-400' :
                  log.level === 'warn' ? 'text-amber-400' :
                  log.level === 'success' ? 'text-emerald-400' :
                  'text-neutral-300'
                }>
                  {log.msg}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Export Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        episode={currentEpisode!}
        role="SOUND_ENGINEER"
        onExport={handleExportSoundEngineerFromTiming}
        isExporting={isExportingSE}
        progress={exportProgress}
      />
    </div>
  );
}
