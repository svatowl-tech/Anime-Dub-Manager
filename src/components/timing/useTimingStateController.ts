import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { Track, SubtitleLine } from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';
import { NormalizationMetrics } from '../../lib/qa/audioNormalizer';
import { TimingSettings, DEFAULT_TIMING_SETTINGS } from '../TimingSettingsModal';
import { TimingProjectData } from '../../lib/qa/timingSyncService';
import {
  AudioClip,
  IntentionalOverlapMoment,
  MissingSubtitleMarker,
  NoiseCalibration,
  OriginalStemsState,
  TimingIssue,
  VoiceCollisionMarker,
} from './timing.types';

export function useTimingStateController() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [audioClips, setAudioClips] = useState<Record<string, AudioClip[]>>({});
  const [collisions, setCollisions] = useState<VoiceCollisionMarker[]>([]);
  const [intentionalOverlaps, setIntentionalOverlaps] = useState<IntentionalOverlapMoment[]>([]);
  const [qaPassportLoaded, setQaPassportLoaded] = useState<{
    loaded: boolean;
    summary: TimingProjectData['summary'];
    savedAt: string;
  } | null>(null);
  const savedPassportRef = useRef<TimingProjectData | null>(null);
  const allCatalogTracksRef = useRef<Track[]>([]);
  const isStateRestoredRef = useRef<boolean>(false);
  const [savedTimingStateInfo, setSavedTimingStateInfo] = useState<{
    savedAt: string;
    filePath?: string;
  } | null>(null);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState<boolean>(false);

  // Pipeline status flags
  const [isSilenceRemoved, setIsSilenceRemoved] = useState<boolean>(false);
  const [isFixesStitched, setIsFixesStitched] = useState<boolean>(false);
  const [timingIssues, setTimingIssues] = useState<TimingIssue[]>([]);
  const [missingSubtitles, setMissingSubtitles] = useState<MissingSubtitleMarker[]>([]);
  const [isTimingAnalyzed, setIsTimingAnalyzed] = useState<boolean>(false);
  const [isIssuesDrawerOpen, setIsIssuesDrawerOpen] = useState<boolean>(false);
  const [activeIssueFilter, setActiveIssueFilter] = useState<'all' | 'overlap' | 'desync' | 'missing' | 'orphan'>('all');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [importDecodedTracks, setImportDecodedTracks] = useState<Array<{ id: string; name: string; duration?: number; status: 'pending' | 'decoding' | 'done' | 'error' }>>([]);
  const [trackHeightMode, setTrackHeightMode] = useState<'standard' | 'compact' | 'fit'>('standard');
  const [exportingToMixing, setIsExportingToMixing] = useState<boolean>(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isExportingSE, setIsExportingSE] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [isLogDrawerOpen, setIsLogDrawerOpen] = useState<boolean>(false);
  const [operationLogs, setOperationLogs] = useState<Array<{ time: string; msg: string; level: 'info' | 'success' | 'warn' | 'error' }>>([]);
  const [rawSubtitles, setRawSubtitles] = useState<SubtitleLine[]>([]);
  const [trackSubLinesMap, setTrackSubLinesMap] = useState<Record<string, SubtitleLine[]>>({});
  const subtitles = useMemo<SubtitleLine[]>(() => {
    if (rawSubtitles.length > 0) return rawSubtitles;
    const seen = new Set<string>();
    const merged: SubtitleLine[] = [];
    for (const list of Object.values(trackSubLinesMap)) {
      for (const s of list) {
        const key = String(s.id ?? `${s.startSec}_${s.text}`);
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(s);
        }
      }
    }
    return merged.sort((a, b) => a.startSec - b.startSec);
  }, [rawSubtitles, trackSubLinesMap]);

  // Unified Adaptive Active Process State
  const [activeProcess, setActiveProcess] = useState<{
    title: string;
    detail: string;
    progress: number;
    stepCurrent?: number;
    stepTotal?: number;
  } | null>(null);

  const updateProcess = useCallback((
    title: string,
    detail: string,
    progress: number,
    stepCurrent?: number,
    stepTotal?: number
  ) => {
    const clamped = Math.max(0, Math.min(100, Math.round(progress)));
    setActiveProcess({ title, detail, progress: clamped, stepCurrent, stepTotal });
    setStatusMessage(detail);
    setImportProgress(clamped);
  }, []);

  const clearProcess = useCallback(() => {
    setActiveProcess(null);
    setStatusMessage('');
    setImportProgress(0);
  }, []);

  // Original Video & Floating Draggable Video Window State
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [originalPeaks, setOriginalPeaks] = useState<number[]>([]);
  const [isOriginalMuted, setIsOriginalMuted] = useState<boolean>(false);
  const [originalWaveScale, setOriginalWaveScale] = useState<number>(() => {
    try {
      const saved = parseFloat(localStorage.getItem('timing_orig_wave_scale') || '');
      if (!isNaN(saved) && saved >= 0.25 && saved <= 12) return saved;
    } catch (e) {}
    return 1.8;
  });
  const [isOriginalWaveNormalized, setIsOriginalWaveNormalized] = useState<boolean>(() => {
    try {
      return localStorage.getItem('timing_orig_wave_norm') !== 'false';
    } catch (e) {
      return true;
    }
  });
  const [originalTrackHeight, setOriginalTrackHeight] = useState<number>(() => {
    try {
      const saved = parseInt(localStorage.getItem('timing_orig_track_height') || '', 10);
      if (!isNaN(saved) && saved >= 56 && saved <= 240) return saved;
    } catch (e) {}
    return 96;
  });
  const [resizingOrigTrack, setResizingOrigTrack] = useState<{
    startMouseY: number;
    initialHeight: number;
  } | null>(null);

  const handleChangeOriginalWaveScale = useCallback((nextVal: number) => {
    const clamped = Number(Math.max(0.25, Math.min(10, nextVal)).toFixed(2));
    setOriginalWaveScale(clamped);
    try { localStorage.setItem('timing_orig_wave_scale', String(clamped)); } catch (e) {}
  }, []);

  const handleToggleOriginalWaveNorm = useCallback(() => {
    setIsOriginalWaveNormalized(prev => {
      const next = !prev;
      try { localStorage.setItem('timing_orig_wave_norm', String(next)); } catch (e) {}
      return next;
    });
  }, []);

  const handleChangeOriginalTrackHeight = useCallback((nextHeight: number) => {
    const clamped = Math.max(56, Math.min(220, Math.round(nextHeight)));
    setOriginalTrackHeight(clamped);
    try { localStorage.setItem('timing_orig_track_height', String(clamped)); } catch (e) {}
  }, []);

  useEffect(() => {
    if (!resizingOrigTrack) return;
    const onMove = (e: MouseEvent) => {
      const dy = e.clientY - resizingOrigTrack.startMouseY;
      handleChangeOriginalTrackHeight(resizingOrigTrack.initialHeight + dy);
    };
    const onUp = () => setResizingOrigTrack(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizingOrigTrack, handleChangeOriginalTrackHeight]);

  const [isVideoOpen, setIsVideoOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('timing_video_open') !== 'false';
    } catch (e) {
      return true;
    }
  });
  const [videoSize, setVideoSize] = useState<'S' | 'M' | 'L'>(() => {
    try {
      const saved = localStorage.getItem('timing_video_size');
      if (saved === 'S' || saved === 'M' || saved === 'L') return saved;
    } catch (e) {}
    return 'M';
  });
  const [videoPos, setVideoPos] = useState<{ x: number; y: number }>({ x: 280, y: 44 });
  const [draggingVideo, setDraggingVideo] = useState<{
    startMouseX: number;
    startMouseY: number;
    initialX: number;
    initialY: number;
  } | null>(null);
  const videoDragMovedRef = useRef<boolean>(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const handleToggleVideoOpen = useCallback(() => {
    setIsVideoOpen(prev => {
      const next = !prev;
      try { localStorage.setItem('timing_video_open', String(next)); } catch (e) {}
      return next;
    });
  }, []);

  const handleChangeVideoSize = useCallback((sz: 'S' | 'M' | 'L') => {
    setVideoSize(sz);
    try { localStorage.setItem('timing_video_size', sz); } catch (e) {}
  }, []);

  useEffect(() => {
    if (!draggingVideo) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - draggingVideo.startMouseX;
      const dy = e.clientY - draggingVideo.startMouseY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        videoDragMovedRef.current = true;
      }
      const maxX = Math.max(20, window.innerWidth - 180);
      const maxY = Math.max(20, window.innerHeight - 160);
      setVideoPos({
        x: Math.max(8, Math.min(maxX, draggingVideo.initialX + dx)),
        y: Math.max(8, Math.min(maxY, draggingVideo.initialY + dy))
      });
    };
    const onUp = () => setDraggingVideo(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingVideo]);

  // QA Auto-Normalization State (-18 dBFS target RMS + -0.7 dBFS peak limiter)
  const [isAutoNormalize, setIsAutoNormalize] = useState<boolean>(() => {
    try {
      return localStorage.getItem('timing_auto_normalize') !== 'false';
    } catch (e) {
      return true;
    }
  });
  const [normalizationMetrics, setNormalizationMetrics] = useState<Record<string, NormalizationMetrics>>({});

  const handleToggleAutoNormalize = useCallback(() => {
    setIsAutoNormalize(prev => {
      const next = !prev;
      try { localStorage.setItem('timing_auto_normalize', String(next)); } catch (e) {}
      toast.info(next ? 'Нормализация при воспроизведении включена (-18 dBFS как в QA)' : 'Нормализация при воспроизведении отключена (исходная громкость)');
      return next;
    });
  }, []);

  // Timing & Silence Settings Modal
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [timingSettings, setTimingSettings] = useState<TimingSettings>(() => {
    try {
      const saved = localStorage.getItem('timing_settings_v3');
      if (saved) return { ...DEFAULT_TIMING_SETTINGS, ...JSON.parse(saved) };
    } catch (e) {}
    return DEFAULT_TIMING_SETTINGS;
  });
  const [calibrationsByTrack, setCalibrationsByTrack] = useState<Record<string, NoiseCalibration>>({});

  const handleSaveSettings = useCallback((newSettings: TimingSettings) => {
    setTimingSettings(newSettings);
    try {
      localStorage.setItem('timing_settings_v3', JSON.stringify(newSettings));
    } catch (e) {}
    toast.success('Настройки тайминга и удаления тишины сохранены!');
  }, []);

  // Mouse Dragging & Resizing State for Clips
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

  const missingFileInputRef = useRef<HTMLInputElement>(null);
  const [activeMissingMarker, setActiveMissingMarker] = useState<MissingSubtitleMarker | null>(null);

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
        const rounded = Math.max(0, Math.min(100, Math.round(percent)));
        setExportProgress(rounded);
        setActiveProcess(prev => prev ? { ...prev, progress: rounded } : prev);
      }
    });
    return () => {
      if (unsub) unsub();
    };
  }, []);

  // Playback & Zoom Controls
  const [currentTime, setCurrentTime] = useState<number>(0);
  const currentTimeRef = useRef<number>(0);
  const [duration, setDuration] = useState<number>(100);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [zoomLevel, setZoomLevel] = useState<number>(30);

  // Audio Playback
  const [mutedTracks, setMutedTracks] = useState<Set<string>>(new Set());
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [originalVolume, setOriginalVolume] = useState<number>(0.4);

  // AI Original Stem Separation State
  const [originalStems, setOriginalStems] = useState<OriginalStemsState>({
    hasStems: false,
    modelId: 'uvr_mdx_voc_ft',
    vocalsPeaks: [],
    instrumentalPeaks: [],
    vocalsVolume: 0.8,
    instrumentalVolume: 0.6,
    vocalsMuted: false,
    instrumentalMuted: false,
    vocalsSolo: false,
    instrumentalSolo: false,
    vocalsWaveScale: 1.8,
    instrumentalWaveScale: 1.8,
    vocalsTrackHeight: 88,
    instrumentalTrackHeight: 88,
    isSeparating: false,
    separationProgress: 0,
    separationStatus: ''
  });
  const [isStemsModalOpen, setIsStemsModalOpen] = useState<boolean>(false);
  const [selectedStemModel, setSelectedStemModel] = useState<string>('uvr_mdx_voc_ft');
  const vocalsAudioRef = useRef<HTMLAudioElement | null>(null);
  const instrumentalAudioRef = useRef<HTMLAudioElement | null>(null);

  const playbackRef = useRef<number | null>(null);
  const timelineContainerRef = useRef<HTMLDivElement | null>(null);
  const timeRulerContainerRef = useRef<HTMLDivElement | null>(null);
  const audioElementsRef = useRef<Record<string, HTMLAudioElement>>({});
  const audioBuffersRef = useRef<Record<string, AudioBuffer>>({});
  const trackFileSizesRef = useRef<Record<string, number>>({});
  const origBuffersByTrackRef = useRef<Record<string, { buffer: AudioBuffer; filePath?: string; sourceTrackId: string }>>({});
  const fixBuffersByActorRef = useRef<Record<string, Array<{ buffer: AudioBuffer; filePath?: string; sourceTrackId: string; participant: string }>>>({});

  const [finalVerificationReport, setFinalVerificationReport] = useState<{
    totalSubs: number;
    voicedSubs: number;
    voicedByOtherDubberCount?: number;
    recoveredFromFixCount: number;
    recoveredFromOrigCount: number;
    realignedCount: number;
    physicsProtectedCount: number;
    iterationsRun: number;
    unvoicedSubs: MissingSubtitleMarker[];
    passed: boolean;
  } | null>(null);

  const activeClipNodesRef = useRef<Map<string, {
    clipId: string;
    trackId: string;
    source: AudioBufferSourceNode;
    gainNode: GainNode;
    clipStart: number;
    clipEnd: number;
    sourceStart: number;
    sourceEnd: number;
  }>>(new Map());
  const [aiProcessingTrackId, setAiProcessingTrackId] = useState<string | null>(null);
  const [activeAiMenuTrackId, setActiveAiMenuTrackId] = useState<string | null>(null);

  return {
    tracks, setTracks,
    audioClips, setAudioClips,
    collisions, setCollisions,
    intentionalOverlaps, setIntentionalOverlaps,
    qaPassportLoaded, setQaPassportLoaded,
    savedPassportRef, allCatalogTracksRef, isStateRestoredRef,
    savedTimingStateInfo, setSavedTimingStateInfo,
    isResetConfirmOpen, setIsResetConfirmOpen,
    isSilenceRemoved, setIsSilenceRemoved,
    isFixesStitched, setIsFixesStitched,
    timingIssues, setTimingIssues,
    missingSubtitles, setMissingSubtitles,
    isTimingAnalyzed, setIsTimingAnalyzed,
    isIssuesDrawerOpen, setIsIssuesDrawerOpen,
    activeIssueFilter, setActiveIssueFilter,
    isLoading, setIsLoading,
    isImporting, setIsImporting,
    importProgress, setImportProgress,
    statusMessage, setStatusMessage,
    importDecodedTracks, setImportDecodedTracks,
    trackHeightMode, setTrackHeightMode,
    exportingToMixing, setIsExportingToMixing,
    isExportModalOpen, setIsExportModalOpen,
    isExportingSE, setIsExportingSE,
    exportProgress, setExportProgress,
    isLogDrawerOpen, setIsLogDrawerOpen,
    operationLogs, setOperationLogs,
    rawSubtitles, setRawSubtitles,
    trackSubLinesMap, setTrackSubLinesMap,
    subtitles,
    activeProcess, setActiveProcess,
    updateProcess, clearProcess,
    videoUrl, setVideoUrl,
    originalPeaks, setOriginalPeaks,
    isOriginalMuted, setIsOriginalMuted,
    originalWaveScale, setOriginalWaveScale,
    isOriginalWaveNormalized, setIsOriginalWaveNormalized,
    originalTrackHeight, setOriginalTrackHeight,
    resizingOrigTrack, setResizingOrigTrack,
    handleChangeOriginalWaveScale,
    handleToggleOriginalWaveNorm,
    handleChangeOriginalTrackHeight,
    isVideoOpen, setIsVideoOpen,
    videoSize, setVideoSize,
    videoPos, setVideoPos,
    draggingVideo, setDraggingVideo,
    videoDragMovedRef, videoRef,
    handleToggleVideoOpen, handleChangeVideoSize,
    isAutoNormalize, setIsAutoNormalize,
    normalizationMetrics, setNormalizationMetrics,
    handleToggleAutoNormalize,
    isSettingsModalOpen, setIsSettingsModalOpen,
    timingSettings, setTimingSettings,
    calibrationsByTrack, setCalibrationsByTrack,
    handleSaveSettings,
    draggingClip, setDraggingClip,
    selectedClipId, setSelectedClipId,
    missingFileInputRef,
    activeMissingMarker, setActiveMissingMarker,
    addLog,
    currentTime, setCurrentTime, currentTimeRef,
    duration, setDuration,
    isPlaying, setIsPlaying,
    zoomLevel, setZoomLevel,
    mutedTracks, setMutedTracks,
    volumes, setVolumes,
    originalVolume, setOriginalVolume,
    originalStems, setOriginalStems,
    isStemsModalOpen, setIsStemsModalOpen,
    selectedStemModel, setSelectedStemModel,
    vocalsAudioRef, instrumentalAudioRef,
    playbackRef, timelineContainerRef, timeRulerContainerRef,
    audioElementsRef, audioBuffersRef, trackFileSizesRef,
    origBuffersByTrackRef, fixBuffersByActorRef,
    finalVerificationReport, setFinalVerificationReport,
    activeClipNodesRef,
    aiProcessingTrackId, setAiProcessingTrackId,
    activeAiMenuTrackId, setActiveAiMenuTrackId,
  };
}
