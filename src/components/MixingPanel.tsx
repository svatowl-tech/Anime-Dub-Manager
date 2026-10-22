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
  Loader2,
  Zap,
  XCircle,
  FileDown,
  RotateCcw,
  Folder,
  Activity,
  X
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
  matchIntensity: { min: 0, max: 100, step: 1 },
  subBassCutoff: { min: 20, max: 150, step: 1 },
  airLimitDb: { min: 0.0, max: 8.0, step: 0.5 },
  smoothness: { min: 1, max: 6, step: 1 },
  sensitivity: { min: 0.5, max: 10.0, step: 0.5 },
  wetDryBlend: { min: 10, max: 100, step: 1 },
  attenuationLimitDb: { min: 6, max: 100, step: 1 },
  reverbReduction: { min: 0.05, max: 1.0, step: 0.05 },
  shifts: { min: 1, max: 5, step: 1 },
  overlap: { min: 0.1, max: 0.5, step: 0.05 },
  segment: { min: 5, max: 60, step: 5 },
  noiseReductionDb: { min: 1, max: 45, step: 1 },
  noiseFloorDb: { min: -85, max: -20, step: 1 },
  deechoReductionDb: { min: 1, max: 30, step: 1 },
  earlyReflectionsDecay: { min: 0.1, max: 1.0, step: 0.05 },
  airBandBoostDb: { min: 0, max: 15, step: 0.5 },
  harmonicSaturation: { min: 0.1, max: 1.0, step: 0.05 },
  formantClarity: { min: 0.1, max: 1.0, step: 0.05 },
  thresholdDb: { min: -60, max: 0, step: 1 },
  rangeDb: { min: -90, max: 0, step: 1 },
  attackMs: { min: 1, max: 500, step: 1 },
  releaseMs: { min: 10, max: 2000, step: 10 },
  targetLufs: { min: -30, max: -5, step: 0.5 },
  truePeak: { min: -10, max: 0, step: 0.1 },
  loudnessRange: { min: 1, max: 20, step: 0.5 },
  lra: { min: 1, max: 20, step: 0.5 },
  maxGainDb: { min: 0, max: 30, step: 0.5 },
  marginDb: { min: -10, max: 15, step: 0.5 },
  postProcessThreshold: { min: 0.0, max: 1.0, step: 0.05 },
  instrumentalBlend: { min: 0, max: 100, step: 1 },
  frequencyHz: { min: 3000, max: 12000, step: 100 },
  intensity: { min: 0.0, max: 10.0, step: 0.1 },
  maxReduction: { min: 0.1, max: 1.0, step: 0.05 },
  ratio: { min: 1, max: 20, step: 0.1 },
  kneeDb: { min: 0, max: 20, step: 0.5 },
  makeupDb: { min: 0, max: 20, step: 0.5 },
  peakLimitDb: { min: -12, max: 0, step: 0.5 },
  duckingAmountDb: { min: -36, max: -1, step: 1 },
  threshold: { min: 0.01, max: 0.5, step: 0.01 },
  minGapSec: { min: 0.01, max: 2.0, step: 0.01 },
  leadInSec: { min: 0.0, max: 1.0, step: 0.01 },
  silenceThresholdDb: { min: -80, max: -20, step: 1 },
  minSilenceDuration: { min: 0.05, max: 2.0, step: 0.05 },
  fadeDurationMs: { min: 0, max: 100, step: 1 },
  safetyPaddingMs: { min: 0, max: 500, step: 5 },
  minTimeStretch: { min: 0.5, max: 1.0, step: 0.05 },
  maxTimeStretch: { min: 1.0, max: 2.0, step: 0.05 },
  maxDriftMs: { min: 10, max: 300, step: 5 },
  confidenceThreshold: { min: 0.1, max: 1.0, step: 0.05 },
  loudnessMatchStrength: { min: 0, max: 100, step: 1 },
  reverbMatchStrength: { min: 0, max: 100, step: 1 },
  eqMatchStrength: { min: 0, max: 100, step: 1 },
  targetLufsOffset: { min: -10, max: 10, step: 0.5 },
  // De-Plosive / Thickener / Spectral De-Reverb / Headroom / Speech Leveler
  frequencyLimitHz: { min: 60, max: 250, step: 5 },
  suppressionDepthDb: { min: -36, max: 0, step: 1 },
  recoveryMs: { min: 5, max: 250, step: 5 },
  wetDryPercent: { min: 10, max: 100, step: 5 },
  bodyDrivePercent: { min: 0, max: 100, step: 5 },
  presenceClarityPercent: { min: 0, max: 100, step: 5 },
  tapeDensityPercent: { min: 0, max: 100, step: 5 },
  mixPercent: { min: 10, max: 100, step: 5 },
  reductionDb: { min: -24, max: 0, step: 0.5 },
  decayTimeEstMs: { min: 100, max: 1200, step: 25 },
  clarityPercent: { min: 0, max: 100, step: 5 },
  targetPeakDb: { min: -18, max: 0, step: 0.5 },
  maxBoostDb: { min: 0, max: 48, step: 1 },
  manualGainDb: { min: -12, max: 24, step: 0.5 },
  lookaheadMs: { min: 0.5, max: 20, step: 0.5 },
  targetLevelDb: { min: -30, max: -6, step: 0.5 },
  maxCutDb: { min: -24, max: 0, step: 1 },
  silenceGateDb: { min: -80, max: -25, step: 1 },
  peakCeilingDb: { min: -12, max: 0, step: 0.5 },
  lowCutHz: { min: 20, max: 250, step: 5 },
  presenceHz: { min: 1500, max: 6000, step: 100 },
  presenceGainDb: { min: -6.0, max: 8.0, step: 0.5 },
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
  levelingSpeedMs: { min: 50, max: 1000, step: 25 },
  // Airwindows DSP Specs
  deessIntensity: { min: 0.0, max: 1.0, step: 0.05 },
  popIntensity: { min: 0.0, max: 1.0, step: 0.05 },
  slewIntensity: { min: 0.0, max: 1.0, step: 0.05 },
  densityDrive: { min: 0.0, max: 1.0, step: 0.05 }
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

  // Acoustic Original Profile & Voice Matcher State
  const [isAcousticMatchModalOpen, setIsAcousticMatchModalOpen] = useState<boolean>(false);
  const [origVocalsPath, setOrigVocalsPath] = useState<string>('');
  const [ourVocalsPath, setOurVocalsPath] = useState<string>('');
  const [origVocalsError, setOrigVocalsError] = useState<string | null>(null);
  const [ourVocalsError, setOurVocalsError] = useState<string | null>(null);
  const [acousticProfile, setAcousticProfile] = useState<any | null>(null);
  const [isAnalyzingAcoustics, setIsAnalyzingAcoustics] = useState<boolean>(false);
  const [isApplyingAcousticMatch, setIsApplyingAcousticMatch] = useState<boolean>(false);
  const [loudnessStrength, setLoudnessStrength] = useState<number>(100);
  const [reverbStrength, setReverbStrength] = useState<number>(100);
  const [eqStrength, setEqStrength] = useState<number>(100);
  const [targetLufsOffset, setTargetLufsOffset] = useState<number>(0.0);
  const [acousticMatchResult, setAcousticMatchResult] = useState<any | null>(null);
  const [selectedEffectFilter, setSelectedEffectFilter] = useState<string>('all');

  // Video Preview Proxy state
  const [isCreatingProxy, setIsCreatingProxy] = useState<boolean>(false);
  const [proxyProgress, setProxyProgress] = useState<number>(0);

  const handleCreateVideoProxy = async () => {
    const sourcePath = manifest?.sourceFiles?.video?.path || currentEpisode?.rawPath;
    if (!sourcePath) return;
    try {
      setIsCreatingProxy(true);
      setProxyProgress(0);
      toast.info('Создание легкого MP4-прокси для плеера (H.264/AAC)...');

      const unsub = ipcSafe.on('video-proxy-progress', (data: any) => {
        if (data && typeof data.percent === 'number') {
          setProxyProgress(data.percent);
        }
      });

      const res = await ipcSafe.invoke('create-video-preview-proxy', { videoPath: sourcePath });
      if (typeof unsub === 'function') unsub();

      setIsCreatingProxy(false);
      if (res && res.proxyPath) {
        toast.success('MP4-прокси успешно создан! Воспроизведение подключено. 🎬');
        setVideoSrc(formatMediaUrl(res.proxyPath));
        setVideoPlaybackError(null);
      }
    } catch (e: any) {
      setIsCreatingProxy(false);
      toast.error(`Ошибка создания прокси: ${e.message}`);
    }
  };

  // Active step processing
  const [activeProcessingStepId, setActiveProcessingStepId] = useState<string | null>(null);
  const [stepProgress, setStepProgress] = useState<Record<string, number>>({});
  const [expandedSettings, setExpandedSettings] = useState<Record<string, boolean>>({});
  const [expandedTracks, setExpandedTracks] = useState<Record<string, boolean>>({});

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
  const currentTimeRef = useRef<number>(0);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoViewMode, setVideoViewMode] = useState<'source' | 'final'>('source');
  const [videoPlaybackError, setVideoPlaybackError] = useState<string | null>(null);
  const [audioPlaybackError, setAudioPlaybackError] = useState<string | null>(null);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<{
    id: string;
    name: string;
    path: string;
    label: string;
    stepId?: string;
    isModuleMix?: boolean;
    isFinalVideo?: boolean;
    mixFiles?: MixingFileItem[];
  } | null>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  // Volume controls for player (Pure layering, zero real-time DSP)
  const [playWithVideo, setPlayWithVideo] = useState<boolean>(true);
  const [videoVolume, setVideoVolume] = useState<number>(0.35);
  const [isVideoMuted, setIsVideoMuted] = useState<boolean>(false);
  const [trackVolume, setTrackVolume] = useState<number>(0.95);
  const [isTrackMuted, setIsTrackMuted] = useState<boolean>(false);
  const [rolesVolumeMap, setRolesVolumeMap] = useState<Record<string, number>>({});

  const handleUpdateDubberVolume = useCallback(async (trackKey: string, newPct: number) => {
    setRolesVolumeMap(prev => {
      const updated = { ...prev, [trackKey]: newPct };
      if (currentEpisode) {
        ipcSafe.invoke('mixing-save-timing-metadata', {
          episode: currentEpisode,
          targetDir: workingDir || undefined,
          timingMetadata: {
            rolesVolumeMap: updated,
            updatedAt: new Date().toISOString()
          }
        }).catch(() => {});
      }
      return updated;
    });
  }, [currentEpisode, workingDir]);

  // Helper to stop and clear multi-track module mix audio
  const stopAndClearModuleMix = useCallback(() => {
    mixAudioElementsRef.current.forEach(audio => {
      try {
        audio.onloadedmetadata = null;
        audio.ontimeupdate = null;
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
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
        trackAudioRef.current.removeAttribute('src');
        try { trackAudioRef.current.load(); } catch (e) {}
      }
      stopAndClearModuleMix();
    } catch (e) {}
  }, [stopAndClearModuleMix]);

  // Sanitize any leftover temporary .tmp_ prefix from paths
  const sanitizeTempPath = useCallback((rawPath: string) => {
    if (!rawPath) return '';
    return rawPath.replace(/\.tmp_[0-9]+_[a-z0-9]+_/i, '');
  }, []);

  // Format media file URL (video or audio) for HTML5 elements safely across Windows/macOS/Linux
  const formatMediaUrl = useCallback((filePath: string) => {
    if (!filePath) return '';
    if (
      filePath.startsWith('http://') ||
      filePath.startsWith('https://') ||
      filePath.startsWith('blob:') ||
      filePath.startsWith('/api/media-file')
    ) {
      return filePath;
    }
    if (filePath.startsWith('custom-media://local/media?path=')) {
      return filePath;
    }
    const cleanP = sanitizeTempPath(
      filePath
        .replace(/^file:\/\//, '')
        .replace(/^custom-media:\/\//, '')
    );
    if (window.electronAPI) {
      // Use query-parameter encoding on valid host 'local' so Windows drive letters (I:\), Cyrillic, brackets [СВЕДЕНО], and spaces never break URL parsing
      return `custom-media://local/media?path=${encodeURIComponent(cleanP)}`;
    }
    return cleanP;
  }, [sanitizeTempPath]);

  const resolveMediaUrlAsync = useCallback(async (filePath: string): Promise<string> => {
    if (!filePath) return '';
    const cleaned = sanitizeTempPath(filePath);
    if (window.electronAPI) {
      return formatMediaUrl(cleaned);
    }
    const cleanName = cleaned.replace(/\\/g, '/').split('/').pop() || cleaned;
    const cachedFile = (window as any).getFileFromCache?.(cleanName);
    if (cachedFile) {
      return URL.createObjectURL(cachedFile);
    }
    try {
      const resolved = await resolveLocalPath(cleaned);
      if (resolved) return resolved;
    } catch (e) {}
    return formatMediaUrl(cleaned);
  }, [formatMediaUrl, sanitizeTempPath]);

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
        if (res.rolesVolumeMap) {
          setRolesVolumeMap(res.rolesVolumeMap);
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

  // Reset custom target dir & player state when episode changes
  useEffect(() => {
    setCustomTargetDir('');
    releasePlayerAudioLocks();
    setSelectedAudioTrack(null);
    setVideoViewMode('source');
    setCurrentTime(0);
    setDuration(0);
  }, [currentEpisode?.id, releasePlayerAudioLocks]);

  // Automatically switch to 'final' view mode when finalVideo first appears and no custom track is selected
  const prevFinalVideoPathRef = useRef<string | null>(null);
  useEffect(() => {
    const finalPath = manifest?.finalVideo?.path ? sanitizeTempPath(manifest.finalVideo.path) : null;
    if (finalPath && finalPath !== prevFinalVideoPathRef.current) {
      prevFinalVideoPathRef.current = finalPath;
      if (!selectedAudioTrack || selectedAudioTrack.isFinalVideo) {
        setVideoViewMode('final');
        setIsVideoMuted(false);
        setVideoVolume(prev => (prev < 0.3 ? 0.85 : prev));
        setSelectedAudioTrack({
          id: 'final_mixed_video',
          name: manifest?.finalVideo?.name || finalPath.split(/[/\\]/).pop() || 'Сведенное видео',
          path: finalPath,
          label: 'Сведено [MP4]',
          isFinalVideo: true
        });
      }
    } else if (!finalPath) {
      prevFinalVideoPathRef.current = null;
      if (videoViewMode === 'final') {
        setVideoViewMode('source');
      }
    }
  }, [manifest?.finalVideo?.path, manifest?.finalVideo?.name, selectedAudioTrack, videoViewMode, sanitizeTempPath]);

  // Resolve video URL for HTML5 video element based on videoViewMode ('source' vs 'final')
  useEffect(() => {
    let active = true;
    setVideoPlaybackError(null);

    const resolveVideo = async () => {
      const sourcePath = manifest?.sourceFiles?.video?.path || currentEpisode?.rawPath;
      const rawFinalPath = manifest?.finalVideo?.path;
      const finalPath = rawFinalPath ? sanitizeTempPath(rawFinalPath) : null;

      let targetPath = sourcePath;

      if (videoViewMode === 'final' && finalPath) {
        let finalExists = true;
        if (window.electronAPI) {
          try {
            finalExists = await ipcSafe.invoke('file-exists', finalPath);
          } catch (e) {
            finalExists = true;
          }
        }
        if (finalExists) {
          targetPath = finalPath;
        } else if (sourcePath) {
          targetPath = sourcePath;
        }
      }

      if (!targetPath) {
        if (active) setVideoSrc(null);
        return;
      }

      const resolved = await resolveMediaUrlAsync(targetPath);
      if (active) {
        setVideoSrc(prev => {
          if (prev !== resolved) {
            const fileName = targetPath.split(/[/\\]/).pop() || targetPath;
            mixLog('debug', 'Видео', `Видеопоток подключен (${videoViewMode === 'final' ? 'Сведенный' : 'Исходник'}): ${fileName}`);
          }
          return resolved;
        });
      }
    };

    resolveVideo();
    return () => { active = false; };
  }, [videoViewMode, manifest?.finalVideo?.path, manifest?.sourceFiles?.video?.path, currentEpisode?.rawPath, mixLog, resolveMediaUrlAsync, sanitizeTempPath]);

  // Restore currentTime when videoSrc changes
  const handleVideoLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const vid = e.currentTarget;
    if (vid.duration && !isNaN(vid.duration) && isFinite(vid.duration)) {
      setDuration(vid.duration);
    }
    if (currentTimeRef.current > 0 && Math.abs(vid.currentTime - currentTimeRef.current) > 0.5) {
      try {
        vid.currentTime = Math.min(currentTimeRef.current, vid.duration || currentTimeRef.current);
      } catch (_) {}
    }
    vid.muted = isVideoMuted;
    vid.volume = isVideoMuted ? 0 : Math.min(1, Math.max(0, videoVolume));
    if (isPlaying && vid.paused) {
      vid.play().catch(() => {});
    }
  };

  const handleVideoError = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    const videoEl = e.currentTarget;
    const err = videoEl.error;
    console.warn('[MixingPanel] Video element playback error:', err, 'src:', videoSrc);

    // Fallback: If current mode was 'final' video and it failed, fall back to 'source' video
    const sourcePath = manifest?.sourceFiles?.video?.path || currentEpisode?.rawPath;
    if (videoViewMode === 'final' && sourcePath) {
      mixLog('warn', 'Видео', `Сбой открытия сведенного видео. Автопереключение на исходный видеоряд: ${sourcePath}`);
      setVideoViewMode('source');
      setVideoPlaybackError(null);
      return;
    }

    let errMsg = 'Формат или кодек видео недоступен для прямого воспроизведения в плеере';
    if (err) {
      if (err.code === 1) errMsg = 'Воспроизведение видео прервано пользователем';
      if (err.code === 2) errMsg = 'Сбой сети при получении видеопотока';
      if (err.code === 3) errMsg = 'Ошибка декодирования (несовместимый видеокодек HEVC или контейнер MKV)';
      if (err.code === 4) errMsg = 'Контейнер/кодек видео не поддерживается HTML5-плеером (напр. MKV / AC3 / 10-bit H.264). Прослушивание аудиодорожек продолжает работать штатно!';
    }
    setVideoPlaybackError(errMsg);
    mixLog('warn', 'Видео', `Несовместимость видеоконтейнера: ${errMsg}`);
  };

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
            // Delay slightly so _safeReplaceFile finishes renaming .tmp_ to final file before status scan
            setTimeout(() => {
              loadStatus();
            }, 350);
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

  // Connect track & module mix volume and mute state (including per-dubber rolesVolumeMap)
  useEffect(() => {
    const baseVol = isTrackMuted ? 0 : Math.min(1, Math.max(0, trackVolume));
    if (trackAudioRef.current) {
      trackAudioRef.current.muted = isTrackMuted;
      trackAudioRef.current.volume = Math.min(1, baseVol);
    }
    mixAudioElementsRef.current.forEach(a => {
      const roleFactor = Number((a as any)._roleVolumeFactor ?? 1);
      a.muted = isTrackMuted;
      a.volume = Math.min(1, Math.max(0, baseVol * roleFactor));
    });
  }, [trackVolume, isTrackMuted, rolesVolumeMap]);

  // Helper: Load a URL into trackAudioRef, seek to targetTime when ready, and optionally start playing
  const loadSingleTrackAudio = useCallback((resolvedSrc: string, targetTime: number, autoPlay: boolean) => {
    const audioEl = trackAudioRef.current;
    if (!audioEl) return;

    setAudioPlaybackError(null);
    audioEl.pause();
    audioEl.src = resolvedSrc;
    audioEl.muted = isTrackMuted;
    audioEl.volume = isTrackMuted ? 0 : Math.min(1, Math.max(0, trackVolume));

    const onLoaded = () => {
      audioEl.removeEventListener('loadedmetadata', onLoaded);
      audioEl.removeEventListener('error', onError);
      if (audioEl.duration && !isNaN(audioEl.duration) && isFinite(audioEl.duration)) {
        setDuration(prev => (prev > 0 ? prev : audioEl.duration));
      }
      if (targetTime > 0) {
        try {
          audioEl.currentTime = Math.min(targetTime, audioEl.duration || targetTime);
        } catch (_) {}
      }
      if (autoPlay) {
        audioEl.play().catch(err => {
          console.warn('[MixingPanel] Audio play warning:', err);
        });
        if (videoRef.current && !videoPlaybackError) {
          try {
            if (Math.abs(videoRef.current.currentTime - targetTime) > 0.3) {
              videoRef.current.currentTime = targetTime;
            }
            videoRef.current.play().catch(() => {});
          } catch (_) {}
        }
        setIsPlaying(true);
      }
    };

    const onError = () => {
      audioEl.removeEventListener('loadedmetadata', onLoaded);
      audioEl.removeEventListener('error', onError);
      const errCode = audioEl.error?.code;
      const msg = `Не удалось загрузить аудиофайл (код ${errCode || 'неизвестен'})`;
      console.warn('[MixingPanel] Track audio load error:', audioEl.error, 'src:', resolvedSrc);
      setAudioPlaybackError(msg);
      toast.error(msg);
    };

    audioEl.addEventListener('loadedmetadata', onLoaded);
    audioEl.addEventListener('error', onError);
    audioEl.load();
  }, [isTrackMuted, trackVolume, videoPlaybackError]);

  // Switch player to Final Mixed Video mode ([СВЕДЕНО].mp4)
  const selectFinalVideoForPlayback = useCallback(async (videoItem?: MixingFileItem, customLabel?: string, stepId?: string) => {
    const targetItem = videoItem || manifest?.finalVideo;
    if (!targetItem || !targetItem.path) {
      toast.error('Финальное сведенное видео ещё не создано');
      return;
    }

    stopAndClearModuleMix();
    if (trackAudioRef.current) {
      trackAudioRef.current.pause();
      trackAudioRef.current.removeAttribute('src');
      try { trackAudioRef.current.load(); } catch (_) {}
    }

    const cleanPath = sanitizeTempPath(targetItem.path);
    setAudioPlaybackError(null);
    setVideoPlaybackError(null);
    setVideoViewMode('final');
    setIsVideoMuted(false);
    if (videoVolume < 0.35) {
      setVideoVolume(0.9);
    }

    const resolvedUrl = await resolveMediaUrlAsync(cleanPath);
    setVideoSrc(resolvedUrl);

    setSelectedAudioTrack({
      id: targetItem.path,
      name: sanitizeTempPath(targetItem.name || cleanPath.split(/[/\\]/).pop() || 'Сведенное видео'),
      path: resolvedUrl,
      label: customLabel || 'Сведено [MP4]',
      stepId: stepId || 'video_mux',
      isFinalVideo: true
    });

    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.muted = false;
        videoRef.current.volume = Math.min(1, Math.max(0.35, videoVolume));
        if (currentTimeRef.current > 0) {
          try { videoRef.current.currentTime = currentTimeRef.current; } catch (_) {}
        }
        videoRef.current.play().then(() => {
          setIsPlaying(true);
        }).catch(() => {});
      }
    }, 80);

    toast.success(`Включен просмотр сведенного видео: ${sanitizeTempPath(targetItem.name)}`, { duration: 2500 });
  }, [manifest?.finalVideo, stopAndClearModuleMix, sanitizeTempPath, videoVolume, resolveMediaUrlAsync]);

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

    stopAndClearModuleMix();
    setVideoViewMode('source');

    if (!origPath) {
      // Fallback: unmute source video audio element directly so user can hear original sound
      if (trackAudioRef.current) {
        trackAudioRef.current.pause();
        trackAudioRef.current.removeAttribute('src');
      }
      setIsVideoMuted(false);
      if (videoVolume < 0.3) setVideoVolume(0.85);
      setSelectedAudioTrack({
        id: 'original_audio_source',
        name: 'Оригинальный звук из видеофайла серии',
        path: '',
        label: 'Оригинал (Видео)',
      });
      if (videoRef.current && !videoPlaybackError) {
        videoRef.current.muted = false;
        videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
      }
      toast.info('Звук оригинала воспроизводится напрямую из исходного видеофайла 🎬');
      return;
    }

    // Mute video element's own audio so it doesn't double-play with 00_original_audio.wav
    setIsVideoMuted(true);
    const resolvedSrc = await resolveMediaUrlAsync(origPath);

    setSelectedAudioTrack({
      id: 'original_audio_source',
      name: 'Оригинальный звук серии (00_original_audio.wav)',
      path: resolvedSrc,
      label: 'Оригинал',
    });

    loadSingleTrackAudio(resolvedSrc, currentTimeRef.current, true);
    toast.info('Включена оригинальная звуковая дорожка серии', { duration: 2500 });
  }, [manifest?.sourceFiles?.originalAudio?.path, currentEpisode, workingDir, customTargetDir, stopAndClearModuleMix, videoVolume, videoPlaybackError, resolveMediaUrlAsync, loadSingleTrackAudio]);

  // Select an individual audio or video file for inspection in the player
  const selectTrackForInspection = useCallback(async (item: MixingFileItem, label: string, stepId?: string) => {
    if (!item || !item.path) return;

    const cleanName = sanitizeTempPath(item.name || '');
    const cleanPath = sanitizeTempPath(item.path);

    // If the user clicked a video file (e.g. output of 14_video_mux), switch to Final Video playback mode!
    if (/\.(mp4|mkv|mov|avi|webm)$/i.test(cleanName || cleanPath)) {
      await selectFinalVideoForPlayback({ ...item, name: cleanName, path: cleanPath }, label, stepId);
      return;
    }

    // If user clicked the already-selected single track, toggle play/pause for convenience
    if (selectedAudioTrack && !selectedAudioTrack.isModuleMix && !selectedAudioTrack.isFinalVideo && selectedAudioTrack.id === item.path) {
      if (isPlaying) {
        if (videoRef.current) videoRef.current.pause();
        if (trackAudioRef.current) trackAudioRef.current.pause();
        setIsPlaying(false);
      } else {
        if (videoRef.current && !videoPlaybackError) {
          videoRef.current.play().catch(() => {});
        }
        if (trackAudioRef.current) {
          trackAudioRef.current.play().catch(() => {});
        }
        setIsPlaying(true);
      }
      return;
    }

    stopAndClearModuleMix();

    // Switch video display to raw source video so we don't play voices over the already-mixed final video
    if (videoViewMode === 'final') {
      setVideoViewMode('source');
    }

    // If inspecting master_audio_mix or ducking output (which already contains background audio), mute raw video audio to prevent doubling
    const lowerName = cleanName.toLowerCase();
    if (lowerName.includes('master_audio_mix') || lowerName.includes('ducking') || lowerName.includes('original_audio')) {
      setIsVideoMuted(true);
    }

    const resolvedSrc = await resolveMediaUrlAsync(cleanPath);

    setSelectedAudioTrack({
      id: item.path,
      name: cleanName || item.name,
      path: resolvedSrc,
      label,
      stepId,
      isFinalVideo: false
    });

    loadSingleTrackAudio(resolvedSrc, currentTimeRef.current, true);
    toast.info(`Воспроизведение дорожки: ${cleanName || item.name}`, { duration: 2500 });
  }, [sanitizeTempPath, selectFinalVideoForPlayback, selectedAudioTrack, isPlaying, videoPlaybackError, stopAndClearModuleMix, videoViewMode, resolveMediaUrlAsync, loadSingleTrackAudio]);

  // Select module mix for multi-track playback
  const selectModuleMixForInspection = useCallback(async (step: PipelineStep) => {
    if (!step.outputFiles || step.outputFiles.length === 0) {
      toast.error('У этого модуля ещё нет сохраненных обработанных дорожек');
      return;
    }

    const meta = moduleDatabase.find(m => m.id === step.moduleId);

    // If this is the video_mux step or only outputs video files, play the final video!
    const videoOutputs = step.outputFiles.filter(f => /\.(mp4|mkv|mov|avi|webm)$/i.test(f.name || f.path));
    const audioOutputs = step.outputFiles.filter(f => !/\.(mp4|mkv|mov|avi|webm)$/i.test(f.name || f.path));

    if (audioOutputs.length === 0 && videoOutputs.length > 0) {
      await selectFinalVideoForPlayback(videoOutputs[0], `${meta?.title || step.moduleId}: ${videoOutputs[0].name}`, step.stepId);
      return;
    }

    if (audioOutputs.length === 1) {
      await selectTrackForInspection(audioOutputs[0], `${meta?.title || step.moduleId}: ${audioOutputs[0].name}`, step.stepId);
      return;
    }

    // Stop single track audio
    if (trackAudioRef.current) {
      trackAudioRef.current.pause();
      trackAudioRef.current.removeAttribute('src');
      try { trackAudioRef.current.load(); } catch (_) {}
    }

    // Clear previous mix elements
    stopAndClearModuleMix();
    setAudioPlaybackError(null);

    if (videoViewMode === 'final') {
      setVideoViewMode('source');
    }

    const targetTime = currentTimeRef.current;
    const baseVol = isTrackMuted ? 0 : Math.min(1, Math.max(0, trackVolume));
    const audioElements: HTMLAudioElement[] = [];

    for (let i = 0; i < audioOutputs.length; i++) {
      const file = audioOutputs[i];
      const cleanPath = sanitizeTempPath(file.path);
      const resolvedSrc = await resolveMediaUrlAsync(cleanPath);

      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = resolvedSrc;

      // Apply per-dubber role volume if configured
      let rolePct = 100;
      if (file.dubberNick && rolesVolumeMap[file.dubberNick] !== undefined) {
        rolePct = Number(rolesVolumeMap[file.dubberNick]) || 100;
      }
      const roleFactor = Math.max(0, Math.min(2, rolePct / 100));
      (audio as any)._roleVolumeFactor = roleFactor;
      audio.muted = isTrackMuted;
      audio.volume = Math.min(1, Math.max(0, baseVol * roleFactor));

      audio.onloadedmetadata = () => {
        if (i === 0 && audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
          setDuration(prev => (prev > 0 ? prev : audio.duration));
        }
        if (targetTime > 0) {
          try {
            audio.currentTime = Math.min(targetTime, audio.duration || targetTime);
          } catch (_) {}
        }
      };

      // First mix track drives clock if video is unavailable or has error
      if (i === 0) {
        audio.ontimeupdate = () => {
          const vid = videoRef.current;
          const videoDriving = vid && !vid.paused && !videoPlaybackError && vid.readyState >= 2;
          if (!videoDriving) {
            setCurrentTime(audio.currentTime);
          }
        };
        audio.onended = () => {
          const vid = videoRef.current;
          const videoDriving = vid && !vid.paused && !videoPlaybackError;
          if (!videoDriving) {
            setIsPlaying(false);
          }
        };
      }

      audio.load();
      audioElements.push(audio);
    }

    mixAudioElementsRef.current = audioElements;

    setSelectedAudioTrack({
      id: `module_mix_${step.stepId}`,
      name: `Микс всех дорожек модуля «${meta?.title || step.moduleId}» (${audioOutputs.length} шт.)`,
      path: '',
      label: `Микс модуля (${audioOutputs.length} шт.)`,
      stepId: step.stepId,
      isModuleMix: true,
      isFinalVideo: false,
      mixFiles: audioOutputs
    });

    // Start playing all mix tracks + video synchronously
    setTimeout(() => {
      if (videoRef.current && !videoPlaybackError) {
        try {
          if (Math.abs(videoRef.current.currentTime - targetTime) > 0.3) {
            videoRef.current.currentTime = targetTime;
          }
          videoRef.current.play().catch(() => {});
        } catch (_) {}
      }
      audioElements.forEach(a => {
        if (targetTime > 0 && a.readyState >= 1) {
          try { a.currentTime = Math.min(targetTime, a.duration || targetTime); } catch (_) {}
        }
        a.play().catch(e => console.warn('Mix track play warning:', e));
      });
      setIsPlaying(true);
    }, 60);

    toast.success(`В плеере включен совместный микс всех ${audioOutputs.length} дорожек модуля!`, { duration: 3000 });
  }, [moduleDatabase, selectFinalVideoForPlayback, selectTrackForInspection, stopAndClearModuleMix, videoViewMode, isTrackMuted, trackVolume, sanitizeTempPath, resolveMediaUrlAsync, rolesVolumeMap, videoPlaybackError]);

  // Handle Play / Pause synchronization
  const togglePlay = useCallback(() => {
    if (isPlaying) {
      if (videoRef.current) videoRef.current.pause();
      if (trackAudioRef.current) trackAudioRef.current.pause();
      mixAudioElementsRef.current.forEach(a => a.pause());
      setIsPlaying(false);
    } else {
      const targetTime = currentTimeRef.current;

      if (selectedAudioTrack?.isFinalVideo || videoViewMode === 'final') {
        if (videoRef.current) {
          videoRef.current.muted = isVideoMuted;
          videoRef.current.volume = isVideoMuted ? 0 : Math.min(1, Math.max(0, videoVolume));
          videoRef.current.play().catch(e => console.warn('Video play warning:', e));
        }
        setIsPlaying(true);
        return;
      }

      if (videoRef.current && !videoPlaybackError) {
        videoRef.current.muted = isVideoMuted;
        videoRef.current.volume = isVideoMuted ? 0 : Math.min(1, Math.max(0, videoVolume));
        if (Math.abs(videoRef.current.currentTime - targetTime) > 0.3) {
          try { videoRef.current.currentTime = targetTime; } catch (_) {}
        }
        videoRef.current.play().catch(e => console.warn('Video play warning:', e));
      }

      if (!selectedAudioTrack) {
        if (manifest?.finalVideo?.path) {
          selectFinalVideoForPlayback(manifest.finalVideo);
          return;
        } else if (manifest?.sourceFiles?.originalAudio?.path) {
          selectOriginalAudioTrack();
          return;
        }
      } else if (selectedAudioTrack.isModuleMix) {
        mixAudioElementsRef.current.forEach(a => {
          if (Math.abs(a.currentTime - targetTime) > 0.25) {
            try { a.currentTime = targetTime; } catch (_) {}
          }
          a.play().catch(e => console.warn('Mix audio play warning:', e));
        });
      } else if (trackAudioRef.current && selectedAudioTrack.path) {
        if (!trackAudioRef.current.src || trackAudioRef.current.src === window.location.href) {
          loadSingleTrackAudio(selectedAudioTrack.path, targetTime, true);
          return;
        }
        if (Math.abs(trackAudioRef.current.currentTime - targetTime) > 0.25) {
          try { trackAudioRef.current.currentTime = targetTime; } catch (_) {}
        }
        trackAudioRef.current.play().catch(e => console.warn('Track audio play warning:', e));
      }

      setIsPlaying(true);
    }
  }, [isPlaying, selectedAudioTrack, videoViewMode, isVideoMuted, videoVolume, videoPlaybackError, manifest?.finalVideo, manifest?.sourceFiles?.originalAudio?.path, selectFinalVideoForPlayback, selectOriginalAudioTrack, loadSingleTrackAudio]);

  // Sync seek position across video, single audio track, and module mix tracks
  const handleSeek = useCallback((time: number) => {
    const clampedTime = Math.max(0, isFinite(time) ? time : 0);
    setCurrentTime(clampedTime);
    currentTimeRef.current = clampedTime;

    if (videoRef.current && videoRef.current.readyState >= 1) {
      try { videoRef.current.currentTime = clampedTime; } catch (_) {}
    }
    if (trackAudioRef.current && trackAudioRef.current.readyState >= 1) {
      try { trackAudioRef.current.currentTime = clampedTime; } catch (_) {}
    }
    mixAudioElementsRef.current.forEach(a => {
      if (a.readyState >= 1) {
        try { a.currentTime = clampedTime; } catch (_) {}
      }
    });
  }, []);

  // Video timeUpdate handler — keeps overlay audio tracks tightly synced
  const handleVideoTimeUpdate = useCallback(() => {
    if (!videoRef.current) return;
    const vTime = videoRef.current.currentTime;
    setCurrentTime(vTime);

    if (videoViewMode === 'final' || selectedAudioTrack?.isFinalVideo) {
      return;
    }

    // Keep trackAudio in tight sync with video
    if (trackAudioRef.current && !trackAudioRef.current.paused && trackAudioRef.current.readyState >= 2) {
      const diff = Math.abs(trackAudioRef.current.currentTime - vTime);
      if (diff > 0.2) {
        try { trackAudioRef.current.currentTime = vTime; } catch (_) {}
      }
    }

    // Keep module mix audio elements in tight sync with video
    if (mixAudioElementsRef.current.length > 0) {
      mixAudioElementsRef.current.forEach(a => {
        if (!a.paused && a.readyState >= 2) {
          const diff = Math.abs(a.currentTime - vTime);
          if (diff > 0.2) {
            try { a.currentTime = vTime; } catch (_) {}
          }
        }
      });
    }
  }, [videoViewMode, selectedAudioTrack?.isFinalVideo]);

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

  const getFileName = (filePath: string) => filePath ? filePath.split(/[/\\]/).pop() || filePath : '';

  // Pipeline manager: Add module from database
  const handleOpenAcousticMatcher = async () => {
    setIsAcousticMatchModalOpen(true);
    setOrigVocalsError(null);
    setOurVocalsError(null);
    setAcousticMatchResult(null);
    setSelectedEffectFilter('all');

    const epDir = (currentEpisode as any)?.dir || (currentEpisode?.rawPath ? currentEpisode.rawPath.replace(/[/\\][^/\\]+$/, '') : '');
    const searchDirs = [workingDir];
    if (epDir) searchDirs.push(epDir);

    // 1. Строгая проверка наличия склеенной дорожки всех голосов дабберов (voices_master.wav)
    let foundGluedVoices = '';
    try {
      const gluedRes = await ipcSafe.invoke('audio-find-glued-voices', {
        searchDirs,
        manifest,
        options: { strict: true }
      });
      if (gluedRes && typeof gluedRes === 'string') {
        foundGluedVoices = gluedRes;
        setOurVocalsPath(gluedRes);
        setOurVocalsError(null);
        mixLog('info', 'АвтоматизацияЭффектов', `✓ Найдена склеенная дорожка всех голосов дабберов: ${gluedRes}`);
      } else {
        setOurVocalsPath('');
        setOurVocalsError(
          '❌ Ошибка: Голоса дабберов не склеены в единую дорожку (voices_master.wav)!\n' +
          'Модуль повторения эффектов принимает на вход ИСКЛЮЧИТЕЛЬНО склеенную мастер-дорожку всех голосов.\n' +
          'Сначала выполните шаг «Склеивание голосов в одну дорожку» (mix_voices).'
        );
      }
    } catch (e: any) {
      setOurVocalsPath('');
      const msg = e.message || String(e);
      setOurVocalsError(msg);
      mixLog('error', 'АвтоматизацияЭффектов', msg);
    }

    // 2. Строгая проверка наличия разделенной дорожки вокала оригинала (01_vocals.wav)
    try {
      const foundOrig = await ipcSafe.invoke('audio-find-original-vocals', {
        searchDirs,
        manifest,
        ourVocalsPath: foundGluedVoices,
        options: { strict: true }
      });
      if (foundOrig && typeof foundOrig === 'string') {
        setOrigVocalsPath(foundOrig);
        setOrigVocalsError(null);
        mixLog('info', 'АвтоматизацияЭффектов', `✓ Обнаружена разделенная вокальная дорожка оригинала: ${foundOrig}`);
        runAnalyzeOriginalAcoustics(foundOrig);
      } else {
        setOrigVocalsPath('');
        const errMsg =
          '❌ Ошибка: Оригинальное аудио из видео не было разделено на стемы!\n' +
          'Модуль принимает на вход ИСКЛЮЧИТЕЛЬНО разделенную вокальную дорожку оригинала (01_vocals.wav).\n' +
          'Сначала выполните шаг разделения оригинального аудио из видео (Demucs / UVR / RoFormer / FFmpeg).';
        setOrigVocalsError(errMsg);
        mixLog('error', 'АвтоматизацияЭффектов', errMsg);
      }
    } catch (e: any) {
      setOrigVocalsPath('');
      const msg = e.message || String(e);
      setOrigVocalsError(msg);
      mixLog('error', 'АвтоматизацияЭффектов', msg);
    }
  };

  const runAnalyzeOriginalAcoustics = async (audioPath: string) => {
    if (!audioPath) return;
    try {
      setIsAnalyzingAcoustics(true);
      setOrigVocalsError(null);
      mixLog('info', 'АнализЭффектов', `Запуск полного пофразового и покадрового (шаг 100 мс) анализа наложенных эффектов вокала оригинала: ${audioPath}`);
      const profile = await ipcSafe.invoke('audio-analyze-original-snapshots', {
        audioPath,
        options: { strict: true }
      });
      setAcousticProfile(profile);
      setIsAnalyzingAcoustics(false);
      toast.success(`Пофразовый анализ завершен: ${profile.phrasesCount || 0} фраз, ${profile.framesCount || 0} точек автоматизации!`);
      mixLog(
        'success',
        'АнализЭффектов',
        `✓ Проанализировано фраз: ${profile.phrasesCount || 0} (с наложенными спецэффектами: ${profile.overallStats?.phrasesWithSpecialEffects || 0}, LUFS: ${profile.overallStats?.integratedLufs} dB, Реверб: ${profile.overallStats?.reverbCategory})`
      );
    } catch (e: any) {
      setIsAnalyzingAcoustics(false);
      setAcousticProfile(null);
      setOrigVocalsError(e.message || String(e));
      toast.error(`Ошибка анализа вокала оригинала: ${e.message}`);
      mixLog('error', 'АнализЭффектов', `Ошибка анализа вокала оригинала: ${e.message}`);
    }
  };

  const handleApplyAcousticProfileMatch = async () => {
    if (!origVocalsPath) {
      toast.error('Ошибка: отсутствует разделенная вокальная дорожка оригинала (01_vocals.wav)!');
      return;
    }
    if (!ourVocalsPath) {
      toast.error('Ошибка: отсутствует склеенная дорожка всех голосов дабберов (voices_master.wav)!');
      return;
    }

    try {
      setIsApplyingAcousticMatch(true);
      mixLog('info', 'АвтоматизацияЭффектов', `▶ Запуск наложения эффектов оригинала по кривой автоматизации на склеенную дорожку голосов...`);
      const epDir = (currentEpisode as any)?.dir || (currentEpisode?.rawPath ? currentEpisode.rawPath.replace(/[/\\][^/\\]+$/, '') : '');
      const searchDirs = [workingDir];
      if (epDir) searchDirs.push(epDir);

      const res = await ipcSafe.invoke('audio-apply-acoustic-match', {
        ourVocalsPath,
        originalVocalsPath: origVocalsPath,
        searchDirs,
        manifest,
        options: {
          loudnessMatchStrength: loudnessStrength,
          reverbMatchStrength: reverbStrength,
          eqMatchStrength: eqStrength,
          targetLufsOffset,
          strict: true
        }
      });

      setAcousticMatchResult(res);
      if (res.originalProfile) {
        setAcousticProfile(res.originalProfile);
      }
      setIsApplyingAcousticMatch(false);
      toast.success('Эффекты оригинала успешно воспроизведены по кривой автоматизации на дорожке голосов!');
      mixLog('success', 'АвтоматизацияЭффектов', `✓ Автоматизация эффектов завершена! Создан файл: ${res.outputPath}`);
      handleRescanSources();
    } catch (e: any) {
      setIsApplyingAcousticMatch(false);
      toast.error(`Ошибка наложения эффектов: ${e.message}`);
      mixLog('error', 'АвтоматизацияЭффектов', `Ошибка наложения эффектов: ${e.message}`);
    }
  };

  const handleAddAcousticModuleToPipeline = () => {
    const modDef = moduleDatabase.find(m => m.id === 'acoustic_original_match');
    if (modDef) {
      handleAddModuleFromDatabase({
        ...modDef,
        defaultParams: {
          ...modDef.defaultParams,
          loudnessMatchStrength: loudnessStrength,
          reverbMatchStrength: reverbStrength,
          eqMatchStrength: eqStrength,
          targetLufsOffset,
          strictOriginalVocalsRequired: true,
          strictGluedVoicesRequired: true
        }
      });
      setIsAcousticMatchModalOpen(false);
    } else {
      handleAddModuleFromDatabase({
        id: 'acoustic_original_match',
        category: 'analysis',
        defaultPrefix: 'acoustic_matched_',
        title: 'Повторение эффектов оригинала по кривой автоматизации (Acoustic Effect Matcher)',
        description: 'Строго проверяет наличие разделенного вокала оригинала (01_vocals.wav) и склеенной дорожки всех голосов (voices_master.wav). Выполняет полный пофразовый и покадровый (100 мс) анализ наложенных эффектов оригинала и воспроизводит их на дорожке голосов в каждый момент времени.',
        icon: 'Activity',
        defaultParams: {
          loudnessMatchStrength: loudnessStrength,
          reverbMatchStrength: reverbStrength,
          eqMatchStrength: eqStrength,
          targetLufsOffset,
          strictOriginalVocalsRequired: true,
          strictGluedVoicesRequired: true
        }
      } as any);
      setIsAcousticMatchModalOpen(false);
    }
  };

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

  // Abort any running step or chain
  const handleAbortProcessing = async () => {
    try {
      releasePlayerAudioLocks();
      mixLog('warn', 'Остановка', '🛑 Отправка сигнала принудительной остановки (Abort) всех процессов сведения...');
      toast.warning('Остановка процесса сведения...');
      const res: any = await ipcSafe.invoke('mixing-abort', {
        episode: currentEpisode,
        targetDir: workingDir || customTargetDir
      });
      setActiveProcessingStepId(null);
      setStepProgress({});
      if (res && res.manifest) {
        setManifest(res.manifest);
      } else {
        await loadStatus();
      }
      toast.info('Процесс сведения остановлен пользователем 🛑');
    } catch (e: any) {
      setActiveProcessingStepId(null);
      toast.error(`Ошибка при остановке: ${e.message || String(e)}`);
      await loadStatus();
    }
  };

  // Clear step output files (or a single output file)
  const handleClearStep = async (stepId: string, singleFilePath?: string) => {
    if (!currentEpisode) return;
    releasePlayerAudioLocks();
    try {
      const res: any = await ipcSafe.invoke('mixing-clear-step', {
        episode: currentEpisode,
        targetDir: workingDir || customTargetDir,
        stepId,
        filePath: singleFilePath || null
      });
      if (res && res.manifest) {
        setManifest(res.manifest);
      } else {
        await loadStatus();
      }
      if (singleFilePath) {
        toast.success(`Дорожка удалена из результатов шага`);
      } else {
        toast.success('Шаг очищен: все обработанные дорожки этого шага удалены 🧹');
      }
    } catch (e: any) {
      toast.error(`Ошибка очистки шага: ${e.message || String(e)}`);
    }
  };

  // Update per-step input tracks (include/exclude or add/remove custom tracks)
  const handleUpdateStepTracks = async (
    stepId: string,
    action: 'toggle_exclude' | 'clear_exclusions' | 'add_custom' | 'remove_custom',
    trackKey?: string,
    trackPaths?: string[]
  ) => {
    if (!currentEpisode) return;
    try {
      const res: any = await ipcSafe.invoke('mixing-update-step-tracks', {
        episode: currentEpisode,
        targetDir: workingDir || customTargetDir,
        stepId,
        action,
        trackKey,
        trackPaths
      });
      if (res && res.manifest) {
        setManifest(res.manifest);
      } else {
        await loadStatus();
      }
    } catch (e: any) {
      toast.error(`Ошибка обновления дорожек шага: ${e.message || String(e)}`);
    }
  };

  const handleAddCustomTrackToStep = async (stepId: string) => {
    try {
      const res: any = await ipcSafe.invoke('mixing-select-external-files', { type: 'audio' });
      if (res && !res.canceled && Array.isArray(res.filePaths) && res.filePaths.length > 0) {
        await handleUpdateStepTracks(stepId, 'add_custom', undefined, res.filePaths);
        toast.success(`Добавлено дорожек в шаг: ${res.filePaths.length}`);
      }
    } catch (e: any) {
      toast.error(`Ошибка выбора аудиофайла: ${e.message || String(e)}`);
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
        importSource,
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
    matchIntensity: { label: 'Сила выравнивания АЧХ (Match Intensity)', unit: '%' },
    targetProfile: { label: 'Целевой студийный профиль (Target Profile)' },
    subBassCutoff: { label: 'Срез инфра-низа / гула (Sub-Bass Cutoff)', unit: 'Гц' },
    airLimitDb: { label: 'Лимит сибилянтов / воздуха (Air Limit)', unit: 'dB' },
    smoothness: { label: 'Сглаживание кривой формант (Smoothness)', unit: 'x' },
    sensitivity: { label: 'Чувствительность спектральной маски (Sensitivity)', unit: 'x' },
    wetDryBlend: { label: 'Смешивание Dry/Wet (Blend)', unit: '%' },
    attenuationLimitDb: { label: 'Предел подавления шума DF3 (Attenuation Limit)', unit: 'dB' },
    postFilter: { label: 'Перцептивный пост-фильтр DeepFilterNet3 (Post-Filter)' },
    reverbReduction: { label: 'Степень дериверберации (Reverb Reduction)', unit: 'x' },
    shifts: { label: 'Точность усреднения сдвигов (Shifts)', unit: 'x' },
    overlap: { label: 'Перекрытие окон разложения (Overlap)', unit: 'x' },
    segment: { label: 'Длина сегмента (Segment Length)', unit: 'с' },
    stems: { label: 'Выбор стемов для экспорта' },
    noiseTraining: { label: 'Адаптивное отслеживание профиля шума (FFmpeg tn)' },
    marginDb: { label: 'Запас усиления вокала (Vocal Margin)', unit: 'dB' },
    postProcessThreshold: { label: 'Порог шумового гейта (Gate Threshold)', unit: 'x' },
    instrumentalBlend: { label: 'Смешивание M&E фонограммы (BGM Blend)', unit: '%' },
    noiseReductionDb: { label: 'Подавление шума (Noise Reduction)', unit: 'dB' },
    noiseFloorDb: { label: 'Порог фонового шума (Noise Floor)', unit: 'dB' },
    preserveVoiceFormants: { label: 'Сохранение формант речи (Formant Restoration)' },
    deechoReductionDb: { label: 'Степень подавления эха (De-Echo)', unit: 'dB' },
    earlyReflectionsDecay: { label: 'Подавление ранних отражений', unit: 'x' },
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
    detectionMode: { label: 'Детектор уровня (FFmpeg agate)' },
    targetLufs: { label: 'Целевая громкость (Target LUFS)', unit: 'LUFS' },
    truePeak: { label: 'Истинный пик (True Peak)', unit: 'dBTP' },
    loudnessRange: { label: 'Динамический диапазон (LRA)', unit: 'LU' },
    lra: { label: 'Динамический диапазон (LRA)', unit: 'LU' },
    maxGainDb: { label: 'Максимальное усиление (Max Gain)', unit: 'dB' },
    dualMono: { label: 'Обработка Dual-Mono' },
    modeType: { label: 'Режим нормализации pyloudnorm' },
    frequencyHz: { label: 'Частота сибилянтов (Frequency)', unit: 'Гц' },
    intensity: { label: 'Интенсивность деэссера (Intensity)', unit: 'x' },
    maxReduction: { label: 'Макс. глубина подавления (Max De-Essing)', unit: 'x' },
    frequencyLimitHz: { label: 'Граничная частота взрывных согласных', unit: 'Гц' },
    suppressionDepthDb: { label: 'Глубина подавления задувов', unit: 'dB' },
    recoveryMs: { label: 'Скорость восстановления (Recovery)', unit: 'мс' },
    wetDryPercent: { label: 'Баланс обработки Wet/Dry', unit: '%' },
    bodyDrivePercent: { label: 'Насыщение нижних гармоник (Body Drive)', unit: '%' },
    presenceClarityPercent: { label: 'Презенс и разборчивость (Presence)', unit: '%' },
    tapeDensityPercent: { label: 'Пленочное уплотнение (Tape Density)', unit: '%' },
    mixPercent: { label: 'Смешивание Dry/Wet (Mix)', unit: '%' },
    reductionDb: { label: 'Подавление реверберации (Reduction)', unit: 'dB' },
    decayTimeEstMs: { label: 'Оценка времени спада хвоста (Decay Time)', unit: 'мс' },
    clarityPercent: { label: 'Подъем читаемости речи (Clarity)', unit: '%' },
    autoHeadroom: { label: 'Автоматический расчет запаса по пикам' },
    targetPeakDb: { label: 'Целевой пиковый потолок (Target Peak)', unit: 'dBFS' },
    maxBoostDb: { label: 'Максимальный разгон (Max Boost)', unit: 'dB' },
    manualGainDb: { label: 'Ручное доп. усиление (Manual Gain)', unit: 'dB' },
    lookaheadMs: { label: 'Опережение лимитера (Lookahead)', unit: 'мс' },
    targetLevelDb: { label: 'Целевой RMS-уровень речи', unit: 'dB' },
    maxCutDb: { label: 'Макс. ослабление громких фраз (Max Cut)', unit: 'dB' },
    silenceGateDb: { label: 'Порог отсечки тишины (Silence Gate)', unit: 'dB' },
    peakCeilingDb: { label: 'Потолок пикового лимитера (Ceiling)', unit: 'dBFS' },
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
    duckingAmountDb: { label: 'Глубина приглушения фона (Ducking)', unit: 'dB' },
    threshold: { label: 'Порог срабатывания детектора речи', unit: 'x' },
    filterMusicOnly: { label: 'Приглушать только среднечастотную полосу (сохранять суб-бас)' },
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
    acousticModel: { label: 'Акустическая модель MFA' },
    dictionary: { label: 'Фонетический словарь MFA' },
    autoApplyStretch: { label: 'Автоматически применять тайм-стретч (atempo)' },
    minTimeStretch: { label: 'Мин. коэффициент сжатия времени', unit: 'x' },
    maxTimeStretch: { label: 'Макс. коэффициент растяжения времени', unit: 'x' },
    maxDriftMs: { label: 'Допустимый рассинхрон (Drift Threshold)', unit: 'мс' },
    confidenceThreshold: { label: 'Порог достоверности фонем (Confidence)', unit: 'x' },
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
    // Airwindows DSP
    deessIntensity: { label: 'Интенсивность Airwindows DeEss', unit: 'x' },
    popIntensity: { label: 'Сжатие взрывных согласных (De-Pop)', unit: 'x' },
    slewIntensity: { label: 'Сглаживание ВЧ-градиента (Slew2)', unit: 'x' },
    densityDrive: { label: 'Насыщение плотности (Density2)', unit: 'x' },
    modelId: { label: 'Выбор модели / Алгоритма' },
    modelName: { label: 'Выбор нейросетевой модели' },
    loudnessMatchStrength: { label: 'Автоматизация громкости и панорамы', unit: '%' },
    reverbMatchStrength: { label: 'Автоматизация пространства (Reverb / Echo)', unit: '%' },
    eqMatchStrength: { label: 'Автоматизация АЧХ и фильтров (Телефон / За стеной / EQ)', unit: '%' },
    targetLufsOffset: { label: 'Смещение целевой громкости голосов', unit: 'dB' },
    strictOriginalVocalsRequired: { label: 'Строгая проверка разделения вокала оригинала' },
    strictGluedVoicesRequired: { label: 'Строгая проверка склеивания всех голосов (voices_master)' }
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
        preload="auto"
        onTimeUpdate={() => {
          const vid = videoRef.current;
          const videoActivelyDriving = Boolean(vid && !vid.paused && !videoPlaybackError && vid.readyState >= 2);
          if (!videoActivelyDriving && trackAudioRef.current) {
            setCurrentTime(trackAudioRef.current.currentTime);
          }
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (d && !isNaN(d) && isFinite(d) && (!duration || duration <= 0)) {
            setDuration(d);
          }
        }}
        onEnded={() => {
          const vid = videoRef.current;
          const videoActivelyDriving = Boolean(vid && !vid.paused && !videoPlaybackError);
          if (!videoActivelyDriving) {
            setIsPlaying(false);
          }
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

          {activeProcessingStepId !== null && (
            <button
              onClick={handleAbortProcessing}
              className="px-3.5 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition shadow-md animate-pulse border border-red-400/50"
              title="Немедленно прервать выполнение текущего шага или всей цепочки сведения"
            >
              <XCircle className="w-4 h-4" />
              <span>Остановить сведение</span>
            </button>
          )}

          <button
            onClick={handleOpenAcousticMatcher}
            className="px-3 py-1.5 bg-sky-950/60 hover:bg-sky-900/60 text-sky-200 border border-sky-700/60 rounded-lg text-xs font-medium flex items-center gap-1.5 transition shadow-sm"
            title="Аналитический модуль: 3 Акустических слепка оригинала (Громкость, Реверб, EQ)"
          >
            <Activity className="w-4 h-4 text-sky-400" />
            <span>Слепок оригинала</span>
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
                          {/* Dubber Track Volume Slider */}
                          {(() => {
                            const trackKey = tr.dubberNick || tr.name;
                            const curVol = rolesVolumeMap[trackKey] ?? rolesVolumeMap[tr.name] ?? 100;
                            return (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-neutral-950/80 border border-neutral-800"
                                title={`Индивидуальная громкость даббера: ${curVol}% (сохраняется в сведении и тайминге)`}
                              >
                                <Volume2 className="w-3 h-3 text-cyan-400 shrink-0" />
                                <input
                                  type="range"
                                  min="20"
                                  max="180"
                                  step="5"
                                  value={curVol}
                                  onChange={(e) => handleUpdateDubberVolume(trackKey, parseInt(e.target.value, 10))}
                                  className="w-16 h-1 accent-cyan-400 bg-neutral-800 rounded cursor-pointer"
                                />
                                <span className={`font-mono text-[10px] w-8 text-right font-medium ${curVol !== 100 ? 'text-cyan-300 font-bold' : 'text-neutral-400'}`}>
                                  {curVol}%
                                </span>
                              </div>
                            );
                          })()}

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
                          <div className="flex items-center gap-2 flex-wrap">
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
                            {/* Active model badge for neural dereverb / denoise / separation */}
                            {(step.params?.modelId || step.params?.modelName || step.moduleId === 'uvr_deecho_normal' || step.moduleId === 'uvr_deecho_aggressive' || step.moduleId === 'deepfilternet3') && (
                              <span className="text-[10px] px-2 py-0.5 bg-indigo-950/80 text-indigo-300 font-mono font-semibold rounded-md border border-indigo-700/60 flex items-center gap-1 shadow-sm">
                                <Radio className="w-2.5 h-2.5 text-indigo-400" />
                                <span>
                                  {step.params?.modelId === 'uvr_deecho_aggressive' || step.moduleId === 'uvr_deecho_aggressive'
                                    ? 'UVR De-Echo Aggressive'
                                    : step.params?.modelId === 'uvr_deecho_normal' || step.moduleId === 'uvr_deecho_normal'
                                      ? 'UVR De-Echo Normal'
                                      : step.params?.modelId === 'deepfilternet3' || step.moduleId === 'deepfilternet3'
                                        ? 'DeepFilterNet 3'
                                        : step.params?.modelId === 'reverb_foxjoy'
                                          ? 'Reverb HQ FoxJoy'
                                          : step.params?.modelName || step.params?.modelId || meta?.name || meta?.title}
                                </span>
                              </span>
                            )}
                            {/* Active target profile for voice timbre match */}
                            {step.moduleId === 'voice_timbre_match' && (
                              <span className="text-[10px] px-2 py-0.5 bg-emerald-950/80 text-emerald-300 font-medium rounded-full border border-emerald-700/60 flex items-center gap-1 shadow-sm">
                                <Sparkles className="w-2.5 h-2.5 text-emerald-400" />
                                <span>
                                  {step.params?.targetProfile === 'warm_broadcast'
                                    ? 'Тёплый бродкаст'
                                    : step.params?.targetProfile === 'crisp_anime'
                                      ? 'Прозрачный аниме'
                                      : step.params?.targetProfile === 'gentle_balance'
                                        ? 'Мягкий баланс'
                                        : 'Студийный дубляж'} ({step.params?.matchIntensity ?? 75}%)
                                </span>
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-neutral-400 leading-relaxed mt-0.5">
                            {meta?.description || ''}
                          </p>
                        </div>
                      </div>

                      {/* Step Actions: Listen Module Mix, Tracks, Clear, Up, Down, Settings, Run/Abort, Delete */}
                      <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
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
                            <span>Прослушать ({step.outputFiles.length})</span>
                          </button>
                        )}

                        {/* Toggle Step Input Tracks Manager */}
                        {(() => {
                          const candidates = step.candidateInputs || manifest?.sourceFiles?.dubberTracks || [];
                          const activeCount = candidates.filter(t => !t.excluded).length;
                          const hasExclusions = candidates.some(t => t.excluded) || (step.customInputTracks && step.customInputTracks.length > 0);
                          const isTracksOpen = expandedTracks[step.stepId] ?? (idx === 0);
                          return (
                            <button
                              onClick={() => setExpandedTracks(prev => ({ ...prev, [step.stepId]: !isTracksOpen }))}
                              className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition border ${
                                hasExclusions
                                  ? 'bg-amber-950/70 text-amber-300 border-amber-700/70'
                                  : isTracksOpen
                                    ? 'bg-cyan-950/60 text-cyan-300 border-cyan-700/60'
                                    : 'bg-neutral-800/80 hover:bg-neutral-700 text-neutral-300 border-neutral-700'
                              }`}
                              title="Выбрать, какие дорожки обрабатывать в этом шаге (исключить или добавить дорожку)"
                            >
                              <Headphones className="w-3 h-3 text-cyan-400" />
                              <span>Дорожки ({activeCount}/{candidates.length})</span>
                            </button>
                          );
                        })()}

                        {/* Clear Step Output Files */}
                        {((step.outputFiles && step.outputFiles.length > 0) || step.status === 'completed' || step.status === 'error') && (
                          <button
                            onClick={() => handleClearStep(step.stepId)}
                            disabled={activeProcessingStepId !== null}
                            className="px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 bg-neutral-800/80 hover:bg-red-950/70 text-neutral-300 hover:text-red-300 border border-neutral-700 hover:border-red-800/60 transition disabled:opacity-40"
                            title="Очистить шаг: удалить все созданные этим шагом дорожки и сбросить статус"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Очистить шаг</span>
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

                        {/* Run Step or Abort Step */}
                        {isProcessing ? (
                          <button
                            onClick={handleAbortProcessing}
                            className="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-bold flex items-center gap-1.5 transition ml-1 shadow"
                            title="Прервать выполнение шага"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Стоп</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleRunStep(step.stepId)}
                            disabled={!manifest?.isImported || !step.enabled || activeProcessingStepId !== null}
                            className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white rounded text-xs font-medium flex items-center gap-1.5 transition ml-1"
                          >
                            <Play className="w-3 h-3 fill-current" />
                            <span>Шаг</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Error Banner if step failed (No Silent Fallback!) */}
                    {step.status === 'error' && step.error && (
                      <div className="p-2.5 bg-red-950/50 border border-red-800/80 rounded-lg text-xs text-red-200 flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-semibold text-red-300 block">Ошибка выполнения модуля (без скрытого фоллбэка):</span>
                            <span className="text-[11px] font-mono break-all">{step.error}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleClearStep(step.stepId)}
                          className="px-2 py-1 bg-red-900/60 hover:bg-red-800 text-red-200 rounded text-[10px] shrink-0 transition"
                        >
                          Сбросить
                        </button>
                      </div>
                    )}

                    {/* Progress Bar */}
                    {isProcessing && (
                      <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
                        <div 
                          className="bg-purple-500 h-full transition-all duration-300"
                          style={{ width: `${stepProgress[step.stepId] || 15}%` }}
                        />
                      </div>
                    )}

                    {/* Per-Step Input Tracks Control Panel */}
                    {(expandedTracks[step.stepId] ?? (idx === 0)) && (
                      <div className="p-2.5 bg-neutral-950/70 rounded-lg border border-neutral-800/90 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-[10px] uppercase font-semibold tracking-wider text-cyan-400 flex items-center gap-1.5">
                            <Headphones className="w-3 h-3" />
                            <span>Входные дорожки для обработки в этом шаге:</span>
                          </span>
                          <div className="flex items-center gap-1.5">
                            {(step.excludedTrackKeys && step.excludedTrackKeys.length > 0) && (
                              <button
                                onClick={() => handleUpdateStepTracks(step.stepId, 'clear_exclusions')}
                                className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 rounded text-[10px] font-medium transition border border-amber-700/40"
                              >
                                Включить все дорожки
                              </button>
                            )}
                            <button
                              onClick={() => handleAddCustomTrackToStep(step.stepId)}
                              className="px-2 py-0.5 bg-cyan-950/70 hover:bg-cyan-900/80 text-cyan-300 rounded text-[10px] font-medium flex items-center gap-1 border border-cyan-800/60 transition"
                              title="Добавить дополнительный аудиофайл с диска в обработку именно этого шага"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Добавить дорожку в шаг</span>
                            </button>
                          </div>
                        </div>

                        {(() => {
                          const candidates = step.candidateInputs || manifest?.sourceFiles?.dubberTracks || [];
                          if (candidates.length === 0) {
                            return (
                              <div className="text-[11px] text-neutral-500 italic py-1">
                                Нет входных дорожек. Импортируйте файлы звукорежиссера или добавьте дорожку вручную.
                              </div>
                            );
                          }
                          return (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1">
                              {candidates.map((cand, cIdx) => {
                                const tKey = cand.trackKey || cand.path || cand.name;
                                const isExcluded = !!cand.excluded;
                                const isInspecting = selectedAudioTrack?.id === cand.path;
                                return (
                                  <div
                                    key={`${tKey}_${cIdx}`}
                                    className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] transition ${
                                      isExcluded
                                        ? 'bg-neutral-950/40 border-neutral-800/50 text-neutral-500 opacity-60'
                                        : isInspecting
                                          ? 'bg-cyan-950/40 border-cyan-600/60 text-cyan-100'
                                          : 'bg-neutral-900/80 border-neutral-800 text-neutral-200 hover:border-neutral-700'
                                    }`}
                                  >
                                    <label className="flex items-center gap-2 truncate cursor-pointer flex-1">
                                      <input
                                        type="checkbox"
                                        checked={!isExcluded}
                                        onChange={() => handleUpdateStepTracks(step.stepId, 'toggle_exclude', tKey)}
                                        className="rounded accent-cyan-500 cursor-pointer shrink-0"
                                        title={isExcluded ? 'Включить дорожку в обработку этого шага' : 'Исключить дорожку из обработки в этом шаге'}
                                      />
                                      <div className="truncate">
                                        <span className={`font-medium ${isExcluded ? 'line-through text-neutral-500' : 'text-neutral-100'}`}>
                                          {cand.dubberNick || cand.name}
                                        </span>
                                        {cand.sourceLabel && (
                                          <span className="text-[9px] text-neutral-400 ml-1.5 px-1 py-0.2 bg-neutral-800 rounded">
                                            {cand.sourceLabel}
                                          </span>
                                        )}
                                      </div>
                                    </label>

                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        onClick={() => selectTrackForInspection(cand, `Вход шага #${idx + 1}: ${cand.dubberNick || cand.name}`, step.stepId)}
                                        className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-emerald-400 rounded text-[10px] transition"
                                        title={`Прослушать входную дорожку: ${cand.name}`}
                                      >
                                        🎧
                                      </button>
                                      {cand.isCustom && (
                                        <button
                                          onClick={() => handleUpdateStepTracks(step.stepId, 'remove_custom', cand.path || tKey)}
                                          className="px-1.5 py-0.5 bg-neutral-800 hover:bg-red-900/70 text-neutral-400 hover:text-red-300 rounded text-[10px] transition"
                                          title="Удалить добавленную вручную дорожку из этого шага"
                                        >
                                          ✕
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Settings & Presets Accordion */}
                    {isExpanded && (
                      <div className="p-3 bg-neutral-950/80 rounded-lg border border-neutral-800 text-xs space-y-3">
                        {/* Voice Timbre Match Visual Equalizer Card */}
                        {step.moduleId === 'voice_timbre_match' && (
                          <div className="p-3 bg-gradient-to-r from-emerald-950/40 via-neutral-900 to-teal-950/30 border border-emerald-800/50 rounded-xl space-y-2.5 shadow-sm">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-2.5">
                                <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg mt-0.5">
                                  <Sparkles className="w-4 h-4" />
                                </div>
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-xs text-neutral-100">
                                      Калибровка АЧХ всех дабберов к единому студийному эталону
                                    </span>
                                    <span className="text-[10px] font-mono px-1.5 py-0.5 bg-emerald-900/60 text-emerald-300 rounded border border-emerald-700/50">
                                      LTAS 32-Band Match EQ
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-neutral-400 leading-snug">
                                    Автоматически анализирует долговременный спектр речи каждого даббера и приводит амплитудно-частотную характеристику к общему эталону, убирая различия микрофонов и комнат.
                                  </p>
                                </div>
                              </div>
                            </div>

                            {/* Spectrum Frequency Bands Map */}
                            <div className="bg-neutral-950/80 p-2.5 rounded-lg border border-neutral-800 space-y-1.5">
                              <div className="flex items-center justify-between text-[10px] text-neutral-400">
                                <span className="font-semibold text-emerald-400">Полосы спектральной калибровки:</span>
                                <span className="font-mono text-neutral-500">Минимально-фазовый 1/3-октавный фильтр</span>
                              </div>
                              <div className="grid grid-cols-4 gap-2 text-[10px] font-mono pt-1">
                                <div className="p-1.5 bg-neutral-900/90 rounded border border-neutral-800 text-center">
                                  <div className="text-neutral-500">&lt; {step.params?.subBassCutoff ?? 75} Гц</div>
                                  <div className="text-emerald-400 font-semibold">Срез инфра-гула</div>
                                </div>
                                <div className="p-1.5 bg-neutral-900/90 rounded border border-neutral-800 text-center">
                                  <div className="text-neutral-500">100 - 400 Гц</div>
                                  <div className="text-emerald-400 font-semibold">Баланс тела голоса</div>
                                </div>
                                <div className="p-1.5 bg-neutral-900/90 rounded border border-neutral-800 text-center">
                                  <div className="text-neutral-500">1.2 - 4.5 кГц</div>
                                  <div className="text-emerald-400 font-semibold">Форманты речи</div>
                                </div>
                                <div className="p-1.5 bg-neutral-900/90 rounded border border-neutral-800 text-center">
                                  <div className="text-neutral-500">&gt; 5 кГц (макс +{step.params?.airLimitDb ?? 3} дБ)</div>
                                  <div className="text-emerald-400 font-semibold">Защита сибилянтов</div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

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
                                    <option value="loudnorm">FFmpeg EBU R128 (Двухпроходный Loudnorm)</option>
                                    <option value="dynaudnorm">FFmpeg Динамический левелер (DynAudNorm)</option>
                                    <option value="pyloudnorm">PythonITU-R BS.1770-4 (pyloudnorm)</option>
                                  </select>
                                </div>
                              );
                            }

                            if (paramKey === 'modeType') {
                              return (
                                <div key={paramKey} className="col-span-2">
                                  <label className="text-[11px] text-neutral-400 block mb-1">
                                    Режим измерения и выравнивания (pyloudnorm):
                                  </label>
                                  <select
                                    value={val}
                                    onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, e.target.value)}
                                    className="w-full px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-xs text-neutral-200"
                                  >
                                    <option value="track">По всей дорожке целиком (Integrated LUFS)</option>
                                    <option value="phrases">Пофразовое выравнивание (RMS / Gate Segmentation)</option>
                                  </select>
                                </div>
                              );
                            }

                            if (paramKey === 'targetProfile') {
                              return (
                                <div key={paramKey} className="col-span-2 space-y-1">
                                  <label className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1.5">
                                    <Sparkles className="w-3.5 h-3.5" />
                                    Целевой студийный профиль АЧХ (Universal Studio Reference):
                                  </label>
                                  <select
                                    value={val}
                                    onChange={(e) => handleUpdateStepParams(step.stepId, paramKey, e.target.value)}
                                    className="w-full px-2.5 py-1.5 bg-neutral-900 border border-emerald-800/60 rounded-lg text-xs text-emerald-200 font-medium focus:ring-1 focus:ring-emerald-500"
                                  >
                                    <option value="studio_neutral">🎯 Нейтральный студийный дубляж (Универсальный эталон)</option>
                                    <option value="warm_broadcast">📻 Тёплый бродкаст (Плотный бархатный низ)</option>
                                    <option value="crisp_anime">✨ Прозрачный аниме-дубляж (Яркая эмоциональная читаемость)</option>
                                    <option value="gentle_balance">🍃 Мягкое выравнивание (50% интенсивности)</option>
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
                          <div className="flex items-center gap-2">
                            <span className="text-emerald-400">✓ Записано на диск</span>
                            <button
                              onClick={() => handleClearStep(step.stepId)}
                              disabled={activeProcessingStepId !== null}
                              className="text-[10px] text-red-400 hover:text-red-300 bg-red-950/40 hover:bg-red-900/50 px-2 py-0.5 rounded border border-red-800/40 transition flex items-center gap-1 normal-case font-medium"
                              title="Удалить все обработанные дорожки этого шага и очистить шаг"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                              <span>Удалить все дорожки шага</span>
                            </button>
                          </div>
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
                              <div
                                key={oIdx}
                                className={`rounded text-[11px] font-mono flex items-center border transition overflow-hidden ${
                                  isSelected
                                    ? 'bg-purple-600/30 border-purple-500 text-purple-200 shadow-sm'
                                    : 'bg-neutral-800/60 border-neutral-700/60 text-neutral-300 hover:border-neutral-500'
                                }`}
                              >
                                <button
                                  onClick={() => selectTrackForInspection(of, `${meta?.title || step.moduleId}: ${of.name}`, step.stepId)}
                                  className="px-2 py-1 flex items-center gap-1 text-left"
                                  title={`Прослушать: ${of.name}`}
                                >
                                  {of.name.endsWith('.mp4') ? (
                                    <Film className="w-3 h-3 text-purple-400" />
                                  ) : (
                                    <FileAudio className="w-3 h-3 text-purple-400" />
                                  )}
                                  <span className="truncate max-w-[180px]">{of.name}</span>
                                  <span className="text-[10px] text-emerald-400 ml-1">🎧</span>
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleClearStep(step.stepId, of.path);
                                  }}
                                  disabled={activeProcessingStepId !== null}
                                  className="px-1.5 py-1 text-[10px] text-neutral-500 hover:text-red-300 hover:bg-red-950/60 border-l border-neutral-700/60 transition"
                                  title={`Удалить эту дорожку (${of.name}) из результатов шага`}
                                >
                                  ✕
                                </button>
                              </div>
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
          {/* Mode Switcher Bar: Final Mixed Video vs Source Video + Track Inspection */}
          {manifest?.finalVideo && (
            <div className="bg-neutral-900/90 border border-neutral-800 p-1.5 rounded-xl flex items-center gap-1.5 text-xs">
              <button
                onClick={() => selectFinalVideoForPlayback(manifest.finalVideo)}
                className={`flex-1 py-1.5 px-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition ${
                  videoViewMode === 'final' || selectedAudioTrack?.isFinalVideo
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/70'
                }`}
                title="Смотреть и слушать готовое сведенное видео со встроенным финальным звуком"
              >
                <Film className="w-3.5 h-3.5" />
                <span>✨ Готовое сведенное видео [СВЕДЕНО]</span>
              </button>
              <button
                onClick={() => {
                  setVideoViewMode('source');
                  if (selectedAudioTrack?.isFinalVideo) {
                    selectOriginalAudioTrack();
                  }
                }}
                className={`flex-1 py-1.5 px-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition ${
                  videoViewMode === 'source' && !selectedAudioTrack?.isFinalVideo
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/70'
                }`}
                title="Режим прослушивания отдельных дорожек и модулей поверх исходного видеоряда"
              >
                <Headphones className="w-3.5 h-3.5" />
                <span>🎧 Прослушивание дорожек / модулей</span>
              </button>
            </div>
          )}

          {/* Video Player Display */}
          <div className="aspect-video bg-black rounded-xl overflow-hidden border border-neutral-800 relative group flex items-center justify-center shadow-lg">
            {/* Active Video Stream Badge */}
            {videoSrc && (
              <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1.5 pointer-events-none">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase backdrop-blur-md border ${
                  videoViewMode === 'final'
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40'
                    : 'bg-neutral-900/80 text-neutral-300 border-neutral-700/60'
                }`}>
                  {videoViewMode === 'final' ? '🎬 Сведенный мастер (MP4)' : '📹 Исходный видеоряд'}
                </span>
                {isPlaying && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-600/80 text-white backdrop-blur-md animate-pulse">
                    ▶ Играет
                  </span>
                )}
              </div>
            )}

            {videoSrc ? (
              <video
                ref={videoRef}
                src={videoSrc}
                className="w-full h-full object-contain"
                muted={isVideoMuted}
                onTimeUpdate={handleVideoTimeUpdate}
                onLoadedMetadata={handleVideoLoadedMetadata}
                onEnded={() => setIsPlaying(false)}
                onError={handleVideoError}
              />
            ) : (
              <div className="text-center p-6 text-neutral-500 space-y-2">
                <Film className="w-10 h-10 mx-auto text-neutral-700" />
                <p className="text-xs">Видеоряд серии еще не импортирован (аудиоплеер дорожек работает автономно)</p>
              </div>
            )}

            {/* Video Playback Compatibility Error Overlay */}
            {videoPlaybackError && (
              <div className="absolute inset-0 bg-neutral-950/90 backdrop-blur-sm p-4 flex flex-col items-center justify-center text-center space-y-3 z-20">
                <AlertCircle className="w-9 h-9 text-amber-400 shrink-0" />
                <div className="max-w-md space-y-1">
                  <h4 className="text-sm font-semibold text-amber-200">Несовместимость воспроизведения видео</h4>
                  <p className="text-xs text-neutral-300 leading-relaxed">{videoPlaybackError}</p>
                  <p className="text-[11px] text-emerald-400 pt-1">
                    🎧 Вы можете продолжать прослушивать любые аудиодорожки и модули — аудиоплеер работает независимо от видео!
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  {manifest?.finalVideo?.path && (
                    <button
                      onClick={() => selectFinalVideoForPlayback(manifest.finalVideo)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition shadow flex items-center gap-1.5"
                    >
                      <Film className="w-3.5 h-3.5" />
                      <span>🎬 Включить готовое MP4-видео</span>
                    </button>
                  )}
                  {(manifest?.sourceFiles?.video?.path || currentEpisode?.rawPath) && (
                    <button
                      onClick={handleCreateVideoProxy}
                      disabled={isCreatingProxy}
                      className="px-3 py-1.5 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white text-xs font-semibold rounded-lg transition shadow flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isCreatingProxy ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Создание MP4-прокси... {proxyProgress}%</span>
                        </>
                      ) : (
                        <>
                          <Zap className="w-3.5 h-3.5" />
                          <span>⚡ Создать быстрый MP4-прокси (H.264/AAC)</span>
                        </>
                      )}
                    </button>
                  )}
                  {(manifest?.sourceFiles?.video?.path || currentEpisode?.rawPath) && (
                    <button
                      onClick={() => {
                        const srcPath = manifest?.sourceFiles?.video?.path || currentEpisode?.rawPath;
                        if (srcPath) {
                          setVideoViewMode('source');
                          setVideoSrc(formatMediaUrl(srcPath));
                          setVideoPlaybackError(null);
                        }
                      }}
                      className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium rounded-lg transition border border-neutral-700"
                    >
                      📻 Попробовать исходник
                    </button>
                  )}
                  <button
                    onClick={() => handleSelectExternalFile('video')}
                    className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium rounded-lg transition border border-neutral-700"
                  >
                    📂 Выбрать другой файл...
                  </button>
                  <button
                    onClick={() => setVideoPlaybackError(null)}
                    className="px-2.5 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-neutral-400 text-xs rounded-lg transition"
                  >
                    ✕
                  </button>
                </div>
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
                selectedAudioTrack?.isFinalVideo
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : selectedAudioTrack?.isModuleMix
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'bg-purple-600/20 text-purple-400'
              }`}>
                {selectedAudioTrack?.isFinalVideo ? (
                  <Film className="w-4 h-4" />
                ) : selectedAudioTrack?.isModuleMix ? (
                  <Volume2 className="w-4 h-4" />
                ) : (
                  <Headphones className="w-4 h-4" />
                )}
              </div>
              <div className="truncate">
                <span className="text-neutral-400 text-[11px] block">
                  {selectedAudioTrack?.isFinalVideo
                    ? 'Воспроизводится финальное сведенное видео:'
                    : selectedAudioTrack?.isModuleMix
                    ? 'Прослушивается совместный микс модуля:'
                    : 'Прослушиваемый источник:'}
                </span>
                <span className="font-semibold text-neutral-100 truncate block" title={selectedAudioTrack?.name}>
                  {selectedAudioTrack ? selectedAudioTrack.name : 'Исходный звук видеоряда'}
                </span>
                {audioPlaybackError && (
                  <span className="text-[10px] text-red-400 block truncate">{audioPlaybackError}</span>
                )}
              </div>
            </div>

            {/* Source Switcher: Original vs Final vs Module */}
            <div className="flex items-center gap-1.5 shrink-0">
              {manifest?.finalVideo && (
                <button
                  onClick={() => selectFinalVideoForPlayback(manifest.finalVideo)}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition border ${
                    selectedAudioTrack?.isFinalVideo || videoViewMode === 'final'
                      ? 'bg-emerald-600 text-white border-emerald-500 font-bold shadow-sm'
                      : 'bg-neutral-800/80 hover:bg-neutral-700/80 text-emerald-300 border-emerald-800/60'
                  }`}
                  title="Переключить плеер на готовое сведенное видео [СВЕДЕНО]"
                >
                  🎬 Сведено
                </button>
              )}
              <button
                onClick={selectOriginalAudioTrack}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition border ${
                  selectedAudioTrack?.id === 'original_audio_source'
                    ? 'bg-amber-600 text-white border-amber-500 font-bold shadow-sm'
                    : 'bg-neutral-800/80 hover:bg-neutral-700/80 text-neutral-300 border-neutral-700/60'
                }`}
                title="Переключить плеер на оригинальную японскую дорожку серии"
              >
                📻 Оригинал
              </button>
              <span className={`px-2 py-1 rounded text-[10px] font-medium border ${
                selectedAudioTrack?.isFinalVideo
                  ? 'bg-emerald-900/60 text-emerald-200 border-emerald-700 font-bold'
                  : selectedAudioTrack?.isModuleMix
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
                max={duration > 0 ? duration : 100}
                step="0.05"
                value={Math.min(currentTime, duration > 0 ? duration : 100)}
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
                  onClick={() => handleSeek(Math.min(duration || currentTime + 5, currentTime + 5))}
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
                  title={isVideoMuted ? "Включить звук видеопотока" : "Заглушить звук видеопотока"}
                >
                  {isVideoMuted ? <VolumeX className="w-3.5 h-3.5 text-neutral-500" /> : <Volume2 className="w-3.5 h-3.5 text-blue-400" />}
                  <span>
                    {isVideoMuted
                      ? 'Звук видео: Выкл'
                      : `${videoViewMode === 'final' ? 'Мастер-звук видео' : 'Звук видео'}: ${Math.round(videoVolume * 100)}%`}
                  </span>
                </button>
              </div>
            </div>

            {/* Audio Volume Controls (Video Audio & Processed Track) */}
            <div className="pt-2 border-t border-neutral-800 space-y-3">
              {/* Processed Track / Dubber Voices Volume (shown when inspecting audio tracks) */}
              {videoViewMode !== 'final' && !selectedAudioTrack?.isFinalVideo && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-neutral-400 flex items-center gap-1.5">
                      <Music className="w-3.5 h-3.5 text-purple-400" />
                      Громкость прослушиваемой дорожки / модуля:
                    </span>
                    <button
                      onClick={() => setIsTrackMuted(!isTrackMuted)}
                      className="text-neutral-400 hover:text-neutral-200 flex items-center gap-1 text-[11px]"
                      title={isTrackMuted ? "Включить звук дорожки" : "Заглушить звук дорожки"}
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
              )}

              {/* Video Audio Volume Slider (when unmuted) */}
              {!isVideoMuted && (
                <div className="space-y-1.5 bg-neutral-900/40 p-2 rounded-lg border border-neutral-800/60">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-neutral-400 flex items-center gap-1.5">
                      <Film className="w-3.5 h-3.5 text-blue-400" />
                      {videoViewMode === 'final' ? 'Громкость сведенного видео:' : 'Громкость фонового звука из видео:'}
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
                <div className="text-xs text-neutral-200 font-mono truncate mt-0.5" title={sanitizeTempPath(manifest.finalVideo.name)}>
                  {sanitizeTempPath(manifest.finalVideo.name)}
                </div>
                <div className="text-[11px] text-neutral-400 mt-0.5">
                  Размер: {formatFileSize(manifest.finalVideo.size)}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => selectFinalVideoForPlayback(manifest.finalVideo)}
                  className="px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow"
                  title="Запустить предпросмотр готового сведенного видео в плеере"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Смотреть</span>
                </button>
                <button
                  onClick={handleSaveFinalVideo}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow"
                >
                  <Save className="w-4 h-4" />
                  <span>Сохранить видео</span>
                </button>
              </div>
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
                const isStandaloneFfmpeg = modDef.id.startsWith('ffmpeg_');
                return (
                  <div
                    key={modDef.id}
                    className={`p-3.5 border rounded-xl flex items-center justify-between gap-3 transition ${
                      isUltimate 
                        ? 'bg-purple-950/30 hover:bg-purple-900/40 border-purple-800/70 shadow-md'
                        : isStandaloneFfmpeg
                          ? 'bg-cyan-950/25 hover:bg-cyan-900/35 border-cyan-800/60'
                          : 'bg-neutral-950/60 hover:bg-neutral-800/60 border-neutral-800'
                    }`}
                  >
                    <div className="space-y-1 truncate">
                      <div className="flex items-center gap-2 flex-wrap">
                        {isUltimate && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded border border-amber-500/40 tracking-wider uppercase flex items-center gap-1">
                            <Sparkles className="w-2.5 h-2.5" />
                            <span>All-In-One</span>
                          </span>
                        )}
                        {isStandaloneFfmpeg && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 bg-cyan-500/20 text-cyan-300 rounded border border-cyan-500/40 tracking-wider uppercase flex items-center gap-1">
                            <Zap className="w-2.5 h-2.5" />
                            <span>FFmpeg Модуль</span>
                          </span>
                        )}
                        <span className={`text-xs font-semibold ${isUltimate ? 'text-purple-200' : isStandaloneFfmpeg ? 'text-cyan-200' : 'text-neutral-100'}`}>
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
                        isUltimate ? 'bg-purple-600 hover:bg-purple-500 font-bold shadow-sm' : isStandaloneFfmpeg ? 'bg-cyan-700 hover:bg-cyan-600 font-semibold' : 'bg-neutral-800 hover:bg-neutral-700'
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

      {/* Modal: Acoustic Original Effect & Automation Matcher */}
      {isAcousticMatchModalOpen && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-emerald-500/40 rounded-2xl w-full max-w-5xl overflow-hidden shadow-2xl flex flex-col max-h-[94vh]">
            <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between bg-gradient-to-r from-emerald-950/50 via-teal-950/30 to-neutral-900">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-600/20 text-emerald-400 rounded-xl border border-emerald-500/30">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <span>Повторение эффектов оригинала по кривой автоматизации</span>
                    <span className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full font-mono">
                      acoustic_matched v2.0 • 100ms Automation DSP
                    </span>
                  </h2>
                  <p className="text-xs text-neutral-400">
                    Строгий контроль 2-х входов (разделенный вокал оригинала + склеенная дорожка всех голосов), пофразовый детектор эффектов и автоматизация в каждый момент времени
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsAcousticMatchModalOpen(false)}
                className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5 flex-1">
              {/* Блок 1: Строгая двухэтапная проверка входных дорожек */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Вход №1: Разделенная вокальная дорожка оригинала */}
                <div className={`p-4 rounded-xl border ${origVocalsError ? 'bg-red-950/25 border-red-500/50' : 'bg-emerald-950/15 border-emerald-500/30'} space-y-2.5`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-emerald-300">
                      <Volume2 className="w-4 h-4" />
                      1. Вокальная дорожка оригинала (Stem Vocals)
                    </span>
                    <button
                      onClick={async () => {
                        try {
                          const res = await ipcSafe.invoke('mixing-select-external-files', { type: 'audio' });
                          if (!res.canceled && res.filePaths?.[0]) {
                            setOrigVocalsPath(res.filePaths[0]);
                            setOrigVocalsError(null);
                            runAnalyzeOriginalAcoustics(res.filePaths[0]);
                          }
                        } catch (e) {}
                      }}
                      className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-[11px] font-medium border border-neutral-700 transition flex items-center gap-1"
                    >
                      <FolderOpen className="w-3 h-3" />
                      <span>Выбрать 01_vocals.wav...</span>
                    </button>
                  </div>

                  {origVocalsError ? (
                    <div className="text-xs text-red-300 bg-red-950/50 p-3 rounded-lg border border-red-500/30 whitespace-pre-line leading-relaxed">
                      {origVocalsError}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between bg-neutral-950 px-3 py-2 rounded-lg border border-emerald-500/30">
                        <span className="text-xs font-mono text-emerald-300 truncate" title={origVocalsPath}>
                          ✓ {origVocalsPath || 'Ожидание...'}
                        </span>
                        {origVocalsPath && (
                          <button
                            onClick={() => runAnalyzeOriginalAcoustics(origVocalsPath)}
                            disabled={isAnalyzingAcoustics}
                            className="ml-2 px-2 py-0.5 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 rounded text-[10px] border border-emerald-500/30 shrink-0 transition"
                          >
                            Переанализировать
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-neutral-400">
                        Проверка пройдена: исходное аудио из видео разделено на стемы, выделен чистый вокал оригинала.
                      </p>
                    </div>
                  )}
                </div>

                {/* Вход №2: Склеенная дорожка всех голосов дабберов */}
                <div className={`p-4 rounded-xl border ${ourVocalsError ? 'bg-red-950/25 border-red-500/50' : 'bg-purple-950/15 border-purple-500/30'} space-y-2.5`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-purple-300">
                      <Sliders className="w-4 h-4" />
                      2. Склеенная дорожка всех голосов (voices_master)
                    </span>
                    <button
                      onClick={async () => {
                        try {
                          const res = await ipcSafe.invoke('mixing-select-external-files', { type: 'audio' });
                          if (!res.canceled && res.filePaths?.[0]) {
                            setOurVocalsPath(res.filePaths[0]);
                            setOurVocalsError(null);
                          }
                        } catch (e) {}
                      }}
                      className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-[11px] font-medium border border-neutral-700 transition flex items-center gap-1"
                    >
                      <FolderOpen className="w-3 h-3" />
                      <span>Выбрать voices_master.wav...</span>
                    </button>
                  </div>

                  {ourVocalsError ? (
                    <div className="text-xs text-red-300 bg-red-950/50 p-3 rounded-lg border border-red-500/30 whitespace-pre-line leading-relaxed">
                      {ourVocalsError}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between bg-neutral-950 px-3 py-2 rounded-lg border border-purple-500/30">
                        <span className="text-xs font-mono text-purple-300 truncate" title={ourVocalsPath}>
                          ✓ {ourVocalsPath || 'Не выбрана'}
                        </span>
                      </div>
                      <p className="text-[11px] text-neutral-400">
                        Проверка пройдена: все голоса дабберов склеены в единую мастер-дорожку для синхронной автоматизации.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Блок 2: Результаты полного пофразового и покадрового анализа эффектов оригинала */}
              {isAnalyzingAcoustics ? (
                <div className="p-8 bg-neutral-950 rounded-xl border border-neutral-800 flex flex-col items-center justify-center gap-3">
                  <RefreshCw className="w-7 h-7 text-emerald-400 animate-spin" />
                  <span className="text-sm text-neutral-200 font-medium">
                    Выполняется полный физический пофразовый и покадровый (100 мс) анализ эффектов вокала оригинала...
                  </span>
                  <span className="text-xs text-neutral-500">
                    Измерение телефонных/радио полосовых фильтров, эффекта «за стеной», RT60 реверберации, времени эха/дилэя, стерео-панорамы, перегруза и кривой громкости
                  </span>
                </div>
              ) : acousticProfile ? (
                <div className="space-y-4">
                  {/* Верхние карточки сводной статистики */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div className="p-3.5 bg-neutral-950 rounded-xl border border-neutral-800 space-y-1.5">
                      <div className="text-[11px] font-bold text-amber-400 uppercase flex items-center justify-between">
                        <span>1. Динамика и Фразы</span>
                        <span className="font-mono text-xs bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                          {acousticProfile.phrasesCount || 0} фраз
                        </span>
                      </div>
                      <div className="text-xs text-neutral-300 space-y-1">
                        <div className="flex justify-between">
                          <span className="text-neutral-500">Средний уровень:</span>
                          <span className="font-mono font-semibold text-white">{acousticProfile.overallStats?.integratedLufs} LUFS</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">Пик / LRA:</span>
                          <span className="font-mono text-neutral-200">{acousticProfile.overallStats?.truePeakDb} dBTP / {acousticProfile.overallStats?.loudnessRangeLu} LU</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">Точек автоматизации:</span>
                          <span className="font-mono text-emerald-400">{acousticProfile.framesCount || 0} (шаг 100 мс)</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-3.5 bg-neutral-950 rounded-xl border border-neutral-800 space-y-1.5">
                      <div className="text-[11px] font-bold text-cyan-400 uppercase flex items-center justify-between">
                        <span>2. Пространство и Эхо</span>
                        <span className="font-mono text-xs bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20">
                          RT60 {acousticProfile.overallStats?.avgReverbRt60}c
                        </span>
                      </div>
                      <div className="text-xs text-neutral-300 space-y-1">
                        <div className="flex justify-between">
                          <span className="text-neutral-500">Базовая среда:</span>
                          <span className="font-medium text-cyan-200 truncate max-w-[130px]">{acousticProfile.overallStats?.reverbCategory}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">Фраз с ревербом:</span>
                          <span className="font-mono text-white">{acousticProfile.overallStats?.effectCounts?.reverb_space || 0} шт.</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">Фраз с эхом/дилэем:</span>
                          <span className="font-mono text-cyan-300">{acousticProfile.overallStats?.effectCounts?.echo_delay || 0} шт.</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-3.5 bg-neutral-950 rounded-xl border border-neutral-800 space-y-1.5">
                      <div className="text-[11px] font-bold text-purple-400 uppercase flex items-center justify-between">
                        <span>3. Фильтры и Спецэффекты</span>
                        <span className="font-mono text-xs bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20">
                          {acousticProfile.overallStats?.phrasesWithSpecialEffects || 0} спецфраз
                        </span>
                      </div>
                      <div className="text-xs text-neutral-300 space-y-1">
                        <div className="flex justify-between">
                          <span className="text-neutral-500">Телефон / Рация:</span>
                          <span className="font-mono text-amber-300">{acousticProfile.overallStats?.effectCounts?.telephone || 0} фраз</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">За стеной / Издали:</span>
                          <span className="font-mono text-orange-300">{acousticProfile.overallStats?.effectCounts?.muffled_wall || 0} фраз</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">Панорама / Перегруз:</span>
                          <span className="font-mono text-pink-300">
                            {(acousticProfile.overallStats?.effectCounts?.stereo_pan || 0) + (acousticProfile.overallStats?.effectCounts?.stereo_wide || 0)} / {acousticProfile.overallStats?.effectCounts?.megaphone_dist || 0}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="p-3.5 bg-neutral-950 rounded-xl border border-neutral-800 space-y-1.5">
                      <div className="text-[11px] font-bold text-emerald-400 uppercase flex items-center justify-between">
                        <span>4. 6-Полосный Спектр</span>
                        <span className="font-mono text-[10px] text-neutral-400">Оригинал</span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] font-mono text-neutral-300">
                        <div>Sub: <span className="text-white">{acousticProfile.overallStats?.spectralBandsDb?.lowCut100Hz}dB</span></div>
                        <div>Body: <span className="text-white">{acousticProfile.overallStats?.spectralBandsDb?.warmth250Hz}dB</span></div>
                        <div>Box: <span className="text-white">{acousticProfile.overallStats?.spectralBandsDb?.boxiness500Hz}dB</span></div>
                        <div>Mid: <span className="text-white">{acousticProfile.overallStats?.spectralBandsDb?.nasal1200Hz}dB</span></div>
                        <div>Pres: <span className="text-emerald-300">{acousticProfile.overallStats?.spectralBandsDb?.presence3500Hz}dB</span></div>
                        <div>Air: <span className="text-cyan-300">{acousticProfile.overallStats?.spectralBandsDb?.air10000Hz}dB</span></div>
                      </div>
                    </div>
                  </div>

                  {/* Интерактивный пофразовый инспектор обнаруженных эффектов (как при ручном прослушивании) */}
                  {Array.isArray(acousticProfile.phrases) && acousticProfile.phrases.length > 0 && (
                    <div className="bg-neutral-950 rounded-xl border border-neutral-800 overflow-hidden">
                      <div className="px-4 py-2.5 bg-neutral-900/90 border-b border-neutral-800 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-neutral-200">
                            Пофразовая карта эффектов оригинала ({acousticProfile.phrases.length} фраз)
                          </span>
                          <span className="text-[11px] text-neutral-400">
                            — нажмите на таймкод фразы для мгновенного прослушивания в плеере
                          </span>
                        </div>

                        {/* Фильтры по типам обнаруженных эффектов */}
                        <div className="flex flex-wrap items-center gap-1">
                          {[
                            { id: 'all', label: `Все (${acousticProfile.phrases.length})` },
                            { id: 'special', label: `Со спецэффектами (${acousticProfile.overallStats?.phrasesWithSpecialEffects || 0})` },
                            { id: 'telephone', label: `📞 Телефон/Рация (${acousticProfile.overallStats?.effectCounts?.telephone || 0})` },
                            { id: 'muffled_wall', label: `🚪 За стеной (${acousticProfile.overallStats?.effectCounts?.muffled_wall || 0})` },
                            { id: 'reverb_space', label: `🏛 Реверб (${acousticProfile.overallStats?.effectCounts?.reverb_space || 0})` },
                            { id: 'echo_delay', label: `🌀 Эхо (${acousticProfile.overallStats?.effectCounts?.echo_delay || 0})` }
                          ].map(tab => (
                            <button
                              key={tab.id}
                              onClick={() => setSelectedEffectFilter(tab.id)}
                              className={`px-2 py-0.5 rounded text-[10px] font-medium transition border ${
                                selectedEffectFilter === tab.id
                                  ? 'bg-emerald-600/30 text-emerald-200 border-emerald-500/50'
                                  : 'bg-neutral-800/70 text-neutral-400 border-neutral-700/60 hover:text-neutral-200'
                              }`}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="max-h-56 overflow-y-auto divide-y divide-neutral-800/60">
                        {acousticProfile.phrases
                          .filter((ph: any) => {
                            if (selectedEffectFilter === 'all') return true;
                            if (selectedEffectFilter === 'special') {
                              return Array.isArray(ph.detectedEffects) && ph.detectedEffects.some((e: string) => e !== 'clean_studio');
                            }
                            return Array.isArray(ph.detectedEffects) && ph.detectedEffects.includes(selectedEffectFilter);
                          })
                          .map((ph: any) => {
                            const hasSpecial = Array.isArray(ph.detectedEffects) && ph.detectedEffects.some((e: string) => e !== 'clean_studio');
                            return (
                              <div
                                key={ph.index}
                                className={`px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs hover:bg-neutral-900/60 transition ${
                                  hasSpecial ? 'bg-emerald-950/10' : ''
                                }`}
                              >
                                <div className="flex items-center gap-2.5 min-w-[190px]">
                                  <span className="text-[10px] font-mono text-neutral-500 w-7">#{ph.index}</span>
                                  <button
                                    onClick={() => {
                                      handleSeek(ph.startSec);
                                      toast.info(`Плеер перемотан на фразу #${ph.index} (${ph.startFormatted})`);
                                    }}
                                    className="px-2 py-0.5 bg-neutral-800 hover:bg-emerald-700/40 text-emerald-300 rounded font-mono text-[11px] border border-neutral-700 hover:border-emerald-500/40 transition flex items-center gap-1"
                                    title="Перемотать плеер на эту фразу"
                                  >
                                    <Play className="w-2.5 h-2.5 fill-current" />
                                    <span>{ph.startFormatted} – {ph.endFormatted}</span>
                                  </button>
                                </div>

                                {/* Бейджи обнаруженных эффектов на фразе */}
                                <div className="flex flex-wrap items-center gap-1 flex-1">
                                  {(ph.detectedEffectLabels || []).map((lbl: string, idx: number) => {
                                    const code = ph.detectedEffects?.[idx] || 'clean_studio';
                                    const badgeColor =
                                      code === 'telephone'
                                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                        : code === 'muffled_wall'
                                        ? 'bg-orange-500/20 text-orange-300 border-orange-500/40'
                                        : code === 'reverb_space'
                                        ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                                        : code === 'echo_delay'
                                        ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                                        : code === 'megaphone_dist'
                                        ? 'bg-red-500/20 text-red-300 border-red-500/40'
                                        : code === 'stereo_pan' || code === 'stereo_wide'
                                        ? 'bg-pink-500/20 text-pink-300 border-pink-500/40'
                                        : code === 'whisper_intimate' || code === 'shout_intense'
                                        ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                                        : 'bg-neutral-800 text-neutral-400 border-neutral-700';
                                    return (
                                      <span
                                        key={idx}
                                        className={`px-2 py-0.5 rounded-md text-[10px] font-medium border ${badgeColor}`}
                                      >
                                        {lbl}
                                      </span>
                                    );
                                  })}
                                </div>

                                {/* Точные физические параметры автоматизации для этой фразы */}
                                <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-neutral-400">
                                  <span title="Целевая громкость фразы">
                                    LUFS: <strong className="text-neutral-200">{ph.loudnessLufs}</strong>
                                  </span>
                                  <span title="Полоса пропускания динамических фильтров (HPF .. LPF)">
                                    Фильтр: <strong className="text-amber-300">{ph.hpfCutoffHz}..{ph.lpfCutoffHz} Гц</strong>
                                  </span>
                                  <span title="Время затухания реверберации RT60 и доля Wet">
                                    Rev: <strong className="text-cyan-300">{ph.reverbRt60Sec}с ({Math.round((ph.reverbWetMix || 0) * 100)}%)</strong>
                                  </span>
                                  {ph.echoWetMix > 0.04 && (
                                    <span title="Задержка эха/дилэя и уровень повторов">
                                      Echo: <strong className="text-sky-300">{ph.echoDelayMs}мс ({Math.round(ph.echoWetMix * 100)}%)</strong>
                                    </span>
                                  )}
                                  {(Math.abs(ph.pan || 0) > 0.12 || (ph.stereoWidth || 1) > 1.2) && (
                                    <span title="Стерео-панорама и ширина">
                                      Pan: <strong className="text-pink-300">{ph.pan > 0 ? `R${Math.round(ph.pan * 100)}` : ph.pan < 0 ? `L${Math.round(Math.abs(ph.pan) * 100)}` : 'C'} (W:{ph.stereoWidth}x)</strong>
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {/* Блок 3: Регуляторы глубины кривых автоматизации */}
              <div className="p-4 bg-neutral-950 rounded-xl border border-neutral-800 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-neutral-200 uppercase tracking-wider">
                    Настройка кривых автоматизации обработчиков (Time-Varying Automation Curves)
                  </div>
                  <span className="text-[11px] text-emerald-400 font-mono">
                    Плавная интерполяция каждые 100 мс без щелчков
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-neutral-400">1. Автоматизация громкости, экспрессии и стерео-панорамы:</span>
                      <span className="font-mono text-amber-400 font-bold">{loudnessStrength}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={loudnessStrength}
                      onChange={e => setLoudnessStrength(Number(e.target.value))}
                      className="w-full accent-amber-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-neutral-400">2. Автоматизация пространства (FDN-Реверберация + Stereo Slapback/Delay):</span>
                      <span className="font-mono text-cyan-400 font-bold">{reverbStrength}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={reverbStrength}
                      onChange={e => setReverbStrength(Number(e.target.value))}
                      className="w-full accent-cyan-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-neutral-400">3. Автоматизация фильтров (Телефон / Рация / За стеной / 6-полосный EQ / Перегруз):</span>
                      <span className="font-mono text-purple-400 font-bold">{eqStrength}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={eqStrength}
                      onChange={e => setEqStrength(Number(e.target.value))}
                      className="w-full accent-purple-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-neutral-400">Смещение целевой громкости голосов относительно оригинала:</span>
                      <span className="font-mono text-emerald-400 font-bold">{targetLufsOffset > 0 ? `+${targetLufsOffset}` : targetLufsOffset} dB</span>
                    </div>
                    <input
                      type="range"
                      min={-6}
                      max={6}
                      step={0.5}
                      value={targetLufsOffset}
                      onChange={e => setTargetLufsOffset(Number(e.target.value))}
                      className="w-full accent-emerald-500"
                    />
                  </div>
                </div>
              </div>

              {/* Отчет о примененной автоматизации */}
              {acousticMatchResult && (
                <div className="p-4 bg-emerald-950/30 border border-emerald-500/40 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-300">
                      ✓ Кривые автоматизации эффектов успешно наложены на склеенную дорожку голосов!
                    </span>
                    <span className="text-[11px] font-mono text-emerald-400">
                      {acousticMatchResult.outputPath}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] text-neutral-300 font-mono">
                    <div>Точек кривой: {acousticMatchResult.appliedParameters?.loudnessEnvelope?.automationPointsCount || 0}</div>
                    <div>Базовый Gain: {acousticMatchResult.appliedParameters?.loudnessEnvelope?.gainDeltaDb > 0 ? '+' : ''}{acousticMatchResult.appliedParameters?.loudnessEnvelope?.gainDeltaDb} dB</div>
                    <div>Фраз со спецэффектами: {acousticMatchResult.appliedParameters?.detectedEffectsSummary?.phrasesWithSpecialEffects || 0}</div>
                    <div>Категория среды: {acousticMatchResult.appliedParameters?.reverbSpace?.originalCategory}</div>
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-neutral-800 bg-neutral-950 flex items-center justify-between gap-3">
              <button
                onClick={handleAddAcousticModuleToPipeline}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-emerald-300 rounded-xl text-xs font-semibold border border-emerald-500/30 flex items-center gap-2 transition"
              >
                <Plus className="w-4 h-4" />
                <span>Добавить шаг «acoustic_matched» в конвейер сведения</span>
              </button>

              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => setIsAcousticMatchModalOpen(false)}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-xl text-xs font-medium transition"
                >
                  Закрыть
                </button>
                <button
                  onClick={handleApplyAcousticProfileMatch}
                  disabled={isApplyingAcousticMatch || !origVocalsPath || !ourVocalsPath || !!origVocalsError || !!ourVocalsError}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition shadow-lg shadow-emerald-900/30"
                >
                  {isApplyingAcousticMatch ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Рендеринг кривых автоматизации...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Наложить эффекты по кривой автоматизации сейчас</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
