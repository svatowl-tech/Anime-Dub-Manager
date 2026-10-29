import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Play, Pause, CheckCircle, XCircle, AlertCircle, MessageSquare, Volume2, Check, X, Activity, User, Clock, FileAudio, Send, Video, Trash2, Mic, Sparkles, Save, SkipForward, SkipBack, Scissors, Zap, VolumeX, Volume1, Sliders, Info } from 'lucide-react';
import { toast } from 'sonner';
import { safeCopyToClipboard } from '../lib/clipboard';
import { ipcSafe } from '../lib/ipcSafe';
import { Episode, RoleAssignment, Participant, Track, SubtitleLine, Comment } from '../types';
import { sanitizeFolderName } from '../lib/pathUtils';
import { TrackWaveform } from './qa/TrackWaveform';
import { TrackSidebar } from './qa/TrackSidebar';
import { MissingLinesModal } from './qa/MissingLinesModal';
import { generateFixesIssuedMessage, generateStatusMessage, generateSoundEngineerQAReport } from '../lib/templates';
import { getParticipants } from '../services/dbService';
import { ExportModal } from './ExportModal';
import { ConfirmModal } from './ui/ConfirmModal';
import { useVideoContext } from '../contexts/VideoContext';
import { SIGN_KEYWORDS } from '../constants';
import { analyzeAudioForPreview, NormalizationMetrics, getCachedNormalization } from '../lib/qa/audioNormalizer';
import { detectEpisodeGaps, MissingLineDetection, silenceAudioBufferInterval, transferAudioBufferPhrase, findFullPhraseSilenceBoundaries, GapDetectionOptions, QAScanReport } from '../lib/qa/missingLinesDetector';
import { QAScanConfigModal } from './qa/QAScanConfigModal';
import { getSharedAudioContext, ensureAudioContextResumed } from '../lib/qa/sharedAudioContext';
import { saveQAGapsToTimingProject } from '../lib/qa/timingSyncService';
import { prepareQATracksForTiming, normalizeKey } from '../lib/qaTimingHelper';
import { resolveLocalPath } from '../lib/webFileSystem';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';

import { useQAGapFixApplier } from "./qa/useQAGapFixApplier";
import { QAPlayerAndModalsView } from "./qa/QAPlayerAndModalsView";
interface QAPanelProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
  onNavigate?: (tab: 'dashboard' | 'subtitles' | 'qa' | 'timing' | 'mixing' | 'release' | 'telegram' | 'settings' | 'database' | 'cover' | 'stats' | 'archive') => void;
}

export default function QAPanel({ currentEpisode, onRefresh, onNavigate }: QAPanelProps) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [mutedTracks, setMutedTracks] = useState<Set<string>>(new Set());
  const [soloTrack, setSoloTrack] = useState<string | null>(null);
  const [commentModal, setCommentModal] = useState<{ isOpen: boolean, region: any } | null>(null);
  const [newComment, setNewComment] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [originalVolume, setOriginalVolume] = useState(0.5);
  const [isPlaying, setIsPlaying] = useState(false);
  const [subLines, setSubLines] = useState<SubtitleLine[]>([]);
  const [currentCharacter, setCurrentCharacter] = useState<string | null>(null);
  const [currentDubberNickname, setCurrentDubberNickname] = useState<string | null>(null);
  const [currentSubtitleText, setCurrentSubtitleText] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [generatedMessage, setGeneratedMessage] = useState<string | null>(null);
  const [isMessageModalOpen, setIsMessageModalOpen] = useState(false);
  const [isMessageCopied, setIsMessageCopied] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isBaking, setIsBaking] = useState(false);
  const [bakeProgress, setBakeProgress] = useState(0);
  const [bakeStatus, setBakeStatus] = useState('');
  const [isAnalyzingSilence, setIsAnalyzingSilence] = useState(false);
  const [silenceThreshold, setSilenceThreshold] = useState(0.01); // Default threshold
  const [currentSubId, setCurrentSubId] = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | undefined>(undefined);
  const [isAutoNormalize, setIsAutoNormalize] = useState<boolean>(() => {
    return localStorage.getItem('qa_auto_normalize') !== 'false';
  });
  const [normalizationMetrics, setNormalizationMetrics] = useState<Record<string, NormalizationMetrics>>({});
  const [detectedGaps, setDetectedGaps] = useState<MissingLineDetection[]>([]);
  const [qaScanReport, setQaScanReport] = useState<QAScanReport | null>(null);
  const [isGapModalOpen, setIsGapModalOpen] = useState(false);
  const [isScanConfigModalOpen, setIsScanConfigModalOpen] = useState(false);
  const [isAnalyzingGaps, setIsAnalyzingGaps] = useState(false);
  const [isApplyingGapFixes, setIsApplyingGapFixes] = useState(false);
  const [gapSensitivityThreshold, setGapSensitivityThreshold] = useState<number>(3.0);
  const [gapScanOptions, setGapScanOptions] = useState<GapDetectionOptions>({
    speechDynamicThresholdDb: 3.0,
    scanMissingLines: true,
    scanUnwantedSpeech: true,
    scanCollisions: true,
    scanOverlaps: true,
    scanTimingMismatches: true,
    scanArtifacts: true,
    scanWhisperText: false,
    whisperModel: 'small'
  });

  const [isManualDubberOverride, setIsManualDubberOverride] = useState(false);
  const [manualDubberId, setManualDubberId] = useState<string>('');

  const gapsByTrack = useMemo(() => {
    const map: Record<string, number> = {};
    for (const gap of detectedGaps) {
      map[gap.trackId] = (map[gap.trackId] || 0) + 1;
    }
    return map;
  }, [detectedGaps]);

  const toggleAutoNormalize = useCallback(() => {
    setIsAutoNormalize(prev => {
      const next = !prev;
      localStorage.setItem('qa_auto_normalize', String(next));
      toast.info(next ? 'Авто-нормализация громкости превью включена' : 'Авто-нормализация громкости превью выключена');
      return next;
    });
  }, []);

  const [isSplitMultiTracks, setIsSplitMultiTracks] = useState<boolean>(() => {
    return localStorage.getItem('qa_split_multi_tracks') !== 'false';
  });

  const toggleSplitMultiTracks = useCallback(() => {
    setIsSplitMultiTracks(prev => {
      const next = !prev;
      localStorage.setItem('qa_split_multi_tracks', String(next));
      toast.info(next ? 'Импорт всех версий как отдельных параллельных дорожек включен' : 'Группировка версий в выпадающий список включена');
      return next;
    });
  }, []);

  // Restore persisted QA results for current episode so work is never lost on closing modal
  useEffect(() => {
    if (!currentEpisode?.id) {
      setDetectedGaps([]);
      setQaScanReport(null);
      return;
    }

    try {
      const storageKey = `qa_detected_gaps_${currentEpisode.id}`;
      const reportKey = `qa_scan_report_${currentEpisode.id}`;
      const savedGapsRaw = localStorage.getItem(storageKey);
      const savedReportRaw = localStorage.getItem(reportKey);

      if (savedGapsRaw) {
        const parsedGaps = JSON.parse(savedGapsRaw);
        if (Array.isArray(parsedGaps) && parsedGaps.length > 0) {
          setDetectedGaps(parsedGaps);
        } else {
          setDetectedGaps([]);
        }
      } else {
        setDetectedGaps([]);
      }

      if (savedReportRaw) {
        setQaScanReport(JSON.parse(savedReportRaw));
      } else {
        setQaScanReport(null);
      }
    } catch (err) {
      console.warn('Failed to restore QA scan results from storage:', err);
    }
  }, [currentEpisode?.id]);

  const handleSaveDetectedGaps = useCallback((updatedGaps: MissingLineDetection[]) => {
    setDetectedGaps(updatedGaps);
    if (currentEpisode?.id) {
      try {
        localStorage.setItem(`qa_detected_gaps_${currentEpisode.id}`, JSON.stringify(updatedGaps));
      } catch (e) {
        console.warn('Failed to save QA gaps to localStorage:', e);
      }
    }
  }, [currentEpisode?.id]);

  const handleUpdateSubLineFromModal = useCallback(async (updatedLine: { rawLineIndex: number; name?: string; text?: string; start?: string; end?: string }) => {
    if (!currentEpisode?.subPath) {
      toast.error('Файл субтитров отсутствует в серии');
      return;
    }
    try {
      await ipcSafe.invoke('save-raw-subtitles', {
        filePath: currentEpisode.subPath,
        lines: [updatedLine]
      });

      setSubLines(prev => prev.map(l => {
        if (l.rawLineIndex !== updatedLine.rawLineIndex) return l;
        return {
          ...l,
          name: updatedLine.name !== undefined ? updatedLine.name : l.name,
          text: updatedLine.text !== undefined ? updatedLine.text : l.text,
          start: updatedLine.start !== undefined ? updatedLine.start : l.start,
          end: updatedLine.end !== undefined ? updatedLine.end : l.end
        };
      }));
    } catch (err: any) {
      console.error('Failed to update subtitle line:', err);
      throw err;
    }
  }, [currentEpisode?.subPath]);

  const handleExportSubtitlesFromModal = useCallback(async () => {
    if (!currentEpisode?.subPath) {
      toast.error('Файл субтитров отсутствует в серии');
      return;
    }
    try {
      // Save all current in-memory lines to ensure disk is 100% in sync
      await ipcSafe.invoke('save-raw-subtitles', {
        filePath: currentEpisode.subPath,
        lines: subLines,
        overwrite: true
      });

      // Also allow saving a copy to custom location if electron dialog is available
      if (window.electronAPI) {
        try {
          const res = await ipcSafe.invoke('dialog:save-file', {
            title: 'Экспортировать исправленные субтитры',
            defaultPath: currentEpisode.subPath.replace(/\.ass$/i, '_исправленные.ass'),
            filters: [{ name: 'ASS Subtitles', extensions: ['ass'] }]
          });
          if (res && !res.canceled && res.filePath) {
            await ipcSafe.invoke('save-raw-subtitles', {
              filePath: res.filePath,
              lines: subLines,
              overwrite: true
            });
            toast.success(`Субтитры успешно сохранены в: ${res.filePath}`);
            return;
          }
        } catch (e) {
          // Dialog skipped or canceled
        }
      }
      toast.success('Субтитры успешно сохранены и обновлены с учетом всех правок!');
    } catch (err: any) {
      toast.error(`Ошибка при экспорте субтитров: ${err?.message || err}`);
    }
  }, [currentEpisode?.subPath, subLines]);

  useEffect(() => {
    let active = true;
    const resolvePath = async () => {
      if (!currentEpisode?.rawPath) {
        if (active) setVideoUrl(undefined);
        return;
      }
      
      if (!window.electronAPI) {
        // Мы в веб-версии
        const cleanName = currentEpisode.rawPath.replace(/\\/g, '/').split('/').pop() || currentEpisode.rawPath;
        const cached = (window as any).getFileFromCache?.(cleanName);
        if (cached) {
          if (active) setVideoUrl(URL.createObjectURL(cached));
          return;
        }
        try {
          const resolved = await resolveLocalPath(currentEpisode.rawPath);
          if (active) setVideoUrl(resolved);
        } catch (e) {
          if (active) setVideoUrl(currentEpisode.rawPath);
        }
      } else {
        // Мы в Электроне
        let src = currentEpisode.rawPath;
        if (!src.startsWith('http') && !src.startsWith('file://') && !src.startsWith('blob:')) {
          src = `file://${src}`;
        }
        if (active) setVideoUrl(src);
      }
    };
    resolvePath();
    return () => { active = false; };
  }, [currentEpisode?.rawPath]);

  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    variant?: 'danger' | 'warning' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const { registerPlayer, unregisterPlayer } = useVideoContext();

  useEffect(() => {
    loadParticipants();
  }, []);

  const loadParticipants = async () => {
    const p = await getParticipants();
    setParticipants(p);
  };

  const parseAssTime = (timeStr: string) => {
    const parts = timeStr.split(':');
    if (parts.length === 3) {
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      const seconds = parseFloat(parts[2]);
      return (hours * 3600) + (minutes * 60) + seconds;
    }
    return 0;
  };

  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<any>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});
  const audioGainNodesRef = useRef<Record<string, { gain: GainNode }>>({});
  const [audioRefsUpdated, setAudioRefsUpdated] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Synchronize all secondary audio sources (HTMLAudioElement tracks & WaveSurfer) to video master time
  const syncAudioSources = useCallback((targetTime: number, shouldPlay: boolean) => {
    if (shouldPlay) {
      ensureAudioContextResumed();
    }

    Object.values(audioRefs.current).forEach(audio => {
      if (audio instanceof HTMLAudioElement) {
        if (Math.abs(audio.currentTime - targetTime) > 0.05) {
          audio.currentTime = targetTime;
        }
        audio.playbackRate = 1.0;
        if (shouldPlay) {
          audio.play().catch(e => {
            if (e?.name !== 'AbortError') console.error('Audio track play error:', e);
          });
        } else {
          audio.pause();
        }
      }
    });

    if (wavesurferRef.current) {
      try {
        if (Math.abs(wavesurferRef.current.getCurrentTime() - targetTime) > 0.05) {
          wavesurferRef.current.setTime(targetTime);
        }
        if (shouldPlay) {
          wavesurferRef.current.play().catch(e => {
            if (e?.name !== 'AbortError') console.error('WaveSurfer play error:', e);
          });
        } else {
          wavesurferRef.current.pause();
        }
      } catch (err) {
        // Ignored during teardown
      }
    }
  }, []);

  useEffect(() => {
    const time = videoRef.current?.currentTime ?? currentTime;
    syncAudioSources(time, isPlaying);
  }, [isPlaying, audioRefsUpdated, syncAudioSources]);

  const handleVideoPlay = useCallback(() => {
    setIsPlaying(true);
    const time = videoRef.current?.currentTime ?? currentTime;
    setCurrentTime(time);
    syncAudioSources(time, true);
  }, [currentTime, syncAudioSources]);

  const handleVideoPause = useCallback(() => {
    setIsPlaying(false);
    const time = videoRef.current?.currentTime ?? currentTime;
    setCurrentTime(time);
    syncAudioSources(time, false);
  }, [currentTime, syncAudioSources]);

  const handleVideoTimeUpdate = useCallback((e?: React.SyntheticEvent<HTMLVideoElement>) => {
    const time = e ? e.currentTarget.currentTime : (videoRef.current?.currentTime ?? currentTime);
    setCurrentTime(time);

    if (e ? !e.currentTarget.paused : !videoRef.current?.paused) {
      ensureAudioContextResumed();
      Object.values(audioRefs.current).forEach(audio => {
        if (audio instanceof HTMLAudioElement && !audio.paused) {
          const diff = time - audio.currentTime;
          if (Math.abs(diff) > 0.4) {
            // Hard seek only when drift is significant (e.g. manual timeline jump)
            audio.currentTime = time;
            audio.playbackRate = 1.0;
          } else if (Math.abs(diff) > 0.05) {
            // Micro-adjust playback rate smoothly to lock onto video without flushing audio buffers or silencing phrases
            audio.playbackRate = Math.max(0.92, Math.min(1.08, 1.0 + diff * 0.4));
          } else {
            audio.playbackRate = 1.0;
          }
        }
      });

      if (wavesurferRef.current && wavesurferRef.current.isPlaying()) {
        const wsTime = wavesurferRef.current.getCurrentTime();
        if (Math.abs(wsTime - time) > 0.4) {
          wavesurferRef.current.setTime(time);
        }
      }
    }
  }, []);

  const handleVideoSeeking = useCallback(() => {
    const time = videoRef.current?.currentTime ?? currentTime;
    setCurrentTime(time);
    const isPaused = videoRef.current ? videoRef.current.paused : !isPlaying;
    syncAudioSources(time, !isPaused);
  }, [currentTime, isPlaying, syncAudioSources]);

  const handleVideoEnded = useCallback(() => {
    setIsPlaying(false);
    const time = videoRef.current?.duration ?? currentTime;
    setCurrentTime(time);
    syncAudioSources(time, false);
  }, [currentTime, syncAudioSources]);

  const handleSeekToTime = useCallback((targetTime: number) => {
    setCurrentTime(targetTime);
    if (videoRef.current) {
      videoRef.current.currentTime = targetTime;
    }
    const shouldPlay = videoRef.current ? !videoRef.current.paused : isPlaying;
    syncAudioSources(targetTime, shouldPlay);
  }, [isPlaying, syncAudioSources]);

  // Run normalization analysis for all track audio files for preview
  useEffect(() => {
    if (!currentEpisode || tracks.length === 0) return;
    let isCancelled = false;

    tracks.forEach(track => {
      if (track.id === 'original') return;
      const selectedFile = track.files.find(f => f.id === track.selectedFileId) || track.files[0];
      if (!selectedFile || !selectedFile.path) return;

      let audioUrl = selectedFile.path;
      if (!window.electronAPI) {
        const cleanName = selectedFile.path.replace(/\\/g, '/').split('/').pop() || selectedFile.path;
        const cached = (window as any).getFileFromCache?.(cleanName);
        if (cached) {
          audioUrl = URL.createObjectURL(cached);
        }
      } else {
        audioUrl = selectedFile.path.startsWith('file://') || selectedFile.path.startsWith('http') ? selectedFile.path : `file://${selectedFile.path}`;
      }

      const isPlayable = audioUrl && (
        audioUrl.startsWith('blob:') ||
        audioUrl.startsWith('http://') ||
        audioUrl.startsWith('https://') ||
        audioUrl.startsWith('data:') ||
        audioUrl.startsWith('/api/') ||
        (window.electronAPI && audioUrl.startsWith('file://'))
      );
      if (!isPlayable) return;

      const cacheKey = `${track.id}_${selectedFile.id || selectedFile.path}`;
      const existing = getCachedNormalization(cacheKey);
      if (existing && existing.status === 'ready') {
        setNormalizationMetrics(prev => ({ ...prev, [track.id]: existing }));
        return;
      }

      setNormalizationMetrics(prev => ({
        ...prev,
        [track.id]: {
          gain: 1.0,
          gainDb: 0,
          peak: 1.0,
          peakDb: 0,
          rms: 0.125,
          rmsDb: -18,
          status: 'analyzing'
        }
      }));

      analyzeAudioForPreview(audioUrl, cacheKey, selectedFile?.path).then(metrics => {
        if (!isCancelled) {
          setNormalizationMetrics(prev => ({ ...prev, [track.id]: metrics }));
        }
      }).catch(err => {
        if (!isCancelled) {
          console.warn('Normalization analysis error:', err);
        }
      });
    });

    return () => {
      isCancelled = true;
    };
  }, [tracks, currentEpisode]);

  // Update audio volumes with auto-normalization gain
  useEffect(() => {
    Object.entries(audioRefs.current).forEach(([id, audio]) => {
      if (audio instanceof HTMLAudioElement) {
        const userVol = volumes[id] ?? 0.8;
        const normGain = (isAutoNormalize && normalizationMetrics[id]?.status === 'ready')
          ? normalizationMetrics[id].gain
          : 1.0;
        
        const gainNodeData = audioGainNodesRef.current[id];
        if (gainNodeData) {
          audio.volume = 1.0;
          gainNodeData.gain.gain.value = isMuted ? 0 : Math.max(0, userVol * normGain);
        } else {
          const volume = isMuted ? 0 : Math.min(1.0, Math.max(0, userVol * normGain));
          audio.volume = volume;
        }
      }
    });

    if (wavesurferRef.current && selectedTrackId) {
      const userVol = volumes[selectedTrackId] ?? 0.8;
      const normGain = (isAutoNormalize && normalizationMetrics[selectedTrackId]?.status === 'ready')
        ? normalizationMetrics[selectedTrackId].gain
        : 1.0;
      const volume = isMuted ? 0 : Math.min(1.0, Math.max(0, userVol * normGain));
      try {
        wavesurferRef.current.setVolume(volume);
      } catch (e) {
        console.warn('WaveSurfer setVolume warning:', e);
      }
    }
  }, [volumes, isMuted, selectedTrackId, isAutoNormalize, normalizationMetrics, audioRefsUpdated]);

  // Clean up audio elements on unmount or track change
  useEffect(() => {
    return () => {
      Object.keys(audioRefs.current).forEach(id => {
        const audio = audioRefs.current[id];
        if (audio instanceof HTMLAudioElement) {
          audio.pause();
          audio.src = '';
        }
        const gainData = audioGainNodesRef.current[id];
        if (gainData) {
          try {
            gainData.gain.disconnect();
          } catch (e) {}
        }
      });
      audioRefs.current = {};
      audioGainNodesRef.current = {};
      setAudioRefsUpdated(prev => prev + 1);
    };
  }, [currentEpisode?.id]);

  // Initialize audio elements for all tracks (except selected one which is handled by WaveSurfer)
  useEffect(() => {
    if (!currentEpisode) return;
    
    let updated = false;
    tracks.forEach(track => {
      // If we are viewing a specific track, we ONLY want to hear that track (via wavesurfer)
      // So we should not create/play audio elements for other tracks unless we are in 'all' mode
      // Also, we NEVER want an audio element for the 'original' track because the video handles it
      if (selectedTrackId !== 'all' || track.id === selectedTrackId || track.id === 'original') {
        // If it was previously in audioRefs, remove it
        if (audioRefs.current[track.id]) {
          audioRefs.current[track.id].pause();
          delete audioRefs.current[track.id];
          updated = true;
        }
        return;
      }

      const selectedFile = track.files.find(f => f.id === track.selectedFileId) || track.files[0];
      if (selectedFile && selectedFile.path && !audioRefs.current[track.id]) {
        let audioUrl = selectedFile.path;
        if (!window.electronAPI) {
          const cleanName = selectedFile.path.replace(/\\/g, '/').split('/').pop() || selectedFile.path;
          const cached = (window as any).getFileFromCache?.(cleanName);
          if (cached) {
            audioUrl = URL.createObjectURL(cached);
          }
        } else {
          audioUrl = selectedFile.path.startsWith('file://') || selectedFile.path.startsWith('http') ? selectedFile.path : `file://${selectedFile.path}`;
        }

        const isPlayable = audioUrl && (
          audioUrl.startsWith('blob:') ||
          audioUrl.startsWith('http://') ||
          audioUrl.startsWith('https://') ||
          audioUrl.startsWith('data:') ||
          audioUrl.startsWith('/api/') ||
          (window.electronAPI && audioUrl.startsWith('file://'))
        );
        if (!isPlayable) return;

        const audio = new Audio(audioUrl);
        audio.volume = Math.min(1.0, Math.max(0, volumes[track.id] ?? 0.8));
        audioRefs.current[track.id] = audio;
        
        try {
          const ctx = getSharedAudioContext();
          if (ctx) {
            const source = ctx.createMediaElementSource(audio);
            const gain = ctx.createGain();
            source.connect(gain);
            gain.connect(ctx.destination);
            audioGainNodesRef.current[track.id] = { gain };
          }
        } catch (e) {
          console.warn('Web Audio gain init notice for track', track.id, e);
        }
        
        updated = true;
      } else if (selectedFile && selectedFile.path && audioRefs.current[track.id]) {
        let audioUrl = selectedFile.path;
        if (!window.electronAPI) {
          const cleanName = selectedFile.path.replace(/\\/g, '/').split('/').pop() || selectedFile.path;
          const cached = (window as any).getFileFromCache?.(cleanName);
          if (cached) {
            audioUrl = URL.createObjectURL(cached);
          }
        } else {
          audioUrl = selectedFile.path.startsWith('file://') || selectedFile.path.startsWith('http') ? selectedFile.path : `file://${selectedFile.path}`;
        }

        const isPlayable = audioUrl && (
          audioUrl.startsWith('blob:') ||
          audioUrl.startsWith('http://') ||
          audioUrl.startsWith('https://') ||
          audioUrl.startsWith('data:') ||
          audioUrl.startsWith('/api/') ||
          (window.electronAPI && audioUrl.startsWith('file://'))
        );
        if (!isPlayable) return;

        // Update source if it changed
        if (audioRefs.current[track.id].src !== audioUrl) {
          audioRefs.current[track.id].src = audioUrl;
          updated = true;
        }
      }
    });
    if (updated) setAudioRefsUpdated(prev => prev + 1);
  }, [tracks, currentEpisode, selectedTrackId]);

  // Map assignments to tracks (grouped by dubber)
  useEffect(() => {
    if (!currentEpisode) return;
    
    const dubberTracks: Record<string, Track> = {};
    
    currentEpisode.assignments?.forEach(as => {
      const dubberId = as.substituteId || as.dubberId;
      const dubberName = as.substitute?.nickname || as.dubber?.nickname || 'Неизвестно';
      
    // Find ALL DUBBER_FILEs and FIXES for this dubber in this episode
    const dubberFiles = currentEpisode.uploads?.filter(u => 
      (u.type === 'DUBBER_FILE' || u.type === 'FIXES') && 
      (u.assignmentId === as.id || currentEpisode.assignments?.find(a => a.id === u.assignmentId)?.dubberId === dubberId || currentEpisode.assignments?.find(a => a.id === u.assignmentId)?.substituteId === dubberId)
    ).map(u => ({ id: u.id, path: u.path, createdAt: u.createdAt, type: u.type, size: u.size })) || [];
      
      let comments: Comment[] = [];
      if (as.comments) {
        try {
          comments = JSON.parse(as.comments);
        } catch (e) {
          console.error('Failed to parse comments', e);
        }
      }

      if (!dubberTracks[dubberId]) {
        dubberTracks[dubberId] = {
          id: dubberId, // Use dubberId as track ID
          participant: dubberName,
          character: as.characterName,
          status: (as.status?.toLowerCase() || 'pending') as Track['status'],
          files: dubberFiles,
          selectedFileId: dubberFiles.length > 0 ? dubberFiles[0].id : undefined,
          comments
        };
      } else {
        // Append character name if multiple
        if (!dubberTracks[dubberId].character.includes(as.characterName)) {
          dubberTracks[dubberId].character += `, ${as.characterName}`;
        }
        // Merge files (avoid duplicates)
        dubberFiles.forEach(f => {
          if (!dubberTracks[dubberId].files.find(existing => existing.id === f.id)) {
            dubberTracks[dubberId].files.push(f);
          }
        });
        // Merge comments
        dubberTracks[dubberId].comments = [...dubberTracks[dubberId].comments, ...comments];
        
        // Upgrade track status if a more critical status is found
        const currentStatus = dubberTracks[dubberId].status;
        const newStatus = as.status?.toLowerCase() as Track['status'];
        
        // Priority: rejected > fixes_needed > pending > approved
        const priorities: Record<string, number> = {
          'rejected': 4,
          'fixes_needed': 3,
          'pending': 2,
          'approved': 1
        };
        
        const currentPriority = priorities[currentStatus] || 0;
        const newPriority = priorities[newStatus] || 0;
        
        if (newPriority > currentPriority) {
          dubberTracks[dubberId].status = newStatus;
        }
      }
    });
    
    let mappedTracks: Track[] = [];
    try {
      mappedTracks = prepareQATracksForTiming(currentEpisode, [], isSplitMultiTracks);
    } catch (e) {
      console.warn('Fallback to basic dubberTracks mapping', e);
    }

    if (mappedTracks.length === 0) {
      mappedTracks = Object.values(dubberTracks);
    }
    
    // Add original track
    const originalTrack: Track = {
      id: 'original',
      participant: 'Оригинал',
      character: 'Оригинал',
      status: 'approved',
      files: [{ id: 'orig', path: currentEpisode.rawPath, createdAt: '', type: 'DUBBER_FILE' }],
      selectedFileId: 'orig',
      comments: []
    };
    
    setTracks([originalTrack, ...mappedTracks]);
    if (mappedTracks.length > 0 && !selectedTrackId) {
      setSelectedTrackId(mappedTracks[0].id);
    }
  }, [currentEpisode, isSplitMultiTracks]);

  // Load subtitles for auto-detection
  useEffect(() => {
    const loadSubs = async () => {
      if (currentEpisode?.subPath) {
        try {
          const res = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
          if (res && res.lines) {
            const processedLines = (res.lines as SubtitleLine[])
              .filter((l: SubtitleLine) => {
                const name = (l.name || '').toLowerCase();
                const style = (l.style || '').toLowerCase();
                return !SIGN_KEYWORDS.some(k => name.includes(k.toLowerCase()) || style.includes(k.toLowerCase()));
              })
              .map((l: SubtitleLine) => ({
                ...l,
                startSec: typeof l.start === 'number' ? l.start : parseAssTime(l.start || ''),
                endSec: typeof l.end === 'number' ? l.end : parseAssTime(l.end || '')
              })).sort((a: SubtitleLine, b: SubtitleLine) => a.startSec - b.startSec);
            setSubLines(processedLines);
          }
        } catch (e) {
          console.error('Failed to load subs for QA', e);
        }
      }
    };
    loadSubs();
  }, [currentEpisode?.subPath]);

  // Track current character based on time
  useEffect(() => {
    if (subLines.length === 0) return;

    // subLines is already sorted by startSec
    let lastStartedSub = null;
    for (let i = subLines.length - 1; i >= 0; i--) {
      if (currentTime >= subLines[i].startSec) {
        lastStartedSub = subLines[i];
        break;
      }
    }

    if (lastStartedSub) {
      const name = (lastStartedSub.name || '').toLowerCase();
      const style = (lastStartedSub.style || '').toLowerCase();
      const isSign = SIGN_KEYWORDS.some(k => name.includes(k.toLowerCase()) || style.includes(k.toLowerCase()));

      if (isSign) {
        setCurrentCharacter(null);
        setCurrentSubId(null);
        setCurrentDubberNickname(null);
        setCurrentSubtitleText(null);
        return;
      }

      const aliases: Record<string, string> = JSON.parse(currentEpisode?.project?.characterAliases || '{}');
      const mainName = aliases[lastStartedSub.name] || lastStartedSub.name;
      setCurrentCharacter(mainName);
      setCurrentSubId(lastStartedSub.id || lastStartedSub.index?.toString() || null);
      
      // Find dubber nickname for this character
      const assignment = currentEpisode?.assignments?.find(a => a.characterName.toLowerCase() === mainName.toLowerCase());
      if (assignment) {
        setCurrentDubberNickname(assignment.substitute?.nickname || assignment.dubber?.nickname || null);
      } else {
        setCurrentDubberNickname(null);
      }

      // Only show text if we are within the subtitle duration
      if (currentTime <= lastStartedSub.endSec) {
        setCurrentSubtitleText(lastStartedSub.text);
      } else {
        setCurrentSubtitleText(null);
      }
    } else {
      setCurrentCharacter(null);
      setCurrentDubberNickname(null);
      setCurrentSubtitleText(null);
    }
  }, [currentTime, subLines, currentEpisode?.project?.characterAliases, currentEpisode?.assignments]);

  const handleReassignCharacter = async (newCharacterName: string) => {
    if (!currentEpisode || !currentSubId || !currentEpisode.subPath) return;

    try {
      const lineIndex = parseInt(currentSubId);
      if (isNaN(lineIndex)) return;

      const updates = [{
        rawLineIndex: lineIndex,
        name: newCharacterName
      }];

      await ipcSafe.invoke('save-raw-subtitles', { filePath: currentEpisode.subPath, lines: updates });
      
      // Update local state
      setSubLines(prev => prev.map(l => 
        l.rawLineIndex === lineIndex ? { ...l, name: newCharacterName } : l
      ));
      
      // Update current character immediately
      setCurrentCharacter(newCharacterName);
      
      const assignment = currentEpisode?.assignments?.find(a => a.characterName.toLowerCase() === newCharacterName.toLowerCase());
      if (assignment) {
        setCurrentDubberNickname(assignment.substitute?.nickname || assignment.dubber?.nickname || null);
      } else {
        setCurrentDubberNickname(null);
      }

      toast.success(`Реплика переназначена на ${newCharacterName}`);
    } catch (error) {
      console.error('Reassign character error:', error);
      toast.error('Ошибка при переназначении персонажа');
    }
  };

  const selectedTrack = tracks.find(t => t.id === selectedTrackId);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      if (video.paused) {
        video.play().catch(e => {
          if (e?.name !== 'AbortError') console.error('Video play error:', e);
        });
      } else {
        video.pause();
      }
    } else {
      setIsPlaying(prev => {
        const next = !prev;
        syncAudioSources(currentTime, next);
        return next;
      });
    }
  }, [currentTime, syncAudioSources]);

  const seekToNext = useCallback(() => {
    if (subLines.length === 0) return;

    const nextSub = subLines.find(l => {
      return l.startSec > currentTime + 0.1; // Add a small buffer
    });

    if (nextSub) {
      const nextTime = nextSub.startSec;
      
      if (wavesurferRef.current) {
        wavesurferRef.current.setTime(nextTime);
      }
      if (videoRef.current) {
        videoRef.current.currentTime = nextTime;
      }
      setCurrentTime(nextTime);
    }
  }, [subLines, currentTime]);

  const seekToPrev = useCallback(() => {
    if (subLines.length === 0) return;

    // subLines is sorted by startSec
    let prevSub: SubtitleLine | null = null;
    for (let i = subLines.length - 1; i >= 0; i--) {
      if (subLines[i].startSec < currentTime - 0.25) {
        prevSub = subLines[i];
        break;
      }
    }

    if (!prevSub && subLines.length > 0 && currentTime > subLines[0].startSec + 0.1) {
      prevSub = subLines[0];
    }

    if (prevSub) {
      const prevTime = Math.max(0, prevSub.startSec);
      if (wavesurferRef.current) {
        wavesurferRef.current.setTime(prevTime);
      }
      if (videoRef.current) {
        videoRef.current.currentTime = prevTime;
      }
      setCurrentTime(prevTime);
    }
  }, [subLines, currentTime]);

  useEffect(() => {
    registerPlayer({ togglePlayPause: togglePlay, seekToNext, seekToPrev });
    return () => unregisterPlayer();
  }, [registerPlayer, unregisterPlayer, togglePlay, seekToNext, seekToPrev]);

  const handleAddComment = useCallback(async (textOverride?: string, customTargetDubberId?: string) => {
    const commentText = (textOverride !== undefined ? textOverride : newComment).trim();
    if (!commentText || !currentEpisode) return;

    // Use explicit dubber if provided or if manual override checkbox is on
    const effectiveDubberId = customTargetDubberId || (isManualDubberOverride && manualDubberId ? manualDubberId : null);

    let targetTrackId = effectiveDubberId;

    if (!targetTrackId) {
      // Use selected track if available, otherwise try to auto-detect
      targetTrackId = selectedTrackId === 'all' ? null : selectedTrackId;
    }
    
    const baseDubberId = targetTrackId ? targetTrackId.split('__')[0] : null;
    
    // If we have a detected character, we can use it to find the specific assignment
    // but we should stay on the selected track if it's one of the dubber's roles
    const dubberAssignments = baseDubberId ? (currentEpisode.assignments?.filter(a => (a.substituteId || a.dubberId) === baseDubberId) || []) : [];
    const matchingAssignment = dubberAssignments.find(
      a => currentCharacter && a.characterName.toLowerCase() === currentCharacter.toLowerCase()
    );

    // If no track selected or 'all' selected, try to auto-detect from character
    if (!targetTrackId && currentCharacter) {
      const autoAssignment = currentEpisode.assignments?.find(
        a => a.characterName.toLowerCase() === currentCharacter.toLowerCase()
      );
      if (autoAssignment) {
        targetTrackId = autoAssignment.substituteId || autoAssignment.dubberId;
      }
    }

    if (!targetTrackId) {
      // Fallback: if we have tracks, use the first one
      if (tracks.length > 0) {
        targetTrackId = tracks[0].id;
      } else {
        toast.error("Не удалось определить дабера для фикса. Включите галочку «Указать дабера» и выберите нужного.");
        return;
      }
    }

    const comment: Comment = {
      id: Math.random().toString(36).substr(2, 9),
      text: commentText,
      timestamp: currentTime,
      author: 'Куратор',
      subId: currentSubId || undefined
    };

    const resolvedDubberId = targetTrackId.split('__')[0];

    // Update local state immediately for responsiveness
    const updatedTracks = tracks.map(t => {
      const tBase = t.id.split('__')[0];
      if (t.id === targetTrackId || tBase === resolvedDubberId) {
        return { 
          ...t, 
          comments: [...t.comments, comment],
          status: 'fixes_needed' as const
        };
      }
      return t;
    });
    
    setTracks(updatedTracks);
    if (!textOverride) setNewComment('');

    // Save to DB
    try {
      const targetDubberAssignments = currentEpisode.assignments?.filter(a => (a.substituteId || a.dubberId) === resolvedDubberId) || [];
      const bestAssignmentMatch = targetDubberAssignments.find(
        a => currentCharacter && a.characterName.toLowerCase() === currentCharacter.toLowerCase()
      ) || targetDubberAssignments[0];

      if (!bestAssignmentMatch) {
        toast.warning('Правка сохранена в дорожку (роль дабера в назначениях не найдена)');
        return;
      }

      const updatedAssignments = currentEpisode.assignments?.map(a => {
        if (a.id === bestAssignmentMatch.id) {
          let existingComments: Comment[] = [];
          try {
            existingComments = JSON.parse(a.comments || '[]');
          } catch (e) {}
          
          return { 
            ...a, 
            comments: JSON.stringify([...existingComments, comment]),
            status: 'FIXES_NEEDED'
          };
        }
        return a;
      }) || [];

      await ipcSafe.invoke('save-episode', { 
        ...currentEpisode, 
        assignments: updatedAssignments,
        status: currentEpisode.status === 'FINISHED' ? 'FINISHED' : 'FIXES'
      });
      const dubberNick = bestAssignmentMatch.substitute?.nickname || bestAssignmentMatch.dubber?.nickname || bestAssignmentMatch.characterName;
      toast.success(`Правка успешно выписана дабберу «${dubberNick}»!`);
      onRefresh();
    } catch (error) {
      console.error('Save comment error:', error);
      toast.error('Ошибка сохранения правки в БД');
    }
  }, [newComment, currentEpisode, selectedTrackId, tracks, currentCharacter, currentTime, currentSubId, isManualDubberOverride, manualDubberId, onRefresh]);

  const detectSilence = async () => {
    if (!wavesurferRef.current || !regionsRef.current) return;
    
    setIsAnalyzingSilence(true);
    regionsRef.current.clearRegions();
    
    try {
      const buffer = wavesurferRef.current.getDecodedData();
      if (!buffer) return;
      
      const channelData = buffer.getChannelData(0);
      const sampleRate = buffer.sampleRate;
      const silenceRegions: { start: number; end: number }[] = [];
      
      let isSilence = false;
      let silenceStart = 0;
      
      // Analyze in chunks for performance
      const chunkSize = Math.floor(sampleRate * 0.1); // 100ms chunks
      for (let i = 0; i < channelData.length; i += chunkSize) {
        let maxAmp = 0;
        for (let j = 0; j < chunkSize && i + j < channelData.length; j++) {
          maxAmp = Math.max(maxAmp, Math.abs(channelData[i + j]));
        }
        
        const time = i / sampleRate;
        
        if (maxAmp < silenceThreshold) {
          if (!isSilence) {
            isSilence = true;
            silenceStart = time;
          }
        } else {
          if (isSilence) {
            isSilence = false;
            // Only count as silence if it's longer than 0.5s
            if (time - silenceStart > 0.5) {
              silenceRegions.push({ start: silenceStart, end: time });
            }
          }
        }
      }
      
      // Add regions to wavesurfer
      silenceRegions.forEach(region => {
        regionsRef.current.addRegion({
          start: region.start,
          end: region.end,
          color: 'rgba(255, 0, 0, 0.2)',
          drag: false,
          resize: false,
          content: 'Silence'
        });
      });
      
    } catch (e) {
      console.error('Silence detection error', e);
    } finally {
      setIsAnalyzingSilence(false);
    }
  };

  // Hotkeys for instant edit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'KeyF') { // 'F' for Fix
        e.preventDefault();
        const text = currentSubtitleText ? `Правка: ${currentSubtitleText}` : 'Правка';
        handleAddComment(text);
      }
      
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }

      if ((e.code === 'ArrowRight' && (e.altKey || e.ctrlKey || e.shiftKey)) || ((e.code === 'KeyD' || e.code === 'KeyN') && (e.altKey || e.shiftKey))) {
        e.preventDefault();
        seekToNext();
      }

      if ((e.code === 'ArrowLeft' && (e.altKey || e.ctrlKey || e.shiftKey)) || ((e.code === 'KeyA' || e.code === 'KeyP') && (e.altKey || e.shiftKey))) {
        e.preventDefault();
        seekToPrev();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentTime, currentSubtitleText, currentSubId, togglePlay, handleAddComment, seekToNext, seekToPrev]);

  // Sync wavesurfer with video when scrubbing
  useEffect(() => {
    if (!wavesurferRef.current || isPlaying) return;
    
    const wsTime = wavesurferRef.current.getCurrentTime();
    if (Math.abs(wsTime - currentTime) > 0.05) {
      wavesurferRef.current.setTime(currentTime);
    }
  }, [currentTime, isPlaying]);

  const handlePause = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.pause();
    } else {
      setIsPlaying(false);
      syncAudioSources(currentTime, false);
    }
  }, [currentTime, syncAudioSources]);

  const handleStop = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
    syncAudioSources(0, false);
  }, [syncAudioSources]);

  const handleGenerateFixesMessage = () => {
    if (!currentEpisode) return;
    try {
      const msg = generateFixesIssuedMessage(currentEpisode, participants);
      setIsMessageCopied(false);
      if (msg) {
        setGeneratedMessage(msg);
        setIsMessageModalOpen(true);
      } else {
        setGeneratedMessage(`✏️ ВЫПИСАНЫ ФИКСЫ: ${currentEpisode.project?.title}\n👾 Серия: ${currentEpisode.number}\n\n✅ Фиксов не обнаружено! Все даберы молодцы! ✨`);
        setIsMessageModalOpen(true);
      }
    } catch (e: any) {
      console.error('Failed to generate fixes message:', e);
      toast.error('Ошибка генерации выписки фиксов: ' + (e?.message || String(e)));
    }
  };

  const handleOpenScanConfig = () => {
    if (!currentEpisode) return;
    if (subLines.length === 0) {
      toast.error('Субтитры еще не загружены или отсутствуют в серии');
      return;
    }
    const dubberTracks = tracks.filter(t => t.id !== 'original' && t.files.length > 0);
    if (dubberTracks.length === 0) {
      toast.error('Нет загруженных аудиодорожек даберов для анализа');
      return;
    }

    // If we already have scanned gaps for this episode, open the QA Center directly!
    if (detectedGaps && detectedGaps.length > 0) {
      setIsGapModalOpen(true);
      return;
    }

    setIsScanConfigModalOpen(true);
  };

  const handleExecuteGapDetection = async (overrideOptions?: GapDetectionOptions) => {
    if (!currentEpisode) return;
    if (subLines.length === 0) {
      toast.error('Субтитры еще не загружены или отсутствуют в серии');
      return;
    }
    const dubberTracks = tracks.filter(t => t.id !== 'original' && t.files.length > 0);
    if (dubberTracks.length === 0) {
      toast.error('Нет загруженных аудиодорожек даберов для анализа');
      return;
    }

    const optionsToUse: GapDetectionOptions = overrideOptions || gapScanOptions;
    const thresholdToUse = optionsToUse.speechDynamicThresholdDb ?? gapSensitivityThreshold;
    setGapSensitivityThreshold(thresholdToUse);
    setGapScanOptions(optionsToUse);

    setIsAnalyzingGaps(true);
    try {
      const activeModes: string[] = [];
      if (optionsToUse.scanMissingLines) activeModes.push('пропуски');
      if (optionsToUse.scanCollisions) activeModes.push('конфликты');
      if (optionsToUse.scanOverlaps) activeModes.push('наезды хвостов');
      if (optionsToUse.scanTimingMismatches) activeModes.push('тайминги');
      if (optionsToUse.scanArtifacts) activeModes.push('артефакты');
      if (optionsToUse.scanWhisperText) activeModes.push(`Whisper (${optionsToUse.whisperModel || 'small'})`);

      toast.info(`Запуск QA анализа [${activeModes.join(', ')}]...`);
      const gaps = await detectEpisodeGaps(
        currentEpisode,
        tracks,
        subLines,
        optionsToUse,
        (current, total, msg) => {
          // Progress feedback
        }
      );

      setDetectedGaps(gaps);
      if (currentEpisode?.id) {
        try {
          localStorage.setItem(`qa_detected_gaps_${currentEpisode.id}`, JSON.stringify(gaps));
          if ((gaps as any)?.scanReport) {
            localStorage.setItem(`qa_scan_report_${currentEpisode.id}`, JSON.stringify((gaps as any).scanReport));
          }
          // Automatically synchronize with Timing Video passport on disk and state
          saveQAGapsToTimingProject(currentEpisode, gaps, tracks).catch(err => {
            console.warn('Auto-save to timing project error:', err);
          });
        } catch (storageErr) {
          console.warn('Failed to persist QA gaps to localStorage:', storageErr);
        }
      }

      if ((gaps as any)?.scanReport) {
        setQaScanReport((gaps as any).scanReport);
      }
      setIsGapModalOpen(true);

      const missing = gaps.filter(g => (g.defectCategory || 'missing_line') === 'missing_line').length;
      const unwanted = gaps.filter(g => g.defectCategory === 'unwanted_speech').length;
      const collisions = gaps.filter(g => g.defectCategory === 'actor_collision').length;
      const overlaps = gaps.filter(g => g.defectCategory === 'actor_overlap').length;
      const artifacts = gaps.filter(g => g.defectCategory === 'audio_artifact').length;
      const textMismatches = gaps.filter(g => g.defectCategory === 'text_mismatch').length;

      if (gaps.length === 0) {
        toast.success('✨ Замечаний не обнаружено! Все реплики озвучены корректно.');
      } else {
        toast.warning(
          `Найдено замечаний: ${gaps.length}` +
          (missing ? ` • Пропусков: ${missing}` : '') +
          (collisions ? ` • Конфликтов: ${collisions}` : '') +
          (overlaps ? ` • Наездов: ${overlaps}` : '') +
          (artifacts ? ` • Артефактов: ${artifacts}` : '') +
          (textMismatches ? ` • Расхождений текста: ${textMismatches}` : '')
        );
      }
    } catch (e: any) {
      console.error('Gap detection failed:', e);
      toast.error(`Ошибка анализа косяков: ${e?.message || e}`);
    } finally {
      setIsAnalyzingGaps(false);
    }
  };

  const handleRunGapDetection = async (overrideThreshold?: number) => {
    const updatedOptions: GapDetectionOptions = {
      ...gapScanOptions,
      speechDynamicThresholdDb: typeof overrideThreshold === 'number' ? overrideThreshold : gapScanOptions.speechDynamicThresholdDb
    };
    await handleExecuteGapDetection(updatedOptions);
  };

  const {
    handleApplyGapFixes,
    handleGenerateReminderMessage,
    handleGenerateSoundEngineerReport,
    handleExportSoundEngineer,
    handleBakeSubtitles
  } = useQAGapFixApplier({
    currentEpisode,
    tracks,
    setTracks,
    subLines,
    setSubLines,
    participants,
    detectedGaps,
    setDetectedGaps,
    setIsApplyingGapFixes,
    setIsGapModalOpen,
    setGeneratedMessage,
    setIsMessageCopied,
    setIsMessageModalOpen,
    setIsExportModalOpen,
    setIsBaking,
    setBakeProgress,
    setBakeStatus,
    handleGenerateFixesMessage,
    onRefresh
  });
  const handleDeleteComment = async (trackId: string, commentId: string) => {
    if (!currentEpisode) return;

    const updatedTracks = tracks.map(t => 
      t.id === trackId ? { ...t, comments: t.comments.filter(c => c.id !== commentId) } : t
    );
    
    setTracks(updatedTracks);

    try {
      // Remove comment from all assignments of this dubber (since we don't know which one it was on exactly)
      const updatedAssignments = currentEpisode.assignments?.map(a => {
        const assignedId = a.substituteId || a.dubberId;
        if (assignedId === trackId) {
          let existingComments: Comment[] = [];
          try {
            existingComments = JSON.parse(a.comments || '[]');
          } catch (e) {}
          const filtered = existingComments.filter(c => c.id !== commentId);
          return { ...a, comments: JSON.stringify(filtered) };
        }
        return a;
      }) || [];

      await ipcSafe.invoke('save-episode', { 
        ...currentEpisode, 
        assignments: updatedAssignments 
      });
      onRefresh();
    } catch (error) {
      console.error('Delete comment error:', error);
    }
  };

  const handleApproveAll = async () => {
    if (!currentEpisode) return;

    setConfirmState({
      isOpen: true,
      title: 'Одобрить все дорожки',
      message: 'Одобрить ВСЕ дорожки в этом эпизоде?',
      onConfirm: async () => {
        try {
          const updatedAssignments = currentEpisode.assignments?.map(a => ({
            ...a,
            status: 'APPROVED'
          })) || [];

          await ipcSafe.invoke('save-episode', { 
            ...currentEpisode, 
            assignments: updatedAssignments,
            status: 'SOUND_ENGINEERING'
          });

          onRefresh();
          toast.success('Все дорожки одобрены');
        } catch (error) {
          console.error('Approve all error:', error);
          toast.error('Ошибка при одобрении дорожек');
        }
      }
    });
  };

  const handleStatusChange = async (id: string, status: Track['status']) => {
    if (!currentEpisode) return;
    
    // Convert Track status back to RoleAssignment status
    const dbStatus = status.toUpperCase();
    
    try {
      const updatedAssignments = currentEpisode.assignments?.map(a => {
        const assignedId = a.substituteId || a.dubberId;
        const normNick = normalizeKey(a.substitute?.nickname || a.dubber?.nickname || '');
        const rawTrackId = id.replace(/^track_/, '').split('_')[0];
        const normTrackId = normalizeKey(rawTrackId);
        const isMatch = (assignedId && (assignedId === id || id.startsWith(assignedId + '__'))) || (normNick && normNick === normTrackId);
        return isMatch ? { ...a, status: dbStatus } : a;
      }) || [];

      // Check if all assignments are approved
      const allApproved = updatedAssignments.every(a => a.status === 'APPROVED');
      const needsFixes = dbStatus === 'FIXES_NEEDED' || dbStatus === 'REJECTED';

      let newStatus = currentEpisode.status;
      if (allApproved) {
        newStatus = 'SOUND_ENGINEERING';
      } else if (needsFixes && currentEpisode.status !== 'FIXES') {
        newStatus = 'FIXES';
      }

      await ipcSafe.invoke('save-episode', { 
        ...currentEpisode, 
        assignments: updatedAssignments,
        status: newStatus
      });

      onRefresh();
    } catch (error) {
      console.error('Status update error:', error);
    }
  };

  const handleFileUpload = async (e: any, trackId: string, type: 'DUBBER_FILE' | 'FIXES' = 'DUBBER_FILE') => {
    const file = e.target.files?.[0];
    if (!file || !currentEpisode) return;

    // Find one of the assignments for this dubber to link the upload to
    const parts = trackId.split('__');
    const baseDubberId = parts[0];
    const rawNickKey = normalizeKey(trackId.replace(/^track_/, '').split('_')[0]);

    const assignment = currentEpisode.assignments?.find(a => {
      const aDubberId = a.substituteId || a.dubberId;
      if (aDubberId && (aDubberId === baseDubberId || aDubberId === trackId)) return true;
      const aNick = normalizeKey(a.substitute?.nickname || a.dubber?.nickname || '');
      return aNick && (aNick === rawNickKey || aNick === normalizeKey(baseDubberId));
    });
    if (!assignment) return;

    const projectTitle = sanitizeFolderName(currentEpisode.project?.title || 'Project');
    const episodeFolder = sanitizeFolderName(`Episode_${currentEpisode.number}`);
    const subDir = `${projectTitle}/${episodeFolder}/${type === 'FIXES' ? 'Fixes' : 'QAFixes'}`;
    const prefix = type === 'FIXES' ? 'fix' : 'dub';
    const fileName = `${prefix}_${assignment.id}_${Date.now()}.${file.name.split('.').pop() || 'wav'}`;
    
    try {
      let res;
      if (file.path) {
        res = await ipcSafe.invoke('copy-file', {
          sourcePath: file.path,
          targetDir: subDir,
          fileName
        });
      } else {
        // Browser fallback: read as buffer to avoid "src argument must be string" error
        const buffer = await file.arrayBuffer();
        res = await ipcSafe.invoke('save-file-buffer', {
          buffer,
          targetDir: subDir,
          fileName
        });
      }
      
      if (!res || !res.path) throw new Error("Не удалось получить путь сохранения файла");
      
      const newUpload = {
        id: Math.random().toString(36).substr(2, 9),
        episodeId: currentEpisode.id,
        type,
        isFix: type === 'FIXES',
        targetTrackId: trackId,
        path: res.path,
        uploadedById: baseDubberId,
        assignmentId: assignment.id,
        createdAt: new Date().toISOString(),
        size: file.size || res.size || 0
      };

      const updatedUploads = [...(currentEpisode.uploads || []), newUpload];
      
      const updatedAssignments = currentEpisode.assignments?.map(a => 
        (a.substituteId || a.dubberId) === baseDubberId ? { ...a, status: 'RECORDED' } : a
      ) || [];

      // Check if all assignments are recorded or approved
      const allRecorded = updatedAssignments.every(a => 
        a.status === 'RECORDED' || a.status === 'APPROVED'
      );
      
      let newStatus = currentEpisode.status;
      if (allRecorded && (currentEpisode.status === 'FIXES' || currentEpisode.status === 'RECORDING')) {
        newStatus = 'QA';
      }
      
      await ipcSafe.invoke('save-episode', { 
        ...currentEpisode, 
        uploads: updatedUploads,
        assignments: updatedAssignments,
        status: newStatus
      });

      // Pre-calculate audio analysis sidecar passport in background so Timing & Mixing load instantly
      if (res && res.path) {
        try {
          await ipcSafe.invoke('audio-run-track-analysis', {
            audioPath: res.path,
            options: {
              skipWhisper: true,
              isFix: type === 'FIXES',
              dubberNick: (assignment as any)?.dubber?.nickname || (assignment as any)?.dubber?.username || (assignment as any)?.dubber?.name || baseDubberId,
              characterName: (assignment as any)?.character?.name || (assignment as any)?.characterName || 'Персонаж'
            }
          });
        } catch (err) {
          console.warn('[QA] Pre-analysis sidecar calculation warning:', err);
        }
      }
      
      onRefresh();
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Upload error:', error);
        toast.error('Ошибка загрузки: ' + (error.message || String(error)));
      }
    }
  };

  const handleFileDelete = async (trackId: string, fileId: string) => {
    if (!currentEpisode) return;
    if (fileId === 'orig') return;

    setConfirmState({
      isOpen: true,
      title: 'Удалить загруженный файл?',
      message: 'Вы уверены, что хотите удалить этот файл? Это действие нельзя отменить.',
      variant: 'danger',
      onConfirm: async () => {
        try {
          const uploads = currentEpisode.uploads || [];
          const uploadToDelete = uploads.find(u => u.id === fileId);
          if (!uploadToDelete) return;
          
          const updatedUploads = uploads.filter(u => u.id !== fileId);
          
          // Check if this dubber has any files left
          const baseDubberId = trackId.split('__')[0];
          const dubberFilesRemaining = updatedUploads.some(u => 
            u.uploadedById === baseDubberId || 
            (u.assignmentId && currentEpisode.assignments?.find(a => a.id === u.assignmentId && (a.substituteId || a.dubberId) === baseDubberId))
          );
          
          let updatedAssignments = currentEpisode.assignments;
          let newEpisodeStatus = currentEpisode.status;
          
          if (!dubberFilesRemaining && currentEpisode.assignments) {
            updatedAssignments = currentEpisode.assignments.map(a => 
              (a.substituteId || a.dubberId) === baseDubberId ? { ...a, status: 'PENDING' } : a
            );
            
            // If the episode was in QA but we now have pending assignments, move back to RECORDING
            // Wait, if it's already FIXES or something, don't move it back. Only move back if QA.
            if (currentEpisode.status === 'QA') {
              newEpisodeStatus = 'RECORDING';
            }
          }
          
          await ipcSafe.invoke('save-episode', { 
            ...currentEpisode, 
            uploads: updatedUploads,
            ...(updatedAssignments !== currentEpisode.assignments && { assignments: updatedAssignments, status: newEpisodeStatus })
          });
          
          if (uploadToDelete.path && !uploadToDelete.path.startsWith('http')) {
             try {
               await ipcSafe.invoke('delete-file', uploadToDelete.path);
             } catch(e) {
               console.warn("Could not delete file from disk:", e);
             }
          }
          
          onRefresh();
          setConfirmState(prev => ({ ...prev, isOpen: false }));
        } catch (error: any) {
          toast.error('Ошибка при удалении: ' + error.message);
          setConfirmState(prev => ({ ...prev, isOpen: false }));
        }
      }
    });
  };

  if (!currentEpisode) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500">
        Выберите серию в Дашборде для проверки качества
      </div>
    );
  }

  return (
    <>
    <div className="flex h-full bg-neutral-950 overflow-hidden w-full">
        <TrackSidebar 
          tracks={tracks}
          selectedTrackId={selectedTrackId}
          episodeId={currentEpisode.id}
          setSelectedTrackId={setSelectedTrackId}
          handleApproveAll={handleApproveAll}
          handleFileUpload={handleFileUpload}
          handleFileDelete={handleFileDelete}
          setTracks={setTracks}
          onGenerateFixesMessage={handleGenerateFixesMessage}
          onGenerateReminderMessage={handleGenerateReminderMessage}
          onExportSoundEngineer={() => setIsExportModalOpen(true)}
          onOpenTimingPanel={async () => {
            if (currentEpisode && detectedGaps.length > 0) {
              await saveQAGapsToTimingProject(currentEpisode, detectedGaps, tracks).catch(() => {});
            }
            onNavigate?.('timing');
          }}
          onSaveToTiming={async () => {
            if (!currentEpisode) return;
            try {
              const res = await saveQAGapsToTimingProject(currentEpisode, detectedGaps, tracks);
              toast.success(
                `✓ Записано в файл тайминга! (Наездов: ${res.summary.overlapsCount}, коллизий: ${res.summary.collisionsCount}, рассинхронов: ${res.summary.desyncCount})`
              );
            } catch (err: any) {
              toast.error('Ошибка записи в тайминг: ' + (err?.message || String(err)));
            }
          }}
          onGenerateSoundEngineerReport={handleGenerateSoundEngineerReport}
          onBakeSubtitles={handleBakeSubtitles}
          isBaking={isBaking}
          bakeProgress={bakeProgress}
          bakeStatus={bakeStatus}
          isAutoNormalize={isAutoNormalize}
          onToggleAutoNormalize={toggleAutoNormalize}
          normalizationMetrics={normalizationMetrics}
          onOpenGapDetection={handleOpenScanConfig}
          isAnalyzingGaps={isAnalyzingGaps}
          detectedGapsCount={detectedGaps.length}
          gapsByTrack={gapsByTrack}
          isSplitMultiTracks={isSplitMultiTracks}
          onToggleSplitMultiTracks={toggleSplitMultiTracks}
        />

      <QAPlayerAndModalsView
        currentEpisode={currentEpisode}
        tracks={tracks}
        selectedTrackId={selectedTrackId}
        selectedTrack={selectedTrack}
        videoRef={videoRef}
        videoUrl={videoUrl}
        handleVideoPlay={handleVideoPlay}
        handleVideoPause={handleVideoPause}
        handleVideoTimeUpdate={handleVideoTimeUpdate}
        handleVideoSeeking={handleVideoSeeking}
        handleVideoEnded={handleVideoEnded}
        duration={duration}
        setDuration={setDuration}
        currentTime={currentTime}
        setCurrentTime={setCurrentTime}
        handleSeekToTime={handleSeekToTime}
        isPlaying={isPlaying}
        togglePlay={togglePlay}
        seekToNext={seekToNext}
        seekToPrev={seekToPrev}
        isManualDubberOverride={isManualDubberOverride}
        setIsManualDubberOverride={setIsManualDubberOverride}
        manualDubberId={manualDubberId}
        setManualDubberId={setManualDubberId}
        handleStop={handleStop}
        handlePause={handlePause}
        isAutoNormalize={isAutoNormalize}
        toggleAutoNormalize={toggleAutoNormalize}
        originalVolume={originalVolume}
        setOriginalVolume={setOriginalVolume}
        normalizationMetrics={normalizationMetrics}
        volumes={volumes}
        setVolumes={setVolumes}
        currentCharacter={currentCharacter}
        currentDubberNickname={currentDubberNickname}
        currentSubtitleText={currentSubtitleText}
        handleReassignCharacter={handleReassignCharacter}
        newComment={newComment}
        setNewComment={setNewComment}
        handleAddComment={handleAddComment}
        detectSilence={detectSilence}
        isAnalyzingSilence={isAnalyzingSilence}
        handleStatusChange={handleStatusChange}
        isMuted={isMuted}
        setIsMuted={setIsMuted}
        handleDeleteComment={handleDeleteComment}
        mutedTracks={mutedTracks}
        setMutedTracks={setMutedTracks}
        subLines={subLines}
        commentModal={commentModal}
        setCommentModal={setCommentModal}
        wavesurferRef={wavesurferRef}
        isScanConfigModalOpen={isScanConfigModalOpen}
        setIsScanConfigModalOpen={setIsScanConfigModalOpen}
        gapScanOptions={gapScanOptions}
        setGapScanOptions={setGapScanOptions}
        handleExecuteGapDetection={handleExecuteGapDetection}
        isGapModalOpen={isGapModalOpen}
        setIsGapModalOpen={setIsGapModalOpen}
        detectedGaps={detectedGaps}
        participants={participants}
        onNavigate={onNavigate}
        handleApplyGapFixes={handleApplyGapFixes}
        isApplyingGapFixes={isApplyingGapFixes}
        handleRunGapDetection={handleRunGapDetection}
        isAnalyzingGaps={isAnalyzingGaps}
        gapSensitivityThreshold={gapSensitivityThreshold}
        qaScanReport={qaScanReport}
        handleUpdateSubLineFromModal={handleUpdateSubLineFromModal}
        handleExportSubtitlesFromModal={handleExportSubtitlesFromModal}
        handleSaveDetectedGaps={handleSaveDetectedGaps}
        isExportModalOpen={isExportModalOpen}
        setIsExportModalOpen={setIsExportModalOpen}
        handleExportSoundEngineer={handleExportSoundEngineer}
        isUploading={isUploading}
        isMessageModalOpen={isMessageModalOpen}
        setIsMessageModalOpen={setIsMessageModalOpen}
        generatedMessage={generatedMessage}
        isMessageCopied={isMessageCopied}
        setIsMessageCopied={setIsMessageCopied}
        isBaking={isBaking}
        bakeProgress={bakeProgress}
        bakeStatus={bakeStatus}
        confirmState={confirmState}
        setConfirmState={setConfirmState}
      />
    </div>
    </>
  );
}
