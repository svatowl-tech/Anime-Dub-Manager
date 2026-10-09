import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Sliders, 
  Play, 
  Pause, 
  Volume2, 
  VolumeX, 
  FolderOpen, 
  Download, 
  CheckCircle2, 
  Clock, 
  FileAudio, 
  Film, 
  FileText, 
  ChevronDown, 
  ChevronUp, 
  Sparkles, 
  Layers, 
  Music, 
  Radio, 
  Save, 
  RefreshCw, 
  Settings2, 
  Plus, 
  ShieldCheck, 
  Headphones, 
  ArrowUp, 
  ArrowDown, 
  Trash2, 
  Power, 
  Wand2, 
  Check, 
  Info,
  Maximize2,
  Minimize2,
  Bookmark,
  Upload,
  Copy,
  FolderPlus,
  FilePlus,
  Compass,
  Terminal,
  Search,
  AlertTriangle,
  AlertCircle,
  XCircle,
  FileDown,
  RotateCcw,
  Folder,
  Activity
} from 'lucide-react';
import { toast } from 'sonner';
import { safeCopyToClipboard } from '../lib/clipboard';
import { 
  Episode, 
  MixingManifest, 
  MixingFileItem, 
  PipelineStep, 
  MixingModuleDef,
  MixingModulePreset,
  PipelinePreset
} from '../types';
import { ipcSafe } from '../lib/ipcSafe';
import { resolveLocalPath } from '../lib/webFileSystem';
import { sanitizeFolderName } from '../lib/pathUtils';
import { globalAudioAICleanupEngine } from '../services/AudioAICleanupEngine';

export interface MixingLogEntry {
  id: string;
  timestamp: string; // HH:mm:ss.ms
  fullTime: string;  // ISO
  level: 'info' | 'warn' | 'error' | 'debug' | 'success';
  tag: string;
  message: string;
  stepId?: string;
  meta?: any;
}

interface MixingPanelProps {
  currentEpisode?: Episode | null;
  onRefresh?: () => void;
}

const PARAM_SPECS: Record<string, { min: number; max: number; step: number }> = {
  sensitivity: { min: 0.1, max: 10.0, step: 0.1 },
  wetDryBlend: { min: 10, max: 100, step: 1 },
  attenuationLimitDb: { min: -100, max: 0, step: 1 },
  reverbReduction: { min: 0.0, max: 1.0, step: 0.05 },
  shifts: { min: 1, max: 5, step: 1 },
  overlap: { min: 0.1, max: 0.5, step: 0.05 },
  segment: { min: 5, max: 60, step: 5 },
  noiseReductionDb: { min: 1, max: 45, step: 1 },
  noiseFloorDb: { min: -85, max: -20, step: 1 },
  stationarityWeight: { min: 0.1, max: 1.0, step: 0.01 },
  frequencySmoothingHz: { min: 20, max: 500, step: 10 },
  deechoReductionDb: { min: 1, max: 45, step: 1 },
  earlyReflectionsDecay: { min: 0.1, max: 1.0, step: 0.01 },
  reverbTailSuppress: { min: 0.1, max: 1.0, step: 0.01 },
  airBandBoostDb: { min: 0, max: 15, step: 0.5 },
  harmonicSaturation: { min: 0.1, max: 1.0, step: 0.05 },
  formantClarity: { min: 0.1, max: 1.0, step: 0.05 },
  thresholdDb: { min: -60, max: 0, step: 1 },
  rangeDb: { min: -40, max: 0, step: 1 },
  attackMs: { min: 1, max: 500, step: 1 },
  releaseMs: { min: 10, max: 2000, step: 10 },
  holdMs: { min: 0, max: 1000, step: 10 },
  targetLufs: { min: -30, max: -5, step: 0.5 },
  truePeak: { min: -10, max: 0, step: 0.1 },
  maxGainDb: { min: 0, max: 30, step: 0.5 },
  marginDb: { min: -10, max: 15, step: 0.1 },
  postProcessThreshold: { min: 0.0, max: 1.0, step: 0.05 },
  instrumentalBlend: { min: 0, max: 100, step: 1 },
  intensity: { min: 0.0, max: 10.0, step: 0.1 },
  ratio: { min: 1, max: 20, step: 0.1 },
  kneeDb: { min: 0, max: 20, step: 0.5 },
  makeupDb: { min: 0, max: 20, step: 0.5 },
  peakLimitDb: { min: -12, max: 0, step: 0.5 },
  duckingAmountDb: { min: 0, max: 40, step: 1 },
  minGapSec: { min: 0.01, max: 2.0, step: 0.01 },
  leadInSec: { min: 0.0, max: 1.0, step: 0.01 },
  silenceThresholdDb: { min: -80, max: -20, step: 1 },
  minSilenceDuration: { min: 0.05, max: 2.0, step: 0.05 },
  fadeDurationMs: { min: 0, max: 100, step: 1 },
  safetyPaddingMs: { min: 0, max: 500, step: 5 },
  minSpeechDb: { min: -80, max: -20, step: 1 },
  fadeEdgeMs: { min: 0, max: 100, step: 1 },
  // Spotify Pedalboard DSP Granular Specs
  eqHighpass: { min: 20, max: 300, step: 5 },
  eqPresenceFreq: { min: 1000, max: 8000, step: 50 },
  eqPresenceGain: { min: -12.0, max: 12.0, step: 0.5 },
  eqLowpass: { min: 6000, max: 22000, step: 500 },
  bodyGainDb: { min: -12.0, max: 12.0, step: 0.5 },
  boxCutGainDb: { min: -12.0, max: 0.0, step: 0.5 },
  airGainDb: { min: 0.0, max: 12.0, step: 0.5 },
  compThresholdDb: { min: -60, max: 0, step: 1 },
  compRatio: { min: 1, max: 10, step: 0.1 },
  compAttackMs: { min: 1, max: 50, step: 1 },
  compReleaseMs: { min: 10, max: 300, step: 5 },
  deesserFreqHz: { min: 4000, max: 10000, step: 100 },
  deesserAmount: { min: 0.0, max: 1.0, step: 0.05 },
  reverbRoomSize: { min: 0.0, max: 1.0, step: 0.01 },
  reverbDamping: { min: 0.0, max: 1.0, step: 0.05 },
  reverbWet: { min: 0.0, max: 1.0, step: 0.01 },
  reverbDry: { min: 0.0, max: 1.0, step: 0.01 },
  limiterThresholdDb: { min: -12.0, max: 0.0, step: 0.1 },
  limiterReleaseMs: { min: 10, max: 300, step: 5 },
  levelingSpeedMs: { min: 50, max: 1000, step: 25 }
};

export default function MixingPanel({ currentEpisode, onRefresh }: MixingPanelProps) {
  const [manifest, setManifest] = useState<MixingManifest | null>(null);
  const [moduleDatabase, setModuleDatabase] = useState<MixingModuleDef[]>([]);
  const [workingDir, setWorkingDir] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Import Modal & Status
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<number>(0);
  const [importStatusMessage, setImportStatusMessage] = useState<string>('');
  const [importSource, setImportSource] = useState<'qa' | 'timing'>('timing');
  const [importAutoTiming, setImportAutoTiming] = useState<boolean>(false);
  const [importAutoFixes, setImportAutoFixes] = useState<boolean>(true);
  const [importSubtitles, setImportSubtitles] = useState<boolean>(true);
  const [customTargetDir, setCustomTargetDir] = useState<string>('');

  // Add Module Modal
  const [isAddModuleModalOpen, setIsAddModuleModalOpen] = useState<boolean>(false);

  // Pipeline Presets Modal & State
  const [isPipelinePresetsModalOpen, setIsPipelinePresetsModalOpen] = useState<boolean>(false);
  const [isSavePresetModalOpen, setIsSavePresetModalOpen] = useState<boolean>(false);
  const [newPresetName, setNewPresetName] = useState<string>('');
  const [newPresetDesc, setNewPresetDesc] = useState<string>('');
  const [pipelinePresets, setPipelinePresets] = useState<PipelinePreset[]>([]);
  const [isLoadingPresets, setIsLoadingPresets] = useState<boolean>(false);

  // External Standalone Files Import Modal
  const [isExternalImportModalOpen, setIsExternalImportModalOpen] = useState<boolean>(false);
  const [extVideoPath, setExtVideoPath] = useState<string>('');
  const [extSubPath, setExtSubPath] = useState<string>('');
  const [extAudioPaths, setExtAudioPaths] = useState<string[]>([]);
  const [isSubmittingExternal, setIsSubmittingExternal] = useState<boolean>(false);

  // Active step processing
  const [activeProcessingStepId, setActiveProcessingStepId] = useState<string | null>(null);
  const [stepProgress, setStepProgress] = useState<Record<string, number>>({});
  const [expandedSettings, setExpandedSettings] = useState<Record<string, boolean>>({});

  // UVR Model Download State
  const [isDownloadingUvrModel, setIsDownloadingUvrModel] = useState<boolean>(false);
  const [uvrDownloadPercent, setUvrDownloadPercent] = useState<number>(0);

  // Process Logging & Live Terminal Console (Полное логирование сведения)
  const [logs, setLogs] = useState<MixingLogEntry[]>([]);
  const [isConsoleOpen, setIsConsoleOpen] = useState<boolean>(true); // Открыта по умолчанию для максимальной прозрачности
  const [isConsoleExpanded, setIsConsoleExpanded] = useState<boolean>(false);
  const [consoleFilter, setConsoleFilter] = useState<'all' | 'error' | 'warn' | 'info' | 'debug'>('all');
  const [consoleSearch, setConsoleSearch] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const consoleBottomRef = useRef<HTMLDivElement | null>(null);

  /**
   * Universal Frontend Logger:
   * 1. Direct colorized printing to browser/DevTools console with CSS styling
   * 2. Live streaming buffer to UI Terminal Console with auto-scroll and inspection
   */
  const mixLog = useCallback((
    level: 'info' | 'warn' | 'error' | 'debug' | 'success',
    tag: string,
    message: string,
    meta?: any,
    stepId?: string
  ) => {
    const d = new Date();
    const timestamp = d.toLocaleTimeString('ru-RU', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
    const fullTime = d.toISOString();

    // DevTools Console Formatting
    const tagStyle = 'color: #c084fc; font-weight: 700; background: rgba(168, 85, 247, 0.15); padding: 1px 6px; border-radius: 4px;';
    const timeStyle = 'color: #94a3b8; font-weight: 500; font-family: monospace;';
    const levelStyles: Record<string, string> = {
      info: 'color: #38bdf8; font-weight: 600;',
      success: 'color: #4ade80; font-weight: 700;',
      warn: 'color: #facc15; font-weight: 700;',
      error: 'color: #f87171; font-weight: 800;',
      debug: 'color: #a1a1aa; font-style: italic;',
    };

    const consoleMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : level === 'debug' ? console.debug : console.log;

    if (meta !== undefined && meta !== null) {
      consoleMethod(
        `%c[Сведение видео]%c %c[${tag}]%c %c${timestamp}%c ${message}`,
        'color: #a855f7; font-weight: bold;',
        '',
        tagStyle,
        '',
        timeStyle,
        levelStyles[level] || '',
        meta
      );
    } else {
      consoleMethod(
        `%c[Сведение видео]%c %c[${tag}]%c %c${timestamp}%c ${message}`,
        'color: #a855f7; font-weight: bold;',
        '',
        tagStyle,
        '',
        timeStyle,
        levelStyles[level] || ''
      );
    }

    // UI Console State
    setLogs(prev => {
      const entry: MixingLogEntry = {
        id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp,
        fullTime,
        level,
        tag,
        message,
        stepId,
        meta
      };
      const updated = [...prev, entry];
      return updated.length > 800 ? updated.slice(updated.length - 800) : updated;
    });

    if (level === 'error') {
      setIsConsoleOpen(true);
    }
  }, []);

  // Auto-scroll terminal console
  useEffect(() => {
    if (autoScroll && isConsoleOpen && consoleBottomRef.current) {
      consoleBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, isConsoleOpen]);

  // Player state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackAudioRef = useRef<HTMLAudioElement | null>(null);
  const mixAudioElementsRef = useRef<HTMLAudioElement[]>([]);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<{
    id: string;
    name: string;
    path: string;
    label: string;
    stepId?: string;
    isModuleMix?: boolean;
    mixFiles?: MixingFileItem[];
  } | null>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);

  // Volume controls for player (Pure layering, zero real-time DSP)
  const [playWithVideo, setPlayWithVideo] = useState<boolean>(true);
  const [videoVolume, setVideoVolume] = useState<number>(0.35);
  const [isVideoMuted, setIsVideoMuted] = useState<boolean>(false);
  const [trackVolume, setTrackVolume] = useState<number>(0.95);
  const [isTrackMuted, setIsTrackMuted] = useState<boolean>(false);

  // Helper to stop and clear multi-track module mix audio
  const stopAndClearModuleMix = useCallback(() => {
    mixAudioElementsRef.current.forEach(audio => {
      try {
        audio.pause();
        audio.src = '';
      } catch (e) {}
    });
    mixAudioElementsRef.current = [];
  }, []);

  // Release all audio elements to avoid Win32 / EACCES file lock errors when reprocessing
  const releasePlayerAudioLocks = useCallback(() => {
    try {
      setIsPlaying(false);
      if (videoRef.current) {
        videoRef.current.pause();
      }
      if (trackAudioRef.current) {
        trackAudioRef.current.pause();
        trackAudioRef.current.src = '';
        try { trackAudioRef.current.load(); } catch (e) {}
      }
      mixAudioElementsRef.current.forEach(audio => {
        try {
          audio.pause();
          audio.src = '';
          audio.load();
        } catch (e) {}
      });
      mixAudioElementsRef.current = [];
    } catch (e) {}
  }, []);

  // Load mixing status for current episode
  const loadStatus = useCallback(async () => {
    if (!currentEpisode) return;
    try {
      setIsLoading(true);
      mixLog('debug', 'Статус', `Запрос состояния сведения серии #${currentEpisode.number || 1}...`);
      const res: any = await ipcSafe.invoke('mixing-get-status', {
        episode: currentEpisode,
        targetDir: customTargetDir || undefined
      });
      if (res && res.manifest) {
        setManifest(res.manifest);
        setWorkingDir(res.workingDir || '');
        if (res.moduleDatabase) {
          setModuleDatabase(res.moduleDatabase);
        }
        mixLog('info', 'Статус', `Состояние загружено: «${res.workingDir || ''}». Модулей: ${res.manifest.pipeline?.length || 0}. Исходных дорожек: ${res.manifest.sourceFiles?.dubberTracks?.length || 0}`, {
          manifest: res.manifest,
          workingDir: res.workingDir
        });
      }
    } catch (e: any) {
      mixLog('error', 'Статус', `Ошибка загрузки статуса сведения: ${e.message || String(e)}`, { error: e, stack: e.stack });
      toast.error(`Ошибка загрузки статуса сведения: ${e.message || String(e)}`);
    } finally {
      setIsLoading(false);
    }
  }, [currentEpisode, customTargetDir, mixLog]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Log episode selection changes
  useEffect(() => {
    if (currentEpisode) {
      mixLog('info', 'Серия', `Инициализация серии #${currentEpisode.number || 1} [${currentEpisode.project?.title || 'Проект'}]`, {
        episodeId: currentEpisode.id,
        rawPath: currentEpisode.rawPath,
        subPath: currentEpisode.subPath,
        assignments: currentEpisode.assignments?.length || 0
      });
    }
  }, [currentEpisode, mixLog]);

  // Reset custom target dir when episode changes so default project path is used
  useEffect(() => {
    setCustomTargetDir('');
  }, [currentEpisode?.id]);

  // Resolve video URL for HTML5 video element
  useEffect(() => {
    let active = true;
    const resolveVideo = async () => {
      const vPath = manifest?.finalVideo?.path || manifest?.sourceFiles?.video?.path || currentEpisode?.rawPath;
      if (!vPath) {
        if (active) setVideoSrc(null);
        return;
      }

      if (window.electronAPI) {
        let src = vPath;
        if (!src.startsWith('http') && !src.startsWith('custom-media://') && !src.startsWith('blob:')) {
          const cleanP = src.replace(/^file:\/\//, '').replace(/\\/g, '/');
          src = `custom-media://${encodeURIComponent(cleanP).replace(/%2F/g, '/')}`;
        }
        if (active) {
          setVideoSrc(src);
          const fileName = vPath.split(/[/\\]/).pop() || src;
          mixLog('debug', 'Видео', `Видеопоток подключен: ${fileName} (${src.slice(0, 50)}...)`);
        }
      } else {
        try {
          const resolved = await resolveLocalPath(vPath);
          if (active) {
            setVideoSrc(resolved);
            mixLog('debug', 'Видео', `Локальный видеопоток разрешен: ${vPath}`);
          }
        } catch (e) {
          if (active) setVideoSrc(vPath);
        }
      }
    };

    resolveVideo();
    return () => { active = false; };
  }, [manifest?.finalVideo?.path, manifest?.sourceFiles?.video?.path, currentEpisode?.rawPath, mixLog]);

  // Listen to IPC progress and log events
  useEffect(() => {
    const unsubProgress = ipcSafe.on('mixing-progress', (data: any) => {
      if (data) {
        if (typeof data.percent === 'number') {
          setUvrDownloadPercent(data.percent);
          if (data.stepId) {
            setStepProgress(prev => ({ ...prev, [data.stepId]: data.percent }));
          } else {
            setImportProgress(data.percent);
          }
          if (data.percent === 100) {
            loadStatus();
          }
        }
        if (data.message) {
          setImportStatusMessage(data.message);
          mixLog('debug', 'Прогресс', `[${data.percent !== undefined ? data.percent + '%' : '...'}] ${data.message}`, data);
        }
      }
    });

    const unsubLog = ipcSafe.on('mixing-log', (data: any) => {
      if (data && data.message) {
        const level = data.level === 'warn' ? 'warn' : data.level === 'error' ? 'error' : data.level === 'debug' ? 'debug' : 'info';
        const tag = data.stepId ? `Шаг:${data.stepId}` : 'Сервер';
        mixLog(level, tag, data.message, data.meta, data.stepId);
      }
    });

    const unsubTask = ipcSafe.on('task-completed', (data: any) => {
      if (data) {
        mixLog('debug', 'Фон', 'Получено уведомление о завершении фоновой задачи. Обновление состояния сведения...');
        loadStatus();
      }
    });

    const handleFocus = () => {
      loadStatus();
    };

    window.addEventListener('focus', handleFocus);

    return () => {
      if (unsubProgress) unsubProgress();
      if (unsubLog) unsubLog();
      if (unsubTask) unsubTask();
      window.removeEventListener('focus', handleFocus);
    };
  }, [loadStatus, mixLog]);

  // Connect video volume and mute state
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isVideoMuted;
      videoRef.current.volume = isVideoMuted ? 0 : Math.min(1, Math.max(0, videoVolume));
    }
  }, [videoVolume, isVideoMuted, videoSrc]);

  useEffect(() => {
    const vol = isTrackMuted ? 0 : Math.min(1, Math.max(0, trackVolume));
    if (trackAudioRef.current) {
      trackAudioRef.current.volume = Math.min(1, vol);
    }
    mixAudioElementsRef.current.forEach(a => {
      a.volume = Math.min(1, vol);
    });
  }, [trackVolume, isTrackMuted]);

  // Select original audio source for playback
  const selectOriginalAudioTrack = useCallback(async () => {
    let origPath = manifest?.sourceFiles?.originalAudio?.path;
    if (!origPath) {
      try {
        const res: any = await ipcSafe.invoke('mixing-refresh-sources', {
          episode: currentEpisode,
          targetDir: workingDir || customTargetDir || undefined
        });
        if (res && res.manifest?.sourceFiles?.originalAudio?.path) {
          setManifest(res.manifest);
          origPath = res.manifest.sourceFiles.originalAudio.path;
        }
      } catch (e) {}
    }

    if (!origPath) {
      // Fallback: unmute video audio element directly so user can hear original sound!
      setIsVideoMuted(false);
      if (videoVolume < 0.2) setVideoVolume(0.8);
      stopAndClearModuleMix();
      setSelectedAudioTrack(null);
      toast.info('Звук оригинала воспроизводится напрямую из видеофайла 🎬');
      return;
    }

    let resolvedSrc = origPath;
    if (window.electronAPI) {
      if (!resolvedSrc.startsWith('http') && !resolvedSrc.startsWith('custom-media://') && !resolvedSrc.startsWith('blob:')) {
        const cleanP = resolvedSrc.replace(/^file:\/\//, '').replace(/\\/g, '/');
        resolvedSrc = `custom-media://${encodeURIComponent(cleanP).replace(/%2F/g, '/')}`;
      }
    } else {
      try {
        resolvedSrc = await resolveLocalPath(origPath);
      } catch (e) {}
    }

    stopAndClearModuleMix();

    if (trackAudioRef.current) {
      trackAudioRef.current.pause();
      trackAudioRef.current.src = resolvedSrc;
      trackAudioRef.current.currentTime = currentTime;
      if (isPlaying) {
        trackAudioRef.current.play().catch(() => {});
      }
    }

    setSelectedAudioTrack({
      id: 'original_audio_source',
      name: 'Оригинальный звук серии (Японский исходник)',
      path: resolvedSrc,
      label: 'Оригинал',
    });

    toast.info('Включена оригинальная звуковая дорожка серии', { duration: 2500 });
  }, [manifest?.sourceFiles?.originalAudio?.path, currentEpisode, workingDir, customTargetDir, currentTime, isPlaying, stopAndClearModuleMix, videoVolume]);

  // Handle Play / Pause synchronization
  const togglePlay = useCallback(() => {
    if (isPlaying) {
      if (videoRef.current) videoRef.current.pause();
      if (trackAudioRef.current) trackAudioRef.current.pause();
      mixAudioElementsRef.current.forEach(a => a.pause());
      setIsPlaying(false);
    } else {
      if (videoRef.current) {
        videoRef.current.muted = isVideoMuted;
        videoRef.current.volume = isVideoMuted ? 0 : Math.min(1, Math.max(0, videoVolume));
        videoRef.current.play().catch(e => console.warn('Video play warning:', e));
      }

      if (!selectedAudioTrack && manifest?.sourceFiles?.originalAudio?.path) {
        selectOriginalAudioTrack();
      } else if (selectedAudioTrack?.isModuleMix) {
        mixAudioElementsRef.current.forEach(a => a.play().catch(e => console.warn('Mix audio play warning:', e)));
      } else if (trackAudioRef.current && selectedAudioTrack) {
        trackAudioRef.current.play().catch(e => console.warn('Track audio play warning:', e));
      }
      setIsPlaying(true);
    }
  }, [isPlaying, isVideoMuted, videoVolume, selectedAudioTrack, manifest?.sourceFiles?.originalAudio?.path, selectOriginalAudioTrack]);

  // Sync seek position
  const handleSeek = (time: number) => {
    setCurrentTime(time);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
    if (trackAudioRef.current) {
      trackAudioRef.current.currentTime = time;
    }
    mixAudioElementsRef.current.forEach(a => {
      a.currentTime = time;
    });
  };

  // Video event handlers
  const handleVideoTimeUpdate = () => {
    if (!videoRef.current) return;
    const vTime = videoRef.current.currentTime;
    setCurrentTime(vTime);

    // Keep trackAudio in tight sync with video
    if (trackAudioRef.current && !trackAudioRef.current.paused) {
      const diff = Math.abs(trackAudioRef.current.currentTime - vTime);
      if (diff > 0.15) {
        trackAudioRef.current.currentTime = vTime;
      }
    }

    // Keep module mix audio elements in tight sync with video
    if (mixAudioElementsRef.current.length > 0) {
      mixAudioElementsRef.current.forEach(a => {
        if (!a.paused) {
          const diff = Math.abs(a.currentTime - vTime);
          if (diff > 0.15) {
            a.currentTime = vTime;
          }
        }
      });
    }
  };

  const handleVideoLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    setDuration(e.currentTarget.duration || 0);
  };

  // Select an audio file for inspection in the player
  const selectTrackForInspection = async (item: MixingFileItem, label: string, stepId?: string) => {
    stopAndClearModuleMix();

    let resolvedSrc = item.path;
    if (window.electronAPI) {
      if (!resolvedSrc.startsWith('http') && !resolvedSrc.startsWith('custom-media://') && !resolvedSrc.startsWith('blob:')) {
        const cleanP = resolvedSrc.replace(/^file:\/\//, '').replace(/\\/g, '/');
        resolvedSrc = `custom-media://${encodeURIComponent(cleanP).replace(/%2F/g, '/')}`;
      }
    } else {
      try {
        resolvedSrc = await resolveLocalPath(item.path);
      } catch (e) {}
    }

    if (trackAudioRef.current) {
      trackAudioRef.current.pause();
      trackAudioRef.current.src = resolvedSrc;
      trackAudioRef.current.currentTime = currentTime;
      if (isPlaying) {
        trackAudioRef.current.play().catch(() => {});
      }
    }

    setSelectedAudioTrack({
      id: item.path,
      name: item.name,
      path: resolvedSrc,
      label,
      stepId
    });

    toast.info(`Выбран для прослушивания: ${item.name}`, { duration: 2500 });
  };

  // Select module mix for multi-track playback
  const selectModuleMixForInspection = async (step: PipelineStep) => {
    if (!step.outputFiles || step.outputFiles.length === 0) {
      toast.error('У этого модуля ещё нет сохраненных обработанных дорожек');
      return;
    }

    const meta = getModuleMeta(step.moduleId);

    // Stop single track audio
    if (trackAudioRef.current) {
      trackAudioRef.current.pause();
      trackAudioRef.current.src = '';
    }

    // Clear previous mix elements
    stopAndClearModuleMix();

    if (step.outputFiles.length === 1) {
      selectTrackForInspection(step.outputFiles[0], `${meta?.title || step.moduleId}: ${step.outputFiles[0].name}`, step.stepId);
      return;
    }

    const audioElements: HTMLAudioElement[] = [];
    for (const file of step.outputFiles) {
      let resolvedSrc = file.path;
      if (window.electronAPI) {
        if (!resolvedSrc.startsWith('http') && !resolvedSrc.startsWith('custom-media://') && !resolvedSrc.startsWith('blob:')) {
          const cleanP = resolvedSrc.replace(/^file:\/\//, '').replace(/\\/g, '/');
          resolvedSrc = `custom-media://${encodeURIComponent(cleanP).replace(/%2F/g, '/')}`;
        }
      } else {
        try {
          resolvedSrc = await resolveLocalPath(file.path);
        } catch (e) {}
      }

      const audio = new Audio(resolvedSrc);
      audio.currentTime = currentTime;
      audio.volume = isTrackMuted ? 0 : Math.min(1, Math.max(0, trackVolume));
      audioElements.push(audio);
    }

    mixAudioElementsRef.current = audioElements;

    setSelectedAudioTrack({
      id: `module_mix_${step.stepId}`,
      name: `Микс всех дорожек модуля «${meta?.title || step.moduleId}» (${step.outputFiles.length} шт.)`,
      path: '',
      label: `Микс модуля (${step.outputFiles.length} шт.)`,
      stepId: step.stepId,
      isModuleMix: true,
      mixFiles: step.outputFiles
    });

    if (isPlaying) {
      audioElements.forEach(a => a.play().catch(e => console.warn('Mix track play warning:', e)));
    }

    toast.success(`В плеере включен совместный микс всех ${step.outputFiles.length} дорожек модуля!`, { duration: 3000 });
  };

  // Pipeline save debounce ref & status indicator
  const saveDebounceTimerRef = useRef<any>(null);
  const [isPipelineSaving, setIsPipelineSaving] = useState<boolean>(false);
  const [lastPipelineSavedAt, setLastPipelineSavedAt] = useState<string>('Синхронизировано');

  // Save modified pipeline
  const savePipeline = useCallback(async (newPipeline: PipelineStep[], immediate = false) => {
    if (!currentEpisode) return;

    // Optimistically update local UI state immediately
    setManifest(prev => prev ? { ...prev, pipeline: newPipeline } : null);

    const performSave = async () => {
      try {
        setIsPipelineSaving(true);
        const res: any = await ipcSafe.invoke('mixing-save-pipeline-config', {
          episode: currentEpisode,
          targetDir: workingDir || customTargetDir,
          pipeline: newPipeline
        });
        if (res && res.manifest) {
          setManifest(res.manifest);
        }
        const now = new Date();
        setLastPipelineSavedAt(now.toLocaleTimeString('ru-RU', { hour12: false }));
        mixLog('debug', 'Конвейер', `Цепочка модулей записана в mixing_pipeline.json (${newPipeline.length} шт.)`);
      } catch (e: any) {
        toast.error(`Не удалось сохранить структуру конвейера: ${e.message || String(e)}`);
      } finally {
        setIsPipelineSaving(false);
      }
    };

    if (immediate) {
      if (saveDebounceTimerRef.current) clearTimeout(saveDebounceTimerRef.current);
      await performSave();
    } else {
      if (saveDebounceTimerRef.current) clearTimeout(saveDebounceTimerRef.current);
      saveDebounceTimerRef.current = setTimeout(() => {
        performSave();
      }, 250);
    }
  }, [currentEpisode, workingDir, customTargetDir, mixLog]);

  // Clean up debounce timer
  useEffect(() => {
    return () => {
      if (saveDebounceTimerRef.current) clearTimeout(saveDebounceTimerRef.current);
    };
  }, []);

  // Pipeline manager: Move step Up
  const handleMoveStepUp = (index: number) => {
    if (!manifest?.pipeline || index <= 0) return;
    const newPipeline = [...manifest.pipeline];
    const temp = newPipeline[index];
    newPipeline[index] = newPipeline[index - 1];
    newPipeline[index - 1] = temp;
    newPipeline.forEach((s, idx) => {
      const def = moduleDatabase.find(m => m.id === s.moduleId);
      s.prefix = `${String(idx + 1).padStart(2, '0')}_${def?.defaultPrefix || 'mod_'}`;
    });
    savePipeline(newPipeline, true);
  };

  // Pipeline manager: Move step Down
  const handleMoveStepDown = (index: number) => {
    if (!manifest?.pipeline || index >= manifest.pipeline.length - 1) return;
    const newPipeline = [...manifest.pipeline];
    const temp = newPipeline[index];
    newPipeline[index] = newPipeline[index + 1];
    newPipeline[index + 1] = temp;
    newPipeline.forEach((s, idx) => {
      const def = moduleDatabase.find(m => m.id === s.moduleId);
      s.prefix = `${String(idx + 1).padStart(2, '0')}_${def?.defaultPrefix || 'mod_'}`;
    });
    savePipeline(newPipeline, true);
  };

  // Pipeline manager: Delete step
  const handleDeleteStep = (index: number) => {
    if (!manifest?.pipeline) return;
    const stepToDelete = manifest.pipeline[index];
    const newPipeline = manifest.pipeline.filter((_, idx) => idx !== index);
    newPipeline.forEach((s, idx) => {
      const def = moduleDatabase.find(m => m.id === s.moduleId);
      s.prefix = `${String(idx + 1).padStart(2, '0')}_${def?.defaultPrefix || 'mod_'}`;
    });
    savePipeline(newPipeline, true);
    toast.success(`Модуль «${stepToDelete.moduleId}» удален из конвейера`);
  };

  // Pipeline manager: Toggle enabled/bypass
  const handleToggleStep = (index: number) => {
    if (!manifest?.pipeline) return;
    const newPipeline = [...manifest.pipeline];
    newPipeline[index] = { ...newPipeline[index], enabled: !newPipeline[index].enabled };
    savePipeline(newPipeline, true);
  };

  // Pipeline manager: Update parameters for a step (debounced for sliders/inputs)
  const handleUpdateStepParams = (stepId: string, paramKey: string, value: any) => {
    if (!manifest?.pipeline) return;
    const newPipeline = manifest.pipeline.map(s => {
      if (s.stepId === stepId) {
        return { ...s, params: { ...s.params, [paramKey]: value } };
      }
      return s;
    });
    savePipeline(newPipeline, false);
  };

  // Pipeline manager: Apply Preset to a step
  const handleApplyPreset = (stepId: string, preset: MixingModulePreset) => {
    if (!manifest?.pipeline) return;
    const newPipeline = manifest.pipeline.map(s => {
      if (s.stepId === stepId) {
        return { ...s, params: { ...s.params, ...preset.params } };
      }
      return s;
    });
    savePipeline(newPipeline, true);
    toast.success(`Применен пресет: «${preset.title}»`);
  };

  // Export pipeline to external file
  const handleExportPipelineToFile = async () => {
    if (!manifest?.pipeline || manifest.pipeline.length === 0) {
      toast.error('Конвейер пуст, нечего экспортировать');
      return;
    }
    try {
      const defaultName = currentEpisode?.project?.title
        ? `mixing_pipeline_${currentEpisode.project.title.replace(/[\/:*?"<>|]/g, '_')}.json`
        : 'mixing_pipeline.json';
      const res: any = await ipcSafe.invoke('mixing-export-pipeline-file', {
        pipeline: manifest.pipeline,
        defaultName
      });
      if (res && !res.canceled && res.filePath) {
        toast.success(`Конвейер успешно сохранен в файл: ${res.filePath.split(/[/\\]/).pop()}! 💾`);
      }
    } catch (e: any) {
      toast.error(`Ошибка экспорта файла: ${e.message || String(e)}`);
    }
  };

  // Import pipeline from external file
  const handleImportPipelineFromFile = async () => {
    if (!currentEpisode) return;
    try {
      const res: any = await ipcSafe.invoke('mixing-import-pipeline-file', {
        episode: currentEpisode,
        targetDir: workingDir || customTargetDir
      });
      if (res && !res.canceled && res.pipeline) {
        setManifest(res.manifest);
        toast.success(`Конвейер (${res.pipeline.length} модулей) успешно загружен из файла! 📂`);
      }
    } catch (e: any) {
      toast.error(`Ошибка импорта: ${e.message || String(e)}`);
    }
  };

  // Reset pipeline to factory default
  const handleResetPipelineToDefault = async () => {
    if (!currentEpisode) return;
    if (!window.confirm('Сбросить цепочку модулей к базовому заводскому конвейеру (6 модулей)? Все текущие настройки будут возвращены к исходным.')) {
      return;
    }
    try {
      const res: any = await ipcSafe.invoke('mixing-reset-pipeline-default', {
        episode: currentEpisode,
        targetDir: workingDir || customTargetDir
      });
      if (res && res.manifest) {
        setManifest(res.manifest);
        toast.success('Конвейер сброшен к базовой заводской цепочке');
      }
    } catch (e: any) {
      toast.error(`Ошибка сброса: ${e.message || String(e)}`);
    }
  };

  // Load Pipeline Presets
  const loadPipelinePresets = useCallback(async () => {
    try {
      setIsLoadingPresets(true);
      const res: any = await ipcSafe.invoke('mixing-get-pipeline-presets', {});
      if (res && res.presets) {
        setPipelinePresets(res.presets);
      }
    } catch (e: any) {
      console.error('Failed to load pipeline presets:', e);
    } finally {
      setIsLoadingPresets(false);
    }
  }, []);

  const handleOpenPresetsModal = () => {
    loadPipelinePresets();
    setIsPipelinePresetsModalOpen(true);
  };

  const handleApplyPipelinePreset = (preset: PipelinePreset) => {
    if (!preset || !Array.isArray(preset.pipeline)) return;
    savePipeline(preset.pipeline, true);
    setIsPipelinePresetsModalOpen(false);
    toast.success(`Применен пресет всей цепочки: «${preset.name}»! 🚀`);
  };

  const handleSaveCurrentPipelineAsPreset = async () => {
    if (!newPresetName.trim()) {
      toast.error('Введите название пресета');
      return;
    }
    if (!manifest?.pipeline || manifest.pipeline.length === 0) {
      toast.error('Конвейер пуст, нечего сохранять в пресет');
      return;
    }

    try {
      const res: any = await ipcSafe.invoke('mixing-save-pipeline-preset', {
        name: newPresetName.trim(),
        description: newPresetDesc.trim(),
        pipeline: manifest.pipeline
      });

      if (res && res.preset) {
        toast.success(`Пресет «${newPresetName}» успешно сохранен! 💾`);
        setNewPresetName('');
        setNewPresetDesc('');
        setIsSavePresetModalOpen(false);
        await loadPipelinePresets();
      }
    } catch (e: any) {
      toast.error(`Ошибка сохранения пресета: ${e.message || String(e)}`);
    }
  };

  const handleDeletePipelinePreset = async (presetId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res: any = await ipcSafe.invoke('mixing-delete-pipeline-preset', { presetId });
      if (res && res.success) {
        toast.success('Пользовательский пресет удален');
        await loadPipelinePresets();
      }
    } catch (e: any) {
      toast.error(`Ошибка удаления: ${e.message || String(e)}`);
    }
  };

  // External Files Selection Dialogs
  const handleSelectExternalFile = async (type: 'video' | 'subtitles' | 'audio') => {
    try {
      const res: any = await ipcSafe.invoke('mixing-select-external-files', { type });
      if (res && !res.canceled && res.filePaths && res.filePaths.length > 0) {
        if (type === 'video') {
          setExtVideoPath(res.filePaths[0]);
        } else if (type === 'subtitles') {
          setExtSubPath(res.filePaths[0]);
        } else if (type === 'audio') {
          setExtAudioPaths(prev => Array.from(new Set([...prev, ...res.filePaths])));
        }
      }
    } catch (e: any) {
      toast.error(`Ошибка выбора файла: ${e.message || String(e)}`);
    }
  };

  const handleImportExternalFilesSubmit = async () => {
    if (!currentEpisode) return;
    if (!extVideoPath && !extSubPath && extAudioPaths.length === 0) {
      toast.error('Выберите хотя бы один файл (видео, субтитры или аудио)');
      return;
    }

    try {
      setIsSubmittingExternal(true);
      mixLog('info', 'ВнешнийИмпорт', `Импорт сторонних материалов: video=${extVideoPath || 'нет'}, sub=${extSubPath || 'нет'}, audio=${extAudioPaths.length} шт.`, {
        video: extVideoPath,
        subtitles: extSubPath,
        audioCount: extAudioPaths.length,
        audioPaths: extAudioPaths
      });
      toast.info('Импорт внешних файлов в сведение серии...');

      const res: any = await ipcSafe.invoke('mixing-import-external-files', {
        episode: currentEpisode,
        targetDir: workingDir || customTargetDir,
        videoPath: extVideoPath || undefined,
        subPath: extSubPath || undefined,
        audioPaths: extAudioPaths
      });

      if (res && res.manifest) {
        setManifest(res.manifest);
        setWorkingDir(res.workingDir || '');
        mixLog('success', 'ВнешнийИмпорт', `Внешние материалы успешно импортированы в сведение!`);
        toast.success('Внешние материалы успешно импортированы в сведение! 🎬');
        setIsExternalImportModalOpen(false);
        setExtVideoPath('');
        setExtSubPath('');
        setExtAudioPaths([]);
        await loadStatus();
      }
    } catch (e: any) {
      mixLog('error', 'ВнешнийИмпорт', `Ошибка импорта внешних файлов: ${e.message || String(e)}`, { error: e, stack: e.stack });
      console.error('Import external files error:', e);
      toast.error(`Ошибка импорта внешних файлов: ${e.message || String(e)}`);
    } finally {
      setIsSubmittingExternal(false);
    }
  };

  // Re-scan episode directory and extract 00_original_audio.wav on-the-fly
  const handleRescanSources = async () => {
    if (!currentEpisode) return;
    try {
      toast.info('Поиск видеофайла серии и извлечение звука оригинала...');
      mixLog('info', 'Сканирование', 'Запуск пересканирования папки серии и извлечения аудиодорожки оригинала...');
      const res: any = await ipcSafe.invoke('mixing-refresh-sources', {
        episode: currentEpisode,
        targetDir: workingDir || customTargetDir || undefined
      });
      if (res && res.manifest) {
        setManifest(res.manifest);
        if (res.workingDir) setWorkingDir(res.workingDir);
        toast.success('Исходные файлы и звук оригинала обновлены! 🎵');
        mixLog('success', 'Сканирование', `Синхронизировано: видео=${res.manifest?.sourceFiles?.video?.name || 'нет'}, оригинал=${res.manifest?.sourceFiles?.originalAudio?.name || 'нет'}`);
        await loadStatus();
      }
    } catch (e: any) {
      toast.error(`Ошибка пересканирования: ${e.message}`);
      mixLog('error', 'Сканирование', `Ошибка: ${e.message}`);
    }
  };

  // Pipeline manager: Add module from database
  const handleAddModuleFromDatabase = (modDef: MixingModuleDef) => {
    if (!manifest?.pipeline) return;
    const newIndex = manifest.pipeline.length;
    const newPrefix = `${String(newIndex + 1).padStart(2, '0')}_${modDef.defaultPrefix}`;
    const newStep: PipelineStep = {
      stepId: `step_${Date.now()}_${modDef.id}`,
      moduleId: modDef.id,
      prefix: newPrefix,
      enabled: true,
      params: { ...modDef.defaultParams },
      status: 'idle',
      outputFiles: []
    };
    const newPipeline = [...manifest.pipeline, newStep];
    mixLog('info', 'Конвейер', `Добавлен модуль «${modDef.title}» (префикс: ${newPrefix}) в позицию #${newIndex + 1}`);
    savePipeline(newPipeline, true);
    setIsAddModuleModalOpen(false);
    toast.success(`Модуль «${modDef.title}» добавлен в конвейер!`);
  };

  // Execute single step
  const handleRunStep = async (stepId: string) => {
    if (!currentEpisode) return;
    releasePlayerAudioLocks();
    const targetStep = manifest?.pipeline?.find(s => s.stepId === stepId);
    const stepMeta = targetStep ? getModuleMeta(targetStep.moduleId) : undefined;
    const stepTitle = stepMeta?.title || targetStep?.moduleId || stepId;
    try {
      setActiveProcessingStepId(stepId);
      setStepProgress(prev => ({ ...prev, [stepId]: 5 }));
      mixLog('info', 'Шаг', `🚀 Запуск шага конвейера: «${stepTitle}» (ID: ${stepId})`, {
        params: targetStep?.params,
        prefix: targetStep?.prefix
      });

      const res: any = await ipcSafe.invoke('mixing-run-step', {
        episode: currentEpisode,
        targetDir: workingDir || customTargetDir,
        stepId
      });

      if (res && res.success) {
        mixLog('success', 'Шаг', `✅ Шаг «${stepTitle}» успешно выполнен за ${res.durationSec || '?'}s! Сформировано файлов: ${res.outputFiles?.length || 0}`, {
          outputFiles: res.outputFiles
        });
        toast.success(`Шаг успешно выполнен! Файлы сохранены на диск. 🚀`);
        await loadStatus();
      }
    } catch (e: any) {
      mixLog('error', 'Шаг', `❌ Сбой выполнения шага «${stepTitle}»: ${e.message || String(e)}`, {
        error: e,
        stack: e.stack,
        stepId,
        params: targetStep?.params
      });
      console.error(`Run step error:`, e);
      toast.error(`Ошибка выполнения шага: ${e.message || String(e)}`);
    } finally {
      setActiveProcessingStepId(null);
      setStepProgress(prev => ({ ...prev, [stepId]: 0 }));
      await loadStatus();
    }
  };

  // Execute all enabled steps
  const handleRunAllSteps = async () => {
    if (!currentEpisode) return;
    releasePlayerAudioLocks();
    const enabledCount = manifest?.pipeline?.filter(s => s.enabled)?.length || 0;
    try {
      setActiveProcessingStepId('all');
      mixLog('info', 'Конвейер', `🎬 Запуск полной цепочки сведения (${enabledCount} активных модулей)...`);
      toast.info('Запуск конвейера сведения по цепочке модулей...');

      const res: any = await ipcSafe.invoke('mixing-run-all-steps', {
        episode: currentEpisode,
        targetDir: workingDir || customTargetDir
      });

      if (res && res.success) {
        mixLog('success', 'Конвейер', `🎉 Все активные модули сведения успешно выполнены!`, res);
        toast.success('Все активные модули сведения успешно выполнены! 🎉');
        await loadStatus();
      }
    } catch (e: any) {
      mixLog('error', 'Конвейер', `❌ Критический сбой при выполнении конвейера сведения: ${e.message || String(e)}`, {
        error: e,
        stack: e.stack
      });
      console.error('Run all steps error:', e);
      toast.error(`Ошибка при сведении: ${e.message || String(e)}`);
    } finally {
      setActiveProcessingStepId(null);
      await loadStatus();
    }
  };

  // Execute "Import sound engineer files"
  const handleImportSoundEngineerFiles = async () => {
    if (!currentEpisode) {
      toast.error('Серия не выбрана');
      return;
    }

    try {
      setIsImporting(true);
      setImportProgress(5);
      setImportStatusMessage('Подготовка экспорта звукорежиссеру...');
      const effectiveTarget = (customTargetDir && customTargetDir.trim()) ? customTargetDir.trim() : (workingDir || undefined);
      mixLog('info', 'Импорт', `Запуск экспорта/импорта файлов звукорежиссера (папка: ${effectiveTarget || 'автоматически'}, тайминг: ${importAutoTiming}, фиксы: ${importAutoFixes}, субтитры: ${importSubtitles})...`);

      const res: any = await ipcSafe.invoke('mixing-import-sound-engineer-files', {
        episode: currentEpisode,
        targetDir: effectiveTarget,
        autoTiming: importAutoTiming,
        autoApplyFixes: importAutoFixes,
        includeSubtitles: importSubtitles,
        smartExport: true,
        skipConversion: true,
        additionalProcessing: false
      });

      if (res && res.manifest) {
        setManifest(res.manifest);
        setWorkingDir(res.workingDir || '');
        mixLog('success', 'Импорт', `Файлы звукорежиссера успешно импортированы в сведение!`);
        toast.success('Файлы звукорежиссера успешно импортированы в сведение серии! 🎉');
        setIsImportModalOpen(false);
      }
    } catch (e: any) {
      mixLog('error', 'Импорт', `Ошибка импорта файлов звукорежиссера: ${e.message || String(e)}`, { error: e, stack: e.stack });
      console.error('Import sound engineer error:', e);
      toast.error(`Ошибка импорта файлов звукорежиссера: ${e.message || String(e)}`);
    } finally {
      setIsImporting(false);
      setImportProgress(0);
      setImportStatusMessage('');
    }
  };

  // Save final video
  const handleSaveFinalVideo = async () => {
    if (!currentEpisode) return;
    try {
      mixLog('info', 'ЭкспортВидео', `Запрос сохранения сведенного видео серии...`);
      const res: any = await ipcSafe.invoke('mixing-save-final-video', {
        episode: currentEpisode,
        targetDir: workingDir || customTargetDir
      });

      if (res && res.canceled) {
        mixLog('debug', 'ЭкспортВидео', `Сохранение видео отменено пользователем`);
        return;
      }
      if (res && res.success) {
        mixLog('success', 'ЭкспортВидео', `Готовое видео сохранено: ${res.savedPath}`);
        toast.success(`Готовое видео серии сохранено: ${res.savedPath} 🎬`);
      }
    } catch (e: any) {
      mixLog('error', 'ЭкспортВидео', `Ошибка сохранения видео: ${e.message || String(e)}`, { error: e, stack: e.stack });
      toast.error(`Ошибка сохранения видео: ${e.message || String(e)}`);
    }
  };

  // Open folder in explorer
  const handleOpenFolder = async () => {
    try {
      mixLog('debug', 'Папка', `Открытие рабочей папки: ${workingDir}`);
      await ipcSafe.invoke('mixing-open-folder', { folderPath: workingDir });
    } catch (e: any) {
      mixLog('error', 'Папка', `Не удалось открыть папку: ${e.message || String(e)}`);
      toast.error(`Не удалось открыть папку: ${e.message || String(e)}`);
    }
  };

  // Download / Activate UVR model
  const handleDownloadUvrModel = async (targetModelId: string = 'uvr_denoise_lite') => {
    const targetDef = moduleDatabase.find(m => m.id === targetModelId);
    const modelName = targetDef?.name || targetDef?.title || targetModelId;
    const sizeMb = targetDef?.size_mb || 40;

    try {
      setIsDownloadingUvrModel(true);
      setUvrDownloadPercent(5);
      mixLog('info', 'Модель', `Запуск загрузки/инициализации нейромодели «${modelName}» (${sizeMb} МБ)...`, {
        modelId: targetModelId,
        urls: targetDef?.urls,
        filename: targetDef?.filename
      });
      toast.info(`Запуск загрузки модели ${modelName} (${sizeMb} МБ)...`);

      const res: any = await ipcSafe.invoke('mixing-download-uvr-model', {
        modelId: targetModelId
      });

      if (res && res.success) {
        mixLog('success', 'Модель', `Модель ${targetDef?.filename || modelName} успешно активирована!`, res);
        toast.success(`Модель ${targetDef?.filename || modelName} успешно активирована и готова к работе! 🛡`);
        await loadStatus();
      } else {
        mixLog('error', 'Модель', `Не удалось активировать модель ${modelName}: ${res?.error || 'неизвестная ошибка'}`);
        toast.error(`Не удалось активировать модель ${modelName}`);
      }
    } catch (e: any) {
      mixLog('error', 'Модель', `Ошибка загрузки модели ${modelName}: ${e.message || String(e)}`, { error: e, stack: e.stack });
      toast.error(`Ошибка загрузки модели: ${e.message || String(e)}`);
    } finally {
      setIsDownloadingUvrModel(false);
      setUvrDownloadPercent(0);
    }
  };

  // Copy all console logs to clipboard
  const handleCopyLogs = async () => {
    const text = logs
      .map(l => `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.tag}] ${l.message}${l.meta ? '\n  ' + JSON.stringify(l.meta) : ''}`)
      .join('\n');
    await safeCopyToClipboard(text);
    toast.success(`Скопировано ${logs.length} строк логов в буфер обмена 📋`);
    mixLog('debug', 'Консоль', `Все логи (${logs.length} записей) скопированы в буфер обмена`);
  };

  // Download logs to text file
  const handleDownloadLogs = () => {
    const header = `=== Лог процесса сведения видео ===\nСерия: #${currentEpisode?.number || 1} [${currentEpisode?.project?.title || 'Проект'}]\nДата выгрузки: ${new Date().toLocaleString('ru-RU')}\nВсего записей: ${logs.length}\n=====================================\n\n`;
    const text = header + logs
      .map(l => `[${l.fullTime}] [${l.level.toUpperCase()}] [${l.tag}] ${l.message}${l.meta ? '\n' + JSON.stringify(l.meta, null, 2) : ''}`)
      .join('\n\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mixing_process_${currentEpisode?.number || 1}_${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Лог-файл процесса сохранен на диск! 💾');
    mixLog('info', 'Консоль', `Лог-файл сохранен (записей: ${logs.length})`);
  };

  // Clear console logs
  const handleClearLogs = () => {
    setLogs([]);
    mixLog('info', 'Консоль', 'Консоль процесса очищена');
  };

  const PARAM_LABELS: Record<string, { label: string; unit?: string }> = {
    sensitivity: { label: 'Чувствительность (Sensitivity)', unit: 'x' },
    wetDryBlend: { label: 'Смешивание Dry/Wet (Blend)', unit: '%' },
    attenuationLimitDb: { label: 'Предел шумоподавления (Attenuation Limit)', unit: 'dB' },
    reverbReduction: { label: 'Степень дериверберации (Reverb Reduction)', unit: 'x' },
    shifts: { label: 'Качество смещений (Demucs Shifts)', unit: 'x' },
    overlap: { label: 'Перекрытие фреймов (Overlap)', unit: 'x' },
    segment: { label: 'Длина сегмента (Segment Length)', unit: 'с' },
    stems: { label: 'Выбор стемов для экспорта' },
    noiseTraining: { label: 'Активное обучение шуму (Noise Training)' },
    marginDb: { label: 'Запас усиления вокала (Vocal Margin)', unit: 'dB' },
    postProcessThreshold: { label: 'Порог шумового гейта (Gate Threshold)', unit: 'x' },
    instrumentalBlend: { label: 'Смешивание M&E фонограммы (BGM Blend)', unit: '%' },
    noiseReductionDb: { label: 'Подавление шума (Noise Reduction)', unit: 'dB' },
    noiseFloorDb: { label: 'Порог фонового шума (Noise Floor)', unit: 'dB' },
    stationarityWeight: { label: 'Вес стационарности (Stationarity)', unit: 'x' },
    frequencySmoothingHz: { label: 'Сглаживание спектра (Smoothing)', unit: 'Гц' },
    preserveVoiceFormants: { label: 'Сохранение формант речи (Formant Restoration)' },
    deechoReductionDb: { label: 'Степень подавления эха (De-Echo)', unit: 'dB' },
    earlyReflectionsDecay: { label: 'Подавление ранних отражений', unit: 'x' },
    reverbTailSuppress: { label: 'Приглушение хвостов реверберации', unit: 'x' },
    roomSizeEstimate: { label: 'Оценка размера комнаты' },
    preserveBodyFrequencies: { label: 'Сохранение низких и средних частот (Тело голоса)' },
    airBandBoostDb: { label: 'Подъем воздуха (Air-Band 14kHz)', unit: 'dB' },
    harmonicSaturation: { label: 'Аналоговая сатурация (Saturation)', unit: 'x' },
    formantClarity: { label: 'Читаемость формант (Clarity)', unit: 'x' },
    subBassPreservation: { label: 'Защита фундаментальных басов' },
    warmTubeEmulation: { label: 'Ламповая эмуляция (Warm Tube)' },
    autoDownloadModel: { label: 'Автозагрузка модели при отсутствии' },
    thresholdDb: { label: 'Порог срабатывания (Threshold)', unit: 'dB' },
    rangeDb: { label: 'Диапазон подавления (Range)', unit: 'dB' },
    attackMs: { label: 'Атака (Attack)', unit: 'мс' },
    releaseMs: { label: 'Спад / Релиз (Release)', unit: 'мс' },
    holdMs: { label: 'Удержание (Hold)', unit: 'мс' },
    detectionMode: { label: 'Детектор уровня' },
    targetLufs: { label: 'Целевая громкость (Target LUFS)', unit: 'LUFS' },
    truePeak: { label: 'Истинный пик (True Peak)', unit: 'dBTP' },
    loudnessRange: { label: 'Динамический диапазон (LRA)', unit: 'LU' },
    maxGainDb: { label: 'Максимальное усиление (Max Gain)', unit: 'dB' },
    dualMono: { label: 'Обработка Dual-Mono' },
    frequencyHz: { label: 'Частота сибилянтов (Frequency)', unit: 'Гц' },
    intensity: { label: 'Интенсивность деэссера', unit: 'x' },
    bandwidthHz: { label: 'Ширина полосы (Bandwidth)', unit: 'Гц' },
    lowCutHz: { label: 'Срез низких частот (Low-Cut)', unit: 'Гц' },
    lowCutSlope: { label: 'Крутизна среза (Slope)' },
    bodyGainDb: { label: 'Тело голоса 250Hz (Body)', unit: 'dB' },
    boxCutGainDb: { label: 'Вырез коробочности 500Hz', unit: 'dB' },
    presenceHz: { label: 'Частота читаемости (Presence)', unit: 'Гц' },
    presenceGainDb: { label: 'Подъем читаемости', unit: 'dB' },
    airGainDb: { label: 'Воздух 11kHz (Air)', unit: 'dB' },
    ratio: { label: 'Коэффициент компрессии (Ratio)', unit: ':1' },
    kneeDb: { label: 'Колено компрессора (Knee)', unit: 'dB' },
    makeupDb: { label: 'Компенсация громкости (Make-up)', unit: 'dB' },
    peakLimitDb: { label: 'Лимит пиков (Peak Limit)', unit: 'dB' },
    duckingAmountDb: { label: 'Степень приглушения (Ducking)', unit: 'dB' },
    threshold: { label: 'Порог детектора речи' },
    filterMusicOnly: { label: 'Фильтровать только музыку' },
    voiceVolume: { label: 'Громкость голосов (Voice)', unit: 'x' },
    bgVolume: { label: 'Громкость фона (Background)', unit: 'x' },
    stereoWidth: { label: 'Ширина стереобазы фона', unit: 'x' },
    limiterCeilingDb: { label: 'Потолок мастер-лимитера', unit: 'dB' },
    limiterReleaseMs: { label: 'Релиз мастер-лимитера', unit: 'мс' },
    crf: { label: 'Качество кодирования (CRF)' },
    fastStart: { label: 'Оптимизация FastStart (MP4)' },
    minGapSec: { label: 'Минимальный зазор между фразами', unit: 'с' },
    leadInSec: { label: 'Предвход фразы (Lead-in)', unit: 'с' },
    silenceThresholdDb: { label: 'Порог тишины речи', unit: 'dB' },
    minSilenceDuration: { label: 'Мин. пауза детекции', unit: 'с' },
    preventCollisions: { label: 'Предотвращать перекрытия реплик' },
    fadeDurationMs: { label: 'Микро-фейд стыков', unit: 'мс' },
    cleanLeftoverTails: { label: 'Зачищать остаточные хвосты старых дублей' },
    adjustLongerCollisions: { label: 'Разводить удлиненные дубли фиксов' },
    safetyPaddingMs: { label: 'Защитный интервал зачистки', unit: 'мс' },
    minSpeechDb: { label: 'Порог детекции речи', unit: 'dB' },
    fadeEdgeMs: { label: 'Сглаживание краев фраз', unit: 'мс' },
    // Spotify Pedalboard DSP
    eqHighpass: { label: 'Highpass срез низа (гул/задувы)', unit: 'Гц' },
    eqPresenceFreq: { label: 'Частота презенса речи (Presence)', unit: 'Гц' },
    eqPresenceGain: { label: 'Усиление презенса (Presence Gain)', unit: 'dB' },
    eqLowpass: { label: 'Lowpass срез верха (Air Guard)', unit: 'Гц' },
    compThresholdDb: { label: 'Порог компрессора (Threshold)', unit: 'dB' },
    compRatio: { label: 'Степень сжатия (Ratio)', unit: ':1' },
    compAttackMs: { label: 'Атака компрессора (Attack)', unit: 'мс' },
    compReleaseMs: { label: 'Релиз компрессора (Release)', unit: 'мс' },
    deesserFreqHz: { label: 'Частота сибилянтов (De-Esser)', unit: 'Гц' },
    deesserAmount: { label: 'Интенсивность де-эссера', unit: 'x' },
    reverbRoomSize: { label: 'Размер помещения (Room Size)', unit: 'x' },
    reverbDamping: { label: 'Демпфирование реверберации', unit: 'x' },
    reverbWet: { label: 'Уровень реверберации (Wet)', unit: 'x' },
    reverbDry: { label: 'Прямой сигнал (Dry)', unit: 'x' },
    limiterThresholdDb: { label: 'Потолок лимитера (True-Peak)', unit: 'dBFS' },
    levelingSpeedMs: { label: 'Скорость реакции левелера', unit: 'мс' },
    modelId: { label: 'Выбор модели / Алгоритма' },
    modelName: { label: 'Выбор нейросетевой модели' }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} МБ`;
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getModuleMeta = (moduleId: string): MixingModuleDef | undefined => {
    return moduleDatabase.find(m => m.id === moduleId);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-neutral-950 text-white overflow-hidden select-none">
      {/* Hidden audio element for synchronous preview of selected rendered file (Pure layering) */}
      <audio 
        ref={trackAudioRef}
        onTimeUpdate={() => {
          if (!videoRef.current && trackAudioRef.current) {
            setCurrentTime(trackAudioRef.current.currentTime);
          }
        }}
        onLoadedMetadata={(e) => {
          if (!duration) setDuration(e.currentTarget.duration);
        }}
      />

      {/* Top Header Toolbar */}
      <div className="bg-neutral-900 border-b border-neutral-800 px-6 py-3.5 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-600/20 text-purple-400 rounded-lg border border-purple-500/30">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold text-neutral-100">Сведение видео</h1>
              <span className="text-xs px-2 py-0.5 bg-neutral-800 text-neutral-300 rounded border border-neutral-700">
                Модульный конвейер
              </span>
            </div>
            <p className="text-xs text-neutral-400">
              {currentEpisode ? (
                <>
                  <span className="text-blue-400 font-medium">{currentEpisode.project?.title || 'Проект'}</span>
                  {' • '}
                  <span>Серия #{currentEpisode.number}</span>
                  {workingDir && (
                    <span className="text-neutral-500 ml-2 font-mono text-[11px]">({workingDir})</span>
                  )}
                </>
              ) : (
                'Серия не выбрана'
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition shadow-sm"
            title="Запустить экспорт звукорежиссеру по проверенной методике и импортировать результат"
          >
            <Download className="w-4 h-4" />
            <span>Импорт звукорежиссера</span>
          </button>

          <button
            onClick={() => setIsExternalImportModalOpen(true)}
            className="px-3 py-1.5 bg-sky-700 hover:bg-sky-600 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition shadow-sm"
            title="Загрузить внешние видео, субтитры и аудио сторонней серии без создания проекта в базе"
          >
            <Upload className="w-4 h-4" />
            <span>Внешние файлы</span>
          </button>

          <button
            onClick={handleOpenPresetsModal}
            className="px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-medium flex items-center gap-1.5 transition"
            title="Выбрать или сохранить пресет всей цепочки конвейера"
          >
            <Bookmark className="w-4 h-4 text-amber-400" />
            <span>Пресеты цепочки</span>
          </button>

          <button
            onClick={handleRunAllSteps}
            disabled={!manifest?.isImported || activeProcessingStepId !== null}
            className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white rounded-lg text-xs font-medium flex items-center gap-2 transition"
            title="Выполнить все активные шаги конвейера по порядку"
          >
            {activeProcessingStepId === 'all' ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4 text-purple-200" />
            )}
            <span>Свести цепочку</span>
          </button>

          <button
            onClick={() => setIsAddModuleModalOpen(true)}
            className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 rounded-lg text-xs font-medium flex items-center gap-1.5 transition"
            title="Добавить модуль из базы"
          >
            <Plus className="w-4 h-4 text-emerald-400" />
            <span>Модули</span>
          </button>

          {workingDir && (
            <button
              onClick={handleOpenFolder}
              className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs transition"
              title="Открыть папку сведения в проводнике"
            >
              <FolderOpen className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={() => setIsConsoleOpen(prev => !prev)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition border ${
              isConsoleOpen 
                ? 'bg-purple-950/60 text-purple-300 border-purple-500/50 shadow-sm' 
                : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border-neutral-700'
            }`}
            title="Открыть / закрыть интерактивную консоль логирования сведения"
          >
            <Terminal className="w-4 h-4 text-purple-400" />
            <span>Консоль</span>
            {logs.some(l => l.level === 'error') ? (
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            ) : (
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-neutral-900 text-neutral-400 font-mono">
                {logs.length}
              </span>
            )}
          </button>

          <button
            onClick={loadStatus}
            disabled={isLoading}
            className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs transition"
            title="Обновить состояние файлов"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: File Lists & Pipeline Stages */}
        <div className="w-1/2 border-r border-neutral-800 flex flex-col bg-neutral-900/40 overflow-y-auto">
          {/* Section 1: File Lists */}
          <div className="p-4 border-b border-neutral-800/80 space-y-4">
            {/* List A: General Project Tracks */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
                  <Film className="w-3.5 h-3.5 text-blue-400" />
                  Дорожки проекта
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRescanSources}
                    className="text-[11px] text-purple-400 hover:text-purple-300 flex items-center gap-1 font-medium bg-purple-950/40 hover:bg-purple-900/50 px-2 py-0.5 rounded border border-purple-800/40 transition"
                    title="Пересканировать папку серии и извлечь звук оригинального видео"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Пересканировать папку</span>
                  </button>
                  <span className="text-[11px] text-neutral-500">Видео, звук, субтитры</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {/* Video Card */}
                <div 
                  onClick={() => {
                    if (manifest?.sourceFiles?.video) {
                      toast.info(`Видеоряд серии: ${manifest.sourceFiles.video.name}`);
                    }
                  }}
                  className={`p-2.5 rounded-lg border text-left cursor-pointer transition ${
                    manifest?.sourceFiles?.video?.exists
                      ? 'bg-neutral-800/60 border-neutral-700/80 hover:border-blue-500/50'
                      : 'bg-neutral-900 border-neutral-800 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-blue-400 text-xs font-medium truncate mb-1">
                    <Film className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">Видео серии</span>
                  </div>
                  <div className="text-[11px] text-neutral-300 truncate" title={manifest?.sourceFiles?.video?.name || 'Отсутствует'}>
                    {manifest?.sourceFiles?.video?.name || 'Не импортировано'}
                  </div>
                  <div className="text-[10px] text-neutral-500 mt-1 flex justify-between">
                    <span>{formatFileSize(manifest?.sourceFiles?.video?.size)}</span>
                    <span className="text-emerald-400">{manifest?.sourceFiles?.video ? '✓ Готово' : '—'}</span>
                  </div>
                </div>

                {/* Original Audio Card */}
                <div 
                  onClick={() => {
                    if (manifest?.sourceFiles?.originalAudio) {
                      selectTrackForInspection(manifest.sourceFiles.originalAudio, 'Оригинальный звук', 'source');
                    }
                  }}
                  className={`p-2.5 rounded-lg border text-left cursor-pointer transition ${
                    manifest?.sourceFiles?.originalAudio?.exists
                      ? 'bg-neutral-800/60 border-neutral-700/80 hover:border-amber-500/50'
                      : 'bg-neutral-900 border-neutral-800 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-amber-400 text-xs font-medium truncate mb-1">
                    <Music className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">Оригинал звук</span>
                  </div>
                  <div className="text-[11px] text-neutral-300 truncate" title={manifest?.sourceFiles?.originalAudio?.name || 'Извлекается из видео'}>
                    {manifest?.sourceFiles?.originalAudio?.name || 'Фон видео'}
                  </div>
                  <div className="text-[10px] text-neutral-500 mt-1 flex justify-between">
                    <span>{formatFileSize(manifest?.sourceFiles?.originalAudio?.size)}</span>
                    <span className="text-amber-400">Слушать 🎧</span>
                  </div>
                </div>

                {/* Subtitles Card */}
                <div 
                  className={`p-2.5 rounded-lg border text-left transition ${
                    manifest?.sourceFiles?.subtitles?.exists
                      ? 'bg-neutral-800/60 border-neutral-700/80'
                      : 'bg-neutral-900 border-neutral-800 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-indigo-400 text-xs font-medium truncate mb-1">
                    <FileText className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">Субтитры (ASS)</span>
                  </div>
                  <div className="text-[11px] text-neutral-300 truncate" title={manifest?.sourceFiles?.subtitles?.name || 'Отсутствуют'}>
                    {manifest?.sourceFiles?.subtitles?.name || 'Не импортированы'}
                  </div>
                  <div className="text-[10px] text-neutral-500 mt-1 flex justify-between">
                    <span>{formatFileSize(manifest?.sourceFiles?.subtitles?.size)}</span>
                    <span className="text-indigo-400">{manifest?.sourceFiles?.subtitles ? 'С ролями' : '—'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* List B: Dubber Tracks */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
                  <Headphones className="w-3.5 h-3.5 text-emerald-400" />
                  Дорожки дабберов ({manifest?.sourceFiles?.dubberTracks?.length || 0})
                </span>
                <span className="text-[11px] text-neutral-500">После автотайминга и фиксов</span>
              </div>

              {(!manifest?.sourceFiles?.dubberTracks || manifest.sourceFiles.dubberTracks.length === 0) ? (
                <div className="p-4 bg-neutral-900/60 border border-neutral-800 rounded-lg text-center text-xs text-neutral-400 space-y-2">
                  <p>Дорожки дабберов еще не импортированы в сведение серии.</p>
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => setIsImportModalOpen(true)}
                      className="px-3 py-1.5 bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 border border-blue-500/40 rounded-lg text-xs transition"
                    >
                      Импорт звукорежиссера
                    </button>
                    <button
                      onClick={() => setIsExternalImportModalOpen(true)}
                      className="px-3 py-1.5 bg-sky-600/30 hover:bg-sky-600/50 text-sky-300 border border-sky-500/40 rounded-lg text-xs transition flex items-center gap-1.5"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Загрузить внешние файлы</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {manifest.sourceFiles.dubberTracks.map((tr, idx) => {
                    const isSelected = selectedAudioTrack?.id === tr.path;
                    return (
                      <div
                        key={idx}
                        onClick={() => selectTrackForInspection(tr, `Даббер: ${tr.dubberNick}`, 'source')}
                        className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs cursor-pointer transition ${
                          isSelected 
                            ? 'bg-blue-950/40 border-blue-600 text-blue-200' 
                            : 'bg-neutral-900/70 border-neutral-800 hover:bg-neutral-800/80 text-neutral-200'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-[10px] shrink-0">
                            {idx + 1}
                          </span>
                          <div className="truncate">
                            <span className="font-semibold text-neutral-100">{tr.dubberNick}</span>
                            <span className="text-neutral-500 text-[11px] ml-2 truncate">({tr.name})</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0 text-[11px] text-neutral-400">
                          <span>{formatFileSize(tr.size)}</span>
                          <span className="px-2 py-0.5 bg-neutral-800 rounded text-emerald-400 text-[10px] font-medium">
                            {isSelected ? '▶ Играет' : 'Слушать'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Section 2: Configurable Modular Pipeline */}
          <div className="p-4 space-y-3 flex-1">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-neutral-800/70">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-200 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-purple-400" />
                  Конвейер модулей ({manifest?.pipeline?.length || 0})
                </span>
                <span 
                  className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950/70 text-emerald-400 border border-emerald-800/50 flex items-center gap-1 font-mono" 
                  title="Все модули и параметры моментально сохраняются в файл mixing_pipeline.json папки серии и проекта"
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${isPipelineSaving ? 'bg-amber-400 animate-ping' : 'bg-emerald-400'}`} />
                  {isPipelineSaving ? 'Запись в файл...' : `Файл: mixing_pipeline.json (${lastPipelineSavedAt})`}
                </span>
              </div>

              <div className="flex items-center flex-wrap gap-1.5">
                <button
                  onClick={handleExportPipelineToFile}
                  className="px-2 py-1 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white rounded-lg border border-neutral-800 text-[11px] font-medium flex items-center gap-1 transition shadow-sm"
                  title="Экспортировать текущую цепочку в отдельный .json файл"
                >
                  <FileDown className="w-3.5 h-3.5 text-cyan-400" />
                  <span>В файл</span>
                </button>

                <button
                  onClick={handleImportPipelineFromFile}
                  className="px-2 py-1 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white rounded-lg border border-neutral-800 text-[11px] font-medium flex items-center gap-1 transition shadow-sm"
                  title="Загрузить сохраненную цепочку модулей из файла .json"
                >
                  <Upload className="w-3.5 h-3.5 text-blue-400" />
                  <span>Из файла</span>
                </button>

                <button
                  onClick={handleOpenPresetsModal}
                  className="px-2 py-1 bg-neutral-900 hover:bg-neutral-800 text-purple-300 hover:text-purple-200 rounded-lg border border-purple-900/40 text-[11px] font-medium flex items-center gap-1 transition shadow-sm"
                  title="Открыть галерею встроенных и сохраненных пресетов конвейера"
                >
                  <Wand2 className="w-3.5 h-3.5 text-purple-400" />
                  <span>Пресеты</span>
                </button>

                <button
                  onClick={() => setIsSavePresetModalOpen(true)}
                  className="px-2 py-1 bg-neutral-900 hover:bg-neutral-800 text-amber-300 hover:text-amber-200 rounded-lg border border-amber-900/40 text-[11px] font-medium flex items-center gap-1 transition shadow-sm"
                  title="Сохранить текущую цепочку со всеми настройками как готовый пресет"
                >
                  <Bookmark className="w-3.5 h-3.5 text-amber-400" />
                  <span>В пресет</span>
                </button>

                <button
                  onClick={handleResetPipelineToDefault}
                  className="p-1 bg-neutral-900 hover:bg-neutral-800 text-neutral-500 hover:text-neutral-300 rounded-lg border border-neutral-800 transition"
                  title="Сбросить цепочку к заводскому базовому конвейеру"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => setIsAddModuleModalOpen(true)}
                  className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-[11px] font-medium flex items-center gap-1 transition shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Добавить модуль</span>
                </button>
              </div>
            </div>

            {/* Pipeline Steps List */}
            <div className="space-y-3">
              {(manifest?.pipeline || []).map((step, idx) => {
                const meta = getModuleMeta(step.moduleId);
                const isProcessing = activeProcessingStepId === step.stepId;
                const isExpanded = !!expandedSettings[step.stepId];
                const isComplete = step.status === 'completed';

                return (
                  <div 
                    key={step.stepId}
                    className={`bg-neutral-900/90 border rounded-xl p-3.5 space-y-3 shadow-sm transition ${
                      step.enabled 
                        ? (isComplete ? 'border-emerald-800/40 hover:border-emerald-700/60' : 'border-neutral-800 hover:border-neutral-700')
                        : 'border-neutral-800/50 opacity-50 bg-neutral-950/40'
                    }`}
                  >
                    {/* Step Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 ${
                          step.enabled ? 'bg-purple-600/20 text-purple-400' : 'bg-neutral-800 text-neutral-500'
                        }`}>
                          {idx + 1}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-xs font-semibold text-neutral-100">
                              {meta?.title || step.moduleId}
                            </h3>
                            <span className="font-mono text-[10px] px-1.5 py-0.2 bg-neutral-800 text-purple-300 rounded border border-neutral-700">
                              {step.prefix}
                            </span>
                            {meta?.filename && (
                              <span className="text-[10px] px-1.5 py-0.2 bg-purple-950/60 text-purple-300 font-mono rounded border border-purple-800/40">
                                {meta.filename}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-neutral-400 leading-relaxed mt-0.5">
                            {meta?.description || ''}
                          </p>
                        </div>
                      </div>

                      {/* Step Actions: Listen Module Mix, Up, Down, Settings, Run, Delete */}
                      <div className="flex items-center gap-1 shrink-0">
                        {/* Listen Module Mix */}
                        {step.outputFiles && step.outputFiles.length > 0 && (
                          <button
                            onClick={() => selectModuleMixForInspection(step)}
                            className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition border ${
                              selectedAudioTrack?.id === `module_mix_${step.stepId}`
                                ? 'bg-purple-600 text-white border-purple-400 shadow-md ring-1 ring-purple-400 font-bold'
                                : 'bg-purple-950/70 hover:bg-purple-900/90 text-purple-200 border-purple-800/80 shadow-sm'
                            }`}
                            title="Прослушать в плеере совместный микс всех обработанных этим модулем дорожек"
                          >
                            <Volume2 className="w-3.5 h-3.5 text-purple-300" />
                            <span>Прослушать модуль ({step.outputFiles.length})</span>
                          </button>
                        )}

                        {/* Move Up */}
                        <button
                          onClick={() => handleMoveStepUp(idx)}
                          disabled={idx === 0}
                          className="p-1 text-neutral-400 hover:text-neutral-200 disabled:opacity-20 transition"
                          title="Переместить модуль вверх по конвейеру"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>

                        {/* Move Down */}
                        <button
                          onClick={() => handleMoveStepDown(idx)}
                          disabled={idx === (manifest?.pipeline?.length || 0) - 1}
                          className="p-1 text-neutral-400 hover:text-neutral-200 disabled:opacity-20 transition"
                          title="Переместить модуль вниз по конвейеру"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>

                        {/* Toggle On/Bypass */}
                        <button
                          onClick={() => handleToggleStep(idx)}
                          className={`p-1 transition ${step.enabled ? 'text-emerald-400 hover:text-emerald-300' : 'text-neutral-600 hover:text-neutral-400'}`}
                          title={step.enabled ? "Отключить шаг (Bypass)" : "Включить шаг"}
                        >
                          <Power className="w-3.5 h-3.5" />
                        </button>

                        {/* Settings */}
                        <button
                          onClick={() => setExpandedSettings(prev => ({ ...prev, [step.stepId]: !prev[step.stepId] }))}
                          className="p-1 text-neutral-400 hover:text-neutral-200 transition"
                          title="Настройки параметров и пресеты"
                        >
                          <Settings2 className="w-3.5 h-3.5" />
                        </button>

                        {/* Delete Step */}
                        <button
                          onClick={() => handleDeleteStep(idx)}
                          className="p-1 text-neutral-500 hover:text-red-400 transition"
                          title="Удалить модуль из конвейера"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>

                        {/* Run Step */}
                        <button
                          onClick={() => handleRunStep(step.stepId)}
                          disabled={!manifest?.isImported || !step.enabled || activeProcessingStepId !== null}
                          className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white rounded text-xs font-medium flex items-center gap-1.5 transition ml-1"
                        >
                          {isProcessing ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : (
                            <Play className="w-3 h-3 fill-current" />
                          )}
                          <span>Шаг</span>
                        </button>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    {isProcessing && (
                      <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
                        <div 
                          className="bg-purple-500 h-full transition-all duration-300"
                          style={{ width: `${stepProgress[step.stepId] || 15}%` }}
                        />
                      </div>
                    )}

                    {/* Settings & Presets Accordion */}
                    {isExpanded && (
                      <div className="p-3 bg-neutral-950/80 rounded-lg border border-neutral-800 text-xs space-y-3">
                        {/* UVR Model Card */}
                        {Boolean(meta?.engineArchitecture) && (
                          <div className="p-3 bg-neutral-900 border border-purple-800/40 rounded-xl space-y-2.5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-2.5">
                                <div className="p-2 bg-purple-500/20 text-purple-400 rounded-lg mt-0.5">
                                  {step.moduleId === 'voicefixer_fe' ? (
                                    <Sparkles className="w-4 h-4" />
                                  ) : step.moduleId === 'uvr_deecho_normal' ? (
                                    <Radio className="w-4 h-4" />
                                  ) : (
                                    <ShieldCheck className="w-4 h-4" />
                                  )}
                                </div>
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-xs text-neutral-100">
                                      {meta?.name || meta?.title || step.moduleId}
                                    </span>
                                    <span className="text-[10px] font-mono px-1.5 py-0.5 bg-neutral-800 text-purple-300 rounded border border-neutral-700">
                                      {meta?.filename || 'model.pth'} • {meta?.size_mb || 30} МБ
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-neutral-400 leading-snug">
                                    Архитектура: <span className="text-purple-300 font-mono text-[10px]">{meta?.engineArchitecture}</span>
                                    {meta?.category && <span className="text-neutral-500 uppercase ml-2 text-[9px]">({meta.category})</span>}
                                  </p>
                                  <p className="text-[10px] text-amber-400/90 flex items-center gap-1">
                                    <span>💡 Рекомендовано:</span>
                                    <span>{meta?.recommended_for || 'Очистка аудио'}</span>
                                  </p>
                                </div>
                              </div>

                              <div className="shrink-0 flex items-center gap-2">
                                {meta?.is_installed ? (
                                  <span className="text-[11px] text-emerald-400 flex items-center gap-1.5 font-medium bg-emerald-950/40 px-2.5 py-1 rounded-lg border border-emerald-800/40">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    <span>Установлена ({meta.installed_bytes ? (meta.installed_bytes / (1024*1024)).toFixed(1) + ' МБ' : `${meta.size_mb || 30} МБ`})</span>
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => handleDownloadUvrModel(step.moduleId)}
                                    disabled={isDownloadingUvrModel}
                                    className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-neutral-800 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition"
                                  >
                                    {isDownloadingUvrModel ? (
                                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <Download className="w-3.5 h-3.5" />
                                    )}
                                    <span>{isDownloadingUvrModel ? `Загрузка (${uvrDownloadPercent}%)...` : 'Скачать / Активировать модель'}</span>
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Model URLs and info */}
                            <div className="text-[10px] text-neutral-400 bg-neutral-950/70 p-2 rounded-lg border border-neutral-800 space-y-1">
                              <div className="flex items-center justify-between text-neutral-500">
                                <span>Репозитории модели ({meta?.format?.toUpperCase() || 'PTH'} Arch):</span>
                                <span className="font-mono text-[9px]">Формат: {meta?.format || 'pth'}</span>
                              </div>
                              <div className="space-y-0.5 max-h-16 overflow-y-auto">
                                {(meta?.urls || []).map((url, uIdx) => (
                                  <div key={uIdx} className="truncate text-[10px] text-neutral-400 font-mono hover:text-purple-300 transition">
                                    {url}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Presets Bar */}
                        {meta?.presets && meta.presets.length > 0 && (
                          <div className="space-y-1.5 pb-2.5 border-b border-neutral-800">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-purple-400 flex items-center gap-1">
                              <Wand2 className="w-3 h-3" />
                              Готовые студийные пресеты:
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {meta.presets.map((preset) => (
                                <button
                                  key={preset.id}
                                  onClick={() => handleApplyPreset(step.stepId, preset)}
                                  className="px-2.5 py-1 rounded bg-neutral-900 hover:bg-purple-950/50 border border-neutral-800 hover:border-purple-600/60 text-[11px] text-neutral-300 hover:text-purple-200 transition text-left"
                                  title={preset.description || preset.title}
                                >
                                  {preset.title}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Granular Sliders and Controls */}
                        <div className="grid grid-cols-2 gap-3 pt-1">
                          {Object.keys(step.params || {}).map(paramKey => {
                            const val = step.params[paramKey];

                            // Boolean checkbox
                            if (typeof val === 'boolean') {
                              const metaParam = PARAM_LABELS[paramKey];
                              return (
                                <div key={paramKey} className="flex items-center gap-2 pt-2">
                                  <input 
                                    type="checkbox"
                                    checked={val}
                                    onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, e.target.checked)}
                                    className="rounded accent-purple-500 cursor-pointer"
                                  />
                                  <label className="text-[11px] text-neutral-300 cursor-pointer">
                                    {metaParam?.label || paramKey}
                                  </label>
                                </div>
                              );
                            }

                            // String mode select
                            if (paramKey === 'mode') {
                              return (
                                <div key={paramKey} className="col-span-2">
                                  <label className="text-[11px] text-neutral-400 block mb-1">
                                    Алгоритм нормализации / Режим:
                                  </label>
                                  <select
                                    value={val}
                                    onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, e.target.value)}
                                    className="w-full px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs text-neutral-200"
                                  >
                                    <option value="loudnorm">EBU R128 (-16 LUFS Стриминг)</option>
                                    <option value="dynaudnorm">Динамический левелер (DynAudNorm)</option>
                                    <option value="leveler_pro">Двухступенчатый левелер речи (Speech Leveler Pro)</option>
                                  </select>
                                </div>
                              );
                            }

                            if (paramKey === 'modelId') {
                              const isDenoise = step.moduleId === 'ultimate_denoiser' || step.moduleId.includes('denoise');
                              return (
                                <div key={paramKey} className="col-span-2">
                                  <label className="text-[11px] text-purple-300 font-semibold block mb-1">
                                    {isDenoise ? '⚡ Выбор движка / нейросети шумоподавления:' : '🎛 Выбор алгоритма De-Reverb / De-Echo:'}
                                  </label>
                                  <select
                                    value={val}
                                    onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, e.target.value)}
                                    className="w-full px-2 py-1.5 bg-neutral-900 border border-purple-800/60 rounded text-xs text-purple-200 font-medium"
                                  >
                                    {isDenoise ? (
                                      <>
                                        <option value="deepfilternet3">DeepFilterNet 3 ONNX (Перцептивный нейросетевой AI)</option>
                                        <option value="uvr_denoise_foxjoy">VR-DeNoise FoxJoy (Вокальный спектральный)</option>
                                        <option value="uvr_denoise_full">UVR-DeNoise Full (Глубокое подавление гула и шипения)</option>
                                        <option value="uvr_denoise_lite">VR-DeNoise Lite (Легкая быстрая очистка)</option>
                                      </>
                                    ) : (
                                      <>
                                        <option value="reverb_foxjoy">Reverb HQ FoxJoy (MDX-Net Spatial Inversion)</option>
                                        <option value="uvr_deecho_normal">UVR De-Echo Normal (Мягкое снятие отражений)</option>
                                        <option value="uvr_deecho_aggressive">UVR De-Echo Aggressive (Пустая комната / плитка)</option>
                                        <option value="mdx_dereverb_room">MDX Room DeReverb (Устранение коробочного гула)</option>
                                        <option value="vst-spectral-dereverb">Spectral De-Reverb (Native C++ DSP, 0ms лаг)</option>
                                      </>
                                    )}
                                  </select>
                                </div>
                              );
                            }

                            if (paramKey === 'modelName') {
                              return (
                                <div key={paramKey} className="col-span-2">
                                  <label className="text-[11px] text-purple-300 font-semibold block mb-1">
                                    👑 Нейросетевая модель сепарации:
                                  </label>
                                  <select
                                    value={val}
                                    onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, e.target.value)}
                                    className="w-full px-2 py-1.5 bg-neutral-900 border border-purple-800/60 rounded text-xs text-purple-200 font-medium"
                                  >
                                    <option value="mel_band_roformer_vocals">Mel-Band Roformer Vocals (SOTA Pure Vocals)</option>
                                    <option value="bs_roformer_viperx">BS-Roformer Viperx (Кинематографический)</option>
                                    <option value="htdemucs_ft">HTDemucs v4 Fine-Tuned (4 Изолированных стема)</option>
                                    <option value="htdemucs_vocals_bgm">HTDemucs 2-Стема (Вокал + Фонограмма)</option>
                                    <option value="uvr_mdx_voc_ft">UVR-MDX-NET Voc_FT (Золотой стандарт вокала)</option>
                                    <option value="uvr_mdx_inst_hq3">UVR-MDX-NET Inst_HQ_3 (Чистый минус M&E)</option>
                                    <option value="kim_vocal_2">Kim Vocal 2 (Для плотных миксов)</option>
                                  </select>
                                </div>
                              );
                            }

                            if (paramKey === 'roomSizeEstimate') {
                              return (
                                <div key={paramKey}>
                                  <label className="text-[11px] text-neutral-400 block mb-1">
                                    Размер помещения:
                                  </label>
                                  <select
                                    value={val}
                                    onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, e.target.value)}
                                    className="w-full px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs text-neutral-200"
                                  >
                                    <option value="small">Малая комната / кабина</option>
                                    <option value="medium">Стандартная жилая комната</option>
                                    <option value="large">Большой зал / просторное помещение</option>
                                  </select>
                                </div>
                              );
                            }

                            if (paramKey === 'lowCutSlope') {
                              return (
                                <div key={paramKey}>
                                  <label className="text-[11px] text-neutral-400 block mb-1">
                                    Крутизна среза (Slope):
                                  </label>
                                  <select
                                    value={val}
                                    onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, e.target.value)}
                                    className="w-full px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs text-neutral-200"
                                  >
                                    <option value="12dB/oct">12 dB/окт (Мягкий естественный спад)</option>
                                    <option value="24dB/oct">24 dB/окт (Крутой срез Butterworth)</option>
                                  </select>
                                </div>
                              );
                            }

                            if (paramKey === 'detectionMode') {
                              return (
                                <div key={paramKey}>
                                  <label className="text-[11px] text-neutral-400 block mb-1">
                                    Детектор уровня:
                                  </label>
                                  <select
                                    value={val}
                                    onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, e.target.value)}
                                    className="w-full px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs text-neutral-200"
                                  >
                                    <option value="rms">RMS (Энергетический сглаженный)</option>
                                    <option value="peak">Peak (Мгновенный пиковый)</option>
                                  </select>
                                </div>
                              );
                            }

                            if (paramKey === 'videoCodec') {
                              return (
                                <div key={paramKey}>
                                  <label className="text-[11px] text-neutral-400 block mb-1">
                                    Видеопоток:
                                  </label>
                                  <select
                                    value={val}
                                    onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, e.target.value)}
                                    className="w-full px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs text-neutral-200"
                                  >
                                    <option value="copy">Копирование без пережатия (Copy, 3 сек)</option>
                                    <option value="transcode">H.264 Транскодирование (CRF 18)</option>
                                  </select>
                                </div>
                              );
                            }

                            if (paramKey === 'audioBitrate') {
                              return (
                                <div key={paramKey}>
                                  <label className="text-[11px] text-neutral-400 block mb-1">
                                    Битрейт звука:
                                  </label>
                                  <select
                                    value={val}
                                    onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, e.target.value)}
                                    className="w-full px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs text-neutral-200"
                                  >
                                    <option value="320k">320 kbps (High Quality AAC)</option>
                                    <option value="256k">256 kbps (Web AAC)</option>
                                    <option value="192k">192 kbps (Standard AAC)</option>
                                    <option value="flac">FLAC (Lossless)</option>
                                  </select>
                                </div>
                              );
                            }

                            if (paramKey === 'stems') {
                              return (
                                <div key={paramKey} className="col-span-2">
                                  <label className="text-[11px] text-neutral-400 block mb-1">
                                    Выбор изолируемых стемов (Demucs v4):
                                  </label>
                                  <select
                                    value={val}
                                    onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, e.target.value)}
                                    className="w-full px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs text-neutral-200"
                                  >
                                    <option value="both">Вокал + Инструментал (Vocals + M&E)</option>
                                    <option value="vocals_only">Только вокал (Vocals Only)</option>
                                    <option value="instrumental_only">Только фонограмма (M&E Only)</option>
                                    <option value="all">Все 4 стема (Вокал, Барабаны, Бас, Прочее)</option>
                                  </select>
                                </div>
                              );
                            }

                            // Numeric Sliders with precise value
                            const metaParam = PARAM_LABELS[paramKey];
                            const spec = PARAM_SPECS[paramKey];
                            if (spec) {
                              return (
                                <div key={paramKey} className="col-span-2 space-y-1 bg-neutral-900/40 p-2 rounded border border-neutral-800/40">
                                  <div className="flex items-center justify-between text-[11px]">
                                    <span className="text-neutral-300 font-medium truncate" title={metaParam?.label || paramKey}>
                                      {metaParam?.label || paramKey}:
                                    </span>
                                    <span className="text-purple-300 font-mono font-bold shrink-0">
                                      {val} {metaParam?.unit ? ` ${metaParam.unit}` : ''}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <input 
                                      type="range"
                                      min={spec.min}
                                      max={spec.max}
                                      step={spec.step}
                                      value={val}
                                      onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, parseFloat(e.target.value))}
                                      className="flex-1 h-1 bg-neutral-800 rounded appearance-none cursor-pointer accent-purple-500"
                                    />
                                    <input
                                      type="number"
                                      min={spec.min}
                                      max={spec.max}
                                      step={spec.step}
                                      value={val}
                                      onChange={(e) => {
                                        const parsed = parseFloat(e.target.value);
                                        if (!isNaN(parsed)) {
                                          handleUpdateStepParams(step.stepId, paramKey, parsed);
                                        }
                                      }}
                                      className="w-16 px-1 py-0.5 bg-neutral-950 border border-neutral-800 rounded text-[11px] text-center font-mono text-purple-200"
                                    />
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <div key={paramKey} className="space-y-1">
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="text-neutral-400 truncate" title={metaParam?.label || paramKey}>
                                    {metaParam?.label || paramKey}:
                                  </span>
                                  <span className="text-purple-300 font-mono font-medium shrink-0">
                                    {val} {metaParam?.unit ? ` ${metaParam.unit}` : ''}
                                  </span>
                                </div>
                                <input 
                                  type="number"
                                  step="any"
                                  value={val}
                                  onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, parseFloat(e.target.value))}
                                  className="w-full px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs font-mono text-neutral-200"
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Output Artifacts on Disk (Inspected via Preview) */}
                    {step.outputFiles && step.outputFiles.length > 0 && (
                      <div className="bg-neutral-950/40 p-2.5 rounded-lg border border-neutral-800/80 space-y-1.5">
                        <div className="text-[10px] uppercase font-semibold text-neutral-400 flex items-center justify-between">
                          <span>Сохраненные результаты на диске ({step.outputFiles.length}):</span>
                          <span className="text-emerald-400">✓ Записано на диск</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {/* Full Module Mix Option */}
                          {step.outputFiles.length > 1 && (
                            <button
                              onClick={() => selectModuleMixForInspection(step)}
                              className={`px-2.5 py-1 rounded text-[11px] font-bold flex items-center gap-1.5 border transition ${
                                selectedAudioTrack?.id === `module_mix_${step.stepId}`
                                  ? 'bg-purple-600 text-white border-purple-400 shadow-md ring-1 ring-purple-400'
                                  : 'bg-purple-900/40 hover:bg-purple-800/60 text-purple-300 border-purple-700/60'
                              }`}
                              title="Прослушать в плеере совместный микс всех обработанных этим модулем дорожек"
                            >
                              <Volume2 className="w-3.5 h-3.5 text-purple-300" />
                              <span>🔊 Все дорожки (Микс модуля — {step.outputFiles.length} шт.)</span>
                            </button>
                          )}

                          {/* Individual Output Files */}
                          {step.outputFiles.map((of, oIdx) => {
                            const isSelected = selectedAudioTrack?.id === of.path;
                            return (
                              <button
                                key={oIdx}
                                onClick={() => selectTrackForInspection(of, `${meta?.title || step.moduleId}: ${of.name}`, step.stepId)}
                                className={`px-2 py-1 rounded text-[11px] font-mono flex items-center gap-1 border transition ${
                                  isSelected
                                    ? 'bg-purple-600/30 border-purple-500 text-purple-200 shadow-sm'
                                    : 'bg-neutral-800/60 border-neutral-700/60 text-neutral-300 hover:border-neutral-500'
                                }`}
                              >
                                {of.name.endsWith('.mp4') ? (
                                  <Film className="w-3 h-3 text-purple-400" />
                                ) : (
                                  <FileAudio className="w-3 h-3 text-purple-400" />
                                )}
                                <span className="truncate max-w-[200px]">{of.name}</span>
                                <span className="text-[10px] text-emerald-400 ml-1">🎧</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Video & Synchronous Layered Audio Player */}
        <div className="w-1/2 flex flex-col bg-neutral-950 p-5 space-y-4 overflow-y-auto">
          {/* Video Player Display */}
          <div className="aspect-video bg-black rounded-xl overflow-hidden border border-neutral-800 relative group flex items-center justify-center shadow-lg">
            {videoSrc ? (
              <video
                ref={videoRef}
                src={videoSrc}
                className="w-full h-full object-contain"
                muted={isVideoMuted}
                onTimeUpdate={handleVideoTimeUpdate}
                onLoadedMetadata={handleVideoLoadedMetadata}
                onEnded={() => setIsPlaying(false)}
              />
            ) : (
              <div className="text-center p-6 text-neutral-500 space-y-2">
                <Film className="w-10 h-10 mx-auto text-neutral-700" />
                <p className="text-xs">Видеоряд серии еще не импортирован</p>
              </div>
            )}

            {/* Floating Quick Play Overlay */}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
              <button
                onClick={togglePlay}
                className="p-4 bg-purple-600/90 hover:bg-purple-500 rounded-full text-white shadow-xl pointer-events-auto transition transform hover:scale-105"
              >
                {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 fill-current ml-0.5" />}
              </button>
            </div>
          </div>

          {/* Currently Inspected Track Banner & Quick Switcher */}
          <div className="bg-neutral-900 border border-neutral-800 p-3 rounded-xl flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5 truncate">
              <div className={`p-1.5 rounded-lg shrink-0 ${
                selectedAudioTrack?.isModuleMix ? 'bg-amber-500/20 text-amber-300' : 'bg-purple-600/20 text-purple-400'
              }`}>
                {selectedAudioTrack?.isModuleMix ? <Volume2 className="w-4 h-4" /> : <Headphones className="w-4 h-4" />}
              </div>
              <div className="truncate">
                <span className="text-neutral-400 text-[11px] block">
                  {selectedAudioTrack?.isModuleMix ? 'Прослушивается совместный микс модуля:' : 'Прослушиваемый файл модуля:'}
                </span>
                <span className="font-semibold text-neutral-100 truncate block">
                  {selectedAudioTrack ? selectedAudioTrack.name : 'Исходный звук видеоряда'}
                </span>
              </div>
            </div>

            {/* Source Switcher: Original vs Module */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={selectOriginalAudioTrack}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition border ${
                  selectedAudioTrack?.id === 'original_audio_source' || (!selectedAudioTrack && manifest?.sourceFiles?.originalAudio?.path)
                    ? 'bg-amber-600 text-white border-amber-500 font-bold shadow-sm'
                    : 'bg-neutral-800/80 hover:bg-neutral-700/80 text-neutral-300 border-neutral-700/60'
                }`}
                title="Переключить плеер на оригинальную японскую дорожку видеоряда"
              >
                📻 Оригинал
              </button>
              <span className={`px-2 py-1 rounded text-[10px] font-medium border ${
                selectedAudioTrack?.isModuleMix
                  ? 'bg-purple-900/60 text-purple-200 border-purple-700 font-bold'
                  : selectedAudioTrack && selectedAudioTrack.id !== 'original_audio_source'
                  ? 'bg-purple-900/40 text-purple-300 border border-purple-800/50'
                  : 'bg-neutral-800 text-neutral-400 border-neutral-700'
              }`}>
                {selectedAudioTrack ? selectedAudioTrack.label : 'Оригинал'}
              </span>
            </div>
          </div>

          {/* Timeline & Controls */}
          <div className="bg-neutral-900 border border-neutral-800 p-4 rounded-xl space-y-3.5">
            {/* Scrubber slider */}
            <div className="space-y-1.5">
              <input 
                type="range"
                min="0"
                max={duration || 100}
                step="0.05"
                value={currentTime}
                onChange={(e) => handleSeek(parseFloat(e.target.value))}
                className="w-full accent-purple-500 cursor-pointer"
              />
              <div className="flex justify-between text-[11px] font-mono text-neutral-400">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Playback Controls & Mode Toggle */}
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2">
                <button
                  onClick={togglePlay}
                  className="p-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition shadow"
                  title={isPlaying ? "Пауза" : "Воспроизведение"}
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                </button>

                <button
                  onClick={() => handleSeek(Math.max(0, currentTime - 5))}
                  className="px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-xs transition"
                  title="Назад на 5 секунд"
                >
                  -5с
                </button>

                <button
                  onClick={() => handleSeek(Math.min(duration, currentTime + 5))}
                  className="px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-xs transition"
                  title="Вперед на 5 секунд"
                >
                  +5с
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsVideoMuted(!isVideoMuted)}
                  className={`text-[11px] px-2.5 py-1 rounded-lg border flex items-center gap-1.5 transition ${
                    isVideoMuted 
                      ? 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200' 
                      : 'bg-blue-950/60 border-blue-600/40 text-blue-300 font-semibold'
                  }`}
                  title={isVideoMuted ? "Включить оригинальный звук из видеофайла" : "Заглушить оригинальный звук из видеофайла"}
                >
                  {isVideoMuted ? <VolumeX className="w-3.5 h-3.5 text-neutral-500" /> : <Volume2 className="w-3.5 h-3.5 text-blue-400" />}
                  <span>{isVideoMuted ? 'Звук видео: Выкл' : `Звук видео: ${Math.round(videoVolume * 100)}%`}</span>
                </button>
              </div>
            </div>

            {/* Audio Volume Controls (Video Audio & Processed Track) */}
            <div className="pt-2 border-t border-neutral-800 space-y-3">
              {/* Processed Track / Dubber Voices Volume */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-400 flex items-center gap-1.5">
                    <Music className="w-3.5 h-3.5 text-purple-400" />
                    Громкость дорожки модуля (голоса):
                  </span>
                  <button
                    onClick={() => setIsTrackMuted(!isTrackMuted)}
                    className="text-neutral-400 hover:text-neutral-200 flex items-center gap-1 text-[11px]"
                    title={isTrackMuted ? "Включить звук" : "Заглушить звук"}
                  >
                    {isTrackMuted ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5 text-purple-400" />}
                    <span>{isTrackMuted ? 'Выкл' : `${Math.round(trackVolume * 100)}%`}</span>
                  </button>
                </div>
                <input 
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  disabled={isTrackMuted}
                  value={isTrackMuted ? 0 : trackVolume}
                  onChange={(e) => setTrackVolume(parseFloat(e.target.value))}
                  className="w-full accent-purple-500 cursor-pointer"
                />
              </div>

              {/* Video Audio Volume Slider (when unmuted) */}
              {!isVideoMuted && (
                <div className="space-y-1.5 bg-neutral-900/40 p-2 rounded-lg border border-neutral-800/60">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-neutral-400 flex items-center gap-1.5">
                      <Film className="w-3.5 h-3.5 text-blue-400" />
                      Громкость оригинального видеоряда:
                    </span>
                    <span className="text-[11px] text-blue-300 font-mono">{Math.round(videoVolume * 100)}%</span>
                  </div>
                  <input 
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={videoVolume}
                    onChange={(e) => setVideoVolume(parseFloat(e.target.value))}
                    className="w-full accent-blue-500 cursor-pointer"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Final Video Export Card */}
          {manifest?.finalVideo && (
            <div className="bg-emerald-950/30 border border-emerald-800/60 p-4 rounded-xl flex items-center justify-between gap-3 shadow-sm">
              <div className="truncate">
                <div className="text-emerald-400 text-xs font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Готовая сведенная серия (Final Release):</span>
                </div>
                <div className="text-xs text-neutral-200 font-mono truncate mt-0.5" title={manifest.finalVideo.name}>
                  {manifest.finalVideo.name}
                </div>
                <div className="text-[11px] text-neutral-400 mt-0.5">
                  Размер: {formatFileSize(manifest.finalVideo.size)}
                </div>
              </div>
              <button
                onClick={handleSaveFinalVideo}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0 transition shadow"
              >
                <Save className="w-4 h-4" />
                <span>Сохранить видео</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Dockable Live Process Console & Terminal (Интерактивная консоль логирования сведения) */}
      <div className={`border-t border-neutral-800 bg-[#0b0c10] flex flex-col transition-all duration-200 z-20 ${
        isConsoleOpen ? (isConsoleExpanded ? 'h-96' : 'h-64') : 'h-9'
      }`}>
        {/* Console Header Bar */}
        <div className="bg-neutral-900/90 border-b border-neutral-800 px-4 py-1.5 flex items-center justify-between flex-shrink-0 select-none">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsConsoleOpen(prev => !prev)}
              className="flex items-center gap-2 text-xs font-semibold text-neutral-200 hover:text-white transition"
              title={isConsoleOpen ? 'Свернуть консоль' : 'Развернуть консоль'}
            >
              <div className="p-1 bg-purple-950/80 text-purple-400 rounded border border-purple-500/30">
                <Terminal className="w-3.5 h-3.5" />
              </div>
              <span className="flex items-center gap-1.5 font-mono text-[11px] text-purple-300">
                &gt;_ Консоль процесса сведения
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 font-mono">
                {logs.length}
              </span>
            </button>

            {logs.filter(l => l.level === 'error').length > 0 && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-950/80 text-red-400 border border-red-800/80 flex items-center gap-1 font-mono animate-pulse">
                <AlertCircle className="w-3 h-3" />
                {logs.filter(l => l.level === 'error').length} ошибок
              </span>
            )}

            {logs.filter(l => l.level === 'warn').length > 0 && (
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-950/80 text-amber-300 border border-amber-800/60 flex items-center gap-1 font-mono">
                <AlertTriangle className="w-3 h-3" />
                {logs.filter(l => l.level === 'warn').length} пред.
              </span>
            )}

            {/* Preview of latest log when collapsed */}
            {!isConsoleOpen && logs.length > 0 && (
              <div className="text-[11px] font-mono text-neutral-400 truncate max-w-xl pl-2 border-l border-neutral-800">
                <span className="text-neutral-500 mr-1.5">[{logs[logs.length - 1].timestamp}]</span>
                <span className={
                  logs[logs.length - 1].level === 'error' ? 'text-red-400 font-bold' :
                  logs[logs.length - 1].level === 'warn' ? 'text-amber-400 font-semibold' :
                  logs[logs.length - 1].level === 'success' ? 'text-emerald-400' : 'text-neutral-300'
                }>
                  {logs[logs.length - 1].message}
                </span>
              </div>
            )}
          </div>

          {/* Right Toolbar Controls */}
          <div className="flex items-center gap-2">
            {isConsoleOpen && (
              <>
                {/* Level Filters */}
                <div className="flex items-center gap-1 bg-neutral-950 p-0.5 rounded border border-neutral-800 text-[10px] font-mono">
                  {(['all', 'error', 'warn', 'info', 'debug'] as const).map(f => {
                    const count = f === 'all' ? logs.length :
                      f === 'error' ? logs.filter(l => l.level === 'error').length :
                      f === 'warn' ? logs.filter(l => l.level === 'warn').length :
                      f === 'info' ? logs.filter(l => l.level === 'info' || l.level === 'success').length :
                      logs.filter(l => l.level === 'debug').length;
                    return (
                      <button
                        key={f}
                        onClick={() => setConsoleFilter(f)}
                        className={`px-2 py-0.5 rounded transition ${
                          consoleFilter === f 
                            ? 'bg-purple-900/60 text-purple-200 font-semibold' 
                            : 'text-neutral-400 hover:text-neutral-200'
                        }`}
                      >
                        {f === 'all' ? `Все (${count})` :
                         f === 'error' ? `Ошибки (${count})` :
                         f === 'warn' ? `Внимание (${count})` :
                         f === 'info' ? `Инфо (${count})` : `Отладка (${count})`}
                      </button>
                    );
                  })}
                </div>

                {/* Search in logs */}
                <div className="relative flex items-center">
                  <Search className="w-3 h-3 absolute left-2 text-neutral-500" />
                  <input
                    type="text"
                    value={consoleSearch}
                    onChange={(e) => setConsoleSearch(e.target.value)}
                    placeholder="Поиск в логах..."
                    className="pl-6 pr-2 py-0.5 bg-neutral-950 border border-neutral-800 rounded text-[11px] font-mono text-neutral-200 placeholder-neutral-500 w-32 focus:w-44 transition-all focus:outline-none focus:border-purple-500"
                  />
                  {consoleSearch && (
                    <button
                      onClick={() => setConsoleSearch('')}
                      className="absolute right-1 text-neutral-500 hover:text-neutral-300 text-[10px]"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Copy logs */}
                <button
                  onClick={handleCopyLogs}
                  className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-[11px] flex items-center gap-1 font-mono transition"
                  title="Скопировать все логи в буфер обмена"
                >
                  <Copy className="w-3 h-3" />
                  <span className="hidden sm:inline">Копия</span>
                </button>

                {/* Download log file */}
                <button
                  onClick={handleDownloadLogs}
                  className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-[11px] flex items-center gap-1 font-mono transition"
                  title="Скачать полный лог процесса (.log файл)"
                >
                  <FileDown className="w-3 h-3" />
                  <span className="hidden sm:inline">Лог-файл</span>
                </button>

                {/* Clear logs */}
                <button
                  onClick={handleClearLogs}
                  className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-[11px] flex items-center gap-1 font-mono transition"
                  title="Очистить терминал"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span className="hidden sm:inline">Очистить</span>
                </button>

                {/* Auto-scroll toggle */}
                <button
                  onClick={() => setAutoScroll(prev => !prev)}
                  className={`px-2 py-1 rounded text-[11px] flex items-center gap-1 font-mono transition border ${
                    autoScroll 
                      ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50' 
                      : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                  }`}
                  title={autoScroll ? 'Автопрокрутка включена' : 'Автопрокрутка выключена'}
                >
                  <ArrowDown className={`w-3 h-3 ${autoScroll ? 'animate-bounce' : ''}`} />
                  <span className="hidden sm:inline">Автоскролл</span>
                </button>

                {/* Height toggle */}
                <button
                  onClick={() => setIsConsoleExpanded(prev => !prev)}
                  className="p-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-xs transition"
                  title={isConsoleExpanded ? 'Уменьшить высоту' : 'Увеличить высоту'}
                >
                  {isConsoleExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                </button>
              </>
            )}

            {/* Collapse / Expand Toggle */}
            <button
              onClick={() => setIsConsoleOpen(prev => !prev)}
              className="p-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded transition"
              title={isConsoleOpen ? 'Свернуть' : 'Развернуть'}
            >
              {isConsoleOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Console Terminal Log Stream */}
        {isConsoleOpen && (
          <div className="flex-1 bg-[#090a0f] p-3 overflow-y-auto font-mono text-[11px] leading-relaxed select-text space-y-1">
            {logs.length === 0 ? (
              <div className="text-neutral-500 italic py-6 text-center text-xs">
                Логов пока нет. Запустите импорт, модуль конвейера или воспроизведение серии для вывода процесса.
              </div>
            ) : (
              logs
                .filter(l => {
                  if (consoleFilter === 'error' && l.level !== 'error') return false;
                  if (consoleFilter === 'warn' && l.level !== 'warn') return false;
                  if (consoleFilter === 'info' && (l.level !== 'info' && l.level !== 'success')) return false;
                  if (consoleFilter === 'debug' && l.level !== 'debug') return false;
                  if (consoleSearch.trim()) {
                    const q = consoleSearch.toLowerCase();
                    const matchMsg = l.message.toLowerCase().includes(q);
                    const matchTag = l.tag.toLowerCase().includes(q);
                    const matchStep = l.stepId ? l.stepId.toLowerCase().includes(q) : false;
                    return matchMsg || matchTag || matchStep;
                  }
                  return true;
                })
                .map((logItem) => {
                  const isErr = logItem.level === 'error';
                  const isWarn = logItem.level === 'warn';
                  const isSuccess = logItem.level === 'success';
                  const isDebug = logItem.level === 'debug';

                  return (
                    <div
                      key={logItem.id}
                      className={`flex flex-col py-0.5 px-1.5 rounded transition ${
                        isErr ? 'bg-red-950/30 border-l-2 border-red-500 text-red-200' :
                        isWarn ? 'bg-amber-950/20 border-l-2 border-amber-500 text-amber-200' :
                        isSuccess ? 'bg-emerald-950/20 border-l-2 border-emerald-500 text-emerald-200' :
                        'hover:bg-neutral-900/40 text-neutral-300'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {/* Timestamp */}
                        <span className="text-neutral-500 select-none shrink-0 font-mono text-[10px] mt-0.5">
                          {logItem.timestamp}
                        </span>

                        {/* Level badge */}
                        <span className={`px-1.5 py-0.2 rounded font-bold text-[9px] uppercase tracking-wider shrink-0 select-none mt-0.5 ${
                          isErr ? 'bg-red-900/60 text-red-300 border border-red-700/60' :
                          isWarn ? 'bg-amber-900/60 text-amber-300 border border-amber-700/60' :
                          isSuccess ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/60' :
                          isDebug ? 'bg-neutral-800 text-neutral-400' :
                          'bg-sky-950/80 text-sky-300 border border-sky-800/60'
                        }`}>
                          {logItem.level}
                        </span>

                        {/* Tag */}
                        <span className="px-1.5 py-0.2 rounded bg-purple-950/40 text-purple-300 border border-purple-800/30 font-semibold text-[10px] shrink-0 select-none mt-0.5">
                          {logItem.tag}
                        </span>

                        {/* Message */}
                        <span className="flex-1 break-words select-text">
                          {logItem.message}
                        </span>
                      </div>

                      {/* Optional Expandable Meta or Stack Trace */}
                      {logItem.meta && (
                        <div className="ml-16 mt-1 text-[10px] text-neutral-400">
                          <details className="cursor-pointer">
                            <summary className="text-neutral-500 hover:text-neutral-300 select-none">
                              ▸ Детали объекта (JSON / Stack Trace)
                            </summary>
                            <pre className="mt-1 p-2 bg-neutral-950/90 rounded border border-neutral-800/80 overflow-x-auto text-neutral-300 font-mono text-[10px] max-h-40">
                              {typeof logItem.meta === 'string' ? logItem.meta : JSON.stringify(logItem.meta, null, 2)}
                            </pre>
                          </details>
                        </div>
                      )}
                    </div>
                  );
                })
            )}
            <div ref={consoleBottomRef} />
          </div>
        )}
      </div>

      {/* Modal: Import Sound Engineer Files */}
      {isImportModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-blue-600/20 text-blue-400 rounded-lg">
                  <Download className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-neutral-100">Импорт файлов звукорежиссера</h2>
                  <p className="text-xs text-neutral-400">Экспорт по методике QA-проверки прямо в папку сведения</p>
                </div>
              </div>
              <button 
                onClick={() => setIsImportModalOpen(false)}
                className="text-neutral-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {/* Source Selector */}
              <div>
                <label className="text-neutral-300 font-medium block mb-1">
                  Источник материалов для сведения:
                </label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-neutral-950 rounded-xl border border-neutral-800">
                  <button
                    type="button"
                    onClick={() => {
                      setImportSource('timing');
                      setImportAutoTiming(false);
                    }}
                    className={`py-2 px-3 rounded-lg font-medium flex items-center justify-center gap-2 transition ${
                      importSource === 'timing' 
                        ? 'bg-amber-600/20 text-amber-300 border border-amber-500/40' 
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    <span>Из Тайминга видео</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setImportSource('qa');
                      setImportAutoTiming(true);
                    }}
                    className={`py-2 px-3 rounded-lg font-medium flex items-center justify-center gap-2 transition ${
                      importSource === 'qa' 
                        ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40' 
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    <Activity className="w-3.5 h-3.5 text-blue-400" />
                    <span>Из QA-проверки</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="text-neutral-300 font-medium block mb-1">
                  Целевая папка сведения:
                </label>
                <div className="flex gap-2">
                  <input 
                    type="text"
                    value={customTargetDir}
                    onChange={(e) => setCustomTargetDir(e.target.value)}
                    placeholder={workingDir || "По умолчанию: папка Сведения в папке серии"}
                    className="flex-1 px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-neutral-200 font-mono text-xs focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const selected = await ipcSafe.invoke('select-directory');
                        if (selected) {
                          setCustomTargetDir(selected);
                          mixLog('info', 'Папка', `Выбрана целевая папка: ${selected}`);
                        }
                      } catch (err) {}
                    }}
                    className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs transition-colors shrink-0 flex items-center gap-1.5"
                    title="Выбрать папку на диске"
                  >
                    <Folder className="w-3.5 h-3.5" />
                    <span>Обзор...</span>
                  </button>
                </div>
                {workingDir && !customTargetDir && (
                  <p className="text-[10px] text-neutral-400 mt-1 font-mono truncate">
                    Папка по умолчанию: {workingDir}
                  </p>
                )}
              </div>

              <div className="p-3 bg-neutral-950 rounded-lg border border-neutral-800 space-y-2.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="checkbox"
                    checked={importAutoTiming}
                    onChange={(e) => setImportAutoTiming(e.target.checked)}
                    className="rounded accent-blue-500"
                  />
                  <span>Включить автоматический автотайминг поверх импорта</span>
                </label>
                <p className="text-[10px] text-neutral-500 ml-5 -mt-1">
                  {importSource === 'timing' 
                    ? 'При импорте из Тайминга рекомендуется оставить выключенным, чтобы сохранить ручные правки.' 
                    : 'Автоматически подогнать фразы к таймингам субтитров ASS.'}
                </p>

                <label className="flex items-center gap-2 cursor-pointer pt-1">
                  <input 
                    type="checkbox"
                    checked={importAutoFixes}
                    onChange={(e) => setImportAutoFixes(e.target.checked)}
                    className="rounded accent-blue-500"
                  />
                  <span>Бесшовное вшитие фиксов и очистка хвостов реплик</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="checkbox"
                    checked={importSubtitles}
                    onChange={(e) => setImportSubtitles(e.target.checked)}
                    className="rounded accent-blue-500"
                  />
                  <span>Экспорт размеченных субтитров с ролями для звукорежиссера</span>
                </label>
              </div>

              {isImporting && (
                <div className="space-y-1.5 pt-2">
                  <div className="w-full bg-neutral-800 h-2 rounded-full overflow-hidden">
                    <div 
                      className="bg-blue-500 h-full transition-all duration-300"
                      style={{ width: `${importProgress || 15}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-blue-400 font-mono text-center">
                    {importStatusMessage || 'Импорт материалов...'}
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                onClick={() => setIsImportModalOpen(false)}
                disabled={isImporting}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-medium transition"
              >
                Отмена
              </button>
              <button
                onClick={handleImportSoundEngineerFiles}
                disabled={isImporting}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium flex items-center gap-2 transition"
              >
                {isImporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                <span>Начать импорт</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Module Database (Add Module to Pipeline) */}
      {isAddModuleModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-purple-600/20 text-purple-400 rounded-lg">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-neutral-100">База модулей сведения</h2>
                  <p className="text-xs text-neutral-400">Выберите модуль для добавления в активный конвейер</p>
                </div>
              </div>
              <button 
                onClick={() => setIsAddModuleModalOpen(false)}
                className="text-neutral-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
              {moduleDatabase.map((modDef) => {
                const isUltimate = (modDef as any).isUltimate || ['voice_master_strip', 'ultimate_denoiser', 'ultimate_dereverb', 'ultimate_separation', 'ultimate_loudness'].includes(modDef.id);
                return (
                  <div
                    key={modDef.id}
                    className={`p-3.5 border rounded-xl flex items-center justify-between gap-3 transition ${
                      isUltimate 
                        ? 'bg-purple-950/30 hover:bg-purple-900/40 border-purple-800/70 shadow-md'
                        : 'bg-neutral-950/60 hover:bg-neutral-800/60 border-neutral-800'
                    }`}
                  >
                    <div className="space-y-1 truncate">
                      <div className="flex items-center gap-2">
                        {isUltimate && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded border border-amber-500/40 tracking-wider uppercase flex items-center gap-1">
                            <Sparkles className="w-2.5 h-2.5" />
                            <span>All-In-One</span>
                          </span>
                        )}
                        <span className={`text-xs font-semibold ${isUltimate ? 'text-purple-200' : 'text-neutral-100'}`}>
                          {modDef.name || modDef.title}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.2 bg-neutral-800 text-purple-300 font-mono rounded border border-neutral-700">
                          {modDef.defaultPrefix}
                        </span>
                        <span className="text-[10px] text-neutral-500 uppercase">{modDef.category}</span>
                        {modDef.filename && (
                          <span className="text-[10px] px-1.5 py-0.2 bg-purple-950/60 text-purple-300 font-mono rounded border border-purple-800/40">
                            {modDef.filename} ({modDef.size_mb || 28.5} МБ)
                          </span>
                        )}
                        {modDef.presets && (
                          <span className="text-[10px] px-1.5 py-0.2 bg-purple-950/60 text-purple-300 rounded border border-purple-800/50">
                            {modDef.presets.length} пресета
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-neutral-400 leading-relaxed">
                        {modDef.description}
                      </p>
                      {modDef.recommended_for && (
                        <p className="text-[10px] text-amber-400/90 pt-0.5">
                          💡 {modDef.recommended_for}
                        </p>
                      )}
                    </div>

                    <button
                      onClick={() => handleAddModuleFromDatabase(modDef)}
                      className={`px-3 py-1.5 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 shrink-0 transition ${
                        isUltimate ? 'bg-purple-600 hover:bg-purple-500 font-bold shadow-sm' : 'bg-neutral-800 hover:bg-neutral-700'
                      }`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Добавить</span>
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end pt-2 border-t border-neutral-800">
              <button
                onClick={() => setIsAddModuleModalOpen(false)}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-medium transition"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Pipeline Presets (Choose or Manage Entire Pipeline Presets) */}
      {isPipelinePresetsModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-600/20 text-amber-400 rounded-lg">
                  <Bookmark className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-neutral-100">Пресеты всей цепочки сведения</h2>
                  <p className="text-xs text-neutral-400">Готовые студийные связки и ваши сохраненные конфигурации конвейера</p>
                </div>
              </div>
              <button 
                onClick={() => setIsPipelinePresetsModalOpen(false)}
                className="text-neutral-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              {isLoadingPresets ? (
                <div className="text-center py-8 text-neutral-500 flex items-center justify-center gap-2 text-xs">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Загрузка пресетов...</span>
                </div>
              ) : pipelinePresets.length === 0 ? (
                <div className="text-center py-8 text-neutral-500 text-xs">
                  Нет доступных пресетов
                </div>
              ) : (
                pipelinePresets.map((preset) => (
                  <div
                    key={preset.id}
                    onClick={() => handleApplyPipelinePreset(preset)}
                    className="p-4 bg-neutral-950/80 hover:bg-neutral-800/80 border border-neutral-800 hover:border-amber-500/60 rounded-xl cursor-pointer transition space-y-2 group"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-xs font-bold text-neutral-100 group-hover:text-amber-300 transition">
                            {preset.name}
                          </h3>
                          {preset.isBuiltIn ? (
                            <span className="text-[10px] px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded">
                              Встроенный
                            </span>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded">
                              Пользовательский
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed">
                          {preset.description || 'Пользовательский пресет конвейера'}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {!preset.isBuiltIn && (
                          <button
                            onClick={(e) => handleDeletePipelinePreset(preset.id, e)}
                            className="p-1.5 text-neutral-500 hover:text-red-400 hover:bg-red-500/10 rounded transition"
                            title="Удалить пресет"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => handleApplyPipelinePreset(preset)}
                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Применить</span>
                        </button>
                      </div>
                    </div>

                    {/* Steps Badge Chain */}
                    <div className="flex flex-wrap gap-1.5 pt-1 border-t border-neutral-800/60">
                      {preset.pipeline.map((step, sIdx) => {
                        const m = getModuleMeta(step.moduleId);
                        return (
                          <span 
                            key={sIdx}
                            className="text-[10px] px-2 py-0.5 bg-neutral-900 text-neutral-300 rounded border border-neutral-800 font-mono"
                          >
                            {sIdx + 1}. {m?.title || step.moduleId}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-neutral-800">
              <button
                onClick={() => {
                  setIsPipelinePresetsModalOpen(false);
                  setIsSavePresetModalOpen(true);
                }}
                className="px-3.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-medium flex items-center gap-1.5 transition"
              >
                <Bookmark className="w-3.5 h-3.5" />
                <span>Сохранить текущую цепочку как новый пресет</span>
              </button>

              <button
                onClick={() => setIsPipelinePresetsModalOpen(false)}
                className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-medium transition"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Save Current Pipeline as Preset */}
      {isSavePresetModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-600/20 text-amber-400 rounded-lg">
                  <Bookmark className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-neutral-100">Сохранить пресет всей цепочки</h2>
                  <p className="text-xs text-neutral-400">Сохраняет порядок всех модулей и текущие значения настроек</p>
                </div>
              </div>
              <button 
                onClick={() => setIsSavePresetModalOpen(false)}
                className="text-neutral-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-neutral-300 font-medium block mb-1">
                  Название пресета:
                </label>
                <input 
                  type="text"
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  placeholder="Мой студийный конвейер 2026"
                  className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-neutral-200 text-xs focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="text-neutral-300 font-medium block mb-1">
                  Описание пресета:
                </label>
                <textarea 
                  value={newPresetDesc}
                  onChange={(e) => setNewPresetDesc(e.target.value)}
                  placeholder="Краткое примечание: для какого типа сериалов, голосов или микрофонов подходит"
                  rows={3}
                  className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-neutral-200 text-xs focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="p-3 bg-neutral-950 rounded-lg border border-neutral-800 text-[11px] text-neutral-400">
                <span>Будет сохранено модулей: </span>
                <span className="font-bold text-amber-400">{manifest?.pipeline?.length || 0}</span>
                <span className="block mt-1 text-neutral-500">
                  Все выставленные параметры модулей (гейт, LUFS, атака, даккинг, битрейт) запомнятся в пресете.
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                onClick={() => setIsSavePresetModalOpen(false)}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-medium transition"
              >
                Отмена
              </button>
              <button
                onClick={handleSaveCurrentPipelineAsPreset}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-medium flex items-center gap-2 transition"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Сохранить пресет</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Import External Files (Standalone / Outside Projects) */}
      {isExternalImportModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-sky-600/20 text-sky-400 rounded-lg">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-neutral-100">Импорт внешних сторонних файлов</h2>
                  <p className="text-xs text-neutral-400">Сведение присланной серии без необходимости создавать проект в базе</p>
                </div>
              </div>
              <button 
                onClick={() => setIsExternalImportModalOpen(false)}
                className="text-neutral-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {/* External Video Selector */}
              <div className="space-y-1">
                <label className="text-neutral-300 font-medium flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-blue-400">
                    <Film className="w-3.5 h-3.5" />
                    Видеофайл серии (MP4 / MKV / MOV):
                  </span>
                  <button
                    onClick={() => handleSelectExternalFile('video')}
                    className="text-[11px] text-blue-400 hover:text-blue-300 underline"
                  >
                    Обзор...
                  </button>
                </label>
                <div className="flex gap-2">
                  <input 
                    type="text"
                    value={extVideoPath}
                    onChange={(e) => setExtVideoPath(e.target.value)}
                    placeholder="Путь к видеофайлу..."
                    className="flex-1 px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-neutral-200 font-mono text-[11px] focus:outline-none focus:border-sky-500"
                  />
                  <button
                    onClick={() => handleSelectExternalFile('video')}
                    className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs"
                  >
                    Выбрать
                  </button>
                </div>
              </div>

              {/* External Subtitles Selector */}
              <div className="space-y-1">
                <label className="text-neutral-300 font-medium flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-indigo-400">
                    <FileText className="w-3.5 h-3.5" />
                    Файл субтитров (ASS / SRT):
                  </span>
                  <button
                    onClick={() => handleSelectExternalFile('subtitles')}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 underline"
                  >
                    Обзор...
                  </button>
                </label>
                <div className="flex gap-2">
                  <input 
                    type="text"
                    value={extSubPath}
                    onChange={(e) => setExtSubPath(e.target.value)}
                    placeholder="Путь к субтитрам для автотайминга..."
                    className="flex-1 px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-neutral-200 font-mono text-[11px] focus:outline-none focus:border-sky-500"
                  />
                  <button
                    onClick={() => handleSelectExternalFile('subtitles')}
                    className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs"
                  >
                    Выбрать
                  </button>
                </div>
              </div>

              {/* External Audio Tracks Selector */}
              <div className="space-y-1">
                <label className="text-neutral-300 font-medium flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <FileAudio className="w-3.5 h-3.5" />
                    Дорожки дабберов (WAV / MP3 / FLAC):
                  </span>
                  <button
                    onClick={() => handleSelectExternalFile('audio')}
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 underline"
                  >
                    Добавить файлы...
                  </button>
                </label>

                {extAudioPaths.length === 0 ? (
                  <div 
                    onClick={() => handleSelectExternalFile('audio')}
                    className="border-2 border-dashed border-neutral-800 hover:border-emerald-600/60 rounded-xl p-4 text-center cursor-pointer transition text-neutral-500"
                  >
                    <Upload className="w-5 h-5 mx-auto mb-1 text-neutral-600" />
                    <span>Нажмите, чтобы выбрать несколько аудиодорожек дабберов</span>
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-32 overflow-y-auto bg-neutral-950 p-2.5 rounded-lg border border-neutral-800">
                    {extAudioPaths.map((ap, aIdx) => (
                      <div key={aIdx} className="flex items-center justify-between text-[11px] font-mono text-neutral-300 bg-neutral-900 px-2.5 py-1 rounded">
                        <span className="truncate max-w-[400px]">{ap}</span>
                        <button
                          onClick={() => setExtAudioPaths(extAudioPaths.filter((_, i) => i !== aIdx))}
                          className="text-neutral-500 hover:text-red-400 ml-2"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2 border-t border-neutral-800">
              <button
                onClick={() => setIsExternalImportModalOpen(false)}
                disabled={isSubmittingExternal}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-medium transition"
              >
                Отмена
              </button>
              <button
                onClick={handleImportExternalFilesSubmit}
                disabled={isSubmittingExternal || (!extVideoPath && !extSubPath && extAudioPaths.length === 0)}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white rounded-lg text-xs font-medium flex items-center gap-2 transition"
              >
                {isSubmittingExternal ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                <span>Импортировать в сведение</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
