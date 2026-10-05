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
  FileAudio,
  Settings
} from 'lucide-react';
import { toast } from 'sonner';
import { Episode, Track, SubtitleLine, RoleAssignment } from '../types';
import { ipcSafe } from '../lib/ipcSafe';
import { getSharedAudioContext, ensureAudioContextResumed } from '../lib/qa/sharedAudioContext';
import { ExportModal } from './ExportModal';
import { TimingSettingsModal, TimingSettings, DEFAULT_TIMING_SETTINGS } from './TimingSettingsModal';
import { normalizeSpeechText } from '../lib/qa/whisperTextChecker';

/**
 * Calculates text similarity for Whisper speech vs. Subtitle text
 * Word-level Dice coefficient with prefix/stem matching for Russian morphology.
 */
function calculateTextSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0;
  const norm1 = normalizeSpeechText(text1);
  const norm2 = normalizeSpeechText(text2);
  if (!norm1 || !norm2) return 0;
  if (norm1 === norm2) return 1.0;
  if (norm1.includes(norm2) || norm2.includes(norm1)) return 0.9;

  const words1 = norm1.split(' ').filter(Boolean);
  const words2 = norm2.split(' ').filter(Boolean);
  if (words1.length === 0 || words2.length === 0) return 0;

  let common = 0;
  for (const w of words1) {
    if (words2.includes(w)) {
      common += 1.0;
    } else {
      const stem = w.slice(0, Math.min(5, w.length));
      if (stem.length >= 4 && words2.some(w2 => w2.startsWith(stem))) {
        common += 0.8;
      }
    }
  }
  const dice = (2 * common) / (words1.length + words2.length);
  return Math.min(1.0, Math.max(0, dice));
}

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
 * Strips technical suffixes like [Дорожка 1], _дорожка2, [фикс] so that
 * dubber nicknames are always canonical and never duplicate.
 */
function cleanDubberNick(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '')
    .replace(/_дорожка\d+/gi, '')
    .replace(/\[(.*?)\]/g, (_m, inner) => {
      return inner.replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '').trim();
    })
    .replace(/[_\s-]+$/, '')
    .trim();
}

/**
 * Validates that candidate name is a legitimate person/character name,
 * and strictly filters out numeric artifacts (e.g. "0 3 4", "03_4", "123", timestamps, step IDs).
 */
function isValidDubberName(name: string): boolean {
  if (!name) return false;
  const clean = cleanDubberNick(name);
  if (!clean) return false;
  // Must contain at least one letter (Latin or Cyrillic)
  if (!/[a-zA-Zа-яА-ЯёЁ]/.test(clean)) return false;
  // Must not be a string made only of numbers, spaces, dots, underscores, dashes
  if (/^[\d\s._-]+$/.test(clean)) return false;
  const lower = clean.toLowerCase();
  if (['default', 'original', 'оригинал', 'серия', 'видео', 'sound', 'audio', 'master', 'mix', 'comment', 'шумы'].includes(lower)) return false;
  return true;
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

export interface NoiseCalibration {
  noiseFloorDb: number;
  speechFloorDb: number;
  speechPeakDb: number;
  calculatedThresholdDb: number;
  thresholdAmp: number;
  dynamicRangeDb: number;
  snrDb: number;
}

/**
 * Statistical Noise Floor & Speech Energy Analyzer.
 * Accurately analyzes the track before silence cutting to detect true ambient room noise,
 * speech dynamics, and safe threshold preventing clipping of quiet words or breaths.
 */
export function analyzeTrackAudioNoiseFloor(
  audioBuffer: AudioBuffer,
  manualThresholdDb?: number
): NoiseCalibration {
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const totalSamples = channelData.length;
  
  const windowSize = Math.max(128, Math.floor(sampleRate * 0.02)); // 20ms windows
  const totalWindows = Math.floor(totalSamples / windowSize);
  
  // Sample up to 12000 windows across the file for fast, ultra-accurate distribution
  const step = Math.max(1, Math.floor(totalWindows / 12000));
  const rmsDbValues: number[] = [];

  for (let w = 0; w < totalWindows; w += step) {
    const offset = w * windowSize;
    let sumSquares = 0;
    for (let j = 0; j < windowSize; j++) {
      const s = channelData[offset + j];
      sumSquares += s * s;
    }
    const rms = Math.sqrt(sumSquares / windowSize);
    const db = rms > 1e-5 ? 20 * Math.log10(rms) : -96;
    rmsDbValues.push(db);
  }

  if (rmsDbValues.length === 0) {
    return {
      noiseFloorDb: -60,
      speechFloorDb: -24,
      speechPeakDb: -6,
      calculatedThresholdDb: manualThresholdDb ?? -45,
      thresholdAmp: Math.pow(10, (manualThresholdDb ?? -45) / 20),
      dynamicRangeDb: 36,
      snrDb: 36
    };
  }

  rmsDbValues.sort((a, b) => a - b);
  const n = rmsDbValues.length;

  const noiseFloorDb = rmsDbValues[Math.floor(n * 0.15)]; // Room noise floor
  const speechFloorDb = rmsDbValues[Math.floor(n * 0.75)]; // Speech median
  const speechPeakDb = rmsDbValues[Math.floor(n * 0.98)];  // Speech peaks

  let calculatedThresholdDb: number;
  if (manualThresholdDb !== undefined && manualThresholdDb !== null && !isNaN(manualThresholdDb)) {
    calculatedThresholdDb = manualThresholdDb;
  } else {
    const snr = speechFloorDb - noiseFloorDb;
    if (snr > 14) {
      const margin = Math.min(8.0, Math.max(3.5, snr * 0.20));
      calculatedThresholdDb = Math.min(-34, noiseFloorDb + margin);
    } else {
      calculatedThresholdDb = Math.min(-32, noiseFloorDb + 2.5);
    }
    calculatedThresholdDb = Math.max(-65, Math.min(-30, calculatedThresholdDb));
  }

  const thresholdAmp = Math.pow(10, calculatedThresholdDb / 20);
  const dynamicRangeDb = Number((speechPeakDb - noiseFloorDb).toFixed(1));
  const snrDb = Number((speechFloorDb - noiseFloorDb).toFixed(1));

  return {
    noiseFloorDb: Number(noiseFloorDb.toFixed(1)),
    speechFloorDb: Number(speechFloorDb.toFixed(1)),
    speechPeakDb: Number(speechPeakDb.toFixed(1)),
    calculatedThresholdDb: Number(calculatedThresholdDb.toFixed(1)),
    thresholdAmp,
    dynamicRangeDb,
    snrDb
  };
}

/**
 * Speech interval detection algorithm on decoded AudioBuffer.
 * Identifies speech phrases and silences with noise calibration, intra-word pause smoothing,
 * and adaptive lead-in / lead-out padding so quiet consonants and breath tails are NEVER cut.
 */
function detectSpeechIntervals(
  audioBuffer: AudioBuffer,
  options: {
    minSilenceDurationSec?: number;
    leadInPaddingSec?: number;
    leadOutPaddingSec?: number;
    minSpeechDurationSec?: number;
    mergeCloseGapsSec?: number;
    manualThresholdDb?: number;
    onCalibration?: (calib: NoiseCalibration) => void;
  } = {}
): Array<{ startSec: number; endSec: number; durationSec: number }> {
  const {
    minSilenceDurationSec = 0.30,
    leadInPaddingSec = 0.15,
    leadOutPaddingSec = 0.22,
    minSpeechDurationSec = 0.20,
    mergeCloseGapsSec = 0.35,
    manualThresholdDb,
    onCalibration
  } = options;

  const calib = analyzeTrackAudioNoiseFloor(audioBuffer, manualThresholdDb);
  if (onCalibration) onCalibration(calib);

  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const totalSamples = channelData.length;
  const duration = audioBuffer.duration;
  const thresholdAmp = calib.thresholdAmp;

  const chunkSize = Math.max(128, Math.floor(sampleRate * 0.02)); // 20ms chunks
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

  // Smooth short micro-pauses inside words (e.g. stop consonants like p, t, k < mergeCloseGapsSec)
  const minSilenceChunks = Math.floor(mergeCloseGapsSec / 0.02);
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

  const rawIntervals: Array<{ startSec: number; endSec: number; durationSec: number }> = [];
  let inSpeech = false;
  let intervalStartSec = 0;

  for (let i = 0; i < totalChunks; i++) {
    const chunkTime = (i * chunkSize) / sampleRate;
    if (isSpeechChunk[i] === 1 && !inSpeech) {
      inSpeech = true;
      intervalStartSec = Math.max(0, chunkTime - leadInPaddingSec);
    } else if (isSpeechChunk[i] === 0 && inSpeech) {
      inSpeech = false;
      const intervalEndSec = Math.min(duration, chunkTime + leadOutPaddingSec);
      if (intervalEndSec - intervalStartSec >= minSpeechDurationSec) {
        rawIntervals.push({
          startSec: Number(intervalStartSec.toFixed(2)),
          endSec: Number(intervalEndSec.toFixed(2)),
          durationSec: Number((intervalEndSec - intervalStartSec).toFixed(2))
        });
      }
    }
  }

  if (inSpeech) {
    const intervalEndSec = duration;
    if (intervalEndSec - intervalStartSec >= minSpeechDurationSec) {
      rawIntervals.push({
        startSec: Number(intervalStartSec.toFixed(2)),
        endSec: Number(intervalEndSec.toFixed(2)),
        durationSec: Number((intervalEndSec - intervalStartSec).toFixed(2))
      });
    }
  }

  // Merge intervals if silence between them is less than minSilenceDurationSec
  const finalIntervals: Array<{ startSec: number; endSec: number; durationSec: number }> = [];
  for (const interval of rawIntervals) {
    if (finalIntervals.length === 0) {
      finalIntervals.push({ ...interval });
    } else {
      const last = finalIntervals[finalIntervals.length - 1];
      const gap = interval.startSec - last.endSec;
      if (gap < minSilenceDurationSec) {
        last.endSec = Math.max(last.endSec, interval.endSec);
        last.durationSec = Number((last.endSec - last.startSec).toFixed(2));
      } else {
        finalIntervals.push({ ...interval });
      }
    }
  }

  return finalIntervals;
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
  text: string;             // Dialogue text hint / matched subtitle
  recognizedText?: string;  // What Whisper recognized in this audio phrase
  whisperMatchedScore?: number; // Match confidence percentage (0-100)
  volumePercent: number;    // Gain % (0 - 200%)
  isFix?: boolean;          // Flag for spliced fix takes
  hasCollision?: boolean;   // Collision with another actor
  offsetSec: number;        // Manual mouse drag offset
  rawSourceStartSec?: number; // Detected start before any manual trim/expansion
  rawSourceEndSec?: number;   // Detected end before any manual trim/expansion
  isSelfOverlap?: boolean;    // Intentional parallel layer between 2 tracks of same dubber
  sourceAudioTrackId?: string; // Track ID of audio buffer if spliced from fix track
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

  // Timing & Silence Settings Modal
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [timingSettings, setTimingSettings] = useState<TimingSettings>(() => {
    try {
      const saved = localStorage.getItem('timing_settings');
      if (saved) return { ...DEFAULT_TIMING_SETTINGS, ...JSON.parse(saved) };
    } catch (e) {}
    return DEFAULT_TIMING_SETTINGS;
  });
  const [calibrationsByTrack, setCalibrationsByTrack] = useState<Record<string, NoiseCalibration>>({});

  const handleSaveSettings = (newSettings: TimingSettings) => {
    setTimingSettings(newSettings);
    try {
      localStorage.setItem('timing_settings', JSON.stringify(newSettings));
    } catch (e) {}
    toast.success('Настройки тайминга и удаления тишины сохранены!');
  };

  // Mouse Dragging & Resizing State for Clips (DAW-style trim and expand)
  const [draggingClip, setDraggingClip] = useState<{
    type: 'move' | 'resize-start' | 'resize-end';
    trackId: string;
    clipId: string;
    startMouseX: number;
    initialClipStartSec: number;
    initialDurationSec: number;
    initialSourceStartSec: number;
    initialSourceEndSec: number;
  } | null>(null);

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
  const timeRulerContainerRef = useRef<HTMLDivElement | null>(null);
  const unifiedScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const audioElementsRef = useRef<Record<string, HTMLAudioElement>>({});
  const audioBuffersRef = useRef<Record<string, AudioBuffer>>({});

  // Synchronize Horizontal Scrolling from Timeline to Timecode Ruler
  const handleTimelineHorizontalScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (timeRulerContainerRef.current) {
      timeRulerContainerRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  }, []);

  // Handle mouse wheel scrolling: unified vertical scrolling and horizontal scrolling
  const handleTimelineWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      if (timelineContainerRef.current) {
        timelineContainerRef.current.scrollLeft += (e.deltaX || e.deltaY);
        if (timeRulerContainerRef.current) {
          timeRulerContainerRef.current.scrollLeft = timelineContainerRef.current.scrollLeft;
        }
      }
    } else if (e.deltaY !== 0) {
      if (unifiedScrollContainerRef.current) {
        unifiedScrollContainerRef.current.scrollTop += e.deltaY;
      }
    }
  }, []);

  const handleSidebarWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY !== 0 && unifiedScrollContainerRef.current) {
      unifiedScrollContainerRef.current.scrollTop += e.deltaY;
    }
  }, []);

  const handleSwitchTrackFile = async (trackId: string, newPath: string) => {
    setTracks(prev => prev.map(tr => {
      if (tr.id === trackId) {
        const fileObj = tr.files?.find(f => f.path === newPath);
        return {
          ...tr,
          filePath: newPath,
          selectedFileId: fileObj?.id
        };
      }
      return tr;
    }));

    if (currentEpisode) {
      localStorage.setItem(`selectedFile_${currentEpisode.id}_${trackId.replace(/^track_/, '')}`, newPath);
    }

    const sharedAudioCtx = getSharedAudioContext();
    const playableUrl = await getPlayableAudioUrl(newPath);
    if (playableUrl && sharedAudioCtx) {
      const audio = new Audio(playableUrl);
      audio.preload = 'metadata';
      audioElementsRef.current[trackId] = audio;
      try {
        const resp = await fetch(playableUrl);
        const arrayBuf = await resp.arrayBuffer();
        const decodedBuf = await sharedAudioCtx.decodeAudioData(arrayBuf);
        audioBuffersRef.current[trackId] = decodedBuf;
        const tr = tracks.find(t => t.id === trackId);
        if (tr) {
          const intervals = detectSpeechIntervals(decodedBuf, {
            minSilenceDurationSec: timingSettings.minSilenceDurationSec,
            leadInPaddingSec: timingSettings.leadInPaddingSec,
            leadOutPaddingSec: timingSettings.leadOutPaddingSec,
            minSpeechDurationSec: timingSettings.minSpeechDurationSec,
            mergeCloseGapsSec: timingSettings.mergeCloseGapsSec,
            manualThresholdDb: timingSettings.autoAnalyzeNoiseFloor ? undefined : timingSettings.silenceThresholdDb
          });
          const dubberName = tr.participant || tr.dubberName || 'Даббер';
          const characterName = tr.character || tr.characterName || 'Персонаж';
          const trSubs = trackSubLinesMap[tr.id] || [];

          let newClips: AudioClip[] = [];
          if (intervals.length > 0) {
            newClips = intervals.map((inv, idx) => {
              const matchedSub = trSubs.find(s => Math.abs(s.startSec - inv.startSec) < 3.0);
              return {
                id: `clip_${tr.id}_sw_${idx}_${Date.now()}`,
                trackId: tr.id,
                dubberName,
                characterName,
                clipStartSec: inv.startSec,
                durationSec: inv.durationSec,
                sourceStartSec: inv.startSec,
                sourceEndSec: inv.endSec,
                text: matchedSub?.text || `${characterName}: Фраза #${idx + 1}`,
                volumePercent: 100,
                isFix: false,
                hasCollision: false,
                offsetSec: 0
              };
            });
          } else {
            newClips = [{
              id: `clip_${tr.id}_full_${Date.now()}`,
              trackId: tr.id,
              dubberName,
              characterName,
              clipStartSec: 0,
              durationSec: decodedBuf.duration,
              sourceStartSec: 0,
              sourceEndSec: decodedBuf.duration,
              text: `Полная запись: ${dubberName}`,
              volumePercent: 100,
              isFix: false,
              hasCollision: false,
              offsetSec: 0
            }];
          }
          setAudioClips(prev => ({ ...prev, [trackId]: newClips }));
        }
        toast.success(`Переключено на версию: ${newPath.split(/[/\\]/).pop()}`);
      } catch (err) {
        console.error('Failed to decode switched file', err);
      }
    }
  };

  // Mouse Dragging & Resizing (DAW Trim/Expand into Silence)
  useEffect(() => {
    if (!draggingClip) return;
    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - draggingClip.startMouseX;
      const deltaSec = deltaX / zoomLevel;

      if (draggingClip.type === 'move') {
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
      } else if (draggingClip.type === 'resize-start') {
        // Dragging left (deltaSec < 0) -> expands earlier into source audio from silence!
        // Dragging right (deltaSec > 0) -> trims start inwards!
        const maxBackwardsExpandSec = draggingClip.initialSourceStartSec;
        const clampedDelta = Math.max(-maxBackwardsExpandSec, deltaSec);
        const maxTrimInwards = draggingClip.initialDurationSec - 0.10;
        const finalDelta = Math.min(maxTrimInwards, clampedDelta);

        const newClipStart = Math.max(0, Number((draggingClip.initialClipStartSec + finalDelta).toFixed(2)));
        const newSourceStart = Math.max(0, Number((draggingClip.initialSourceStartSec + finalDelta).toFixed(2)));
        const newDuration = Math.max(0.10, Number((draggingClip.initialDurationSec - finalDelta).toFixed(2)));

        setAudioClips(prev => {
          const trClips = prev[draggingClip.trackId] || [];
          const updated = trClips.map(clip => {
            if (clip.id === draggingClip.clipId) {
              return {
                ...clip,
                clipStartSec: newClipStart,
                sourceStartSec: newSourceStart,
                durationSec: newDuration,
                sourceEndSec: Number((newSourceStart + newDuration).toFixed(2)),
                offsetSec: 0
              };
            }
            return clip;
          });
          return { ...prev, [draggingClip.trackId]: updated };
        });
      } else if (draggingClip.type === 'resize-end') {
        // Dragging right (deltaSec > 0) -> expands tail forwards into un-cut audio!
        // Dragging left (deltaSec < 0) -> trims tail inwards!
        const trackBuffer = audioBuffersRef.current[draggingClip.trackId];
        const maxSourceDuration = trackBuffer ? trackBuffer.duration : 3600;
        const maxForwardsExpandSec = Math.max(0, maxSourceDuration - draggingClip.initialSourceEndSec);

        const clampedDelta = Math.min(maxForwardsExpandSec, deltaSec);
        const maxTrimBackwards = -(draggingClip.initialDurationSec - 0.10);
        const finalDelta = Math.max(maxTrimBackwards, clampedDelta);

        const newDuration = Math.max(0.10, Number((draggingClip.initialDurationSec + finalDelta).toFixed(2)));
        const newSourceEnd = Math.min(maxSourceDuration, Number((draggingClip.initialSourceEndSec + finalDelta).toFixed(2)));

        setAudioClips(prev => {
          const trClips = prev[draggingClip.trackId] || [];
          const updated = trClips.map(clip => {
            if (clip.id === draggingClip.clipId) {
              return {
                ...clip,
                durationSec: newDuration,
                sourceEndSec: newSourceEnd
              };
            }
            return clip;
          });
          return { ...prev, [draggingClip.trackId]: updated };
        });
      }
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
      type: 'move',
      trackId,
      clipId: clip.id,
      startMouseX: e.clientX,
      initialClipStartSec: clip.clipStartSec + (clip.offsetSec || 0),
      initialDurationSec: clip.durationSec,
      initialSourceStartSec: clip.sourceStartSec,
      initialSourceEndSec: clip.sourceEndSec
    });
  };

  const handleResizeMouseDown = (e: React.MouseEvent, trackId: string, clip: AudioClip, edge: 'start' | 'end') => {
    e.stopPropagation();
    setSelectedClipId(clip.id);
    setDraggingClip({
      type: edge === 'start' ? 'resize-start' : 'resize-end',
      trackId,
      clipId: clip.id,
      startMouseX: e.clientX,
      initialClipStartSec: clip.clipStartSec + (clip.offsetSec || 0),
      initialDurationSec: clip.durationSec,
      initialSourceStartSec: clip.sourceStartSec,
      initialSourceEndSec: clip.sourceEndSec
    });
  };

  const handleExpandClip = (trackId: string, clipId: string, side: 'start' | 'end', deltaSec: number) => {
    setAudioClips(prev => {
      const trClips = prev[trackId] || [];
      const trackBuffer = audioBuffersRef.current[trackId];
      const maxSourceDuration = trackBuffer ? trackBuffer.duration : 3600;

      const updated = trClips.map(clip => {
        if (clip.id === clipId) {
          if (side === 'start') {
            const actualDelta = Math.min(clip.sourceStartSec, deltaSec);
            const newClipStart = Math.max(0, Number((clip.clipStartSec - actualDelta).toFixed(2)));
            const newSourceStart = Math.max(0, Number((clip.sourceStartSec - actualDelta).toFixed(2)));
            const newDuration = Number((clip.durationSec + actualDelta).toFixed(2));
            return {
              ...clip,
              clipStartSec: newClipStart,
              sourceStartSec: newSourceStart,
              durationSec: newDuration,
              sourceEndSec: Number((newSourceStart + newDuration).toFixed(2))
            };
          } else {
            const availableEnd = Math.max(0, maxSourceDuration - clip.sourceEndSec);
            const actualDelta = Math.min(availableEnd, deltaSec);
            const newDuration = Number((clip.durationSec + actualDelta).toFixed(2));
            const newSourceEnd = Number((clip.sourceEndSec + actualDelta).toFixed(2));
            return {
              ...clip,
              durationSec: newDuration,
              sourceEndSec: newSourceEnd
            };
          }
        }
        return clip;
      });
      return { ...prev, [trackId]: updated };
    });
    toast.success(`Клип расширен на +${deltaSec}с (${side === 'start' ? 'начало' : 'хвост'})`);
  };

  const handleResetClipToOriginal = (trackId: string, clipId: string) => {
    setAudioClips(prev => {
      const trClips = prev[trackId] || [];
      const updated = trClips.map(clip => {
        if (clip.id === clipId && clip.rawSourceStartSec !== undefined && clip.rawSourceEndSec !== undefined) {
          const origDur = Math.max(0.1, clip.rawSourceEndSec - clip.rawSourceStartSec);
          return {
            ...clip,
            sourceStartSec: clip.rawSourceStartSec,
            sourceEndSec: clip.rawSourceEndSec,
            durationSec: origDur
          };
        }
        return clip;
      });
      return { ...prev, [trackId]: updated };
    });
    toast.info('Границы клипа сброшены к начальной детекции');
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

      // 2. Fetch Dubber Tracks from Manifest or Sound Engineer Files
      const statusRes: any = await ipcSafe.invoke('mixing-get-status', { episode: currentEpisode }).catch(() => null);
      let manifestDubberTracks = statusRes?.manifest?.sourceFiles?.dubberTracks || [];

      if (manifestDubberTracks.length === 0) {
        setStatusMessage('Экспорт и сборка файлов звукорежиссера из QA...');
        const importRes: any = await ipcSafe.invoke('mixing-import-sound-engineer-files', {
          episode: currentEpisode,
          autoApplyFixes: false,
          autoTiming: false
        }).catch(() => null);

        if (importRes?.manifest?.sourceFiles?.dubberTracks) {
          manifestDubberTracks = importRes.manifest.sourceFiles.dubberTracks;
        }
      }

      // Filter manifest tracks to exclude intermediate pipeline renders or numeric artifacts (e.g. 03_..., 04_..., 0 3 4)
      const cleanManifestTracks = manifestDubberTracks.filter((dt: any) => {
        const p = dt.path || '';
        const base = p.split(/[/\\]/).pop() || '';
        if (/^\d{1,2}_/.test(base) || /^[\d\s._-]+$/.test(base.replace(/\.[^.]+$/, ''))) {
          return false;
        }
        if (/master|glue|denoise|deepfilter|mix|compress|release|original_audio/i.test(base)) {
          return false;
        }
        const nick = (dt.dubberNick || '').trim();
        if (!nick || /^[\d\s._-]+$/.test(nick)) {
          return false;
        }
        return true;
      });

      const matchRes: any = await ipcSafe.invoke('match-actors-tracks', {
        episode: currentEpisode,
        audioFiles: cleanManifestTracks
      }).catch(() => null);

      const matchedList = matchRes?.matchedTracks || [];

      // Helper to check if a file or path represents a fix
      const isFixFile = (f: { name?: string; path?: string; type?: string } | string): boolean => {
        if (!f) return false;
        if (typeof f === 'string') return /fix|фикс/i.test(f);
        if (f.type === 'FIXES') return true;
        const str = `${f.name || ''} ${f.path || ''}`.toLowerCase();
        return str.includes('fix') || str.includes('фикс');
      };

      // Helper to match manifest files to actor
      const isActorFileMatch = (mt: any, actorNick: string): boolean => {
        const normActor = normalizeName(actorNick);
        if (!normActor) return false;
        const mtNick = normalizeName(cleanDubberNick(mt.dubberNick || ''));
        if (mtNick && (mtNick === normActor || mtNick.includes(normActor) || normActor.includes(mtNick))) {
          return true;
        }
        const base = normalizeName(cleanDubberNick((mt.name || mt.path || '').split(/[/\\]/).pop() || ''));
        return base.includes(normActor);
      };

      // Group actors and their associated characters & assignment IDs
      // STRICT: Actors are ONLY registered from assignments and real uploads, NEVER from file artifacts!
      const actorMap: Map<string, {
        normKey: string;
        dubberNick: string;
        dubberId?: string;
        assignmentIds: Set<string>;
        characters: Set<string>;
      }> = new Map();

      const registerActor = (rawNick: string, dubberId?: string, charName?: string, assignmentId?: string) => {
        const cleanNick = cleanDubberNick(rawNick) || rawNick.trim();
        if (!isValidDubberName(cleanNick)) return null;
        const normKey = normalizeName(cleanNick);
        if (!normKey) return null;

        if (!actorMap.has(normKey)) {
          actorMap.set(normKey, {
            normKey,
            dubberNick: cleanNick,
            dubberId,
            assignmentIds: new Set<string>(),
            characters: new Set<string>()
          });
        }
        const entry = actorMap.get(normKey)!;
        if (dubberId && !entry.dubberId) entry.dubberId = dubberId;
        if (charName) {
          const charParts = charName.split(/[,;\/]/).map(c => c.trim()).filter(Boolean);
          charParts.forEach(c => entry.characters.add(c));
        }
        if (assignmentId) entry.assignmentIds.add(assignmentId);
        return entry;
      };

      // 1. Collect all real actors from assignments
      (currentEpisode.assignments || []).forEach(as => {
        const dId = as.substituteId || as.dubberId;
        const rawNick = as.substitute?.nickname || as.dubber?.nickname || '';
        registerActor(rawNick, dId, as.characterName, as.id);
      });

      // 2. Also register any actors from uploads who might not have an explicit assignment record
      (currentEpisode.uploads || []).forEach(u => {
        if ((u.type === 'DUBBER_FILE' || u.type === 'FIXES') && u.path) {
          const rawNick = u.uploadedBy?.nickname || '';
          if (rawNick) {
            registerActor(rawNick, u.uploadedById, undefined, u.assignmentId);
          }
        }
      });

      // Now for each distinct actor, load ALL distinct QA tracks (Take 1, Take 2, Fix 1, Fix 2)
      // guaranteeing NO duplicate files are ever loaded!
      const fetchedTracks: Track[] = [];
      const globalUsedPaths = new Set<string>();

      Array.from(actorMap.values()).forEach(actor => {
        const { normKey, dubberNick, dubberId, assignmentIds } = actor;
        const charStr = Array.from(actor.characters).filter(Boolean).join(', ') || dubberNick;

        // A. Uploads from QA for this actor
        const uploadsForActor = (currentEpisode.uploads || []).filter(u => {
          if (!u.path || (u.type !== 'DUBBER_FILE' && u.type !== 'FIXES')) return false;
          if (u.assignmentId && assignmentIds.has(u.assignmentId)) return true;
          if (dubberId && (u.uploadedById === dubberId || (u as any).dubberId === dubberId)) return true;
          const uNick = normalizeName(cleanDubberNick(u.uploadedBy?.nickname || ''));
          return uNick && uNick === normKey;
        }).sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());

        const uploadsMain = uploadsForActor.filter(u => !isFixFile(u));
        const uploadsFixes = uploadsForActor.filter(u => isFixFile(u));

        // B. Manifest files for this actor in 00_исходные
        const manifestForActor = cleanManifestTracks.filter((mt: any) => isActorFileMatch(mt, dubberNick));
        const manifestMain = manifestForActor
          .filter((mt: any) => !isFixFile(mt))
          .sort((a: any, b: any) => {
            const aStr = a.name || a.path || '';
            const bStr = b.name || b.path || '';
            const aNum = (aStr.match(/дорожка(\d+)/i) || [])[1] || '1';
            const bNum = (bStr.match(/дорожка(\d+)/i) || [])[1] || '1';
            return parseInt(aNum, 10) - parseInt(bNum, 10);
          });

        const manifestFixes = manifestForActor
          .filter((mt: any) => isFixFile(mt))
          .sort((a: any, b: any) => {
            const aStr = a.name || a.path || '';
            const bStr = b.name || b.path || '';
            const aNum = (aStr.match(/фикс(\d+)/i) || [])[1] || '1';
            const bNum = (bStr.match(/фикс(\d+)/i) || [])[1] || '1';
            return parseInt(aNum, 10) - parseInt(bNum, 10);
          });

        // C. Select distinct physical files:
        // Main files:
        const finalMainFiles: Array<{ id: string; name: string; path: string; isFix: boolean }> = [];
        if (manifestMain.length > 0) {
          manifestMain.forEach((m: any, idx: number) => {
            if (!globalUsedPaths.has(m.path)) {
              globalUsedPaths.add(m.path);
              finalMainFiles.push({
                id: m.id || m.path,
                name: m.name || m.path.split(/[/\\]/).pop() || `Дорожка ${idx + 1}`,
                path: m.path,
                isFix: false
              });
            }
          });
          // If QA uploads has more main takes than manifest, append extra distinct takes
          if (uploadsMain.length > manifestMain.length) {
            for (let i = manifestMain.length; i < uploadsMain.length; i++) {
              const u = uploadsMain[i];
              if (!globalUsedPaths.has(u.path)) {
                globalUsedPaths.add(u.path);
                finalMainFiles.push({
                  id: u.id,
                  name: u.path.split(/[/\\]/).pop() || `Дорожка ${i + 1}`,
                  path: u.path,
                  isFix: false
                });
              }
            }
          }
        } else {
          uploadsMain.forEach((u, idx) => {
            if (!globalUsedPaths.has(u.path)) {
              globalUsedPaths.add(u.path);
              finalMainFiles.push({
                id: u.id,
                name: u.path.split(/[/\\]/).pop() || `Дорожка ${idx + 1}`,
                path: u.path,
                isFix: false
              });
            }
          });
        }

        // Fix files:
        const finalFixFiles: Array<{ id: string; name: string; path: string; isFix: boolean }> = [];
        if (manifestFixes.length > 0) {
          manifestFixes.forEach((m: any, idx: number) => {
            if (!globalUsedPaths.has(m.path)) {
              globalUsedPaths.add(m.path);
              finalFixFiles.push({
                id: m.id || m.path,
                name: m.name || m.path.split(/[/\\]/).pop() || `Фикс ${idx + 1}`,
                path: m.path,
                isFix: true
              });
            }
          });
          if (uploadsFixes.length > manifestFixes.length) {
            for (let i = manifestFixes.length; i < uploadsFixes.length; i++) {
              const u = uploadsFixes[i];
              if (!globalUsedPaths.has(u.path)) {
                globalUsedPaths.add(u.path);
                finalFixFiles.push({
                  id: u.id,
                  name: u.path.split(/[/\\]/).pop() || `Фикс ${i + 1}`,
                  path: u.path,
                  isFix: true
                });
              }
            }
          }
        } else {
          uploadsFixes.forEach((u, idx) => {
            if (!globalUsedPaths.has(u.path)) {
              globalUsedPaths.add(u.path);
              finalFixFiles.push({
                id: u.id,
                name: u.path.split(/[/\\]/).pop() || `Фикс ${idx + 1}`,
                path: u.path,
                isFix: true
              });
            }
          });
        }

        // D. Build tracks for this actor: Each distinct take/fix gets its own timeline lane!
        const totalActorTracks = finalMainFiles.length + finalFixFiles.length;
        if (totalActorTracks === 0) return;

        // Main takes:
        finalMainFiles.forEach((fileObj, mIdx) => {
          let label = dubberNick;
          if (finalMainFiles.length > 1) {
            label = `${dubberNick} [Дорожка ${mIdx + 1}]`;
          } else if (finalFixFiles.length > 0) {
            label = `${dubberNick} [Дорожка 1]`;
          }

          fetchedTracks.push({
            id: `track_${normKey}_main_${mIdx + 1}`,
            projectId: currentEpisode.projectId,
            episodeId: currentEpisode.id,
            participant: label,
            character: charStr,
            dubberName: dubberNick,
            characterName: charStr,
            filePath: fileObj.path,
            role: 'dubber',
            status: 'recorded' as Track['status'],
            files: [fileObj] as any,
            selectedFileId: fileObj.id
          });
        });

        // Fix takes:
        finalFixFiles.forEach((fixObj, fIdx) => {
          const fixLabel = finalFixFiles.length > 1
            ? `${dubberNick} [Фикс ${fIdx + 1}]`
            : `${dubberNick} [Фикс]`;

          fetchedTracks.push({
            id: `track_${normKey}_fix_${fIdx + 1}`,
            projectId: currentEpisode.projectId,
            episodeId: currentEpisode.id,
            participant: fixLabel,
            character: charStr,
            dubberName: dubberNick,
            characterName: charStr,
            filePath: fixObj.path,
            role: 'dubber',
            status: 'fixes_needed' as Track['status'],
            files: [fixObj] as any,
            selectedFileId: fixObj.id
          });
        });
      });

      setTracks(fetchedTracks);
      addLog(`Загружено ${fetchedTracks.length} дорожек дабберов (все слои и фиксы из QA под своими актерами, без дублей файлов).`, fetchedTracks.length > 0 ? 'success' : 'warn');

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

      // Group tracks by actor to distribute overlapping lines (Layer 2) and fixes cleanly
      const tracksByActor: Record<string, Track[]> = {};
      fetchedTracks.forEach(tr => {
        const actorKey = tr.dubberName || 'Даббер';
        if (!tracksByActor[actorKey]) tracksByActor[actorKey] = [];
        tracksByActor[actorKey].push(tr);
      });

      Object.entries(tracksByActor).forEach(([actorNick, actorTrks]) => {
        const firstTrk = actorTrks[0];
        const charName = firstTrk.character || firstTrk.characterName || 'Персонаж';

        let matchedLines = parsedLines.filter(line => 
          isSubtitleForCharacter(line.name, charName, actorNick, currentEpisode.assignments || [])
        ).sort((a, b) => a.startSec - b.startSec);

        if (matchedLines.length === 0 && (charName !== 'Персонаж' || actorNick !== 'Даббер')) {
          const normC = normalizeName(charName);
          const normD = normalizeName(actorNick);
          matchedLines = parsedLines.filter(line => {
            const normSub = normalizeName(line.name);
            return (normC && (normSub === normC || normSub.includes(normC))) ||
                   (normD && (normSub === normD || normSub.includes(normD)));
          }).sort((a, b) => a.startSec - b.startSec);
        }

        const mainTracks = actorTrks.filter(t => !t.id.includes('_fix_'));
        const fixTracks = actorTrks.filter(t => t.id.includes('_fix_'));

        // If actor has 2 main tracks (second track specifically for overlapping phrases)
        if (mainTracks.length >= 2) {
          const primaryLines: SubtitleLine[] = [];
          const overlapLines: SubtitleLine[] = [];

          matchedLines.forEach((line) => {
            const prevPrimary = primaryLines[primaryLines.length - 1];
            if (prevPrimary && line.startSec < prevPrimary.endSec) {
              overlapLines.push(line);
            } else {
              primaryLines.push(line);
            }
          });

          trackSubMap[mainTracks[0].id] = primaryLines;
          // Crucial: Track 2 ONLY gets genuinely overlapping phrases, never duplicating Track 1's list
          trackSubMap[mainTracks[1].id] = overlapLines;
        } else if (mainTracks.length === 1) {
          trackSubMap[mainTracks[0].id] = matchedLines;
        }

        // Fix tracks: only get their specific fix lines, NEVER duplicating the entire main subtitle list!
        if (fixTracks.length > 0) {
          const actorAssigns = (currentEpisode.assignments || []).filter(a => {
            const aNick = a.substitute?.nickname || a.dubber?.nickname || '';
            return normalizeName(aNick) === normalizeName(actorNick);
          });
          const commentTimestamps: number[] = [];
          actorAssigns.forEach(a => {
            if (a.comments) {
              try {
                const parsedComments = JSON.parse(a.comments);
                if (Array.isArray(parsedComments)) {
                  parsedComments.forEach(c => {
                    if (typeof c.timestamp === 'number') commentTimestamps.push(c.timestamp);
                  });
                }
              } catch (e) {}
            }
          });

          // Distinct fix candidate lines
          let candidateFixLines = commentTimestamps.length > 0
            ? matchedLines.filter(l => commentTimestamps.some(ts => Math.abs(l.startSec - ts) < 3.5 || (ts >= l.startSec && ts <= l.endSec)))
            : [];

          // If no specific QA timestamp flags found, provide distinct subsets for fixes, never cloning the entire main file
          if (candidateFixLines.length === 0) {
            candidateFixLines = matchedLines.slice(0, Math.min(3, matchedLines.length));
          }

          if (fixTracks.length === 1) {
            trackSubMap[fixTracks[0].id] = candidateFixLines;
          } else {
            // Split between Fix 1 and Fix 2 so neither has identical files/subtitles
            const mid = Math.ceil(candidateFixLines.length / 2);
            trackSubMap[fixTracks[0].id] = candidateFixLines.slice(0, mid);
            trackSubMap[fixTracks[1].id] = candidateFixLines.slice(mid);
          }
        }
      });

      fetchedTracks.forEach(tr => {
        const charName = tr.character || tr.characterName || 'Персонаж';
        const dubberName = tr.participant || tr.dubberName || 'Даббер';
        const trSubs = trackSubMap[tr.id] || [];
        const trackBuf = audioBuffersRef.current[tr.id];
        const trackDur = trackBuf ? trackBuf.duration : (trSubs[trSubs.length - 1]?.endSec || 100);

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
          isFix: tr.id.includes('_fix_'),
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

  // PIPELINE STEP 3: "Удалить тишину" — Real VAD Silence Cutting with Noise Floor Auto-Calibration on ALL tracks
  const handleCutSilence = async () => {
    if (tracks.length === 0) {
      toast.error('Нет загруженных дорожек');
      return;
    }
    try {
      setIsLoading(true);
      setStatusMessage('Авто-калибровка шума и удаление тишины на всех дорожках...');
      addLog('Запуск анализа энергии аудиосигнала и авто-калибровки шума/тишины перед нарезкой...', 'info');

      const updatedClips: Record<string, AudioClip[]> = {};
      let totalClips = 0;
      const newCalibrations: Record<string, NoiseCalibration> = {};

      for (const track of tracks) {
        let audioBuf = audioBuffersRef.current[track.id];
        const dubberName = track.participant || track.dubberName || 'Даббер';
        const characterName = track.character || track.characterName || 'Персонаж';
        const trSubs = trackSubLinesMap[track.id] || [];

        // If audio buffer not yet decoded in memory, decode it right now
        if (!audioBuf && track.filePath) {
          try {
            const pUrl = await getPlayableAudioUrl(track.filePath);
            if (pUrl) {
              const resp = await fetch(pUrl);
              const arrayBuf = await resp.arrayBuffer();
              const sharedAudioCtx = getSharedAudioContext();
              if (sharedAudioCtx) {
                audioBuf = await sharedAudioCtx.decodeAudioData(arrayBuf);
                audioBuffersRef.current[track.id] = audioBuf;
              }
            }
          } catch (decodeErr) {
            console.warn(`[SilenceCut] Ошибка декодирования ${track.id}:`, decodeErr);
          }
        }

        if (audioBuf) {
          // Detect speech intervals with automatic noise floor calibration and safety margins
          // "всегда фраза от тишины до тишины"
          const intervals = detectSpeechIntervals(audioBuf, {
            minSilenceDurationSec: timingSettings.minSilenceDurationSec,
            leadInPaddingSec: timingSettings.leadInPaddingSec,
            leadOutPaddingSec: timingSettings.leadOutPaddingSec,
            minSpeechDurationSec: timingSettings.minSpeechDurationSec,
            mergeCloseGapsSec: timingSettings.mergeCloseGapsSec,
            manualThresholdDb: timingSettings.autoAnalyzeNoiseFloor ? undefined : timingSettings.silenceThresholdDb,
            onCalibration: (calib) => {
              newCalibrations[track.id] = calib;
              addLog(`📊 Авто-калибровка «${dubberName}»: Шум: ${calib.noiseFloorDb} dB, Речь: ${calib.speechFloorDb} dB, Порог: ${calib.calculatedThresholdDb} dB (Запас: ${Math.round(timingSettings.leadInPaddingSec * 1000)}/${Math.round(timingSettings.leadOutPaddingSec * 1000)} мс)`, 'info');
            }
          });

          addLog(`🎙 Дорожка «${dubberName}»: обнаружено ${intervals.length} полезных речевых фраз (от тишины до тишины).`, 'info');

          updatedClips[track.id] = intervals.map((iv, idx) => {
            // Find matching subtitle text
            let matchingSub = trSubs[idx];
            if (!matchingSub) {
              matchingSub = trSubs.find(s => (s.startSec >= iv.startSec - 2.5 && s.startSec <= iv.endSec + 2.5));
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
              rawSourceStartSec: iv.startSec,
              rawSourceEndSec: iv.endSec,
              text: matchingSub?.text || `Фраза ${idx + 1}`,
              volumePercent: 100,
              isFix: track.id.includes('_fix_'),
              hasCollision: false,
              offsetSec: 0
            };
          });
        } else {
          // Fallback if audio file is inaccessible: slice by subtitles
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
              rawSourceStartSec: sub.startSec,
              rawSourceEndSec: sub.endSec,
              text: sub.text,
              volumePercent: 100,
              isFix: track.id.includes('_fix_'),
              hasCollision: false,
              offsetSec: 0
            };
          });
        }
      }

      setCalibrationsByTrack(newCalibrations);
      setAudioClips(updatedClips);
      setIsSilenceRemoved(true);
      addLog(`✓ Удаление тишины со всех дорожек завершено! Сформировано ${totalClips} фраз (от тишины до тишины). Границы фраз защищены от обрезания.`, 'success');
      toast.success(`Тишина удалена из всех дорожек! Сформировано ${totalClips} фраз от тишины до тишины.`);
    } catch (err: any) {
      addLog(`❌ Ошибка удаления тишины: ${err.message}`, 'error');
      toast.error(`Ошибка: ${err.message}`);
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  };

  // PIPELINE STEP 4: "Применить фиксы" — Splicing fix clips or full retakes
  // - Полный фикс: полностью заменяет оригинальную дорожку
  // - Фрагментарный фикс: удаляет оригинальную фразу и вставляет фразу фикса от тишины до тишины
  const handleStitchFixes = async () => {
    try {
      setIsLoading(true);
      setStatusMessage('Анализ дорожек фиксов и применение замен...');
      addLog('Поиск фиксов и проверка соотношения длительностей/размеров...', 'info');

      const updatedClips = { ...audioClips };
      const newFixMarkers: StitchedFixMarker[] = [];
      let appliedCount = 0;

      // Group tracks by actor
      const tracksByActor: Record<string, Track[]> = {};
      tracks.forEach(tr => {
        const actorKey = tr.dubberName || 'Даббер';
        if (!tracksByActor[actorKey]) tracksByActor[actorKey] = [];
        tracksByActor[actorKey].push(tr);
      });

      for (const [actorNick, actorTrks] of Object.entries(tracksByActor)) {
        const mainTracks = actorTrks.filter(t => !t.id.includes('_fix_'));
        const fixTracks = actorTrks.filter(t => t.id.includes('_fix_'));

        if (mainTracks.length === 0 || fixTracks.length === 0) continue;

        const mainTrack = mainTracks[0];
        let mainClips = [...(updatedClips[mainTrack.id] || [])];
        const mainBuf = audioBuffersRef.current[mainTrack.id];
        const mainDuration = mainBuf ? mainBuf.duration : (mainClips[mainClips.length - 1]?.clipStartSec || 100);

        for (const fixTrack of fixTracks) {
          let fixClips = updatedClips[fixTrack.id] || [];
          const fixBuf = audioBuffersRef.current[fixTrack.id];

          // If silence hasn't been cut yet on fix track, slice speech phrases from silence to silence
          if (fixClips.length <= 1 && fixBuf) {
            const fixIntervals = detectSpeechIntervals(fixBuf);
            if (fixIntervals.length > 0) {
              const trSubs = trackSubLinesMap[fixTrack.id] || [];
              fixClips = fixIntervals.map((iv, idx) => ({
                id: `clip_${fixTrack.id}_${idx}`,
                trackId: fixTrack.id,
                dubberName: fixTrack.dubberName,
                characterName: fixTrack.characterName,
                clipStartSec: iv.startSec,
                durationSec: iv.durationSec,
                sourceStartSec: iv.startSec,
                sourceEndSec: iv.endSec,
                rawSourceStartSec: iv.startSec,
                rawSourceEndSec: iv.endSec,
                text: trSubs[idx]?.text || `Фраза фикса ${idx + 1}`,
                volumePercent: 100,
                isFix: true,
                offsetSec: 0
              }));
              updatedClips[fixTrack.id] = fixClips;
            }
          }

          if (fixClips.length === 0) continue;

          const fixDuration = fixBuf ? fixBuf.duration : (fixClips[fixClips.length - 1]?.clipStartSec || 0);
          const ratio = (fixDuration && mainDuration) ? fixDuration / mainDuration : (fixClips.length / Math.max(1, mainClips.length));
          const isFullReplacement = ratio >= 0.85 || (mainClips.length > 0 && fixClips.length >= mainClips.length * 0.8 && fixClips.length >= 3);

          if (isFullReplacement) {
            // Case 1: Полный фикс — полностью заменяет оригинальную дорожку
            addLog(`⚡ Полный фикс (${(ratio * 100).toFixed(0)}% длины) для «${actorNick}». Оригинальная дорожка полностью заменена на чистовой дубль от тишины до тишины.`, 'success');
            if (fixBuf) {
              audioBuffersRef.current[mainTrack.id] = fixBuf;
            }
            if (audioElementsRef.current[fixTrack.id]) {
              audioElementsRef.current[mainTrack.id] = audioElementsRef.current[fixTrack.id];
            }
            mainClips = fixClips.map((fc, idx) => ({
              ...fc,
              id: `clip_${mainTrack.id}_fullfix_${idx}`,
              trackId: mainTrack.id,
              sourceAudioTrackId: fixTrack.id,
              isFix: true,
              text: mainClips[idx]?.text || fc.text
            }));
            updatedClips[mainTrack.id] = mainClips;
            updatedClips[fixTrack.id] = []; // Cleared from standalone lane because full track replaced
            newFixMarkers.push({
              id: `fix_marker_full_${fixTrack.id}`,
              trackId: mainTrack.id,
              dubberName: mainTrack.dubberName,
              characterName: mainTrack.characterName,
              startSec: 0,
              endSec: fixDuration,
              filename: fixTrack.filePath?.split(/[/\\]/).pop() || 'fix_full.wav'
            });
            appliedCount += fixClips.length;
          } else {
            // Case 2: Фрагментарные фиксы (отдельные фразы)
            // "заменять фразы из оригинальной дорожки на фразы из фиксов. Причём внимательно надо следить, чтобы дорожка не просто перетаскивалась, а эта фраза удалялась из оригинальной дорожки и вставлялась из дорожки фиксов. Но надо внимательно следить за таймингом этих фраз для того, чтобы не оставалось никаких хвостов и удалений, то есть всегда фраза от тишины до тишины."
            let fixAppliedOnTrack = 0;

            for (const fixClip of fixClips) {
              let bestIdx = -1;
              let bestScore = -1;

              mainClips.forEach((mc, mIdx) => {
                let score = 0;
                // Text match
                if (fixClip.text && mc.text && fixClip.text === mc.text) {
                  score += 10.0;
                }
                const diff = Math.abs(mc.clipStartSec - fixClip.clipStartSec);
                if (diff < 20.0) {
                  score += Math.max(0, 5.0 - (diff / 4.0));
                }
                if (score > bestScore) {
                  bestScore = score;
                  bestIdx = mIdx;
                }
              });

              if (bestIdx !== -1) {
                const origClip = mainClips[bestIdx];

                // Spliced fix phrase:
                // Original phrase at bestIdx is REMOVED from mainClips, and fix phrase is INSERTED!
                // Exact timing: "всегда фраза от тишины до тишины"
                const splicedClip: AudioClip = {
                  ...fixClip,
                  id: `clip_${mainTrack.id}_spliced_${fixClip.id}`,
                  trackId: mainTrack.id,
                  sourceAudioTrackId: fixTrack.id,
                  clipStartSec: origClip.clipStartSec,
                  durationSec: fixClip.durationSec,    // Exact duration from silence to silence
                  sourceStartSec: fixClip.sourceStartSec,
                  sourceEndSec: fixClip.sourceEndSec,
                  rawSourceStartSec: fixClip.rawSourceStartSec,
                  rawSourceEndSec: fixClip.rawSourceEndSec,
                  isFix: true,
                  text: origClip.text || fixClip.text,
                  offsetSec: 0
                };

                // Replace the original phrase
                mainClips[bestIdx] = splicedClip;

                newFixMarkers.push({
                  id: `fix_marker_${Date.now()}_${fixClip.id}`,
                  trackId: mainTrack.id,
                  dubberName: mainTrack.dubberName,
                  characterName: mainTrack.characterName,
                  startSec: splicedClip.clipStartSec,
                  endSec: splicedClip.clipStartSec + splicedClip.durationSec,
                  filename: fixTrack.filePath?.split(/[/\\]/).pop() || 'fix_snippet.wav'
                });
                appliedCount++;
                fixAppliedOnTrack++;
                addLog(`⚡ Замена фразы «${splicedClip.text}» на ${formatSeconds(splicedClip.clipStartSec)} для «${actorNick}»: оригинальная фраза удалена, вставлен фикс от тишины до тишины (${splicedClip.durationSec.toFixed(2)}с)`, 'info');
              }
            }

            updatedClips[mainTrack.id] = [...mainClips];
            updatedClips[fixTrack.id] = []; // Cleared because spliced into main track
            addLog(`⚡ Вшито ${fixAppliedOnTrack} фраз фикса в дорожку «${mainTrack.participant}» (оригинал удален, вставлен фикс)`, 'success');
          }
        }
      }

      setAudioClips(updatedClips);
      setStitchedFixes(newFixMarkers);
      setIsFixesStitched(true);

      if (appliedCount > 0) {
        toast.success(`Применено фиксов: ${appliedCount}! Оригинальные фразы удалены, фиксы вставлены от тишины до тишины.`);
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

  // PIPELINE STEP 5: "Автотайминг" — Whisper ASR phrase transcription and subtitle alignment
  // - Прогоняет дорожки дабберов через Виспер
  // - К каждой отдельной фразе на таймлайне прописывает, что говорится через Виспер
  // - Сопоставляет распознанный текст Виспера с дорогой субтитров
  // - Подтягивает фразы к значениям на дороге субтитров
  const handleAutoTimingAndCollisions = async () => {
    if (tracks.length === 0) return;
    try {
      setIsLoading(true);
      setStatusMessage('Автотайминг: подготовка и распознавание Whisper...');
      addLog('Запуск автотайминга: прогон дорожек дабберов через Whisper (модель tiny)...', 'info');

      let currentClips = { ...audioClips };

      // Ensure silence is cut before auto-timing
      const hasUncutTracks = tracks.some(t => {
        const c = currentClips[t.id];
        return !c || c.length <= 1;
      });

      if (!isSilenceRemoved || hasUncutTracks) {
        setStatusMessage('Удаление тишины перед распознаванием Whisper...');
        for (const track of tracks) {
          let audioBuf = audioBuffersRef.current[track.id];
          if (!audioBuf && track.filePath) {
            try {
              const pUrl = await getPlayableAudioUrl(track.filePath);
              if (pUrl) {
                const resp = await fetch(pUrl);
                const arrayBuf = await resp.arrayBuffer();
                const sharedAudioCtx = getSharedAudioContext();
                if (sharedAudioCtx) {
                  audioBuf = await sharedAudioCtx.decodeAudioData(arrayBuf);
                  audioBuffersRef.current[track.id] = audioBuf;
                }
              }
            } catch (e) {}
          }
          if (audioBuf) {
            const intervals = detectSpeechIntervals(audioBuf, {
              minSilenceDurationSec: timingSettings.minSilenceDurationSec,
              leadInPaddingSec: timingSettings.leadInPaddingSec,
              leadOutPaddingSec: timingSettings.leadOutPaddingSec,
              minSpeechDurationSec: timingSettings.minSpeechDurationSec,
              mergeCloseGapsSec: timingSettings.mergeCloseGapsSec
            });
            const trSubs = trackSubLinesMap[track.id] || [];
            currentClips[track.id] = intervals.map((iv, idx) => {
              const sub = trSubs[idx];
              return {
                id: `clip_${track.id}_${idx}`,
                trackId: track.id,
                dubberName: track.participant || track.dubberName || 'Даббер',
                characterName: track.character || track.characterName || 'Персонаж',
                clipStartSec: iv.startSec,
                durationSec: iv.durationSec,
                sourceStartSec: iv.startSec,
                sourceEndSec: iv.endSec,
                rawSourceStartSec: iv.startSec,
                rawSourceEndSec: iv.endSec,
                text: sub?.text || `Фраза ${idx + 1}`,
                volumePercent: 100,
                isFix: track.id.includes('_fix_'),
                hasCollision: false,
                offsetSec: 0
              };
            });
          }
        }
        setIsSilenceRemoved(true);
      }

      const updatedClips = { ...currentClips };
      const newCollisions: VoiceCollisionMarker[] = [];
      let alignedCount = 0;

      // Process each track with Whisper and match against track subtitles
      for (const track of tracks) {
        const dubberName = track.participant || track.dubberName || 'Даббер';
        const clips = updatedClips[track.id] || [];
        const trSubs = trackSubLinesMap[track.id] || [];

        if (clips.length === 0) continue;

        setStatusMessage(`Whisper: распознавание речи «${dubberName}» (${clips.length} фраз)...`);
        addLog(`🎙 Whisper (модель: tiny, язык: ru): распознавание ${clips.length} фраз для «${dubberName}»...`, 'info');

        // Prepare clips payload for Whisper
        const whisperPayload = clips.map(c => ({
          id: c.id,
          startSec: c.sourceStartSec,
          endSec: c.sourceEndSec,
          hint: c.text
        }));

        const transcriptionMap: Record<string, string> = {};
        try {
          const resp: any = await ipcSafe.invoke('timing-whisper-transcribe-clips', {
            audioFilePath: track.filePath,
            clips: whisperPayload,
            model: 'tiny',
            language: 'ru'
          });
          if (resp && Array.isArray(resp.results)) {
            resp.results.forEach((r: any) => {
              if (r.id && r.text) {
                transcriptionMap[r.id] = r.text.trim();
              }
            });
          }
        } catch (wErr: any) {
          console.warn('[Whisper AutoTiming] IPC error:', wErr);
        }

        // Step 2 & 3: Assign Whisper recognized text, match against subtitle track, and pull/snap to subtitle start
        const assignedSubIndices = new Set<number>();

        updatedClips[track.id] = clips.map((clip, cIdx) => {
          // Write what Whisper recognized into the clip
          const recognized = transcriptionMap[clip.id] || clip.text || '';
          clip.recognizedText = recognized;

          if (trSubs.length === 0) {
            return clip;
          }

          let bestSub: SubtitleLine | null = null;
          let bestSubIdx = -1;
          let bestScore = -1;

          // Compare recognized speech against expected subtitles on the subtitle track
          for (let sIdx = 0; sIdx < trSubs.length; sIdx++) {
            if (assignedSubIndices.has(sIdx)) continue;
            const sub = trSubs[sIdx];
            const textSim = calculateTextSimilarity(recognized, sub.text);

            // Time difference between original speech clip and subtitle line
            const timeDiff = Math.abs(clip.clipStartSec - sub.startSec);
            const timeProximity = Math.max(0, 1 - (timeDiff / 90)); // Soft bonus within 90s

            // Combined scoring: text match is primary (75%), time proximity is secondary (25%)
            const score = (textSim * 0.75) + (timeProximity * 0.25);

            if (score > bestScore && (textSim >= 0.20 || timeDiff < 6.0)) {
              bestScore = score;
              bestSub = sub;
              bestSubIdx = sIdx;
            }
          }

          // Fallback if no text match found: match nearest unassigned subtitle within 12s
          if (!bestSub) {
            let minDiff = Infinity;
            for (let sIdx = 0; sIdx < trSubs.length; sIdx++) {
              if (assignedSubIndices.has(sIdx)) continue;
              const sub = trSubs[sIdx];
              const diff = Math.abs(clip.clipStartSec - sub.startSec);
              if (diff < minDiff && diff < 12.0) {
                minDiff = diff;
                bestSub = sub;
                bestSubIdx = sIdx;
                bestScore = 0.5;
              }
            }
          }

          if (bestSub && bestSubIdx !== -1) {
            assignedSubIndices.add(bestSubIdx);
            alignedCount++;
            addLog(`🎯 Фраза #${cIdx + 1} «${recognized.slice(0, 25)}» пододвинута к субтитру [${formatSeconds(bestSub.startSec)}]: «${bestSub.text.slice(0, 30)}» (сходство: ${Math.round(bestScore * 100)}%)`, 'info');
            return {
              ...clip,
              clipStartSec: bestSub.startSec,
              offsetSec: 0,
              text: bestSub.text,
              recognizedText: recognized,
              whisperMatchedScore: Math.round(bestScore * 100)
            };
          }

          return clip;
        });
      }

      // 4. Detect voice collisions between different dubbers
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

              if (overlapDur > 0.12) {
                const normD1 = normalizeName(c1.dubberName).split(' ')[0];
                const normD2 = normalizeName(c2.dubberName).split(' ')[0];
                const isSameDubber = normD1 && normD1 === normD2;

                if (isSameDubber) {
                  c1.isSelfOverlap = true;
                  c2.isSelfOverlap = true;
                  addLog(`🎙 Параллельный слой одного даббера «${c1.dubberName}» (${overlapDur.toFixed(2)}с): перекрытие сохранено`, 'info');
                } else {
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
      }

      setAudioClips(updatedClips);
      setCollisions(newCollisions);
      setIsAutoTimingDone(true);

      addLog(`✓ Автотайминг по Висперу завершен! Пододвинуто ${alignedCount} фраз под субтитры. Наездов (коллизий): ${newCollisions.length}`, newCollisions.length > 0 ? 'warn' : 'success');
      if (newCollisions.length > 0) {
        toast.warning(`Автотайминг по Висперу выполнен! Фразы пододвинуты к субтитрам. Обнаружено ${newCollisions.length} наездов между дабберами для ручной доводки.`);
      } else {
        toast.success(`Автотайминг по Висперу выполнен! Все ${alignedCount} фраз точно пододвинуты к субтитрам.`);
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
            onClick={() => setIsSettingsModalOpen(true)}
            className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-amber-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 border border-amber-600/40 shadow-sm transition"
            title="Настройки параметров удаления тишины, авто-калибровки, вшития фиксов и автотайминга"
          >
            <Settings className="w-4 h-4 text-amber-400" />
            <span>Параметры</span>
          </button>

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
            title="5. Автотайминг: ASR Whisper распознавание речи каждой фразы и привязка к субтитрам"
          >
            <Activity className="w-4 h-4" />
            <span>5. Автотайминг (Whisper)</span>
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

      {/* Dynamic Calibration Info Banner */}
      {Object.keys(calibrationsByTrack).length > 0 && (
        <div className="bg-amber-950/30 border-b border-amber-900/40 px-4 py-1.5 flex items-center justify-between text-[11px] text-amber-200 shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto py-0.5">
            <span className="font-bold text-amber-400 flex items-center gap-1 shrink-0">
              <Sliders className="w-3.5 h-3.5" /> Авто-калибровка шума активна:
            </span>
            {Object.entries(calibrationsByTrack).map(([trId, calib]) => {
              const trk = tracks.find(t => t.id === trId);
              const name = trk?.participant || 'Трек';
              return (
                <span key={trId} className="bg-neutral-900/90 border border-amber-800/40 rounded px-2 py-0.5 font-mono text-[10px] text-neutral-300 shrink-0">
                  <strong className="text-amber-300">{name}</strong>: шум {calib.noiseFloorDb} dB | речь {calib.speechFloorDb} dB | порог {calib.calculatedThresholdDb} dB
                </span>
              );
            })}
          </div>
          <span className="text-[10px] text-neutral-400 shrink-0 ml-3 hidden md:inline">
            💡 Границы клипов можно свободно вытягивать из тишины мышкой за края
          </span>
        </div>
      )}

      {/* Main Multitrack Workspace: Synchronized Top Bar and Unified Vertical Scroll */}
      <div className="flex-1 flex flex-col overflow-hidden select-none">
        {/* Top Header Row: Left Title + Timecode Ruler (horizontal scroll synchronized) */}
        <div className="h-9 bg-neutral-900 border-b border-neutral-800 flex shrink-0 z-30">
          <div className="w-64 border-r border-neutral-800 px-3 flex items-center text-[11px] font-bold text-neutral-400 uppercase tracking-wider shrink-0 bg-neutral-900">
            Дорожки (Клипы аудио)
          </div>
          <div 
            ref={timeRulerContainerRef}
            className="flex-1 overflow-hidden relative font-mono text-[10px] text-neutral-400 bg-neutral-900/90"
          >
            <div 
              className="relative h-full"
              style={{ width: `${Math.max(800, duration * zoomLevel)}px` }}
            >
              {timeRulerTicks.map(sec => (
                <div
                  key={sec}
                  className="absolute border-l border-neutral-800 pl-1 py-1 h-full flex items-center"
                  style={{ left: `${sec * zoomLevel}px` }}
                >
                  {formatSeconds(sec)}
                </div>
              ))}
              {/* Playhead Cursor Marker on Time Ruler */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-40 pointer-events-none shadow-[0_0_8px_rgba(251,191,36,0.8)]"
                style={{ left: `${currentTime * zoomLevel}px` }}
              />
            </div>
          </div>
        </div>

        {/* Unified Vertical Scrolling Body: Track Headers and Timeline Lanes scroll together simultaneously! */}
        <div 
          ref={unifiedScrollContainerRef}
          className="flex-1 flex overflow-y-auto overflow-x-hidden relative bg-[#06070a]"
        >
          {/* Left Column: Track Headers */}
          <div 
            onWheel={handleSidebarWheel}
            className="w-64 bg-neutral-900/80 border-r border-neutral-800 shrink-0 flex flex-col select-none"
          >
            {/* Original Video Track Header (Exactly h-16 = 64px) */}
            <div className="h-16 p-2.5 border-b border-neutral-800/80 bg-neutral-950/50 flex flex-col justify-between shrink-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5" />
                  Оригинал (Видео)
                </span>
              </div>
              <div className="flex items-center gap-2">
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

            {/* Dubber Tracks Headers: Exactly h-6 for subtitles, h-28 for audio */}
            {tracks.map(track => {
              const dubberName = track.participant || track.dubberName || 'Даббер';
              const characterName = track.character || track.characterName || 'Персонаж';

              return (
                <React.Fragment key={track.id}>
                  {/* Subtitle Lane Header (Exactly h-6 = 24px) */}
                  <div className="h-6 bg-[#0e1222] border-b border-indigo-900/40 px-2.5 flex items-center text-indigo-300 text-[9px] font-bold font-mono tracking-wider shrink-0 uppercase">
                    <span>💬 Сабы: {characterName}</span>
                  </div>

                  {/* Audio Track Header (Exactly h-28 = 112px) */}
                  <div className="h-28 p-2.5 border-b border-neutral-800 flex flex-col justify-between hover:bg-neutral-900/40 transition shrink-0">
                    <div>
                      <div className="flex items-center justify-between">
                        <div className="truncate pr-1">
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

                      {/* Track Type Badge & File Info */}
                      <div className="mt-1 flex items-center gap-1.5 overflow-hidden">
                        {track.id.includes('_fix_') ? (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-amber-950/80 text-amber-300 border border-amber-800/60 uppercase shrink-0">
                            Фикс
                          </span>
                        ) : track.participant.includes('Дорожка 2') ? (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-purple-950/80 text-purple-300 border border-purple-800/60 uppercase shrink-0">
                            Слой 2 (Внахлест)
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-indigo-950/80 text-indigo-300 border border-indigo-800/60 uppercase shrink-0">
                            Основная
                          </span>
                        )}
                        <span 
                          className="text-[9px] text-neutral-400 font-mono truncate hover:text-neutral-200"
                          title={track.filePath}
                        >
                          {track.filePath.split(/[/\\]/).pop()}
                        </span>
                      </div>
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

          {/* Right Column: Timeline Tracks Lanes (Horizontal scroll via overflow-x-auto, inherits vertical scroll from parent) */}
          <div 
            ref={timelineContainerRef}
            onScroll={handleTimelineHorizontalScroll}
            onWheel={handleTimelineWheel}
            onClick={handleTimelineClick}
            className="flex-1 overflow-x-auto overflow-y-hidden relative cursor-crosshair"
          >
            <div 
              className="relative min-h-full"
              style={{ width: `${Math.max(800, duration * zoomLevel)}px` }}
            >
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
                          className={`absolute top-1 bottom-1 rounded-md border flex flex-col justify-between overflow-hidden shadow-lg transition-all cursor-grab active:cursor-grabbing select-none ${
                            clip.hasCollision
                              ? 'bg-red-950/90 border-red-500 shadow-red-500/20'
                              : clip.isSelfOverlap
                              ? 'bg-purple-950/90 border-purple-400 shadow-purple-500/20'
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
                          title={`Клип: ${clip.dubberName} (${formatSeconds(clip.clipStartSec + (clip.offsetSec || 0))})\nСубтитры: "${clip.text}"${clip.recognizedText ? `\nРаспознано Виспером: "${clip.recognizedText}" (сходство: ${clip.whisperMatchedScore || 100}%)` : ''}\nДлительность: ${clip.durationSec.toFixed(2)}с (от тишины до тишины)`}
                        >
                          {/* Left Edge Resize Handle (Reveals audio from silence or trims start) */}
                          <div
                            onMouseDown={(e) => handleResizeMouseDown(e, track.id, clip, 'start')}
                            className="absolute top-0 bottom-0 left-0 w-2.5 z-30 cursor-ew-resize group/edge flex items-center justify-center hover:bg-amber-400/40 transition-colors"
                            title="Потяните влево для раскрытия начала фразы из тишины, или вправо для подрезки"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="w-0.5 h-6 rounded-full bg-neutral-400/50 group-hover/edge:bg-amber-300 group-hover/edge:w-1 transition-all" />
                          </div>

                          {/* Right Edge Resize Handle (Reveals audio from silence or trims tail) */}
                          <div
                            onMouseDown={(e) => handleResizeMouseDown(e, track.id, clip, 'end')}
                            className="absolute top-0 bottom-0 right-0 w-2.5 z-30 cursor-ew-resize group/edge flex items-center justify-center hover:bg-amber-400/40 transition-colors"
                            title="Потяните вправо для раскрытия хвоста фразы (вздоха/затухания) из тишины, или влево для подрезки"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="w-0.5 h-6 rounded-full bg-neutral-400/50 group-hover/edge:bg-amber-300 group-hover/edge:w-1 transition-all" />
                          </div>

                          {/* Clip Top Header Badge */}
                          <div className={`px-2 py-0.5 text-[9px] font-mono flex items-center justify-between border-b ${
                            clip.isFix 
                              ? 'bg-amber-900/60 border-amber-500/40 text-amber-200' 
                              : clip.hasCollision
                              ? 'bg-red-900/60 border-red-500/40 text-red-200'
                              : clip.isSelfOverlap
                              ? 'bg-purple-900/60 border-purple-500/40 text-purple-200'
                              : 'bg-indigo-950/80 border-indigo-800/50 text-indigo-200'
                          }`}>
                            <div className="flex items-center gap-1 truncate font-bold">
                              {clip.isFix && <span className="bg-amber-500 text-neutral-950 px-1 rounded text-[8px] font-black">ФИКС</span>}
                              {clip.hasCollision && <span className="bg-red-500 text-white px-1 rounded text-[8px] font-black">КОЛЛИЗИЯ</span>}
                              {clip.isSelfOverlap && <span className="bg-purple-500 text-white px-1 rounded text-[8px] font-black">СЛОЙ</span>}
                              {clip.recognizedText && (
                                <span className="bg-emerald-600/90 text-white px-1 rounded text-[7.5px] font-mono font-bold" title={`Виспер: "${clip.recognizedText}"`}>
                                  ASR
                                </span>
                              )}
                              <span>{formatSeconds(clip.clipStartSec + (clip.offsetSec || 0))}</span>
                              <span className="text-neutral-300 font-sans truncate max-w-[110px] font-medium opacity-90" title={clip.recognizedText ? `Субтитры: "${clip.text}"\nВиспер: "${clip.recognizedText}"` : clip.text}>
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
                              audioBuffer={audioBuffersRef.current[clip.sourceAudioTrackId || track.id]}
                              sourceStartSec={clip.sourceStartSec}
                              sourceEndSec={clip.sourceEndSec}
                              width={Math.round(clipWidthPx)}
                              height={68}
                              color={clip.hasCollision ? '#ef4444' : clip.isSelfOverlap ? '#c084fc' : clip.isFix ? '#fbbf24' : '#818cf8'}
                              volumePercent={clip.volumePercent}
                            />
                            {clip.recognizedText && clip.recognizedText !== clip.text && (
                              <div className="absolute bottom-1 left-1 right-1 pointer-events-none px-1 py-0.5 rounded bg-black/80 text-[8px] text-emerald-300 font-sans italic truncate border border-emerald-500/30">
                                🎙 {clip.recognizedText}
                              </div>
                            )}
                          </div>

                          {/* Clip Bottom Action Tools (Split, Expand & Nudge) */}
                          <div className="px-1 py-0.5 bg-black/50 flex items-center justify-between opacity-0 hover:opacity-100 transition text-[8px] z-20">
                            <div className="flex items-center gap-0.5">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSplitClip(track.id, clip.id); }}
                                className="px-1 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 rounded border border-neutral-700 font-bold"
                                title="Разрезать клип на 2 части"
                              >
                                ✂
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleExpandClip(track.id, clip.id, 'start', 0.25); }}
                                className="px-1 py-0.5 bg-amber-950/70 hover:bg-amber-800 text-amber-300 rounded border border-amber-700/60 font-mono"
                                title="Раскрыть начало на +0.25с из тишины"
                              >
                                ◀+0.25с
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleExpandClip(track.id, clip.id, 'end', 0.25); }}
                                className="px-1 py-0.5 bg-amber-950/70 hover:bg-amber-800 text-amber-300 rounded border border-amber-700/60 font-mono"
                                title="Раскрыть хвост на +0.25с из тишины"
                              >
                                +0.25с▶
                              </button>
                            </div>
                            <div className="flex items-center gap-0.5">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleNudgeClip(track.id, clip.id, -0.05); }}
                                className="px-1 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded border border-neutral-700 font-mono"
                                title="-50 мс"
                              >
                                -50ms
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleNudgeClip(track.id, clip.id, 0.05); }}
                                className="px-1 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded border border-neutral-700 font-mono"
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

        {/* Selected Clip Volume & Expansion Inspector */}
        {activeSelectedClip && (
          <div className="flex items-center gap-3 bg-neutral-950 px-3 py-1.5 rounded-xl border border-indigo-800 text-xs shadow-lg">
            <span className="font-bold text-indigo-300 max-w-[150px] truncate" title={activeSelectedClip.clip.text}>
              {activeSelectedClip.clip.characterName}: {activeSelectedClip.clip.text}
            </span>
            <div className="flex items-center gap-2 border-l border-neutral-800 pl-2.5">
              <span className="text-[10px] text-neutral-400">Громкость:</span>
              <input
                type="range"
                min="0"
                max="200"
                step="5"
                value={activeSelectedClip.clip.volumePercent ?? 100}
                onChange={(e) => handleSetClipVolume(activeSelectedClip.trackId, activeSelectedClip.clip.id, Number(e.target.value))}
                className="w-20 accent-indigo-500 h-1.5 bg-neutral-800 rounded cursor-pointer"
              />
              <span className="font-mono text-xs text-amber-300 font-bold w-9 text-right">
                {activeSelectedClip.clip.volumePercent ?? 100}%
              </span>
            </div>

            {/* Quick manual expansion buttons: reveal cut audio from silence */}
            <div className="flex items-center gap-1 border-l border-neutral-800 pl-2.5">
              <span className="text-[10px] text-neutral-400 mr-0.5">Границы:</span>
              <button
                onClick={() => handleExpandClip(activeSelectedClip.trackId, activeSelectedClip.clip.id, 'start', 0.5)}
                className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 rounded text-[10px] border border-neutral-700 transition"
                title="Раскрыть начало фразы на +0.5 сек из тишины"
              >
                ◀ +0.5с
              </button>
              <button
                onClick={() => handleExpandClip(activeSelectedClip.trackId, activeSelectedClip.clip.id, 'end', 0.5)}
                className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 rounded text-[10px] border border-neutral-700 transition"
                title="Раскрыть хвост фразы на +0.5 сек из тишины"
              >
                +0.5с ▶
              </button>
              <button
                onClick={() => handleExpandClip(activeSelectedClip.trackId, activeSelectedClip.clip.id, 'end', 1.0)}
                className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 rounded text-[10px] border border-neutral-700 transition"
                title="Раскрыть хвост фразы на +1.0 сек из тишины"
              >
                +1.0с ▶
              </button>
              <button
                onClick={() => handleResetClipToOriginal(activeSelectedClip.trackId, activeSelectedClip.clip.id)}
                className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white rounded text-[10px] border border-neutral-700 transition"
                title="Сбросить границы клипа к исходной детекции"
              >
                Сброс
              </button>
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

      {/* Timing and Silence Settings Modal */}
      <TimingSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={timingSettings}
        onSave={handleSaveSettings}
      />
    </div>
  );
}
