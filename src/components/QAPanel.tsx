import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Play, Pause, CheckCircle, XCircle, AlertCircle, MessageSquare, Volume2, Check, X, Activity, User, Clock, FileAudio, Send, Video, Trash2, Mic, Sparkles, Save, SkipForward, Scissors, Zap, VolumeX, Volume1, Sliders, Info } from 'lucide-react';
import { toast } from 'sonner';
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
import { detectEpisodeGaps, MissingLineDetection, silenceAudioBufferInterval, GapDetectionOptions } from '../lib/qa/missingLinesDetector';
import { QAScanConfigModal } from './qa/QAScanConfigModal';
import { getSharedAudioContext, ensureAudioContextResumed } from '../lib/qa/sharedAudioContext';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';

interface QAPanelProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
}

export default function QAPanel({ currentEpisode, onRefresh }: QAPanelProps) {
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
          const { resolveLocalPath } = await import('../lib/webFileSystem');
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

  const handleVideoTimeUpdate = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const time = e.currentTarget.currentTime;
    setCurrentTime(time);

    if (!e.currentTarget.paused) {
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

      analyzeAudioForPreview(audioUrl, cacheKey).then(metrics => {
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
    ).map(u => ({ id: u.id, path: u.path, createdAt: u.createdAt, type: u.type })) || [];
      
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
    
    const mappedTracks = Object.values(dubberTracks);
    
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
  }, [currentEpisode]);

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

  useEffect(() => {
    registerPlayer({ togglePlayPause: togglePlay, seekToNext });
    return () => unregisterPlayer();
  }, [registerPlayer, unregisterPlayer, togglePlay, seekToNext]);

  const handleAddComment = useCallback(async (textOverride?: string) => {
    const commentText = textOverride || newComment;
    if (!commentText.trim() || !currentEpisode) return;

    // Use selected track if available, otherwise try to auto-detect
    let targetTrackId = selectedTrackId === 'all' ? null : selectedTrackId;
    
    // If we have a detected character, we can use it to find the specific assignment
    // but we should stay on the selected track if it's one of the dubber's roles
    const dubberAssignments = targetTrackId ? (currentEpisode.assignments?.filter(a => (a.substituteId || a.dubberId) === targetTrackId) || []) : [];
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
        toast.error("Не удалось определить дабера для фикса. Выберите дорожку вручную.");
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

    // Update local state immediately for responsiveness
    const updatedTracks = tracks.map(t => 
      t.id === targetTrackId ? { 
        ...t, 
        comments: [...t.comments, comment],
        status: 'fixes_needed' as const
      } : t
    );
    
    setTracks(updatedTracks);
    if (!textOverride) setNewComment('');

    // Save to DB
    try {
      // Determine which assignment to attach the comment to
      // If the dubber has multiple roles, we try to match the current character,
      // otherwise we use the first assignment of that dubber.
      const targetDubberAssignments = currentEpisode.assignments?.filter(a => (a.substituteId || a.dubberId) === targetTrackId) || [];
      const bestAssignmentMatch = targetDubberAssignments.find(
        a => currentCharacter && a.characterName.toLowerCase() === currentCharacter.toLowerCase()
      ) || targetDubberAssignments[0];

      if (!bestAssignmentMatch) return;

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
      onRefresh();
    } catch (error) {
      console.error('Save comment error:', error);
    }
  }, [newComment, currentEpisode, selectedTrackId, tracks, currentCharacter, currentTime, currentSubId, onRefresh]);

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
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentTime, currentSubtitleText, currentSubId, togglePlay, handleAddComment]);

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
    const msg = generateFixesIssuedMessage(currentEpisode, participants);
    if (msg) {
      setGeneratedMessage(msg);
      setIsMessageModalOpen(true);
    } else {
      setGeneratedMessage(`✏️ ВЫПИСАНЫ ФИКСЫ: ${currentEpisode.project?.title}\n👾 Серия: ${currentEpisode.number}\n\n✅ Фиксов не обнаружено! Все даберы молодцы! ✨`);
      setIsMessageModalOpen(true);
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

  const handleApplyGapFixes = async (selectedGaps: MissingLineDetection[]) => {
    if (!currentEpisode || selectedGaps.length === 0) return;

    setIsApplyingGapFixes(true);
    try {
      const commentsByTrackId: Record<string, Comment[]> = {};
      const commentsByAssignmentId: Record<string, Comment[]> = {};
      const intervalsToSilenceByFilePath: Record<string, { startSec: number; endSec: number }[]> = {};
      const subUpdates: { rawLineIndex: number; name?: string; text?: string }[] = [];

      const getFilePathForTrack = (trackId: string): string | null => {
        const trk = tracks.find(t => t.id === trackId);
        const fl = trk?.files.find(f => f.id === trk.selectedFileId) || trk?.files[0];
        return fl?.path || null;
      };

      selectedGaps.forEach(gap => {
        const category = gap.defectCategory || 'missing_line';

        // 1. Missing line handling
        if (category === 'missing_line') {
          // Check if this missing line is a subtitle misattribution error reassigned to another character
          if (gap.resolutionAction === 'reassign_character' || gap.isSubtitleError || gap.reassignedCharacterName) {
            const targetCharName = (gap.reassignedCharacterName || gap.selectedCharacterForSub || '').trim();
            if (targetCharName && typeof gap.lineIndex === 'number') {
              subUpdates.push({ rawLineIndex: gap.lineIndex, name: targetCharName });
            }

            // Find target assignment for the new character
            const targetAssignment = currentEpisode.assignments?.find(
              a => a.characterName.toLowerCase().trim() === targetCharName.toLowerCase()
            );

            // Find target track (by character name or by dubber/substitute ID)
            const targetTrack = tracks.find(
              t => t.character?.toLowerCase().trim() === targetCharName.toLowerCase() ||
                   (targetAssignment && (t.id === targetAssignment.substituteId || t.id === targetAssignment.dubberId))
            );

            const targetTrackId = targetTrack?.id || (targetAssignment ? (targetAssignment.substituteId || targetAssignment.dubberId) : null);

            const commentText = gap.comment || (
              `[Ошибка в субтитрах] Реплика [${gap.startFormatted}]: "${gap.text}". ` +
              `В исходных субтитрах эта фраза ошибочно числилась за персонажем ${gap.characterName}, ` +
              `поэтому отсутствовала в вашем исходном скрипте. Пожалуйста, доозвучьте!`
            );

            const comment: Comment = {
              id: Math.random().toString(36).substr(2, 9),
              text: commentText,
              timestamp: gap.startSec,
              author: 'Куратор (Сабы/Авто)',
              subId: gap.subId
            };

            // Route the fix task to the correct dubber
            if (targetTrackId) {
              if (!commentsByTrackId[targetTrackId]) commentsByTrackId[targetTrackId] = [];
              commentsByTrackId[targetTrackId].push(comment);
            }

            if (targetAssignment) {
              if (!commentsByAssignmentId[targetAssignment.id]) commentsByAssignmentId[targetAssignment.id] = [];
              commentsByAssignmentId[targetAssignment.id].push(comment);
            } else if (targetCharName) {
              const syntheticAssId = `new_ass_${targetCharName.toLowerCase()}`;
              if (!commentsByAssignmentId[syntheticAssId]) commentsByAssignmentId[syntheticAssId] = [];
              commentsByAssignmentId[syntheticAssId].push(comment);
            }

            // Notice: The previous dubber (gap.trackId / gap.assignmentId) gets NO fix or penalty,
            // because they rightly didn't voice someone else's line!
            return;
          }

          const comment: Comment = {
            id: Math.random().toString(36).substr(2, 9),
            text: gap.comment || `Пропуск реплики [${gap.startFormatted}]: "${gap.text}"`,
            timestamp: gap.startSec,
            author: 'Куратор (Авто)',
            subId: gap.subId
          };

          if (!commentsByTrackId[gap.trackId]) commentsByTrackId[gap.trackId] = [];
          commentsByTrackId[gap.trackId].push(comment);

          if (gap.assignmentId) {
            if (!commentsByAssignmentId[gap.assignmentId]) commentsByAssignmentId[gap.assignmentId] = [];
            commentsByAssignmentId[gap.assignmentId].push(comment);
          }
        }

        // 2. Unwanted speech outside subtitles
        else if (category === 'unwanted_speech') {
          if (gap.resolutionAction === 'silence') {
            if (gap.audioBuffer) {
              silenceAudioBufferInterval(gap.audioBuffer, gap.startSec, gap.endSec);
            }
            const filePath = getFilePathForTrack(gap.trackId);
            if (filePath) {
              if (!intervalsToSilenceByFilePath[filePath]) intervalsToSilenceByFilePath[filePath] = [];
              intervalsToSilenceByFilePath[filePath].push({ startSec: gap.startSec, endSec: gap.endSec });
            }

            const comment: Comment = {
              id: Math.random().toString(36).substr(2, 9),
              text: gap.comment || `Лишняя речь вне сабов [${gap.startFormatted} - ${gap.endFormatted}]: заменена тишиной`,
              timestamp: gap.startSec,
              author: 'Куратор (Авто)',
              subId: gap.subId
            };

            if (!commentsByTrackId[gap.trackId]) commentsByTrackId[gap.trackId] = [];
            commentsByTrackId[gap.trackId].push(comment);
          }
        }

        // 3. Dubber collisions
        else if (category === 'actor_collision') {
          if (gap.resolutionAction === 'fix_subs') {
            const targetName = gap.selectedCharacterForSub || gap.characterName;
            if (targetName && typeof gap.lineIndex === 'number') {
              subUpdates.push({ rawLineIndex: gap.lineIndex, name: targetName });
            }
          } else if (gap.resolutionAction === 'keep_first') {
            if (gap.secondTrackId) {
              if (gap.secondAudioBuffer) {
                silenceAudioBufferInterval(gap.secondAudioBuffer, gap.startSec, gap.endSec);
              }
              const filePath = getFilePathForTrack(gap.secondTrackId);
              if (filePath) {
                if (!intervalsToSilenceByFilePath[filePath]) intervalsToSilenceByFilePath[filePath] = [];
                intervalsToSilenceByFilePath[filePath].push({ startSec: gap.startSec, endSec: gap.endSec });
              }
              const comment: Comment = {
                id: Math.random().toString(36).substr(2, 9),
                text: `Дублирование реплики #${(gap.lineIndex ?? 0) + 1} заменено тишиной (реплика отдана ${gap.dubberName})`,
                timestamp: gap.startSec,
                author: 'Куратор (Авто)',
                subId: gap.subId
              };
              if (!commentsByTrackId[gap.secondTrackId]) commentsByTrackId[gap.secondTrackId] = [];
              commentsByTrackId[gap.secondTrackId].push(comment);
            }
          } else if (gap.resolutionAction === 'keep_second') {
            if (gap.trackId) {
              if (gap.audioBuffer) {
                silenceAudioBufferInterval(gap.audioBuffer, gap.startSec, gap.endSec);
              }
              const filePath = getFilePathForTrack(gap.trackId);
              if (filePath) {
                if (!intervalsToSilenceByFilePath[filePath]) intervalsToSilenceByFilePath[filePath] = [];
                intervalsToSilenceByFilePath[filePath].push({ startSec: gap.startSec, endSec: gap.endSec });
              }
              const comment: Comment = {
                id: Math.random().toString(36).substr(2, 9),
                text: `Дублирование реплики #${(gap.lineIndex ?? 0) + 1} заменено тишиной (реплика отдана ${gap.secondDubberName || 'второму даберу'})`,
                timestamp: gap.startSec,
                author: 'Куратор (Авто)',
                subId: gap.subId
              };
              if (!commentsByTrackId[gap.trackId]) commentsByTrackId[gap.trackId] = [];
              commentsByTrackId[gap.trackId].push(comment);
            }
          }
        }

        // 5. Technical Audio Artifacts (перегруз, клики, задувы, обрывы)
        else if (category === 'audio_artifact') {
          if (gap.resolutionAction === 'request_dubber_fix') {
            const comment: Comment = {
              id: Math.random().toString(36).substr(2, 9),
              text: gap.comment || `[Перезапись] Технический дефект (${gap.typeLabel || 'артефакт записи'}) [${gap.startFormatted}]: "${gap.text}"`,
              timestamp: gap.artifactTimestampSec ?? gap.startSec,
              author: 'Куратор (Артефакты)',
              subId: gap.subId
            };

            if (!commentsByTrackId[gap.trackId]) commentsByTrackId[gap.trackId] = [];
            commentsByTrackId[gap.trackId].push(comment);

            if (gap.assignmentId) {
              if (!commentsByAssignmentId[gap.assignmentId]) commentsByAssignmentId[gap.assignmentId] = [];
              commentsByAssignmentId[gap.assignmentId].push(comment);
            }
          }
          // Note: 'note_sound_engineer' is included in sound engineer QA report, 'ignore' is dismissed.
        }

        // 6. Text Mismatch / Whisper ASR
        else if (category === 'text_mismatch') {
          if (gap.resolutionAction === 'actor_better_than_sub') {
            // Actor's delivery is superior to original subtitles -> update subtitles!
            if (gap.recognizedText && typeof gap.lineIndex === 'number') {
              subUpdates.push({
                rawLineIndex: gap.lineIndex,
                text: gap.recognizedText,
                name: gap.characterName
              });
            }
          } else if (gap.resolutionAction === 'legitimate_fix' || gap.resolutionAction === 'request_dubber_fix') {
            // Dubber made a slip of tongue / mistake -> request re-recording
            const comment: Comment = {
              id: Math.random().toString(36).substr(2, 9),
              text: gap.comment || `[Фикс текста / Оговорка] В сабах: "${gap.expectedText || gap.text}". Озвучено: "${gap.recognizedText}". Перезапишите строго по тексту.`,
              timestamp: gap.startSec,
              author: 'Куратор (Whisper QA)',
              subId: gap.subId
            };

            if (!commentsByTrackId[gap.trackId]) commentsByTrackId[gap.trackId] = [];
            commentsByTrackId[gap.trackId].push(comment);

            if (gap.assignmentId) {
              if (!commentsByAssignmentId[gap.assignmentId]) commentsByAssignmentId[gap.assignmentId] = [];
              commentsByAssignmentId[gap.assignmentId].push(comment);
            }
          }
        }
      });

      // Execute audio silencing on physical files in Electron
      for (const [filePath, intervals] of Object.entries(intervalsToSilenceByFilePath)) {
        try {
          await ipcSafe.invoke('silence-audio-intervals', { filePath, intervals });
        } catch (silenceErr) {
          console.warn(`Could not silence audio intervals in ${filePath}:`, silenceErr);
        }
      }

      // Execute subtitle updates if .ass file was corrected
      if (subUpdates.length > 0 && currentEpisode.subPath) {
        try {
          await ipcSafe.invoke('save-raw-subtitles', {
            filePath: currentEpisode.subPath,
            lines: subUpdates
          });
          setSubLines(prev => prev.map(l => {
            const up = subUpdates.find(u => u.rawLineIndex === l.rawLineIndex);
            if (!up) return l;
            return {
              ...l,
              name: up.name !== undefined ? up.name : l.name,
              text: up.text !== undefined ? up.text : l.text
            };
          }));
        } catch (subErr) {
          console.error('Failed to save corrected subtitles:', subErr);
        }
      }

      // Update local tracks state
      const updatedTracks = tracks.map(t => {
        const newComments = commentsByTrackId[t.id];
        if (newComments && newComments.length > 0) {
          return {
            ...t,
            comments: [...t.comments, ...newComments],
            status: 'fixes_needed' as const
          };
        }
        return t;
      });
      setTracks(updatedTracks);

      // Update assignments in DB
      const updatedAssignments = (currentEpisode.assignments || []).map(a => {
        const assignedId = a.substituteId || a.dubberId;
        const newAssComments = commentsByAssignmentId[a.id] || (
          commentsByTrackId[assignedId || '']?.filter(c => {
            const gap = selectedGaps.find(g => g.subId === c.subId);
            if (gap?.isSubtitleError || gap?.resolutionAction === 'reassign_character') {
              return (gap.reassignedCharacterName || gap.selectedCharacterForSub || '').toLowerCase() === a.characterName.toLowerCase();
            }
            return gap && gap.characterName.toLowerCase() === a.characterName.toLowerCase();
          })
        ) || [];

        if (newAssComments.length > 0) {
          let existingComments: Comment[] = [];
          try {
            existingComments = JSON.parse(a.comments || '[]');
          } catch (e) {}

          return {
            ...a,
            comments: JSON.stringify([...existingComments, ...newAssComments]),
            status: 'FIXES_NEEDED' as const
          };
        }
        return a;
      });

      // Also append any synthetic assignments for unlisted characters
      Object.keys(commentsByAssignmentId).forEach(assKey => {
        if (assKey.startsWith('new_ass_')) {
          const charName = assKey.replace('new_ass_', '');
          const exists = updatedAssignments.find(a => a.characterName.toLowerCase() === charName.toLowerCase());
          if (!exists) {
            updatedAssignments.push({
              id: Math.random().toString(36).substr(2, 9),
              episodeId: currentEpisode.id,
              characterName: charName,
              status: 'FIXES_NEEDED',
              comments: JSON.stringify(commentsByAssignmentId[assKey]),
              lineCount: 1,
              isMain: false
            });
          }
        }
      });

      await ipcSafe.invoke('save-episode', {
        ...currentEpisode,
        assignments: updatedAssignments,
        status: currentEpisode.status === 'FINISHED' ? 'FINISHED' : 'FIXES'
      });

      onRefresh();

      const reassignCount = selectedGaps.filter(g => g.isSubtitleError || g.resolutionAction === 'reassign_character').length;
      if (reassignCount > 0) {
        toast.success(`Применено! Обновлено субтитров: ${subUpdates.length}, перенаправлено доозвучек: ${reassignCount}`);
      } else {
        toast.success(`Успешно применены решения для ${selectedGaps.length} замечаний!`);
      }
      setIsGapModalOpen(false);

      if (Object.keys(commentsByTrackId).length > 0) {
        setTimeout(() => {
          handleGenerateFixesMessage();
        }, 300);
      }
    } catch (e: any) {
      console.error('Failed to apply gap fixes:', e);
      toast.error(`Ошибка при сохранении фиксов: ${e?.message || e}`);
    } finally {
      setIsApplyingGapFixes(false);
    }
  };

  const handleGenerateReminderMessage = () => {
    if (!currentEpisode) return;
    const msg = generateStatusMessage(currentEpisode, participants);
    setGeneratedMessage(msg);
    setIsMessageModalOpen(true);
  };

  const handleGenerateSoundEngineerReport = useCallback(() => {
    if (!currentEpisode) return;
    const msg = generateSoundEngineerQAReport(currentEpisode, detectedGaps, participants);
    setGeneratedMessage(msg);
    setIsMessageModalOpen(true);
  }, [currentEpisode, detectedGaps, participants]);

  const handleExportSoundEngineer = async (targetDir: string, skipConversion: boolean, smartExport?: boolean, uploadToYandex?: boolean, additionalProcessing?: boolean, autoApplyFixes?: boolean) => {
    if (!currentEpisode) return;
    try {
      await ipcSafe.invoke('enqueue-ffmpeg-task', {
        type: 'export-sound-engineer-files',
        payload: {
          episode: currentEpisode,
          targetDir,
          skipConversion,
          smartExport,
          additionalProcessing,
          autoApplyFixes
        },
        metadata: {
          title: `Экспорт Звукорежиссеру: ${currentEpisode.project?.title || 'Проект'} - Серия ${currentEpisode.number}`
        }
      });
      setIsExportModalOpen(false);
      toast.success('Экспорт для звукорежиссера добавлен в фоновую очередь задач!');
    } catch (error: any) {
      console.error('Export sound engineer task enqueue error:', error);
      toast.error('Ошибка добавления экспорта в очередь: ' + (error.message || String(error)));
    }
  };

  const handleBakeSubtitles = async () => {
    if (!currentEpisode) return;
    setIsBaking(true);
    setBakeProgress(0);
    setBakeStatus('Запуск FFmpeg...');
    
    let removeListener: (() => void) | undefined;
    removeListener = ipcSafe.on('ffmpeg-progress', (percent: number) => {
      setBakeProgress(percent);
      setBakeStatus(`Рендеринг: ${percent}%`);
    });

    try {
      const projectTitle = sanitizeFolderName(currentEpisode.project?.title || 'Project');
      const episodeFolder = sanitizeFolderName(`Episode_${currentEpisode.number}`);
      const subDir = `${projectTitle}/${episodeFolder}`;
      
      await ipcSafe.invoke('bake-subtitles', {
        videoPath: currentEpisode.rawPath, 
        finalAssPath: currentEpisode.subPath, 
        outputPath: `${subDir}/final_release.mp4`
      });
      
      setBakeStatus('Видео успешно отрендерено!');
      setBakeProgress(100);
    } catch (err: any) {
      setBakeStatus(`Ошибка: ${err.message}`);
    } finally {
      setIsBaking(false);
      if (removeListener) removeListener();
    }
  };


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
        return assignedId === id ? { ...a, status: dbStatus } : a
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
    const assignment = currentEpisode.assignments?.find(a => (a.substituteId || a.dubberId) === trackId);
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
        path: res.path,
        uploadedById: trackId,
        assignmentId: assignment.id,
        createdAt: new Date().toISOString()
      };

      const updatedUploads = [...(currentEpisode.uploads || []), newUpload];
      
      const updatedAssignments = currentEpisode.assignments?.map(a => 
        (a.substituteId || a.dubberId) === trackId ? { ...a, status: 'RECORDED' } : a
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
          const dubberFilesRemaining = updatedUploads.some(u => 
            u.uploadedById === trackId || 
            (u.assignmentId && currentEpisode.assignments?.find(a => a.id === u.assignmentId && (a.substituteId || a.dubberId) === trackId))
          );
          
          let updatedAssignments = currentEpisode.assignments;
          let newEpisodeStatus = currentEpisode.status;
          
          if (!dubberFilesRemaining && currentEpisode.assignments) {
            updatedAssignments = currentEpisode.assignments.map(a => 
              (a.substituteId || a.dubberId) === trackId ? { ...a, status: 'PENDING' } : a
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
        />

      {/* Main Content - Player & Comments */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedTrackId === 'all' ? (
          <div className="flex-1 flex flex-col overflow-hidden p-6 space-y-6">
            <div className="aspect-video bg-black rounded-xl overflow-hidden border border-neutral-800 relative group max-h-[50vh] mx-auto w-full">
              <video 
                ref={videoRef}
                src={videoUrl || undefined}
                className="w-full h-full object-contain"
                onPlay={handleVideoPlay}
                onPause={handleVideoPause}
                onTimeUpdate={handleVideoTimeUpdate}
                onSeeking={handleVideoSeeking}
                onSeeked={handleVideoSeeking}
                onEnded={handleVideoEnded}
                onLoadedMetadata={(e) => {
                  setDuration(e.currentTarget.duration);
                  e.currentTarget.currentTime = currentTime;
                }}
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4">
                <div className="flex flex-col gap-2 w-full">
                  <input 
                    type="range" 
                    min={0} 
                    max={duration || 100} 
                    value={currentTime}
                    onChange={(e) => {
                      const time = parseFloat(e.target.value);
                      handleSeekToTime(time);
                    }}
                    className="w-full accent-blue-500"
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={togglePlay} 
                        className="p-2 bg-blue-600 hover:bg-blue-500 rounded-full text-white transition-all"
                        title={isPlaying ? "Пауза" : "Играть"}
                      >
                        {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                      </button>
                      <button 
                        onClick={seekToNext} 
                        className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all"
                        title="К следующей реплике (Стрелка вправо)"
                      >
                        <SkipForward className="w-5 h-5" />
                      </button>
                      <button 
                        onClick={handleStop} 
                        className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all"
                        title="Стоп"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 bg-black/60 px-3 py-1 rounded-full">
                      <Clock className="w-3 h-3 text-blue-400" />
                      <span className="text-xs font-mono text-white">
                        {new Date(currentTime * 1000).toISOString().substr(14, 5)} / {new Date(duration * 1000).toISOString().substr(14, 5)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-4 shrink-0">
                <div>
                  <h3 className="text-lg font-bold text-white">Громкость даберов в миксе</h3>
                  <div className="text-xs text-neutral-400 mt-0.5">
                    {isAutoNormalize 
                      ? '✨ Авто-нормализация выравнивает громкость дорожек при прослушивании' 
                      : 'Оригинальный уровень громкости файлов'}
                  </div>
                </div>
                <button
                  onClick={toggleAutoNormalize}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    isAutoNormalize 
                      ? 'bg-blue-600/20 text-blue-400 border-blue-500/40 hover:bg-blue-600/30' 
                      : 'bg-neutral-800 text-neutral-400 border-neutral-700 hover:bg-neutral-700'
                  }`}
                  title="Нормализует громкость всех дорожек до целевого уровня в реальном времени"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  {isAutoNormalize ? 'Авто-нормализация: ВКЛ' : 'Авто-нормализация: ВЫКЛ'}
                </button>
              </div>

              <div className="space-y-3 overflow-y-auto pr-2 shrink-0 max-h-[40%]">
                <div className="flex items-center gap-4 p-3 bg-neutral-800/50 rounded-lg">
                  <Volume2 className="w-5 h-5 text-neutral-400" />
                  <div className="w-36 text-sm font-medium text-white truncate">Оригинал (РАВ)</div>
                  <input 
                    type="range" min="0" max="1" step="0.1" value={originalVolume} 
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setOriginalVolume(v);
                      if (videoRef.current) videoRef.current.volume = v;
                    }}
                    className="flex-1 accent-neutral-500"
                  />
                  <span className="text-xs text-neutral-500 w-12 text-right">{Math.round(originalVolume * 100)}%</span>
                </div>

                {tracks.map(track => {
                  const norm = normalizationMetrics[track.id];
                  return (
                    <div key={track.id} className="flex items-center gap-4 p-3 bg-neutral-800/50 rounded-lg">
                      <Volume2 className="w-5 h-5 text-blue-400" />
                      <div className="w-36 flex-shrink-0">
                        <div className="text-sm font-medium text-white truncate">{track.participant}</div>
                        <div className="text-xs text-neutral-500 truncate">{track.character}</div>
                      </div>
                      
                      {isAutoNormalize && norm && norm.status === 'ready' && (
                        <span 
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0"
                          title={`Auto-Gain: ${norm.gainDb > 0 ? '+' : ''}${norm.gainDb} dB (Пик: ${norm.peakDb} dBFS, Речь: ${norm.rmsDb} dBFS)`}
                        >
                          {norm.gainDb > 0 ? '+' : ''}{norm.gainDb} dB
                        </span>
                      )}

                      <input 
                        type="range" min="0" max="1" step="0.1" value={volumes[track.id] ?? 0.8} 
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          setVolumes(prev => ({ ...prev, [track.id]: v }));
                        }}
                        className="flex-1 accent-blue-500"
                      />
                      <span className="text-xs text-neutral-500 w-12 text-right">{Math.round((volumes[track.id] ?? 0.8) * 100)}%</span>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 pt-6 border-t border-neutral-800 shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className={`text-sm font-bold uppercase tracking-widest flex items-center gap-2 ${currentCharacter ? 'text-blue-400' : 'text-neutral-500'}`}>
                        <User className="w-4 h-4" />
                        {currentCharacter ? (
                          <span>
                            {currentDubberNickname ? `${currentDubberNickname} (${currentCharacter})` : currentCharacter}
                          </span>
                        ) : 'Никто не говорит'}
                      </div>
                      
                      {currentCharacter && currentEpisode && (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-neutral-500">Переназначить:</span>
                          <select 
                            className="bg-neutral-800 border border-neutral-700 text-white text-[10px] rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            value={currentCharacter}
                            onChange={(e) => handleReassignCharacter(e.target.value)}
                          >
                            <option value={currentCharacter}>{currentCharacter}</option>
                            {currentEpisode.assignments?.map(a => a.characterName)
                              .filter(name => name !== currentCharacter)
                              .filter((v, i, a) => a.indexOf(v) === i) // Unique
                              .map(name => (
                                <option key={name} value={name}>{name}</option>
                              ))
                            }
                          </select>
                        </div>
                      )}
                    </div>
                    {currentSubtitleText && (
                      <div className="text-xs text-neutral-400 italic line-clamp-1">
                        "{currentSubtitleText}"
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={newComment}
                      onChange={(e) => {
                        setNewComment(e.target.value);
                        if (isPlaying && e.target.value.length > 0) {
                          handlePause(); // Auto-pause when typing
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddComment();
                        if (e.key === ' ') {
                          e.stopPropagation(); // Prevent space from toggling play when typing
                        }
                      }}
                      placeholder="Добавить комментарий на этой секунде..."
                      className="bg-neutral-800 border border-neutral-700 text-white rounded-lg px-4 py-2 w-80 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                    <button 
                      onClick={() => handleAddComment()}
                      className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors font-bold"
                    >
                      Отправить
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : selectedTrack ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Video & Waveform */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="aspect-video bg-black rounded-xl overflow-hidden border border-neutral-800 relative group">
                  <video 
                    ref={videoRef}
                    src={videoUrl || undefined}
                    className="w-full h-full object-contain"
                    onPlay={handleVideoPlay}
                    onPause={handleVideoPause}
                    onTimeUpdate={handleVideoTimeUpdate}
                    onSeeking={handleVideoSeeking}
                    onSeeked={handleVideoSeeking}
                    onEnded={handleVideoEnded}
                    onLoadedMetadata={(e) => {
                      setDuration(e.currentTarget.duration);
                      e.currentTarget.currentTime = currentTime;
                    }}
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4">
                    <div className="flex flex-col gap-2 w-full">
                      <input 
                        type="range" 
                        min={0} 
                        max={duration || 100} 
                        value={currentTime}
                        onChange={(e) => {
                          const time = parseFloat(e.target.value);
                          handleSeekToTime(time);
                        }}
                        className="w-full accent-blue-500"
                      />
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <button 
                            onClick={handleStop} 
                            className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all"
                            title="Стоп"
                          >
                            <X className="w-5 h-5" />
                          </button>
                          <button 
                            onClick={togglePlay} 
                            className="p-3 bg-blue-600 hover:bg-blue-500 rounded-full text-white transition-all transform hover:scale-110"
                            title={isPlaying ? "Пауза" : "Играть"}
                          >
                            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                          </button>
                          <button 
                            onClick={seekToNext} 
                            className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all"
                            title="К следующей реплике (Стрелка вправо)"
                          >
                            <SkipForward className="w-5 h-5" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2 bg-black/60 px-3 py-1 rounded-full">
                          <Clock className="w-3 h-3 text-blue-400" />
                          <span className="text-xs font-mono text-white">
                            {new Date(currentTime * 1000).toISOString().substr(14, 5)} / {new Date(duration * 1000).toISOString().substr(14, 5)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold">
                          {selectedTrack.participant.charAt(0)}
                        </div>
                        <div>
                          <div className="text-white font-bold">{selectedTrack.character}</div>
                          <div className="text-xs text-neutral-400">{selectedTrack.participant}</div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={detectSilence}
                          disabled={isAnalyzingSilence}
                          className={`p-2 rounded-lg transition-colors ${isAnalyzingSilence ? 'bg-neutral-800 text-neutral-600' : 'bg-neutral-800 text-neutral-400 hover:text-blue-400'}`}
                          title="Детектор тишины"
                        >
                          <Scissors className={`w-5 h-5 ${isAnalyzingSilence ? 'animate-pulse' : ''}`} />
                        </button>
                        <button 
                          onClick={() => handleStatusChange(selectedTrack.id, 'approved')}
                          className={`p-2 rounded-lg transition-colors ${selectedTrack.status === 'approved' ? 'bg-green-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-green-400'}`}
                          title="Одобрить"
                        >
                          <CheckCircle className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={() => handleStatusChange(selectedTrack.id, 'fixes_needed')}
                          className={`p-2 rounded-lg transition-colors ${selectedTrack.status === 'fixes_needed' ? 'bg-yellow-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-yellow-400'}`}
                          title="Требуются исправления"
                        >
                          <AlertCircle className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={() => handleStatusChange(selectedTrack.id, 'rejected')}
                          className={`p-2 rounded-lg transition-colors ${selectedTrack.status === 'rejected' ? 'bg-red-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-red-400'}`}
                          title="Отклонить"
                        >
                          <XCircle className="w-5 h-5" />
                        </button>
                      </div>
                    </div>

                    {/* Current Phrase Info & Reassignment */}
                    <div className="mb-4 pb-4 border-b border-neutral-800 space-y-2">
                       <div className="flex items-center justify-between">
                        <div className={`text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 ${currentCharacter ? 'text-blue-400' : 'text-neutral-500'}`}>
                          <User className="w-3.5 h-3.5" />
                          {currentCharacter ? (
                            <span>
                              {currentDubberNickname ? `${currentDubberNickname} (${currentCharacter})` : currentCharacter}
                            </span>
                          ) : 'Никто не говорит'}
                        </div>
                        
                        {currentCharacter && currentEpisode && (
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] text-neutral-500">Переназначить:</span>
                            <select 
                              className="bg-neutral-800 border border-neutral-700 text-white text-[10px] rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              value={currentCharacter}
                              onChange={(e) => handleReassignCharacter(e.target.value)}
                            >
                              <option value={currentCharacter}>{currentCharacter}</option>
                              {currentEpisode.assignments?.map(a => a.characterName)
                                .filter(name => name !== currentCharacter)
                                .filter((v, i, a) => a.indexOf(v) === i)
                                .map(name => (
                                  <option key={name} value={name}>{name}</option>
                                ))
                              }
                            </select>
                          </div>
                        )}
                      </div>
                      {currentSubtitleText && (
                        <div className="text-[11px] text-neutral-400 italic line-clamp-1">
                          "{currentSubtitleText}"
                        </div>
                      )}
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center gap-4">
                        <Volume2 className="w-4 h-4 text-neutral-500" />
                        <input 
                          type="range" min="0" max="1" step="0.1" value={volumes[selectedTrack.id] ?? 0.8} 
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            setVolumes(prev => ({ ...prev, [selectedTrack.id]: v }));
                          }}
                          className="flex-1 accent-blue-500"
                        />
                        {isAutoNormalize && normalizationMetrics[selectedTrack.id]?.status === 'ready' && (
                          <span 
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            title={`Коррекция превью: ${normalizationMetrics[selectedTrack.id].gainDb > 0 ? '+' : ''}${normalizationMetrics[selectedTrack.id].gainDb} dB. Исходный файл не изменен.`}
                          >
                            {normalizationMetrics[selectedTrack.id].gainDb > 0 ? '+' : ''}{normalizationMetrics[selectedTrack.id].gainDb} dB
                          </span>
                        )}
                        <button 
                          onClick={() => setIsMuted(!isMuted)}
                          className={`p-1 rounded ${isMuted ? 'text-red-500 bg-red-500/10' : 'text-neutral-500 hover:text-white'}`}
                          title="Приглушить фон"
                        >
                          <Activity className="w-4 h-4" />
                        </button>
                        <span className="text-[10px] text-neutral-500 w-8">ДАБ</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <Volume2 className="w-4 h-4 text-neutral-500" />
                        <input 
                          type="range" min="0" max="1" step="0.1" value={originalVolume} 
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            setOriginalVolume(v);
                            if (videoRef.current) videoRef.current.volume = v;
                          }}
                          className="flex-1 accent-neutral-500"
                        />
                        <span className="text-[10px] text-neutral-500 w-8">РАВ</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 h-[200px] flex flex-col">
                    <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                      <MessageSquare className="w-4 h-4" />
                      Правки и комментарии
                    </h3>
                    <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-hide">
                      {selectedTrack.comments.map(comment => (
                        <div key={comment.id} className="bg-neutral-800/50 rounded-lg p-3 border border-neutral-700/50 group/comment">
                          <div className="flex justify-between items-start mb-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-blue-400 uppercase">{comment.author}</span>
                              <span className="text-[10px] text-neutral-500">{new Date(comment.timestamp * 1000).toISOString().substr(14, 5)}</span>
                            </div>
                            <button 
                              onClick={() => handleDeleteComment(selectedTrack.id, comment.id)}
                              className="opacity-0 group-hover/comment:opacity-100 p-1 hover:text-red-400 transition-all"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                          <p className="text-sm text-neutral-200">{comment.text}</p>
                        </div>
                      ))}
                      {selectedTrack.comments.length === 0 && (
                        <div className="h-full flex items-center justify-center text-neutral-600 text-sm italic">
                          Комментариев пока нет
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Waveform Section */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 space-y-4">
                {[selectedTrack].map(track => (
                  <div key={track.id} className="bg-neutral-800/50 p-4 rounded-lg border border-neutral-700/50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-white">{track.participant} ({track.character})</span>
                      <div className="flex gap-2">
                        <button onClick={() => setMutedTracks(prev => {
                          const next = new Set(prev);
                          if (next.has(track.id)) next.delete(track.id);
                          else next.add(track.id);
                          return next;
                        })} className={`p-1 rounded ${mutedTracks.has(track.id) ? 'text-red-500' : 'text-neutral-400'}`}>
                          {mutedTracks.has(track.id) ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    <TrackWaveform 
                      track={track}
                      currentTime={currentTime}
                      isPlaying={isPlaying}
                      subLines={subLines}
                      onTimeUpdate={setCurrentTime}
                      onSeek={handleSeekToTime}
                      onPlayPause={togglePlay}
                      volume={track.id === 'original' ? 0 : (isMuted || mutedTracks.has(track.id) ? 0 : Math.max(0, (volumes[track.id] ?? 0.8) * ((isAutoNormalize && normalizationMetrics[track.id]?.status === 'ready') ? normalizationMetrics[track.id].gain : 1.0)))}
                      isMuted={isMuted || mutedTracks.has(track.id)}
                      onRegionClick={(region) => {
                        setCommentModal({ isOpen: true, region });
                      }}
                      onWaveSurferReady={(ws) => {
                        wavesurferRef.current = ws;
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-neutral-600 italic">
            Выберите дорожку для начала проверки
          </div>
        )}
      </div>
    </div>

      {/* Comment Modal */}
      {commentModal?.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
          <div className="bg-neutral-900 p-6 rounded-lg border border-neutral-700 w-96">
            <h3 className="text-white font-bold mb-4">Добавить правку</h3>
            <input 
              type="text" 
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              className="bg-neutral-800 border border-neutral-700 text-white rounded-lg px-4 py-2 w-full mb-4"
              placeholder="Введите комментарий..."
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setCommentModal(null)} className="text-neutral-400">Отмена</button>
              <button onClick={() => {
                handleAddComment();
                setCommentModal(null);
              }} className="bg-blue-600 text-white px-4 py-2 rounded">Сохранить</button>
            </div>
          </div>
        </div>
      )}

      {/* Pre-scan Configuration Modal */}
      {isScanConfigModalOpen && (
        <QAScanConfigModal
          isOpen={isScanConfigModalOpen}
          onClose={() => setIsScanConfigModalOpen(false)}
          onStartScan={(options) => {
            setGapScanOptions(options);
            setIsScanConfigModalOpen(false);
            handleExecuteGapDetection(options);
          }}
          initialOptions={gapScanOptions}
          totalDubbers={tracks.filter(t => t.id !== 'original' && t.files.length > 0).length}
          totalSubLines={subLines.length}
        />
      )}

      {/* Missing Lines / Gaps Review Modal */}
      {isGapModalOpen && (
        <MissingLinesModal
          isOpen={isGapModalOpen}
          onClose={() => setIsGapModalOpen(false)}
          gaps={detectedGaps}
          episode={currentEpisode}
          participants={participants}
          onApplyFixes={handleApplyGapFixes}
          onSeekMainPlayer={(timeSec) => {
            handleSeekToTime(timeSec);
          }}
          isApplying={isApplyingGapFixes}
          onReAnalyze={handleRunGapDetection}
          onOpenScanConfig={() => setIsScanConfigModalOpen(true)}
          isAnalyzing={isAnalyzingGaps}
          currentThreshold={gapSensitivityThreshold}
        />
      )}

      {/* Export Modal */}
      {isExportModalOpen && currentEpisode && (
        <ExportModal 
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          episode={currentEpisode}
          role="SOUND_ENGINEER"
          onExport={handleExportSoundEngineer}
          isExporting={isUploading}
        />
      )}

      {/* Message Modal */}
      {isMessageModalOpen && generatedMessage && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
            <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-400" />
                <h2 className="text-xl font-semibold text-white">Сформированное сообщение</h2>
              </div>
              <button onClick={() => setIsMessageModalOpen(false)} className="text-neutral-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6">
              <pre className="bg-black/50 border border-neutral-800 rounded-xl p-6 text-sm text-neutral-300 whitespace-pre-wrap font-mono leading-relaxed max-h-[50vh] overflow-y-auto custom-scrollbar">
                {generatedMessage}
              </pre>
              
              <div className="mt-6 flex gap-3">
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(generatedMessage);
                    toast.success('Скопировано в буфер обмена!');
                  }}
                  className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"
                >
                  <Save className="w-5 h-5" />
                  Скопировать текст
                </button>
                <button 
                  onClick={() => setIsMessageModalOpen(false)}
                  className="px-8 py-3 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl font-bold transition-all"
                >
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Baking Progress Overlay */}
      {isBaking && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-xl">
          <div className="w-full max-w-md p-8 text-center space-y-6">
            <div className="relative w-32 h-32 mx-auto">
              <div className="absolute inset-0 border-4 border-neutral-800 rounded-full" />
              <div 
                className="absolute inset-0 border-4 border-blue-500 rounded-full transition-all duration-500"
                style={{ 
                  clipPath: `inset(${100 - bakeProgress}% 0 0 0)`,
                  filter: 'drop-shadow(0 0 8px rgba(59, 130, 246, 0.5))'
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-bold text-white">{Math.round(bakeProgress)}%</span>
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-white">Рендеринг видео</h3>
              <p className="text-neutral-400 text-sm">{bakeStatus}</p>
            </div>
            <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-500"
                style={{ width: `${bakeProgress}%` }}
              />
            </div>
          </div>
        </div>
      )}
      <ConfirmModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
        variant={confirmState.variant}
      />
    </>
  );
}
