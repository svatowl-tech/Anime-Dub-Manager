import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  X, 
  Play, 
  Pause, 
  CheckSquare, 
  Square, 
  VolumeX, 
  Volume2, 
  AlertTriangle, 
  Check, 
  Search, 
  Scissors, 
  MessageSquare, 
  Sparkles, 
  Sliders, 
  Shield, 
  Layers, 
  FileText, 
  UserCheck,
  Headphones,
  Copy,
  CheckCircle2,
  Clock,
  Mic,
  Zap,
  ArrowRightLeft,
  RotateCcw,
  Repeat,
  Activity,
  Flame,
  ScrollText,
  Terminal,
  Info,
  XCircle,
  Video,
  Save,
  FileCheck,
  Edit3,
  Gauge,
  UserPlus
} from 'lucide-react';
import { toast } from 'sonner';
import { safeCopyToClipboard } from '../../lib/clipboard';
import { 
  MissingLineDetection, 
  DefectCategory, 
  DefectResolution, 
  SnippetAudioPlayer,
  QAScanReport,
  QAScanLogEntry,
  WhisperScanStatus
} from '../../lib/qa/missingLinesDetector';
import { AudioArtifactType } from '../../lib/qa/artifactDetector';
import { ArtifactWaveformMarker } from './ArtifactWaveformMarker';
import { generateSoundEngineerQAReport } from '../../lib/templates';
import { Episode, Participant, SubtitleLine, Track } from '../../types';
import { saveQAGapsToTimingProject } from '../../lib/qa/timingSyncService';
import { MissingLinesDefectCard } from "./MissingLinesDefectCard";
import { MissingLinesPlayerAndModals } from "./MissingLinesPlayerAndModals";

interface MissingLinesModalProps {
  isOpen: boolean;
  onClose: () => void;
  gaps: MissingLineDetection[];
  onApplyFixes: (selectedGaps: MissingLineDetection[]) => Promise<void>;
  onSeekMainPlayer?: (timeSec: number) => void;
  isApplying?: boolean;
  onReAnalyze?: (dynamicThresholdDb?: number) => void;
  isAnalyzing?: boolean;
  currentThreshold?: number;
  episode?: Episode | null;
  participants?: Participant[];
  tracks?: Track[];
  onOpenTimingPanel?: () => void;
  onGenerateSoundEngineerMessage?: () => void;
  onOpenScanConfig?: () => void;
  scanReport?: QAScanReport;
  videoUrl?: string;
  subLines?: SubtitleLine[];
  onUpdateSubLine?: (updatedLine: { rawLineIndex: number; name?: string; text?: string; start?: string; end?: string }) => Promise<void>;
  onExportSubtitles?: () => Promise<void>;
  onSaveGaps?: (updatedGaps: MissingLineDetection[]) => void;
}

export const MissingLinesModal: React.FC<MissingLinesModalProps> = ({
  isOpen,
  onClose,
  gaps: initialGaps,
  onApplyFixes,
  onSeekMainPlayer,
  isApplying = false,
  onReAnalyze,
  isAnalyzing = false,
  currentThreshold = 3.0,
  episode,
  participants,
  tracks = [],
  onOpenTimingPanel,
  onGenerateSoundEngineerMessage,
  onOpenScanConfig,
  scanReport,
  videoUrl,
  subLines = [],
  onUpdateSubLine,
  onExportSubtitles,
  onSaveGaps
}) => {
  const [gaps, setGaps] = useState<MissingLineDetection[]>(initialGaps);
  const [selectedGapId, setSelectedGapId] = useState<string | null>(() => initialGaps[0]?.id || null);

  // Video player state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isLoopingSnippet, setIsLoopingSnippet] = useState(true);

  // Subtitle in-place editor state
  const [editingSubText, setEditingSubText] = useState('');
  const [selectedReassignCharacter, setSelectedReassignCharacter] = useState('');
  const [customCharacterName, setCustomCharacterName] = useState('');
  const [isSavingSub, setIsSavingSub] = useState(false);
  const [isExportingSub, setIsExportingSub] = useState(false);

  const activeReport: QAScanReport | undefined = scanReport || (initialGaps as any)?.scanReport;
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [logFilterStage, setLogFilterStage] = useState<'all' | 'whisper' | 'error' | 'audio'>('all');
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [selectedCategoryTab, setSelectedCategoryTab] = useState<'all' | DefectCategory | 'sub_error'>('all');
  const [selectedArtifactTypeFilter, setSelectedArtifactTypeFilter] = useState<'all' | AudioArtifactType>('all');
  const [selectedDubberFilter, setSelectedDubberFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [playingSnippetId, setPlayingSnippetId] = useState<string | null>(null);
  const [selectedSensitivity, setSelectedSensitivity] = useState<number>(currentThreshold);
  const [activeReassignGapId, setActiveReassignGapId] = useState<string | null>(null);
  const [customCharInput, setCustomCharInput] = useState<Record<string, string>>({});

  const updateGaps = useCallback((updater: (prev: MissingLineDetection[]) => MissingLineDetection[]) => {
    setGaps(prev => {
      const next = updater(prev);
      onSaveGaps?.(next);
      return next;
    });
  }, [onSaveGaps]);

  const formatTimecode = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  // Sound Engineer Message Modal state
  const [soundEngineerModalOpen, setSoundEngineerModalOpen] = useState(false);
  const [soundEngineerReportText, setSoundEngineerReportText] = useState('');
  const [hasCopiedReport, setHasCopiedReport] = useState(false);

  useEffect(() => {
    setGaps(initialGaps);
  }, [initialGaps]);

  useEffect(() => {
    setSelectedSensitivity(currentThreshold);
  }, [currentThreshold]);

  // Cleanup audio playback on unmount or close
  useEffect(() => {
    return () => {
      SnippetAudioPlayer.stop();
    };
  }, [isOpen]);

  // Available characters in this episode for reassignment
  const availableCharacters = React.useMemo(() => {
    const charMap = new Map<string, { characterName: string; dubberName: string; dubberId?: string; assignmentId?: string }>();
    
    (episode?.assignments || []).forEach(a => {
      if (!a.characterName) return;
      const assignedId = a.substituteId || a.dubberId;
      const part = participants?.find(p => p.id === assignedId);
      const dubberName = a.substitute?.nickname || a.dubber?.nickname || part?.nickname || 'Не назначен';
      charMap.set(a.characterName.toLowerCase(), {
        characterName: a.characterName,
        dubberName,
        dubberId: assignedId,
        assignmentId: a.id
      });
    });

    gaps.forEach(g => {
      if (g.characterName && !charMap.has(g.characterName.toLowerCase())) {
        charMap.set(g.characterName.toLowerCase(), {
          characterName: g.characterName,
          dubberName: g.dubberName || 'Даббер',
          dubberId: g.trackId,
          assignmentId: g.assignmentId
        });
      }
      if (g.secondCharacterName && !charMap.has(g.secondCharacterName.toLowerCase())) {
        charMap.set(g.secondCharacterName.toLowerCase(), {
          characterName: g.secondCharacterName,
          dubberName: g.secondDubberName || 'Даббер',
          dubberId: g.secondTrackId,
          assignmentId: g.secondAssignmentId
        });
      }
    });

    return Array.from(charMap.values()).sort((a, b) => a.characterName.localeCompare(b.characterName));
  }, [episode?.assignments, participants, gaps]);

  const handleReassignGapCharacter = (gapId: string, targetCharName: string) => {
    const trimmed = targetCharName.trim();
    if (!trimmed) return;

    const found = availableCharacters.find(c => c.characterName.toLowerCase() === trimmed.toLowerCase());
    const dubberName = found ? found.dubberName : 'Даббер';
    const dubberId = found ? found.dubberId : undefined;
    const assignmentId = found ? found.assignmentId : undefined;

    updateGaps(prev => prev.map(g => {
      if (g.id !== gapId) return g;
      
      return {
        ...g,
        selected: true,
        resolutionAction: 'reassign_character',
        selectedCharacterForSub: trimmed,
        reassignedCharacterName: trimmed,
        reassignedDubberName: dubberName,
        reassignedDubberId: dubberId,
        reassignedAssignmentId: assignmentId,
        isSubtitleError: true,
        comment: `[Ошибка в субтитрах] Реплика переназначена на ${trimmed}${dubberName ? ` (${dubberName})` : ''}. В исходных сабах реплика ошибочно числилась за ${g.characterName} (${g.dubberName}). Предыдущий даббер не виноват. Требуется доозвучить.`
      };
    }));

    if (onUpdateSubLine) {
      const g = gaps.find(x => x.id === gapId);
      if (g) {
        const rawIdx = typeof g.lineIndex === 'number' ? g.lineIndex : (g.subId ? parseInt(g.subId) : undefined);
        if (typeof rawIdx === 'number' && !isNaN(rawIdx)) {
          onUpdateSubLine({
            rawLineIndex: rawIdx,
            name: trimmed
          }).catch(e => console.warn('Could not update sub line on reassign:', e));
        }
      }
    }

    toast.success(`Реплика переназначена персонажу «${trimmed}» (${dubberName})`);
  };

  const handleCancelReassign = (gapId: string) => {
    updateGaps(prev => prev.map(g => {
      if (g.id !== gapId) return g;
      return {
        ...g,
        resolutionAction: undefined,
        selectedCharacterForSub: undefined,
        reassignedCharacterName: undefined,
        reassignedDubberName: undefined,
        reassignedDubberId: undefined,
        reassignedAssignmentId: undefined,
        isSubtitleError: false,
        comment: `Пропуск реплики [${g.startFormatted}]: "${g.text}"`
      };
    }));
  };

  const activeSelectedGap = useMemo(() => {
    return gaps.find(g => g.id === selectedGapId) || gaps[0] || null;
  }, [gaps, selectedGapId]);

  useEffect(() => {
    if (activeSelectedGap) {
      setEditingSubText(activeSelectedGap.text || '');
      setSelectedReassignCharacter(activeSelectedGap.reassignedCharacterName || activeSelectedGap.characterName || '');
      setCustomCharacterName('');
    }
  }, [activeSelectedGap?.id]);

  const activeDubberNickname = useMemo(() => {
    const char = activeSelectedGap?.characterName || activeSelectedGap?.reassignedCharacterName;
    if (!char || !episode?.assignments) return null;
    const match = episode.assignments.find(a => a.characterName.trim().toLowerCase() === char.trim().toLowerCase());
    return match?.substitute?.nickname || match?.dubber?.nickname || null;
  }, [activeSelectedGap?.characterName, activeSelectedGap?.reassignedCharacterName, episode?.assignments]);

  const activeSubLine = useMemo(() => {
    if (!subLines || subLines.length === 0) return null;
    if (activeSelectedGap) {
      if (activeSelectedGap.subId) {
        const found = subLines.find(l => String(l.rawLineIndex) === activeSelectedGap.subId || String(l.id) === activeSelectedGap.subId);
        if (found) return found;
      }
      if (activeSelectedGap.lineIndex !== undefined) {
        const found = subLines.find(l => l.rawLineIndex === activeSelectedGap.lineIndex || l.id === activeSelectedGap.lineIndex);
        if (found) return found;
      }
      const found = subLines.find(l => Math.abs(l.startSec - activeSelectedGap.startSec) < 0.35);
      if (found) return found;
    }
    return subLines.find(l => videoCurrentTime >= l.startSec && videoCurrentTime <= l.endSec) || null;
  }, [subLines, activeSelectedGap, videoCurrentTime]);

  const handleInspectDefectInPlayer = useCallback((gap: MissingLineDetection) => {
    setSelectedGapId(gap.id);
    const targetSec = gap.artifactTimestampSec ?? gap.startSec;
    onSeekMainPlayer?.(targetSec);

    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, targetSec - 0.4);
      videoRef.current.play().catch(() => {});
      setIsVideoPlaying(true);
    }
  }, [onSeekMainPlayer]);

  const handleVideoTimeUpdate = () => {
    if (!videoRef.current) return;
    const cur = videoRef.current.currentTime;
    setVideoCurrentTime(cur);

    if (isLoopingSnippet && activeSelectedGap) {
      const loopStart = Math.max(0, (activeSelectedGap.artifactTimestampSec ?? activeSelectedGap.startSec) - 0.4);
      const loopEnd = (activeSelectedGap.artifactTimestampSec ? activeSelectedGap.artifactTimestampSec + 1.2 : activeSelectedGap.endSec) + 0.4;
      if (cur >= loopEnd) {
        videoRef.current.currentTime = loopStart;
      }
    }
  };

  const handleSaveSubChanges = async () => {
    if (!activeSubLine) {
      toast.error('Субтитр для редактирования не выбран или отсутствует');
      return;
    }
    const finalName = selectedReassignCharacter === '__custom__' 
      ? customCharacterName.trim() 
      : selectedReassignCharacter.trim();

    setIsSavingSub(true);
    try {
      if (onUpdateSubLine) {
        await onUpdateSubLine({
          rawLineIndex: activeSubLine.rawLineIndex,
          name: finalName || activeSubLine.name,
          text: editingSubText
        });
      }

      if (activeSelectedGap) {
        updateGaps(prev => prev.map(g => {
          if (g.id !== activeSelectedGap.id) return g;
          return {
            ...g,
            characterName: finalName || g.characterName,
            reassignedCharacterName: finalName || g.reassignedCharacterName,
            text: editingSubText,
            resolutionAction: finalName && finalName !== g.characterName ? 'reassign_character' : g.resolutionAction,
            selected: true
          };
        }));
      }
      toast.success('Правки субтитра сохранены!');
    } catch (err: any) {
      toast.error(`Ошибка при сохранении субтитра: ${err?.message || err}`);
    } finally {
      setIsSavingSub(false);
    }
  };

  const handleExportSubtitlesAction = async () => {
    if (!onExportSubtitles) {
      toast.info('Экспорт субтитров недоступен');
      return;
    }
    setIsExportingSub(true);
    try {
      await onExportSubtitles();
    } finally {
      setIsExportingSub(false);
    }
  };

  if (!isOpen) return null;

  // Counts by category
  const missingCount = gaps.filter(g => (g.defectCategory || 'missing_line') === 'missing_line').length;
  const unwantedCount = gaps.filter(g => g.defectCategory === 'unwanted_speech').length;
  const collisionsCount = gaps.filter(g => g.defectCategory === 'actor_collision').length;
  const overlapsCount = gaps.filter(g => g.defectCategory === 'actor_overlap').length;
  const shortTimingCount = gaps.filter(g => g.defectCategory === 'timing_too_short').length;
  const longTimingCount = gaps.filter(g => g.defectCategory === 'timing_too_long' || g.isTimingTooLongMerged).length;
  const subErrorCount = gaps.filter(g => g.isSubtitleError || g.resolutionAction === 'reassign_character').length;
  const artifactsCount = gaps.filter(g => g.defectCategory === 'audio_artifact').length;
  const clippingCount = gaps.filter(g => g.defectCategory === 'audio_artifact' && (g.artifactType === 'clipping' || g.type === 'clipping')).length;
  const clicksCount = gaps.filter(g => g.defectCategory === 'audio_artifact' && (g.artifactType === 'mouse_click' || g.type === 'mouse_click')).length;
  const plosivesCount = gaps.filter(g => g.defectCategory === 'audio_artifact' && (g.artifactType === 'plosive' || g.type === 'plosive')).length;
  const cutoffsCount = gaps.filter(g => g.defectCategory === 'audio_artifact' && (g.artifactType === 'swallowed_vowel' || g.type === 'swallowed_vowel')).length;
  const textMismatchCount = gaps.filter(g => g.defectCategory === 'text_mismatch').length;

  // Dubbers list for filter chips
  const dubbers = Array.from(new Set(
    gaps.flatMap(g => [g.dubberName, g.secondDubberName].filter(Boolean) as string[])
  ));

  // Filtered gaps
  const filteredGaps = gaps.filter(gap => {
    const cat = gap.defectCategory || 'missing_line';
    if (selectedCategoryTab === 'sub_error') {
      if (!gap.isSubtitleError && gap.resolutionAction !== 'reassign_character') return false;
    } else if (selectedCategoryTab === 'audio_artifact') {
      if (cat !== 'audio_artifact') return false;
      if (selectedArtifactTypeFilter !== 'all') {
        const artType = gap.artifactType || gap.type;
        if (artType !== selectedArtifactTypeFilter) return false;
      }
    } else if (selectedCategoryTab !== 'all' && cat !== selectedCategoryTab) {
      if (selectedCategoryTab === 'timing_too_long' && gap.isTimingTooLongMerged) {
        // also show in timing_too_long tab
      } else {
        return false;
      }
    }
    if (selectedDubberFilter !== 'all' && gap.dubberName !== selectedDubberFilter && gap.secondDubberName !== selectedDubberFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchText = (gap.text || '').toLowerCase().includes(q) || (gap.secondText || '').toLowerCase().includes(q);
      const matchChar = (gap.characterName || '').toLowerCase().includes(q) || (gap.secondCharacterName || '').toLowerCase().includes(q);
      const matchDubber = (gap.dubberName || '').toLowerCase().includes(q) || (gap.secondDubberName || '').toLowerCase().includes(q);
      if (!matchText && !matchChar && !matchDubber) return false;
    }
    return true;
  });

  const selectedGaps = gaps.filter(g => g.selected);
  const selectedCount = selectedGaps.length;

  // Breakdown of actions
  const silenceActionsCount = selectedGaps.filter(g => 
    (g.defectCategory === 'unwanted_speech' && g.resolutionAction === 'silence') ||
    (g.defectCategory === 'actor_collision' && (g.resolutionAction === 'keep_first' || g.resolutionAction === 'keep_second')) ||
    (g.defectCategory === 'actor_overlap' && (g.resolutionAction === 'keep_first' || g.resolutionAction === 'keep_second'))
  ).length;

  const transferActionsCount = selectedGaps.filter(g => 
    g.resolutionAction === 'transfer_second_to_first' || g.resolutionAction === 'transfer_first_to_second'
  ).length;

  const fixSubsActionsCount = selectedGaps.filter(g => 
    g.defectCategory === 'actor_collision' && g.resolutionAction === 'fix_subs'
  ).length;

  const missingReportCount = selectedGaps.filter(g => 
    (g.defectCategory || 'missing_line') === 'missing_line' && !g.isSubtitleError && g.resolutionAction !== 'reassign_character'
  ).length;

  const reassignedCount = selectedGaps.filter(g => 
    g.resolutionAction === 'reassign_character' || g.isSubtitleError
  ).length;

  const dubberFixArtifactsCount = selectedGaps.filter(g => 
    g.defectCategory === 'audio_artifact' && g.resolutionAction === 'request_dubber_fix'
  ).length;

  const soundEngineerArtifactsCount = selectedGaps.filter(g => 
    g.defectCategory === 'audio_artifact' && g.resolutionAction === 'note_sound_engineer'
  ).length;

  const textMismatchFixCount = selectedGaps.filter(g => 
    g.defectCategory === 'text_mismatch' && (g.resolutionAction === 'legitimate_fix' || g.resolutionAction === 'request_dubber_fix')
  ).length;

  const textMismatchActorBetterCount = selectedGaps.filter(g => 
    g.defectCategory === 'text_mismatch' && g.resolutionAction === 'actor_better_than_sub'
  ).length;

  const handleToggleSelectAll = (select: boolean) => {
    updateGaps(prev => prev.map(g => {
      const cat = g.defectCategory || 'missing_line';
      const matchesCategory = selectedCategoryTab === 'all' || cat === selectedCategoryTab || (selectedCategoryTab === 'timing_too_long' && g.isTimingTooLongMerged);
      const matchesDubber = selectedDubberFilter === 'all' || g.dubberName === selectedDubberFilter || g.secondDubberName === selectedDubberFilter;
      return (matchesCategory && matchesDubber) ? { ...g, selected: select } : g;
    }));
  };

  const handleToggleSingle = (id: string) => {
    updateGaps(prev => prev.map(g => g.id === id ? { ...g, selected: !g.selected } : g));
  };

  const handleCommentChange = (id: string, newComment: string) => {
    updateGaps(prev => prev.map(g => g.id === id ? { ...g, comment: newComment } : g));
  };

  const handleResolutionChange = (id: string, resolution: DefectResolution, characterForSub?: string) => {
    updateGaps(prev => prev.map(g => {
      if (g.id !== id) return g;
      return {
        ...g,
        resolutionAction: resolution,
        selectedCharacterForSub: characterForSub || g.selectedCharacterForSub
      };
    }));
  };

  const handleRemoveGap = (id: string) => {
    if (playingSnippetId?.startsWith(id)) {
      SnippetAudioPlayer.stop();
      setPlayingSnippetId(null);
    }
    updateGaps(prev => prev.filter(g => g.id !== id));
  };

  const handlePlaySnippet = (
    gap: MissingLineDetection, 
    target: 'primary' | 'secondary' | 'original' | 'mix',
    loop: boolean = false
  ) => {
    const playKey = `${gap.id}_${target}`;
    if (playingSnippetId === playKey) {
      SnippetAudioPlayer.stop();
      setPlayingSnippetId(null);
      setIsLoopingSnippet(false);
      return;
    }

    if (target === 'mix') {
      const bufA = gap.audioBuffer;
      const bufB = gap.secondAudioBuffer || gap.originalAudioBuffer;
      if (!bufA && !bufB) {
        onSeekMainPlayer?.(gap.startSec);
        return;
      }
      setPlayingSnippetId(playKey);
      SnippetAudioPlayer.playMix(
        bufA || null,
        bufB || null,
        gap.startSec,
        gap.endSec,
        1.0,
        gap.defectCategory === 'timing_too_short' ? 0.75 : 1.0,
        () => {
          setPlayingSnippetId(null);
          setIsLoopingSnippet(false);
        }
      );
      return;
    }

    let buffer: AudioBuffer | null | undefined = null;
    if (target === 'primary') buffer = gap.audioBuffer;
    else if (target === 'secondary') buffer = gap.secondAudioBuffer;
    else if (target === 'original') buffer = gap.originalAudioBuffer;

    if (!buffer) {
      if (target === 'original') {
        // Seek main video player to play original
        onSeekMainPlayer?.(gap.startSec);
      }
      return;
    }

    setPlayingSnippetId(playKey);
    SnippetAudioPlayer.play(buffer, gap.startSec, gap.endSec, () => {
      setPlayingSnippetId(null);
      setIsLoopingSnippet(false);
    }, loop);
  };

  const handleGenerateReportForSE = () => {
    let report = '';
    if (episode) {
      report = generateSoundEngineerQAReport(episode, gaps, participants || []);
    } else {
      const mockEp: any = {
        id: 'current',
        number: 1,
        title: 'Серия'
      };
      report = generateSoundEngineerQAReport(mockEp, gaps, participants || []);
    }
    setSoundEngineerReportText(report);
    setSoundEngineerModalOpen(true);
    setHasCopiedReport(false);
  };

  const handleCopyReport = async () => {
    if (!soundEngineerReportText) return;
    await safeCopyToClipboard(soundEngineerReportText);
    setHasCopiedReport(true);
    toast.success('Сообщение для звукаря скопировано в буфер обмена!');
    setTimeout(() => setHasCopiedReport(false), 2500);
  };

  const handleSensitivityChange = (newThreshold: number) => {
    setSelectedSensitivity(newThreshold);
    if (onReAnalyze) {
      onReAnalyze(newThreshold);
    }
  };

  const [isSavingToTiming, setIsSavingToTiming] = useState(false);

  const handleSaveToTiming = async (navigateToTiming: boolean = false) => {
    if (!episode) return;
    setIsSavingToTiming(true);
    try {
      const res = await saveQAGapsToTimingProject(episode, gaps, tracks || []);
      toast.success(
        `✓ Записано в файл тайминга! (Наездов: ${res.summary.overlapsCount}, коллизий: ${res.summary.collisionsCount}, рассинхронов: ${res.summary.desyncCount})`
      );
      if (navigateToTiming) {
        SnippetAudioPlayer.stop();
        onClose();
        if (onOpenTimingPanel) {
          onOpenTimingPanel();
        }
      }
    } catch (err: any) {
      toast.error('Ошибка записи в тайминг: ' + (err?.message || String(err)));
    } finally {
      setIsSavingToTiming(false);
    }
  };

  const handleSubmit = async () => {
    const selected = gaps.filter(g => g.selected);
    if (selected.length === 0) return;
    SnippetAudioPlayer.stop();
    await onApplyFixes(selected);
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-[1720px] h-[95vh] max-h-[960px] flex flex-col overflow-hidden text-neutral-200">
        
        {/* Header */}
        <div className="p-5 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/95 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Scissors className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white">Центр проверки качества и косяков озвучки</h2>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 font-semibold font-mono">
                  {gaps.length} {gaps.length === 1 ? 'замечание' : gaps.length < 5 ? 'замечания' : 'замечаний'}
                </span>
              </div>
              <p className="text-xs text-neutral-400 mt-0.5">
                Автосканирование: пропуски реплик, лишняя речь вне субтитров и конфликты параллельной озвучки
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Sensitivity selector */}
            <div className="flex items-center gap-1.5 bg-neutral-950/80 border border-neutral-700/70 rounded-lg px-2 py-1 text-xs">
              <Sliders className="w-3.5 h-3.5 text-neutral-400" />
              <span className="text-[11px] text-neutral-400 font-medium">Чувствительность:</span>
              <div className="flex items-center gap-1">
                {[
                  { value: 2.0, label: '2.0 дБ (Тихий)' },
                  { value: 3.0, label: '3.0 дБ (Стандарт)' },
                  { value: 4.5, label: '4.5 дБ (Строгий)' }
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => handleSensitivityChange(opt.value)}
                    disabled={isAnalyzing}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                      selectedSensitivity === opt.value
                        ? 'bg-amber-500 text-neutral-950 shadow-sm'
                        : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                    }`}
                    title={`Считать фразой, если перепад громкости внутри реплики превышает ${opt.value} дБ`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Sound Engineer Message Button */}
            <button
              onClick={handleGenerateReportForSE}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40 transition-all flex items-center gap-1.5 shadow-sm hover:shadow-indigo-500/20"
              title="Выписать звукорежиссеру подробный отчет по наездам, конфликтам и рассинхрону"
            >
              <Headphones className="w-3.5 h-3.5 text-indigo-400" />
              <span>Выписать звукорежиссеру</span>
            </button>

            {/* Record to Timing Video Button */}
            <button
              onClick={() => handleSaveToTiming(false)}
              disabled={isSavingToTiming}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-600/25 hover:bg-amber-600/40 text-amber-300 border border-amber-500/40 transition-all flex items-center gap-1.5 shadow-sm hover:shadow-amber-500/20"
              title="Записать все обнаруженные наезды, коллизии и проблемы в файл тайминга серии (timing_project.analysis.json)"
            >
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>{isSavingToTiming ? 'Запись...' : 'Записать в тайминг'}</span>
            </button>

            {/* QA Scan Log Button */}
            <button
              onClick={() => setIsLogModalOpen(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 transition-all flex items-center gap-1.5 shadow-sm relative"
              title="Открыть журнал проверок аудиодорожек и распознавания Whisper"
            >
              <ScrollText className="w-3.5 h-3.5 text-sky-400" />
              <span>Журнал проверок</span>
              {activeReport?.logs && activeReport.logs.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-neutral-900 text-neutral-400 font-mono">
                  {activeReport.logs.length}
                </span>
              )}
              {activeReport?.whisperStatus?.attempted && !activeReport.whisperStatus.success && (
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" title="Ошибка проверки Whisper" />
              )}
            </button>

            {onOpenScanConfig && (
              <button
                type="button"
                onClick={() => {
                  SnippetAudioPlayer.stop();
                  onOpenScanConfig();
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 transition-all flex items-center gap-1.5 shadow-sm"
                title="Настроить детекторы проверок (пропуски, конфликты, наезды, Whisper ASR)"
              >
                <Sliders className="w-3.5 h-3.5 text-amber-400" />
                <span>Настроить проверки</span>
              </button>
            )}

            {onReAnalyze && (
              <button
                onClick={() => onReAnalyze(selectedSensitivity)}
                disabled={isAnalyzing}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                title="Повторить полное сканирование дорожек"
              >
                <Sparkles className={`w-3.5 h-3.5 text-amber-400 ${isAnalyzing ? 'animate-spin' : ''}`} />
                {isAnalyzing ? 'Анализ...' : 'Пересканировать'}
              </button>
            )}
            <button 
              onClick={() => {
                SnippetAudioPlayer.stop();
                onClose();
              }} 
              className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Split Layout: Defects Column (Left) + Integrated Player & Inspector (Right) */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
          {/* Left Column: Category Tabs, Filters, Defect Items List */}
          <div className="w-full lg:w-[58%] xl:w-[60%] flex flex-col h-full border-r border-neutral-800/80 min-h-0">
            {/* Category Tabs Bar */}
        <div className="px-5 pt-3 pb-2 border-b border-neutral-800/80 bg-neutral-950/60 flex items-center justify-between shrink-0 gap-3">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide py-0.5">
            <button
              onClick={() => setSelectedCategoryTab('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${
                selectedCategoryTab === 'all'
                  ? 'bg-neutral-200 text-neutral-950 shadow-sm'
                  : 'bg-neutral-800/80 text-neutral-400 hover:text-white hover:bg-neutral-700'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Все замечания</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${selectedCategoryTab === 'all' ? 'bg-neutral-900 text-white' : 'bg-neutral-700 text-neutral-300'}`}>
                {gaps.length}
              </span>
            </button>

            <button
              onClick={() => setSelectedCategoryTab('missing_line')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${
                selectedCategoryTab === 'missing_line'
                  ? 'bg-red-500 text-white shadow-sm'
                  : 'bg-neutral-800/80 text-neutral-400 hover:text-white hover:bg-neutral-700'
              }`}
            >
              <VolumeX className="w-3.5 h-3.5 text-red-400" />
              <span>Пропуски</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-red-950/80 text-red-200 border border-red-800/40">
                {missingCount}
              </span>
            </button>

            {subErrorCount > 0 && (
              <button
                onClick={() => setSelectedCategoryTab('sub_error')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${
                  selectedCategoryTab === 'sub_error'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'bg-purple-950/50 text-purple-300 hover:text-white hover:bg-purple-900/60 border border-purple-800/40'
                }`}
              >
                <ArrowRightLeft className="w-3.5 h-3.5 text-purple-300" />
                <span>Ошибки в сабах</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-purple-900 text-purple-200 border border-purple-700">
                  {subErrorCount}
                </span>
              </button>
            )}

            <button
              onClick={() => setSelectedCategoryTab('unwanted_speech')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${
                selectedCategoryTab === 'unwanted_speech'
                  ? 'bg-amber-500 text-neutral-950 shadow-sm'
                  : 'bg-neutral-800/80 text-neutral-400 hover:text-white hover:bg-neutral-700'
              }`}
            >
              <Scissors className="w-3.5 h-3.5 text-amber-400" />
              <span>Вне сабов</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-950/80 text-amber-200 border border-amber-800/40">
                {unwantedCount}
              </span>
            </button>

            <button
              onClick={() => setSelectedCategoryTab('actor_collision')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${
                selectedCategoryTab === 'actor_collision'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-neutral-800/80 text-neutral-400 hover:text-white hover:bg-neutral-700'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-blue-400" />
              <span>Конфликты</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-blue-950/80 text-blue-200 border border-blue-800/40">
                {collisionsCount}
              </span>
            </button>

            <button
              onClick={() => setSelectedCategoryTab('actor_overlap')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${
                selectedCategoryTab === 'actor_overlap'
                  ? 'bg-orange-500 text-neutral-950 shadow-sm'
                  : 'bg-neutral-800/80 text-neutral-400 hover:text-white hover:bg-neutral-700'
              }`}
            >
              <Zap className="w-3.5 h-3.5 text-orange-400" />
              <span>Наезды хвостов</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-orange-950/80 text-orange-200 border border-orange-800/40">
                {overlapsCount}
              </span>
            </button>

            <button
              onClick={() => setSelectedCategoryTab('timing_too_short')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${
                selectedCategoryTab === 'timing_too_short'
                  ? 'bg-cyan-500 text-neutral-950 shadow-sm'
                  : 'bg-neutral-800/80 text-neutral-400 hover:text-white hover:bg-neutral-700'
              }`}
            >
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              <span>Короче саба (&gt;30%)</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-cyan-950/80 text-cyan-200 border border-cyan-800/40">
                {shortTimingCount}
              </span>
            </button>

            <button
              onClick={() => setSelectedCategoryTab('timing_too_long')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${
                selectedCategoryTab === 'timing_too_long'
                  ? 'bg-purple-500 text-white shadow-sm'
                  : 'bg-neutral-800/80 text-neutral-400 hover:text-white hover:bg-neutral-700'
              }`}
            >
              <Clock className="w-3.5 h-3.5 text-purple-400" />
              <span>Длиннее саба (&gt;40%)</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-purple-950/80 text-purple-200 border border-purple-800/40">
                {longTimingCount}
              </span>
            </button>

            <button
              onClick={() => setSelectedCategoryTab('audio_artifact')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${
                selectedCategoryTab === 'audio_artifact'
                  ? 'bg-rose-600 text-white shadow-sm ring-1 ring-rose-400/50'
                  : 'bg-neutral-800/80 text-neutral-400 hover:text-white hover:bg-neutral-700'
              }`}
            >
              <Activity className="w-3.5 h-3.5 text-rose-400" />
              <span>Артефакты записи</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-950/80 text-rose-200 border border-rose-800/40">
                {artifactsCount}
              </span>
            </button>

            {(textMismatchCount > 0 || activeReport?.whisperStatus?.attempted) && (
              <button
                onClick={() => setSelectedCategoryTab('text_mismatch')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${
                  selectedCategoryTab === 'text_mismatch'
                    ? (activeReport?.whisperStatus?.attempted && !activeReport.whisperStatus.success
                        ? 'bg-rose-600 text-white shadow-sm ring-1 ring-rose-400/50'
                        : 'bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-400/50')
                    : (activeReport?.whisperStatus?.attempted && !activeReport.whisperStatus.success
                        ? 'bg-rose-950/40 text-rose-300 hover:text-white hover:bg-rose-900/60 border border-rose-800/40'
                        : 'bg-emerald-950/40 text-emerald-300 hover:text-white hover:bg-emerald-900/60 border border-emerald-800/40')
                }`}
              >
                <FileText className={`w-3.5 h-3.5 ${activeReport?.whisperStatus?.attempted && !activeReport.whisperStatus.success ? 'text-rose-400' : 'text-emerald-400'}`} />
                <span>Сверка текста (Whisper)</span>
                {activeReport?.whisperStatus?.attempted && !activeReport.whisperStatus.success ? (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-900 text-rose-200 border border-rose-700">
                    Сбой ASR
                  </span>
                ) : (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-900 text-emerald-200 border border-emerald-700">
                    {textMismatchCount}
                  </span>
                )}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => handleToggleSelectAll(true)}
              className="px-2.5 py-1 text-xs text-blue-400 hover:bg-blue-600/10 rounded-md transition-colors font-medium flex items-center gap-1"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              Выбрать все
            </button>
            <span className="text-neutral-700">|</span>
            <button
              onClick={() => handleToggleSelectAll(false)}
              className="px-2.5 py-1 text-xs text-neutral-400 hover:bg-neutral-800 rounded-md transition-colors font-medium flex items-center gap-1"
            >
              <Square className="w-3.5 h-3.5" />
              Снять все
            </button>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="p-3.5 border-b border-neutral-800 bg-neutral-950/30 flex flex-col gap-3 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Dubber Filter Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-0.5 scrollbar-hide">
              <span className="text-xs text-neutral-500 font-medium mr-1 shrink-0">Дабер:</span>
              <button
                onClick={() => setSelectedDubberFilter('all')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all shrink-0 ${
                  selectedDubberFilter === 'all'
                    ? 'bg-neutral-700 text-white'
                    : 'bg-neutral-800/60 text-neutral-400 hover:text-white'
                }`}
              >
                Все
              </button>
              {dubbers.map(dubber => {
                const count = gaps.filter(g => g.dubberName === dubber || g.secondDubberName === dubber).length;
                return (
                  <button
                    key={dubber}
                    onClick={() => setSelectedDubberFilter(dubber)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all shrink-0 ${
                      selectedDubberFilter === dubber
                        ? 'bg-neutral-700 text-white'
                        : 'bg-neutral-800/60 text-neutral-400 hover:text-white'
                    }`}
                  >
                    {dubber} ({count})
                  </button>
                );
              })}
            </div>

            {/* Search Input */}
            <div className="relative w-72">
              <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Поиск по тексту или персонажу..."
                className="w-full bg-neutral-800/80 border border-neutral-700/80 text-white text-xs rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-neutral-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Sub-Filters for Audio Artifacts */}
          {selectedCategoryTab === 'audio_artifact' && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 border-t border-neutral-800/80 pt-2.5">
              <span className="text-xs text-neutral-500 font-medium mr-1 shrink-0">Тип дефекта:</span>
              <button
                onClick={() => setSelectedArtifactTypeFilter('all')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all shrink-0 ${
                  selectedArtifactTypeFilter === 'all'
                    ? 'bg-rose-600 text-white font-bold shadow-sm'
                    : 'bg-neutral-800/60 text-neutral-400 hover:text-white'
                }`}
              >
                Все ({artifactsCount})
              </button>
              <button
                onClick={() => setSelectedArtifactTypeFilter('clipping')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all shrink-0 flex items-center gap-1 ${
                  selectedArtifactTypeFilter === 'clipping'
                    ? 'bg-rose-500 text-white font-bold shadow-sm'
                    : 'bg-neutral-800/60 text-neutral-400 hover:text-white'
                }`}
              >
                🔴 Перегруз ({clippingCount})
              </button>
              <button
                onClick={() => setSelectedArtifactTypeFilter('mouse_click')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all shrink-0 flex items-center gap-1 ${
                  selectedArtifactTypeFilter === 'mouse_click'
                    ? 'bg-amber-500 text-neutral-950 font-bold shadow-sm'
                    : 'bg-neutral-800/60 text-neutral-400 hover:text-white'
                }`}
              >
                🐭 Клики мыши ({clicksCount})
              </button>
              <button
                onClick={() => setSelectedArtifactTypeFilter('plosive')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all shrink-0 flex items-center gap-1 ${
                  selectedArtifactTypeFilter === 'plosive'
                    ? 'bg-sky-500 text-neutral-950 font-bold shadow-sm'
                    : 'bg-neutral-800/60 text-neutral-400 hover:text-white'
                }`}
              >
                💨 Взрывные П/Б ({plosivesCount})
              </button>
              <button
                onClick={() => setSelectedArtifactTypeFilter('swallowed_vowel')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all shrink-0 flex items-center gap-1 ${
                  selectedArtifactTypeFilter === 'swallowed_vowel'
                    ? 'bg-purple-600 text-white font-bold shadow-sm'
                    : 'bg-neutral-800/60 text-neutral-400 hover:text-white'
                }`}
              >
                📉 Обрывы гейтом ({cutoffsCount})
              </button>
            </div>
          )}
        </div>

        {/* Defect Items List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 custom-scrollbar">
          {/* Explicit Whisper Result Banner */}
          {activeReport?.whisperStatus?.attempted && (
            <div className={`p-3.5 rounded-xl border text-xs transition-all ${
              !activeReport.whisperStatus.success || !activeReport.whisperStatus.ready
                ? 'bg-rose-950/30 border-rose-500/50 text-rose-200 shadow-sm'
                : 'bg-emerald-950/25 border-emerald-500/40 text-emerald-200 shadow-sm'
            }`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <div className={`p-1.5 rounded-lg border mt-0.5 shrink-0 ${
                    !activeReport.whisperStatus.success || !activeReport.whisperStatus.ready
                      ? 'bg-rose-900/50 border-rose-500/40 text-rose-400'
                      : 'bg-emerald-900/50 border-emerald-500/40 text-emerald-400'
                  }`}>
                    {!activeReport.whisperStatus.success || !activeReport.whisperStatus.ready ? (
                      <AlertTriangle className="w-4 h-4" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-neutral-100">
                        {!activeReport.whisperStatus.success || !activeReport.whisperStatus.ready
                          ? 'Проверка текста по Whisper: неудачна / не произошла'
                          : 'Проверка текста по Whisper: успешно выполнена'}
                      </span>
                      <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border ${
                        !activeReport.whisperStatus.success || !activeReport.whisperStatus.ready
                          ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                          : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      }`}>
                        {!activeReport.whisperStatus.success || !activeReport.whisperStatus.ready ? 'Сбой проверки' : 'ASR OK'}
                      </span>
                      {activeReport.whisperStatus.modelUsed && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700 font-mono">
                          модель: {activeReport.whisperStatus.modelUsed}
                        </span>
                      )}
                    </div>

                    <p className="opacity-95 leading-relaxed text-xs">
                      {!activeReport.whisperStatus.success || !activeReport.whisperStatus.ready
                        ? (activeReport.whisperStatus.errorMessage || 'Система Whisper не была готова к загрузке выбранной модели или возникла ошибка при вызове ASR.')
                        : `Проверено озвученных реплик: ${activeReport.whisperStatus.totalLinesChecked}, выявлено расхождений со сценарием: ${activeReport.whisperStatus.discrepanciesCount}.`}
                    </p>

                    {!activeReport.whisperStatus.success && (
                      <p className="text-[11px] text-rose-300/80">
                        Аудиодорожки не были сверены со сценарием через нейросеть. Ознакомьтесь с журналом проверки для анализа причин.
                      </p>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setIsLogModalOpen(true)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-800/90 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 transition-colors shrink-0 flex items-center gap-1.5"
                >
                  <ScrollText className="w-3.5 h-3.5 text-sky-400" />
                  <span>Посмотреть лог</span>
                </button>
              </div>
            </div>
          )}

          {filteredGaps.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-neutral-500">
              {selectedCategoryTab === 'text_mismatch' && activeReport?.whisperStatus?.attempted ? (
                !activeReport.whisperStatus.success || !activeReport.whisperStatus.ready ? (
                  <div className="max-w-md mx-auto space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-rose-900/30 border border-rose-500/40 text-rose-400 flex items-center justify-center mx-auto">
                      <XCircle className="w-6 h-6" />
                    </div>
                    <div className="text-base font-bold text-rose-200">
                      Проверка текста по Whisper: неудачна / не произошла
                    </div>
                    <p className="text-xs text-rose-300/90 leading-relaxed">
                      {activeReport.whisperStatus.errorMessage || 'Система Whisper не была готова к загрузке модели, либо сервис вернул ошибку.'}
                    </p>
                    <div className="pt-2">
                      <button
                        onClick={() => setIsLogModalOpen(true)}
                        className="px-4 py-2 rounded-lg bg-rose-900/60 hover:bg-rose-900 text-xs font-semibold text-rose-100 border border-rose-500/40 transition-colors inline-flex items-center gap-2"
                      >
                        <ScrollText className="w-4 h-4" />
                        Открыть журнал проверок
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="max-w-md mx-auto space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-900/30 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                    <div className="text-base font-bold text-emerald-200">
                      Расхождений текста не обнаружено!
                    </div>
                    <p className="text-xs text-neutral-400 leading-relaxed">
                      Все {activeReport.whisperStatus.totalLinesChecked} озвученных реплик в точности соответствуют тексту субтитров (модель: {activeReport.whisperStatus.modelUsed}).
                    </p>
                    <div className="pt-2">
                      <button
                        onClick={() => setIsLogModalOpen(true)}
                        className="px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-200 border border-neutral-700 transition-colors inline-flex items-center gap-2"
                      >
                        <ScrollText className="w-4 h-4 text-emerald-400" />
                        Открыть журнал проверок
                      </button>
                    </div>
                  </div>
                )
              ) : (
                <>
                  <Check className="w-12 h-12 text-emerald-500/40 mb-3" />
                  <div className="text-base font-semibold text-neutral-300">
                    {gaps.length === 0 ? 'Замечаний не обнаружено!' : 'Ничего не найдено по заданным фильтрам'}
                  </div>
                  <p className="text-xs text-neutral-500 mt-1 max-w-sm">
                    {gaps.length === 0 
                      ? 'Все реплики субтитров озвучены корректно, лишней речи и конфликтов не найдено.' 
                      : 'Попробуйте сбросить фильтр или строку поиска.'}
                  </p>
                </>
              )}
            </div>
          ) : (
            filteredGaps.map(gap => (
              <MissingLinesDefectCard
                key={gap.id}
                gap={gap}
                selectedGapId={selectedGapId}
                playingSnippetId={playingSnippetId}
                isLoopingSnippet={isLoopingSnippet}
                activeReassignGapId={activeReassignGapId}
                setActiveReassignGapId={setActiveReassignGapId}
                customCharInput={customCharInput}
                setCustomCharInput={setCustomCharInput}
                availableCharacters={availableCharacters}
                handleInspectDefectInPlayer={handleInspectDefectInPlayer}
                handleToggleSingle={handleToggleSingle}
                handlePlaySnippet={handlePlaySnippet}
                onSeekMainPlayer={onSeekMainPlayer}
                handleRemoveGap={handleRemoveGap}
                handleCancelReassign={handleCancelReassign}
                handleReassignGapCharacter={handleReassignGapCharacter}
                handleResolutionChange={handleResolutionChange}
                handleCommentChange={handleCommentChange}
                updateGaps={updateGaps}
              />
            ))
          )}
        </div>
      </div>

      <MissingLinesPlayerAndModals
        gaps={gaps}
        activeSelectedGap={activeSelectedGap}
        activeSubLine={activeSubLine}
        activeDubberNickname={activeDubberNickname}
        availableCharacters={availableCharacters}
        videoRef={videoRef}
        videoUrl={videoUrl}
        isVideoPlaying={isVideoPlaying}
        setIsVideoPlaying={setIsVideoPlaying}
        videoCurrentTime={videoCurrentTime}
        setVideoCurrentTime={setVideoCurrentTime}
        videoDuration={videoDuration}
        setVideoDuration={setVideoDuration}
        isMuted={isMuted}
        setIsMuted={setIsMuted}
        playbackRate={playbackRate}
        setPlaybackRate={setPlaybackRate}
        isLoopingSnippet={isLoopingSnippet}
        setIsLoopingSnippet={setIsLoopingSnippet}
        handleVideoTimeUpdate={handleVideoTimeUpdate}
        formatTimecode={formatTimecode}
        onExportSubtitles={onExportSubtitles}
        isExportingSub={isExportingSub}
        handleExportSubtitlesAction={handleExportSubtitlesAction}
        selectedReassignCharacter={selectedReassignCharacter}
        setSelectedReassignCharacter={setSelectedReassignCharacter}
        customCharacterName={customCharacterName}
        setCustomCharacterName={setCustomCharacterName}
        editingSubText={editingSubText}
        setEditingSubText={setEditingSubText}
        isSavingSub={isSavingSub}
        handleSaveSubChanges={handleSaveSubChanges}
        selectedCount={selectedCount}
        silenceActionsCount={silenceActionsCount}
        transferActionsCount={transferActionsCount}
        reassignedCount={reassignedCount}
        fixSubsActionsCount={fixSubsActionsCount}
        missingReportCount={missingReportCount}
        dubberFixArtifactsCount={dubberFixArtifactsCount}
        soundEngineerArtifactsCount={soundEngineerArtifactsCount}
        textMismatchFixCount={textMismatchFixCount}
        textMismatchActorBetterCount={textMismatchActorBetterCount}
        episode={episode}
        isSavingToTiming={isSavingToTiming}
        handleSaveToTiming={handleSaveToTiming}
        handleGenerateReportForSE={handleGenerateReportForSE}
        onClose={onClose}
        handleSubmit={handleSubmit}
        isApplying={isApplying}
        soundEngineerModalOpen={soundEngineerModalOpen}
        setSoundEngineerModalOpen={setSoundEngineerModalOpen}
        soundEngineerReportText={soundEngineerReportText}
        setSoundEngineerReportText={setSoundEngineerReportText}
        hasCopiedReport={hasCopiedReport}
        handleCopyReport={handleCopyReport}
        onOpenTimingPanel={onOpenTimingPanel}
        isLogModalOpen={isLogModalOpen}
        setIsLogModalOpen={setIsLogModalOpen}
        activeReport={activeReport}
        logFilterStage={logFilterStage}
        setLogFilterStage={setLogFilterStage}
        copiedLogs={copiedLogs}
        setCopiedLogs={setCopiedLogs}
      />
        </div>
      </div>
    </div>
  );
};
