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
import { Episode, Participant, SubtitleLine } from '../../types';

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
    (g.defectCategory === 'actor_overlap' && g.resolutionAction === 'silence')
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

  const handleCopyReport = () => {
    if (!soundEngineerReportText) return;
    navigator.clipboard.writeText(soundEngineerReportText);
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
              title="Сформировать подробный отчет для звукорежиссера по наездам, конфликтам и рассинхрону"
            >
              <Headphones className="w-3.5 h-3.5 text-indigo-400" />
              <span>Сообщение звукарю</span>
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
            filteredGaps.map(gap => {
              const category = gap.defectCategory || 'missing_line';
              const isPlayingPrimary = playingSnippetId === `${gap.id}_primary`;
              const isPlayingSecondary = playingSnippetId === `${gap.id}_secondary`;
              const isPlayingOriginal = playingSnippetId === `${gap.id}_original`;
              const isPlayingMix = playingSnippetId === `${gap.id}_mix`;

              return (
                <div
                  key={gap.id}
                  onClick={() => handleInspectDefectInPlayer(gap)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer ${
                    selectedGapId === gap.id
                      ? 'ring-2 ring-amber-500/80 bg-neutral-850 border-amber-500/60 shadow-lg'
                      : gap.selected
                        ? (gap.isSubtitleError || gap.resolutionAction === 'reassign_character'
                            ? 'bg-purple-950/20 border-purple-500/60 hover:border-purple-400 ring-1 ring-purple-500/20 shadow-sm'
                            : 'bg-neutral-800/50 border-neutral-700 hover:border-neutral-600')
                        : 'bg-neutral-900/40 border-neutral-800/60 opacity-60'
                  }`}
                >
                  <div className="flex items-start gap-3.5">
                    {/* Checkbox */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleSingle(gap.id);
                      }}
                      className={`mt-1 p-0.5 rounded transition-colors shrink-0 ${
                        gap.selected ? 'text-blue-400 hover:text-blue-300' : 'text-neutral-600 hover:text-neutral-400'
                      }`}
                      title={gap.selected ? "Исключить" : "Включить в применение"}
                    >
                      {gap.selected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                    </button>

                    {/* Content Body */}
                    <div className="flex-1 min-w-0 space-y-3">
                      
                      {/* Top Meta Line */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Timecode button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleInspectDefectInPlayer(gap);
                            }}
                            className={`px-2 py-0.5 rounded text-xs font-mono font-bold transition-all flex items-center gap-1.5 ${
                              selectedGapId === gap.id
                                ? 'bg-amber-500 text-neutral-950 shadow-sm'
                                : 'bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20'
                            }`}
                            title="Открыть и синхронизировать фрагмент в видеоплеере"
                          >
                            <Video className="w-3.5 h-3.5" />
                            <span>⏱ {gap.startFormatted} – {gap.endFormatted} ({gap.durationSec}с)</span>
                          </button>

                          {selectedGapId === gap.id && (
                            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              В плеере
                            </span>
                          )}

                          {/* Category Tag */}
                          {category === 'missing_line' && !gap.isSubtitleError && (
                            <span className="text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 font-semibold">
                              {gap.typeLabel}
                            </span>
                          )}
                          {category === 'unwanted_speech' && (
                            <span className="text-xs px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 font-semibold flex items-center gap-1">
                              <Scissors className="w-3 h-3 text-amber-400" />
                              Озвучено вне сабов
                            </span>
                          )}
                          {category === 'actor_collision' && (
                            <span className="text-xs px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 font-semibold flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3 text-blue-400" />
                              Конфликт: озвучили вдвоём
                            </span>
                          )}
                          {category === 'actor_overlap' && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs px-2 py-0.5 rounded bg-orange-500/10 text-orange-300 border border-orange-500/20 font-semibold flex items-center gap-1">
                                <Zap className="w-3 h-3 text-orange-400" />
                                Наезд хвоста (~{gap.overlapSec || 0.2}с)
                              </span>
                              {gap.isTimingTooLongMerged && (
                                <span className="text-xs px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30 font-semibold flex items-center gap-1">
                                  <Clock className="w-3 h-3 text-purple-400" />
                                  Длиннее саба (+{gap.timingDeltaPercent}%) • 1 фикс
                                </span>
                              )}
                            </div>
                          )}
                          {category === 'timing_too_short' && (
                            <span className="text-xs px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 font-semibold flex items-center gap-1">
                              <Clock className="w-3 h-3 text-cyan-400" />
                              Короче саба (-{Math.abs(gap.timingDeltaPercent || 30)}%)
                            </span>
                          )}
                          {category === 'timing_too_long' && (
                            <span className="text-xs px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 font-semibold flex items-center gap-1">
                              <Clock className="w-3 h-3 text-purple-400" />
                              Длиннее саба (+{gap.timingDeltaPercent || 40}%)
                            </span>
                          )}
                          {category === 'text_mismatch' && (
                            <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold flex items-center gap-1">
                              <Sparkles className="w-3 h-3 text-emerald-400" />
                              {gap.typeLabel || 'Сверка текста (Whisper)'}
                            </span>
                          )}

                          {/* Dubber badge */}
                          <span className="text-xs font-bold text-white bg-neutral-800 px-2 py-0.5 rounded border border-neutral-700">
                            🎙 {gap.dubberName} ({gap.characterName})
                          </span>

                          {gap.secondDubberName && (
                            <span className="text-xs font-bold text-white bg-neutral-800 px-2 py-0.5 rounded border border-neutral-700">
                              ⚡ 🎙 {gap.secondDubberName} ({gap.secondCharacterName})
                            </span>
                          )}

                          {/* Reassigned badge */}
                          {(gap.isSubtitleError || gap.resolutionAction === 'reassign_character') && (
                            <span className="text-xs font-bold text-purple-200 bg-purple-950/80 px-2.5 py-0.5 rounded-lg border border-purple-500/50 flex items-center gap-1.5 shadow-sm">
                              <ArrowRightLeft className="w-3.5 h-3.5 text-purple-300" />
                              <span>Переназначено: <strong>{gap.reassignedCharacterName || gap.selectedCharacterForSub}</strong> ({gap.reassignedDubberName || 'Даббер'})</span>
                            </span>
                          )}
                        </div>

                        {/* Right Quick Actions */}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleRemoveGap(gap.id)}
                            className="p-1 text-neutral-500 hover:text-red-400 rounded transition-colors"
                            title="Игнорировать это замечание"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* CATEGORY 1: MISSING LINE (ПРОПУСК) */}
                      {category === 'missing_line' && (
                        <div className="space-y-2.5">
                          {/* Subtitle text */}
                          <div className="bg-black/40 border border-neutral-800 rounded-lg p-2.5 text-xs text-neutral-200">
                            <span className="text-neutral-500 font-semibold mr-1.5">Текст субтитра:</span>
                            <span className="font-medium text-amber-200/90 italic">"{gap.text}"</span>
                          </div>

                          <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5">
                            <div className="flex items-center gap-2">
                              {gap.audioBuffer && (
                                <button
                                  onClick={() => handlePlaySnippet(gap, 'primary')}
                                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                                    isPlayingPrimary
                                      ? 'bg-amber-500 text-black border-amber-400 shadow-md animate-pulse font-bold'
                                      : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700 hover:bg-neutral-700'
                                  }`}
                                >
                                  {isPlayingPrimary ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                                  <span>{isPlayingPrimary ? 'Остановить' : 'Тест дорожки дабера'}</span>
                                </button>
                              )}

                              <button
                                onClick={() => onSeekMainPlayer?.(gap.startSec)}
                                className="px-2.5 py-1 rounded-lg text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 flex items-center gap-1"
                              >
                                ⏱ В видеоплееpe
                              </button>
                            </div>

                            <span className="text-[11px] font-mono text-neutral-400">
                              Разбег громкости: <strong className="text-neutral-200">{gap.dynamicRangeDb} дБ</strong> (пик {gap.peakDb} дБ)
                            </span>
                          </div>

                          {/* Subtitle attribution error / Reassign character module */}
                          {gap.isSubtitleError && gap.reassignedCharacterName ? (
                            <div className="bg-purple-950/30 border border-purple-500/40 rounded-xl p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                              <div className="flex items-start gap-2.5">
                                <div className="p-1.5 rounded-lg bg-purple-500/20 border border-purple-500/30 text-purple-300 shrink-0 mt-0.5">
                                  <ArrowRightLeft className="w-4 h-4" />
                                </div>
                                <div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-bold text-purple-200 text-xs">Фраза переназначена в субтитрах:</span>
                                    <span className="px-2 py-0.5 rounded bg-purple-500/20 border border-purple-400/40 text-purple-100 font-bold">
                                      {gap.reassignedCharacterName} ({gap.reassignedDubberName || 'Даббер'})
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-purple-300/80 mt-1 leading-relaxed">
                                    В субтитрах имя персонажа будет исправлено на <strong>{gap.reassignedCharacterName}</strong>. Замечание с просьбой доозвучить отправится дабберу <strong>{gap.reassignedDubberName}</strong>. С даббера <strong>{gap.dubberName}</strong> снята претензия (он не виноват в чужой фразе).
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                                <button
                                  onClick={() => setActiveReassignGapId(activeReassignGapId === gap.id ? null : gap.id)}
                                  className="px-2.5 py-1.5 rounded-lg bg-purple-900/40 hover:bg-purple-800/60 border border-purple-600/40 text-purple-200 text-xs font-medium transition-colors"
                                >
                                  Сменить персонажа
                                </button>
                                <button
                                  onClick={() => handleCancelReassign(gap.id)}
                                  className="px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 hover:text-white text-xs font-medium transition-colors flex items-center gap-1"
                                  title="Сбросить переназначение и вернуть как обычный пропуск"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                  <span>Сбросить</span>
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="pt-0.5">
                              {activeReassignGapId !== gap.id && (
                                <button
                                  onClick={() => setActiveReassignGapId(gap.id)}
                                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-950/40 hover:bg-purple-900/60 text-purple-300 hover:text-purple-200 border border-purple-800/50 hover:border-purple-600/60 transition-all flex items-center gap-1.5 shadow-sm"
                                  title="Указать, что эта фраза попала дабберу по ошибке и принадлежит другому персонажу"
                                >
                                  <ArrowRightLeft className="w-3.5 h-3.5 text-purple-400" />
                                  <span>Фраза другого персонажа? (ошибка в субтитрах)</span>
                                </button>
                              )}
                            </div>
                          )}

                          {/* Active character selection dropdown/panel */}
                          {activeReassignGapId === gap.id && (
                            <div className="bg-neutral-950 border border-purple-500/40 rounded-xl p-3.5 space-y-3 animate-fadeIn">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <ArrowRightLeft className="w-4 h-4 text-purple-400" />
                                  <span className="text-xs font-bold text-white">Кому на самом деле принадлежит эта фраза?</span>
                                </div>
                                <button
                                  onClick={() => setActiveReassignGapId(null)}
                                  className="text-neutral-500 hover:text-white text-xs px-1.5 py-0.5 rounded hover:bg-neutral-800"
                                >
                                  ✕
                                </button>
                              </div>

                              <p className="text-[11px] text-neutral-400">
                                Выберите правильного персонажа. Программа автоматически обновит файл субтитров, снимет претензию с текущего даббера и сформирует задачу на доозвучку для нужного персонажа.
                              </p>

                              {/* Available characters chips */}
                              <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                                {availableCharacters
                                  .filter(c => c.characterName.toLowerCase() !== (gap.characterName || '').toLowerCase())
                                  .map(c => (
                                    <button
                                      key={c.characterName}
                                      onClick={() => {
                                        handleReassignGapCharacter(gap.id, c.characterName);
                                        setActiveReassignGapId(null);
                                      }}
                                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 ${
                                        gap.reassignedCharacterName?.toLowerCase() === c.characterName.toLowerCase()
                                          ? 'bg-purple-600 border-purple-400 text-white shadow-md'
                                          : 'bg-neutral-900 hover:bg-purple-950/60 border-neutral-700 hover:border-purple-500/50 text-neutral-300 hover:text-purple-200'
                                      }`}
                                    >
                                      <span className="font-semibold">{c.characterName}</span>
                                      <span className="text-[10px] opacity-75">({c.dubberName})</span>
                                    </button>
                                  ))}
                              </div>

                              {/* Manual character name input */}
                              <div className="flex items-center gap-2 pt-1 border-t border-neutral-800">
                                <span className="text-[11px] text-neutral-400 shrink-0">Или ввести имя персонажа:</span>
                                <input
                                  type="text"
                                  placeholder="Имя персонажа..."
                                  value={customCharInput[gap.id] || ''}
                                  onChange={e => setCustomCharInput({ ...customCharInput, [gap.id]: e.target.value })}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && customCharInput[gap.id]?.trim()) {
                                      handleReassignGapCharacter(gap.id, customCharInput[gap.id]);
                                      setActiveReassignGapId(null);
                                    }
                                  }}
                                  className="flex-1 bg-neutral-900 border border-neutral-700 rounded-lg px-2.5 py-1 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500"
                                />
                                <button
                                  onClick={() => {
                                    if (customCharInput[gap.id]?.trim()) {
                                      handleReassignGapCharacter(gap.id, customCharInput[gap.id]);
                                      setActiveReassignGapId(null);
                                    }
                                  }}
                                  disabled={!customCharInput[gap.id]?.trim()}
                                  className="px-3 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-xs font-medium transition-colors"
                                >
                                  Назначить
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* CATEGORY 2: UNWANTED SPEECH (ОЗВУЧЕНО ТАМ, ГДЕ НЕ НАДО) */}
                      {category === 'unwanted_speech' && (
                        <div className="space-y-2.5">
                          {/* Context card */}
                          <div className="bg-amber-950/20 border border-amber-900/30 rounded-lg p-2.5 text-xs text-neutral-300 flex items-center justify-between">
                            <div>
                              <span className="text-amber-400 font-bold mr-2">Контекст таймкода:</span>
                              <span>{gap.nearestContext || 'Фраза вне интервалов субтитров'}</span>
                            </div>
                            <span className="text-[11px] font-mono text-neutral-400">
                              Разбег: {gap.dynamicRangeDb} дБ, Пик: {gap.peakDb} дБ
                            </span>
                          </div>

                          {/* Listening controls */}
                          <div className="flex items-center gap-2 flex-wrap">
                            {gap.audioBuffer && (
                              <button
                                onClick={() => handlePlaySnippet(gap, 'primary')}
                                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                                  isPlayingPrimary
                                    ? 'bg-amber-500 text-black border-amber-400 shadow-md animate-pulse font-bold'
                                    : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700 hover:bg-neutral-700'
                                }`}
                              >
                                {isPlayingPrimary ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                                <span>{isPlayingPrimary ? 'Стоп' : `Слушать ${gap.dubberName}`}</span>
                              </button>
                            )}

                            <button
                              onClick={() => handlePlaySnippet(gap, 'original')}
                              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                                isPlayingOriginal
                                  ? 'bg-blue-600 text-white border-blue-500 shadow-md animate-pulse font-bold'
                                  : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700 hover:bg-neutral-700'
                              }`}
                            >
                              {isPlayingOriginal ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Volume2 className="w-3.5 h-3.5 text-blue-400" />}
                              <span>{isPlayingOriginal ? 'Стоп' : 'Слушать оригинал'}</span>
                            </button>

                            <button
                              onClick={() => onSeekMainPlayer?.(gap.startSec)}
                              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 flex items-center gap-1"
                            >
                              ⏱ В плеере
                            </button>
                          </div>

                          {/* Curator Decision Choice Bar */}
                          <div className="bg-neutral-900/90 border border-neutral-700/80 rounded-xl p-2.5 flex items-center justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-white flex items-center gap-1">
                                <Sliders className="w-3.5 h-3.5 text-amber-400" />
                                Решение куратора:
                              </span>

                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleResolutionChange(gap.id, 'keep')}
                                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border ${
                                    gap.resolutionAction === 'keep'
                                      ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                                      : 'bg-neutral-800 text-neutral-400 hover:text-white border-neutral-700'
                                  }`}
                                >
                                  <Shield className="w-3.5 h-3.5" />
                                  Оставить как есть
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleResolutionChange(gap.id, 'silence')}
                                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border ${
                                    gap.resolutionAction === 'silence'
                                      ? 'bg-amber-500 text-neutral-950 border-amber-400 shadow-sm'
                                      : 'bg-neutral-800 text-neutral-400 hover:text-white border-neutral-700'
                                  }`}
                                >
                                  <VolumeX className="w-3.5 h-3.5" />
                                  Заменить тишиной
                                </button>
                              </div>
                            </div>

                            <span className="text-xs font-medium">
                              {gap.resolutionAction === 'silence' ? (
                                <span className="text-amber-300">✂ Будет вырезано тишиной на аудиодорожке</span>
                              ) : (
                                <span className="text-emerald-400">✓ Фраза сохраняется без изменений</span>
                              )}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* CATEGORY 3: COLLISION (КОНФЛИКТ ДУБЛЯЖА) */}
                      {category === 'actor_collision' && (
                        <div className="space-y-3">
                          {/* Subtitle text */}
                          <div className="bg-black/40 border border-neutral-800 rounded-lg p-2.5 text-xs text-neutral-200">
                            <span className="text-neutral-500 font-semibold mr-1.5">Текст спорного субтитра:</span>
                            <span className="font-medium text-amber-200/90 italic">"{gap.text}"</span>
                          </div>

                          {/* Dual Dubber Comparison Player */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                            {/* Actor 1 */}
                            <div className="p-3 bg-neutral-900/80 rounded-xl border border-neutral-800 flex items-center justify-between gap-2">
                              <div>
                                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                                  <span>🎙 {gap.dubberName}</span>
                                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">
                                    {gap.characterName}
                                  </span>
                                </div>
                                <div className="text-[10px] text-neutral-400 font-mono mt-0.5">
                                  Пик: {gap.peakDb} дБ, Разбег: {gap.dynamicRangeDb} дБ
                                </div>
                              </div>

                              <button
                                onClick={() => handlePlaySnippet(gap, 'primary')}
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1 border ${
                                  isPlayingPrimary
                                    ? 'bg-amber-500 text-black border-amber-400 font-bold animate-pulse'
                                    : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
                                }`}
                              >
                                {isPlayingPrimary ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
                                <span>{isPlayingPrimary ? 'Стоп' : 'Слушать'}</span>
                              </button>
                            </div>

                            {/* Actor 2 */}
                            <div className="p-3 bg-neutral-900/80 rounded-xl border border-neutral-800 flex items-center justify-between gap-2">
                              <div>
                                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                                  <span>🎙 {gap.secondDubberName}</span>
                                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">
                                    {gap.secondCharacterName}
                                  </span>
                                </div>
                                <div className="text-[10px] text-neutral-400 font-mono mt-0.5">
                                  Пик: {gap.secondPeakDb ?? 0} дБ, Разбег: {gap.secondDynamicRangeDb ?? 0} дБ
                                </div>
                              </div>

                              <button
                                onClick={() => handlePlaySnippet(gap, 'secondary')}
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1 border ${
                                  isPlayingSecondary
                                    ? 'bg-amber-500 text-black border-amber-400 font-bold animate-pulse'
                                    : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
                                }`}
                              >
                                {isPlayingSecondary ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
                                <span>{isPlayingSecondary ? 'Стоп' : 'Слушать'}</span>
                              </button>
                            </div>
                          </div>

                          {/* Reference audio buttons */}
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handlePlaySnippet(gap, 'original')}
                              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                                isPlayingOriginal
                                  ? 'bg-blue-600 text-white border-blue-500 font-bold animate-pulse'
                                  : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
                              }`}
                            >
                              {isPlayingOriginal ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Volume2 className="w-3.5 h-3.5 text-blue-400" />}
                              <span>{isPlayingOriginal ? 'Стоп' : 'Слушать оригинал (японский звук)'}</span>
                            </button>

                            <button
                              onClick={() => onSeekMainPlayer?.(gap.startSec)}
                              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 flex items-center gap-1"
                            >
                              ⏱ В видеоплеере (увидеть кадр)
                            </button>
                          </div>

                          {/* Conflict Resolution Choices */}
                          <div className="bg-neutral-900/95 border border-neutral-700/80 rounded-xl p-3 space-y-2.5">
                            <div className="text-xs font-bold text-white flex items-center gap-1.5">
                              <Sliders className="w-3.5 h-3.5 text-blue-400" />
                              <span>Решение конфликта куратором:</span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                              {/* Strategy 1: Ошибка росписи сабов */}
                              <div className={`p-2.5 rounded-lg border transition-all ${
                                gap.resolutionAction === 'fix_subs' 
                                  ? 'bg-blue-950/40 border-blue-500/60' 
                                  : 'bg-neutral-950/30 border-neutral-800'
                              }`}>
                                <div className="flex items-center gap-1.5 font-bold text-xs text-white mb-1.5">
                                  <FileText className="w-3.5 h-3.5 text-blue-400" />
                                  <span>Ошибка росписи сабов (авто-исправление)</span>
                                </div>
                                <p className="text-[11px] text-neutral-400 mb-2">
                                  Скорректировать имя персонажа в строке субтитров:
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleResolutionChange(gap.id, 'fix_subs', gap.characterName)}
                                    className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
                                      gap.resolutionAction === 'fix_subs' && gap.selectedCharacterForSub === gap.characterName
                                        ? 'bg-blue-600 text-white shadow-sm'
                                        : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                                    }`}
                                  >
                                    Переписать на {gap.characterName}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleResolutionChange(gap.id, 'fix_subs', gap.secondCharacterName)}
                                    className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
                                      gap.resolutionAction === 'fix_subs' && gap.selectedCharacterForSub === gap.secondCharacterName
                                        ? 'bg-blue-600 text-white shadow-sm'
                                        : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                                    }`}
                                  >
                                    Переписать на {gap.secondCharacterName}
                                  </button>
                                </div>
                              </div>

                              {/* Strategy 2: Ошибка даббера */}
                              <div className={`p-2.5 rounded-lg border transition-all ${
                                (gap.resolutionAction === 'keep_first' || gap.resolutionAction === 'keep_second') 
                                  ? 'bg-amber-950/40 border-amber-500/60' 
                                  : 'bg-neutral-950/30 border-neutral-800'
                              }`}>
                                <div className="flex items-center gap-1.5 font-bold text-xs text-white mb-1.5">
                                  <Scissors className="w-3.5 h-3.5 text-amber-400" />
                                  <span>Ошибка даббера (заменить лишнее тишиной)</span>
                                </div>
                                <p className="text-[11px] text-neutral-400 mb-2">
                                  Оставить нужного актёра, а ошибку второго заглушить:
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleResolutionChange(gap.id, 'keep_first')}
                                    className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
                                      gap.resolutionAction === 'keep_first'
                                        ? 'bg-amber-500 text-neutral-950 shadow-sm'
                                        : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                                    }`}
                                    title={`Оставить ${gap.dubberName}, а реплику у ${gap.secondDubberName} заменить тишиной`}
                                  >
                                    Оставить {gap.dubberName}, глушить {gap.secondDubberName}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleResolutionChange(gap.id, 'keep_second')}
                                    className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
                                      gap.resolutionAction === 'keep_second'
                                        ? 'bg-amber-500 text-neutral-950 shadow-sm'
                                        : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                                    }`}
                                    title={`Оставить ${gap.secondDubberName}, а реплику у ${gap.dubberName} заменить тишиной`}
                                  >
                                    Оставить {gap.secondDubberName}, глушить {gap.dubberName}
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* CATEGORY 4: ACTOR OVERLAP (НАЕЗД ХВОСТОВ ФРАЗ) */}
                      {category === 'actor_overlap' && (
                        <div className="space-y-3">
                          {/* Collision warning banner */}
                          <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <Zap className="w-4 h-4 text-orange-400 shrink-0" />
                                <span className="text-xs text-orange-200 font-medium">
                                  Хвост фразы <strong>{gap.dubberName}</strong> залезает на реплику <strong>{gap.secondDubberName}</strong> на <strong>~{gap.overlapSec || 0.2}с</strong>
                                </span>
                              </div>
                              {gap.isTimingTooLongMerged && (
                                <p className="text-[11px] text-purple-300/90 pl-6">
                                  ⚠️ Объединено в один фикс: фраза дабера длиннее субтитра на <strong>+{gap.timingDeltaPercent}%</strong> (вылет +{gap.overflowDurationSec || 0.4}с) и залезает на соседний саб.
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {gap.isTimingTooLongMerged && (
                                <span className="text-[11px] px-2 py-0.5 rounded bg-purple-950/80 text-purple-300 font-mono shrink-0 border border-purple-800/40">
                                  +{gap.timingDeltaPercent}%
                                </span>
                              )}
                              <span className="text-[11px] px-2 py-0.5 rounded bg-orange-950/80 text-orange-300 font-mono shrink-0 border border-orange-800/40">
                                Наезд: ~{gap.overlapSec || 0.2}с
                              </span>
                            </div>
                          </div>

                          {/* Dual speech cards */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                            <div className="bg-neutral-950/50 border border-neutral-800 rounded-xl p-3 space-y-1.5">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-bold text-amber-300">1. {gap.dubberName}</span>
                                <span className="text-[11px] text-neutral-400">({gap.characterName})</span>
                              </div>
                              <p className="text-xs text-neutral-300 italic font-medium bg-neutral-900/60 p-2 rounded border border-neutral-800/60">
                                «{gap.text || '...' }»
                              </p>
                            </div>

                            <div className="bg-neutral-950/50 border border-neutral-800 rounded-xl p-3 space-y-1.5">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-bold text-orange-300">2. {gap.secondDubberName}</span>
                                <span className="text-[11px] text-neutral-400">({gap.secondCharacterName})</span>
                              </div>
                              <p className="text-xs text-neutral-300 italic font-medium bg-neutral-900/60 p-2 rounded border border-neutral-800/60">
                                «{gap.secondText || '...' }»
                              </p>
                            </div>
                          </div>

                          {/* Dual playback controls */}
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <button
                              onClick={() => handlePlaySnippet(gap, 'mix')}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border shadow-sm ${
                                isPlayingMix
                                  ? 'bg-orange-500 text-neutral-950 border-orange-400 animate-pulse'
                                  : 'bg-orange-500/20 text-orange-300 hover:bg-orange-500/30 border-orange-500/40'
                              }`}
                              title="Прослушать оба трека одновременно, чтобы оценить наезд"
                            >
                              {isPlayingMix ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Headphones className="w-3.5 h-3.5 text-orange-400" />}
                              <span>{isPlayingMix ? 'Остановить стык' : '🎧 Слушать стык (Оба дабера)'}</span>
                            </button>

                            <button
                              onClick={() => handlePlaySnippet(gap, 'primary')}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                                isPlayingPrimary
                                  ? 'bg-amber-500 text-neutral-950 border-amber-400 font-bold animate-pulse'
                                  : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
                              }`}
                            >
                              {isPlayingPrimary ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 text-amber-400" />}
                              <span>{gap.dubberName}</span>
                            </button>

                            <button
                              onClick={() => handlePlaySnippet(gap, 'secondary')}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                                isPlayingSecondary
                                  ? 'bg-orange-500 text-neutral-950 border-orange-400 font-bold animate-pulse'
                                  : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
                              }`}
                            >
                              {isPlayingSecondary ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 text-orange-400" />}
                              <span>{gap.secondDubberName}</span>
                            </button>

                            <button
                              onClick={() => handlePlaySnippet(gap, 'original')}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                                isPlayingOriginal
                                  ? 'bg-blue-600 text-white border-blue-500 font-bold animate-pulse'
                                  : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
                              }`}
                            >
                              {isPlayingOriginal ? <Pause className="w-3 h-3 fill-current" /> : <Volume2 className="w-3 h-3 text-blue-400" />}
                              <span>Оригинал</span>
                            </button>
                          </div>

                          {/* Action choices for curator */}
                          <div className="bg-neutral-900/95 border border-neutral-700/80 rounded-xl p-3 space-y-2">
                            <div className="text-xs font-bold text-white flex items-center gap-1.5">
                              <Sliders className="w-3.5 h-3.5 text-orange-400" />
                              <span>Решение куратора по наезду:</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => handleResolutionChange(gap.id, 'note_sound_engineer')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                                  gap.resolutionAction === 'note_sound_engineer'
                                    ? 'bg-indigo-600 text-white shadow-sm'
                                    : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                                }`}
                              >
                                <Headphones className="w-3.5 h-3.5 text-indigo-300" />
                                {gap.isTimingTooLongMerged ? 'В записку звукарю (поджать фразу и развести стык)' : 'В записку звукарю (развести стык)'}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleResolutionChange(gap.id, 'silence')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                                  gap.resolutionAction === 'silence'
                                    ? 'bg-amber-500 text-neutral-950 shadow-sm'
                                    : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                                }`}
                              >
                                <Scissors className="w-3.5 h-3.5 text-amber-400" />
                                Заглушить хвост первого тишиной
                              </button>

                              <button
                                type="button"
                                onClick={() => handleResolutionChange(gap.id, 'keep')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                                  gap.resolutionAction === 'keep'
                                    ? 'bg-emerald-600 text-white shadow-sm'
                                    : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                                }`}
                              >
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                Оставить наплыв (нормально)
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* CATEGORY 5: TIMING TOO SHORT (КОРОЧЕ САБА, ВИСЯЩИЙ ЯПОНСКИЙ ХВОСТ) */}
                      {category === 'timing_too_short' && (
                        <div className="space-y-3">
                          {/* Alert info banner */}
                          <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <Clock className="w-4 h-4 text-cyan-400 shrink-0" />
                                <span className="text-xs font-bold text-cyan-200">
                                  Фраза дабера короче субтитра на {Math.abs(gap.timingDeltaPercent || 30)}% (критично &gt;30%)
                                </span>
                              </div>
                              <p className="text-[11px] text-cyan-300/80">
                                Речь дабера длится {gap.speechDurationSec}с при длине саба {gap.subDurationSec}с.
                                Висящий японский хвост оригинала без дубляжа: ~{gap.tailDurationSec || 0.4}с
                              </p>
                            </div>
                            <span className="text-xs px-2.5 py-1 rounded bg-cyan-950/80 text-cyan-300 font-mono font-bold border border-cyan-800/40 shrink-0">
                              Хвост: ~{gap.tailDurationSec || 0.4}с
                            </span>
                          </div>

                          {/* Subtitle text */}
                          <div className="bg-neutral-950/50 border border-neutral-800 rounded-xl p-3 space-y-1">
                            <div className="text-[11px] text-neutral-400 font-medium">Текст субтитра:</div>
                            <p className="text-xs text-neutral-200 font-medium italic">
                              «{gap.text}»
                            </p>
                          </div>

                          {/* Audio Controls */}
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => handlePlaySnippet(gap, 'mix')}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border shadow-sm ${
                                isPlayingMix
                                  ? 'bg-cyan-500 text-neutral-950 border-cyan-400 animate-pulse'
                                  : 'bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 border-cyan-500/40'
                              }`}
                              title="Слушать дабера вместе с японским оригиналом (проверить хвост)"
                            >
                              {isPlayingMix ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Headphones className="w-3.5 h-3.5 text-cyan-400" />}
                              <span>{isPlayingMix ? 'Остановить микс' : '🎧 Микс: Дабер + Японский звук (тест хвоста)'}</span>
                            </button>

                            <button
                              onClick={() => handlePlaySnippet(gap, 'primary')}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                                isPlayingPrimary
                                  ? 'bg-amber-500 text-neutral-950 border-amber-400 font-bold animate-pulse'
                                  : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
                              }`}
                            >
                              {isPlayingPrimary ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 text-amber-400" />}
                              <span>Слушать дабера ({gap.speechDurationSec}с)</span>
                            </button>

                            <button
                              onClick={() => handlePlaySnippet(gap, 'original')}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                                isPlayingOriginal
                                  ? 'bg-blue-600 text-white border-blue-500 font-bold animate-pulse'
                                  : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
                              }`}
                            >
                              {isPlayingOriginal ? <Pause className="w-3 h-3 fill-current" /> : <Volume2 className="w-3 h-3 text-blue-400" />}
                              <span>Оригинал ({gap.subDurationSec}с)</span>
                            </button>
                          </div>

                          {/* Curator decisions */}
                          <div className="bg-neutral-900/95 border border-neutral-700/80 rounded-xl p-3 space-y-2">
                            <div className="text-xs font-bold text-white flex items-center gap-1.5">
                              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                              <span>Решение куратора по японскому хвосту:</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => handleResolutionChange(gap.id, 'note_sound_engineer')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                                  gap.resolutionAction === 'note_sound_engineer'
                                    ? 'bg-indigo-600 text-white shadow-sm'
                                    : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                                }`}
                              >
                                <Headphones className="w-3.5 h-3.5 text-indigo-300" />
                                В записку звукарю (заглушить японский хвост)
                              </button>

                              <button
                                type="button"
                                onClick={() => handleResolutionChange(gap.id, 'keep')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                                  gap.resolutionAction === 'keep'
                                    ? 'bg-emerald-600 text-white shadow-sm'
                                    : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                                }`}
                              >
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                Безопасный момент (допустимо, не глушить)
                              </button>

                              <button
                                type="button"
                                onClick={() => handleResolutionChange(gap.id, 'request_dubber_fix')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                                  gap.resolutionAction === 'request_dubber_fix'
                                    ? 'bg-amber-500 text-neutral-950 shadow-sm'
                                    : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                                }`}
                              >
                                <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
                                Замечание даберу (переозвучить шире)
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* CATEGORY 6: TIMING TOO LONG (ДЛИННЕЕ САБА >40%, ВЫЛЕТ) */}
                      {category === 'timing_too_long' && (
                        <div className="space-y-3">
                          {/* Alert info banner */}
                          <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <Clock className="w-4 h-4 text-purple-400 shrink-0" />
                                <span className="text-xs font-bold text-purple-200">
                                  Фраза дабера длиннее субтитра на +{gap.timingDeltaPercent || 40}% (критично &gt;40%)
                                </span>
                              </div>
                              <p className="text-[11px] text-purple-300/80">
                                Речь дабера длится {gap.speechDurationSec}с при длине саба {gap.subDurationSec}с.
                                Превышение тайминга: +{gap.overflowDurationSec || 0.4}с
                              </p>
                            </div>
                            <span className="text-xs px-2.5 py-1 rounded bg-purple-950/80 text-purple-300 font-mono font-bold border border-purple-800/40 shrink-0">
                              Вылет: +{gap.overflowDurationSec || 0.4}с
                            </span>
                          </div>

                          {/* Subtitle text */}
                          <div className="bg-neutral-950/50 border border-neutral-800 rounded-xl p-3 space-y-1">
                            <div className="text-[11px] text-neutral-400 font-medium">Текст субтитра:</div>
                            <p className="text-xs text-neutral-200 font-medium italic">
                              «{gap.text}»
                            </p>
                          </div>

                          {/* Audio controls */}
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => handlePlaySnippet(gap, 'primary')}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                                isPlayingPrimary
                                  ? 'bg-purple-600 text-white border-purple-500 font-bold animate-pulse'
                                  : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
                              }`}
                            >
                              {isPlayingPrimary ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 text-purple-400" />}
                              <span>Слушать дабера ({gap.speechDurationSec}с)</span>
                            </button>

                            <button
                              onClick={() => handlePlaySnippet(gap, 'original')}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                                isPlayingOriginal
                                  ? 'bg-blue-600 text-white border-blue-500 font-bold animate-pulse'
                                  : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
                              }`}
                            >
                              {isPlayingOriginal ? <Pause className="w-3 h-3 fill-current" /> : <Volume2 className="w-3 h-3 text-blue-400" />}
                              <span>Оригинал ({gap.subDurationSec}с)</span>
                            </button>
                          </div>

                          {/* Curator decisions */}
                          <div className="bg-neutral-900/95 border border-neutral-700/80 rounded-xl p-3 space-y-2">
                            <div className="text-xs font-bold text-white flex items-center gap-1.5">
                              <Sliders className="w-3.5 h-3.5 text-purple-400" />
                              <span>Решение куратора по удлинению:</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => handleResolutionChange(gap.id, 'note_sound_engineer')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                                  gap.resolutionAction === 'note_sound_engineer'
                                    ? 'bg-indigo-600 text-white shadow-sm'
                                    : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                                }`}
                              >
                                <Headphones className="w-3.5 h-3.5 text-indigo-300" />
                                В записку звукарю (поджать/сократить дорожку)
                              </button>

                              <button
                                type="button"
                                onClick={() => handleResolutionChange(gap.id, 'keep')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                                  gap.resolutionAction === 'keep'
                                    ? 'bg-emerald-600 text-white shadow-sm'
                                    : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                                }`}
                              >
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                Оставить как есть (допустимо)
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* CATEGORY 7: AUDIO ARTIFACTS (ТЕХНИЧЕСКИЕ АРТЕФАКТЫ ЗАПИСИ: КЛИППИНГ, КЛИКИ, ЗАДУВЫ, ОБРЫВЫ) */}
                      {category === 'audio_artifact' && (
                        <div className="space-y-3">
                          {/* Artifact Header Info */}
                          <div className={`border rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 ${
                            gap.artifactSeverity === 'high'
                              ? 'bg-rose-950/30 border-rose-500/40 text-rose-200'
                              : gap.artifactSeverity === 'medium'
                              ? 'bg-amber-950/30 border-amber-500/40 text-amber-200'
                              : 'bg-blue-950/30 border-blue-500/40 text-blue-200'
                          }`}>
                            <div className="space-y-1.5 flex-1 min-w-[280px]">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider flex items-center gap-1 border ${
                                  gap.artifactType === 'clipping'
                                    ? 'bg-rose-500 text-white border-rose-400'
                                    : gap.artifactType === 'mouse_click'
                                    ? 'bg-amber-500 text-neutral-950 border-amber-400'
                                    : gap.artifactType === 'plosive'
                                    ? 'bg-sky-500 text-neutral-950 border-sky-400'
                                    : 'bg-purple-500 text-white border-purple-400'
                                }`}>
                                  {gap.artifactType === 'clipping' && '🔴 Клиппинг / Перегруз'}
                                  {gap.artifactType === 'mouse_click' && '🐭 Клик мыши / Щелчок'}
                                  {gap.artifactType === 'plosive' && '💨 Задув капсюля (П/Б)'}
                                  {gap.artifactType === 'swallowed_vowel' && '📉 Обрыв гейтом / Срез'}
                                </span>

                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                  gap.artifactSeverity === 'high'
                                    ? 'bg-rose-900/60 text-rose-200 border-rose-700/60'
                                    : gap.artifactSeverity === 'medium'
                                    ? 'bg-amber-900/60 text-amber-200 border-amber-700/60'
                                    : 'bg-blue-900/60 text-blue-200 border-blue-700/60'
                                }`}>
                                  {gap.artifactSeverity === 'high' ? 'Критично (брак записи)' : gap.artifactSeverity === 'medium' ? 'Заметный огрех' : 'Микро-артефакт'}
                                </span>

                                <span className="text-xs font-bold text-white font-mono bg-neutral-900/80 px-2 py-0.5 rounded border border-neutral-700/70">
                                  Точка дефекта: [{formatTimecode(gap.artifactTimestampSec ?? gap.startSec)}]
                                </span>
                              </div>

                              <p className="text-xs text-neutral-300 leading-relaxed">
                                {gap.artifactDescription || 'Обнаружен технический артефакт в аудиодорожке.'}
                              </p>
                            </div>

                            {gap.artifactMetric && (
                              <div className="px-3 py-1.5 rounded-lg bg-neutral-950/90 border border-neutral-700/90 font-mono text-xs text-amber-300 shrink-0 shadow-inner">
                                {gap.artifactMetric}
                              </div>
                            )}
                          </div>

                          {/* Subtitle Dialogue context (if nearby) */}
                          {gap.nearestSubtitleText && (
                            <div className="bg-neutral-950/60 border border-neutral-800 rounded-xl p-2.5 text-xs text-neutral-300 flex items-start gap-2">
                              <span className="text-neutral-500 font-semibold shrink-0">Фраза в сабах:</span>
                              <span className="font-medium text-amber-200 italic">"{gap.nearestSubtitleText}"</span>
                            </div>
                          )}

                          {/* Interactive Mini-Waveform with Neon Defect Marker */}
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-[11px] text-neutral-400 font-mono px-1">
                              <span>Окно: {gap.startFormatted}</span>
                              <span className="text-rose-400 font-bold flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                Огрех в {formatTimecode(gap.artifactTimestampSec ?? gap.startSec)}
                              </span>
                              <span>{gap.endFormatted}</span>
                            </div>

                            <ArtifactWaveformMarker
                              audioBuffer={gap.audioBuffer}
                              startSec={gap.startSec}
                              endSec={gap.endSec}
                              defectTimestampSec={gap.artifactTimestampSec}
                              isPlaying={isPlayingPrimary}
                              artifactType={gap.artifactType}
                              onSeek={(t) => onSeekMainPlayer?.(t)}
                            />
                          </div>

                          {/* Player Controls: Play, Loop, Seek */}
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handlePlaySnippet(gap, 'primary', false)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                                  isPlayingPrimary && !isLoopingSnippet
                                    ? 'bg-rose-500 text-white border-rose-400 font-bold shadow-md animate-pulse'
                                    : 'bg-neutral-800 text-neutral-200 hover:text-white border-neutral-700 hover:bg-neutral-700'
                                }`}
                              >
                                {isPlayingPrimary && !isLoopingSnippet ? (
                                  <Pause className="w-3.5 h-3.5 fill-current" />
                                ) : (
                                  <Play className="w-3.5 h-3.5 fill-current ml-0.5 text-rose-400" />
                                )}
                                <span>{isPlayingPrimary && !isLoopingSnippet ? 'Стоп' : `Слушать отрезок (${gap.durationSec}с)`}</span>
                              </button>

                              <button
                                onClick={() => {
                                  const nextLoop = !isLoopingSnippet;
                                  setIsLoopingSnippet(nextLoop);
                                  handlePlaySnippet(gap, 'primary', nextLoop);
                                }}
                                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1 border ${
                                  isLoopingSnippet && isPlayingPrimary
                                    ? 'bg-amber-500 text-neutral-950 border-amber-400 font-bold shadow-md animate-pulse'
                                    : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700 hover:bg-neutral-700'
                                }`}
                                title="Зациклить отрезок для детального вслушивания в щелчок или задув"
                              >
                                <Repeat className="w-3.5 h-3.5" />
                                <span>{isLoopingSnippet && isPlayingPrimary ? 'Зациклено (Loop)' : 'Loop (Зациклить)'}</span>
                              </button>

                              <button
                                onClick={() => onSeekMainPlayer?.(gap.artifactTimestampSec ?? gap.startSec)}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 flex items-center gap-1"
                              >
                                ⏱ В плеере
                              </button>
                            </div>

                            <span className="text-[11px] text-neutral-400">
                              Даббер: <strong className="text-white">{gap.dubberName}</strong> ({gap.characterName})
                            </span>
                          </div>

                          {/* Curator 1-Click Action Bar */}
                          <div className="bg-neutral-900/95 border border-neutral-700/80 rounded-xl p-3 space-y-2">
                            <div className="text-xs font-bold text-white flex items-center justify-between">
                              <span className="flex items-center gap-1.5">
                                <Sliders className="w-3.5 h-3.5 text-rose-400" />
                                Решение куратора по артефакту:
                              </span>
                              <span className="text-[11px] font-medium">
                                {gap.resolutionAction === 'request_dubber_fix' && <span className="text-rose-400 font-bold">🔴 Назначена перезапись дабберу</span>}
                                {gap.resolutionAction === 'note_sound_engineer' && <span className="text-indigo-300 font-bold">🎛 Назначено звукорежиссеру (плагины)</span>}
                                {gap.resolutionAction === 'ignore' && <span className="text-neutral-400 font-bold">⚪ Пропуск / всё в норме</span>}
                              </span>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              {/* 1. На перезапись */}
                              <button
                                type="button"
                                onClick={() => {
                                  handleResolutionChange(gap.id, 'request_dubber_fix');
                                  setGaps(prev => prev.map(g => g.id === gap.id ? { 
                                    ...g, 
                                    selected: true,
                                    comment: g.comment || (
                                      g.artifactType === 'clipping' 
                                        ? `[Перезапись] Перегруз/клиппинг [${formatTimecode(g.artifactTimestampSec ?? g.startSec)}]: Сбавь гейн микрофона или отойди на шаг назад.`
                                        : g.artifactType === 'mouse_click'
                                        ? `[Перезапись] Посторонний механический клик/щелчок [${formatTimecode(g.artifactTimestampSec ?? g.startSec)}]. Перезапиши без щелчков мыши.`
                                        : g.artifactType === 'plosive'
                                        ? `[Перезапись] Задув микрофона на взрывном согласном [${formatTimecode(g.artifactTimestampSec ?? g.startSec)}]. Используй поп-фильтр.`
                                        : `[Перезапись] Обрыв/срез окончания фразы гейтом [${formatTimecode(g.artifactTimestampSec ?? g.startSec)}]. Перепиши фразу целиком.`
                                    )
                                  } : g));
                                }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border ${
                                  gap.resolutionAction === 'request_dubber_fix'
                                    ? 'bg-rose-600 text-white border-rose-500 shadow-md ring-1 ring-rose-400'
                                    : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700 hover:bg-neutral-700'
                                }`}
                              >
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-300" />
                                <span>На перезапись (Дабберу)</span>
                              </button>

                              {/* 2. На сведение звукарю */}
                              <button
                                type="button"
                                onClick={() => {
                                  handleResolutionChange(gap.id, 'note_sound_engineer');
                                  setGaps(prev => prev.map(g => g.id === gap.id ? { 
                                    ...g, 
                                    selected: true,
                                    comment: g.comment || (
                                      g.artifactType === 'clipping' 
                                        ? `[Звукорежиссеру] Микро-перегруз на [${formatTimecode(g.artifactTimestampSec ?? g.startSec)}]. Восстановить деклиппером при сведении.`
                                        : g.artifactType === 'mouse_click'
                                        ? `[Звукорежиссеру] Легкий щелчок/клик на [${formatTimecode(g.artifactTimestampSec ?? g.startSec)}]. Снять декликером (De-click) при сведении.`
                                        : g.artifactType === 'plosive'
                                        ? `[Звукорежиссеру] Задув/суббасовый хлопок на [${formatTimecode(g.artifactTimestampSec ?? g.startSec)}]. Срезать HPF-фильтром (80-100 Гц) при сведении.`
                                        : `[Звукорежиссеру] Обрыв хвоста на [${formatTimecode(g.artifactTimestampSec ?? g.startSec)}]. Смягчить плавным затуханием (fade-out).`
                                    )
                                  } : g));
                                }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border ${
                                  gap.resolutionAction === 'note_sound_engineer'
                                    ? 'bg-indigo-600 text-white border-indigo-500 shadow-md ring-1 ring-indigo-400'
                                    : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700 hover:bg-neutral-700'
                                }`}
                              >
                                <Headphones className="w-3.5 h-3.5 text-indigo-300" />
                                <span>Звукорежиссёру (Сведение / Плагины)</span>
                              </button>

                              {/* 3. Игнорировать / В норме */}
                              <button
                                type="button"
                                onClick={() => {
                                  handleResolutionChange(gap.id, 'ignore');
                                  setGaps(prev => prev.map(g => g.id === gap.id ? { ...g, selected: false } : g));
                                }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border ${
                                  gap.resolutionAction === 'ignore'
                                    ? 'bg-neutral-700 text-white border-neutral-600'
                                    : 'bg-neutral-800/80 text-neutral-400 hover:text-white border-neutral-700'
                                }`}
                              >
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Игнорировать / Всё в норме</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* CATEGORY 8: TEXT MISMATCH / WHISPER ASR */}
                      {category === 'text_mismatch' && (
                        <div className="space-y-3">
                          {/* Top banner with similarity and model info */}
                          <div className="bg-emerald-950/25 border border-emerald-500/30 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2.5">
                            <div className="flex items-center gap-2.5">
                              <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                <Sparkles className="w-4 h-4" />
                              </div>
                              <div>
                                <div className="text-xs font-bold text-emerald-200 flex items-center gap-2">
                                  <span>Сверка речи со сценарием (Whisper ASR)</span>
                                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-300 border border-neutral-700 font-mono">
                                    модель: {gap.whisperModelUsed || 'small'}
                                  </span>
                                </div>
                                <p className="text-[11px] text-neutral-400 mt-0.5">
                                  Фраза распознана с передачей контекста из субтитров для исключения ошибок в терминах
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              {typeof gap.textSimilarityPercent === 'number' && (
                                <div className={`text-xs px-2.5 py-1 rounded-lg border font-mono font-bold ${
                                  gap.textSimilarityPercent >= 80 
                                    ? 'bg-amber-950/60 text-amber-300 border-amber-500/40' 
                                    : 'bg-red-950/60 text-red-300 border-red-500/40'
                                }`}>
                                  Сходство: {gap.textSimilarityPercent}%
                                </div>
                              )}
                              <span className="text-[11px] px-2.5 py-1 rounded-lg bg-neutral-800 text-neutral-300 border border-neutral-700 font-medium">
                                {gap.typeLabel || 'Расхождение текста'}
                              </span>
                            </div>
                          </div>

                          {/* Side-by-side script vs voiced comparison */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                            {/* Script Subtitle */}
                            <div className="bg-neutral-950/60 border border-neutral-800 rounded-xl p-3 space-y-1.5">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-semibold text-neutral-400 flex items-center gap-1.5">
                                  <FileText className="w-3.5 h-3.5 text-blue-400" />
                                  В сценарии (Субтитры):
                                </span>
                                <span className="text-[11px] text-neutral-400">
                                  {gap.characterName} {gap.lineIndex !== undefined ? `(строка #${gap.lineIndex + 1})` : ''}
                                </span>
                              </div>
                              <p className="text-xs text-neutral-200 font-medium bg-neutral-900/80 p-2.5 rounded-lg border border-neutral-800/80 leading-relaxed select-text">
                                «{gap.expectedText || gap.text}»
                              </p>
                            </div>

                            {/* Spoken in Audio Track */}
                            <div className="bg-neutral-950/60 border border-neutral-800 rounded-xl p-3 space-y-1.5">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
                                  <Mic className="w-3.5 h-3.5 text-emerald-400" />
                                  Произнесено дабером (Whisper):
                                </span>
                                <span className="text-[11px] text-neutral-400 font-bold text-amber-300">
                                  🎙 {gap.dubberName}
                                </span>
                              </div>
                              <p className="text-xs text-emerald-200 font-medium bg-neutral-900/80 p-2.5 rounded-lg border border-emerald-500/20 leading-relaxed select-text">
                                «{gap.recognizedText || '...' }»
                              </p>
                            </div>
                          </div>

                          {/* Visual Word Differences (LCS) */}
                          {gap.wordDiffs && gap.wordDiffs.length > 0 && (
                            <div className="bg-neutral-950/40 border border-neutral-800/80 rounded-xl p-3 space-y-2">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-medium text-neutral-300 flex items-center gap-1.5">
                                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                                  Пословный анализ расхождений:
                                </span>
                                <div className="flex items-center gap-2 text-[10px]">
                                  <span className="flex items-center gap-1 text-red-400">
                                    <span className="w-2 h-2 rounded-full bg-red-500"></span> Пропущено в озвучке
                                  </span>
                                  <span className="flex items-center gap-1 text-emerald-400">
                                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Добавлено / Сказано иначе
                                  </span>
                                </div>
                              </div>
                              <div className="p-2.5 bg-neutral-900/90 rounded-lg border border-neutral-800 text-xs leading-relaxed flex flex-wrap gap-1.5 select-text">
                                {gap.wordDiffs.map((diff, dIdx) => {
                                  if (diff.status === 'missing') {
                                    return (
                                      <span
                                        key={dIdx}
                                        className="px-1.5 py-0.5 rounded bg-red-950/60 text-red-300 border border-red-800/50 line-through font-medium"
                                        title="Пропущенное слово из субтитров"
                                      >
                                        {diff.word}
                                      </span>
                                    );
                                  }
                                  if (diff.status === 'added') {
                                    return (
                                      <span
                                        key={dIdx}
                                        className="px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/50 font-bold"
                                        title="Слово, произнесённое дабером (отсутствует в субтитрах)"
                                      >
                                        {diff.word}
                                      </span>
                                    );
                                  }
                                  return (
                                    <span key={dIdx} className="text-neutral-300">
                                      {diff.word}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Audio playback controls with NORMALIZED AUDIO */}
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => handlePlaySnippet(gap, 'primary')}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border shadow-sm ${
                                isPlayingPrimary
                                  ? 'bg-amber-500 text-neutral-950 border-amber-400 animate-pulse'
                                  : 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border-amber-500/40'
                              }`}
                              title="Прослушать реплику дабера (громкость автоматически нормализована)"
                            >
                              {isPlayingPrimary ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Volume2 className="w-3.5 h-3.5 text-amber-400" />}
                              <span>{isPlayingPrimary ? 'Остановить' : `Слушать дабера (${gap.dubberName})`}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handlePlaySnippet(gap, 'original')}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                                isPlayingOriginal
                                  ? 'bg-blue-600 text-white border-blue-500 font-bold animate-pulse'
                                  : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700'
                              }`}
                              title="Прослушать японский оригинал"
                            >
                              {isPlayingOriginal ? <Pause className="w-3 h-3 fill-current" /> : <Volume2 className="w-3 h-3 text-blue-400" />}
                              <span>Оригинал</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => onSeekMainPlayer?.(gap.startSec)}
                              className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700"
                              title="Перемотать видеоплеер на эту реплику"
                            >
                              <span>В видеоплеере ⏱</span>
                            </button>
                          </div>

                          {/* Curator decision controls: Legitimate Fix vs Actor Better vs Ignore */}
                          <div className="bg-neutral-900/95 border border-neutral-700/80 rounded-xl p-3 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-bold text-white flex items-center gap-1.5">
                                <Sliders className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Решение куратора по расхождению текста:</span>
                              </span>
                              <span className="text-[11px] text-neutral-400">
                                {gap.resolutionAction === 'legitimate_fix' && <span className="text-rose-400 font-bold">🔴 Ошибка дабера (на перезапись)</span>}
                                {gap.resolutionAction === 'actor_better_than_sub' && <span className="text-emerald-400 font-bold">✨ Актёр лучше сабов (обновить сабы)</span>}
                                {gap.resolutionAction === 'ignore' && <span className="text-neutral-400 font-bold">⚪ Пропуск / всё ок</span>}
                              </span>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              {/* 1. Легитимный фикс - дабер ошибся, надо переписать строго по сабам */}
                              <button
                                type="button"
                                onClick={() => {
                                  handleResolutionChange(gap.id, 'legitimate_fix');
                                  setGaps(prev => prev.map(g => g.id === gap.id ? {
                                    ...g,
                                    selected: true,
                                    resolutionAction: 'legitimate_fix',
                                    comment: `[Оговорка / Не по тексту] В сценарии: "${g.expectedText || g.text}". Вы сказали: "${g.recognizedText}". Пожалуйста, перезапишите строго по тексту сценария.`
                                  } : g));
                                }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border ${
                                  gap.resolutionAction === 'legitimate_fix'
                                    ? 'bg-rose-600 text-white border-rose-500 shadow-md ring-1 ring-rose-400'
                                    : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700 hover:bg-neutral-700'
                                }`}
                              >
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-300" />
                                <span>Легитимный фикс (переписать даберу)</span>
                              </button>

                              {/* 2. Актёр лучше сабов - то, что сделал актёр, лучше сабов, оставить и обновить субтитры */}
                              <button
                                type="button"
                                onClick={() => {
                                  handleResolutionChange(gap.id, 'actor_better_than_sub');
                                  setGaps(prev => prev.map(g => g.id === gap.id ? {
                                    ...g,
                                    selected: true,
                                    resolutionAction: 'actor_better_than_sub',
                                    comment: `Оставлено в редакции актёра («${g.recognizedText}»). Текст субтитров будет обновлен.`
                                  } : g));
                                }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border ${
                                  gap.resolutionAction === 'actor_better_than_sub'
                                    ? 'bg-emerald-600 text-white border-emerald-500 shadow-md ring-1 ring-emerald-400'
                                    : 'bg-neutral-800 text-neutral-300 hover:text-white border-neutral-700 hover:bg-neutral-700'
                                }`}
                              >
                                <Sparkles className="w-3.5 h-3.5 text-emerald-300" />
                                <span>Актёр лучше сабов (оставить озвучку)</span>
                              </button>

                              {/* 3. Игнорировать / Всё в норме */}
                              <button
                                type="button"
                                onClick={() => {
                                  handleResolutionChange(gap.id, 'ignore');
                                  setGaps(prev => prev.map(g => g.id === gap.id ? {
                                    ...g,
                                    selected: false,
                                    resolutionAction: 'ignore'
                                  } : g));
                                }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border ${
                                  gap.resolutionAction === 'ignore'
                                    ? 'bg-neutral-700 text-white border-neutral-600'
                                    : 'bg-neutral-800/80 text-neutral-400 hover:text-white border-neutral-700'
                                }`}
                              >
                                <Check className="w-3.5 h-3.5 text-neutral-400" />
                                <span>Пропустить / Всё ок</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Editable Fix Comment (if checked) */}
                      {gap.selected && (
                        <div className="flex items-center gap-2 pt-1 border-t border-neutral-800/60">
                          <MessageSquare className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          <span className="text-[11px] text-neutral-400 shrink-0 font-medium">Примечание:</span>
                          <input
                            type="text"
                            value={gap.comment}
                            onChange={e => handleCommentChange(gap.id, e.target.value)}
                            className="flex-1 bg-neutral-900 border border-neutral-700/80 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
                            placeholder="Текст комментария для дабера..."
                          />
                        </div>
                      )}

                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right Column: Built-in Video Player & Subtitle Inspector / Editor */}
      <div className="w-full lg:w-[42%] xl:w-[40%] flex flex-col h-full bg-neutral-950/90 overflow-y-auto custom-scrollbar p-4 space-y-4">
        
        {/* Top Bar for Video Column */}
        <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Video className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                Плеер проверки косяков
                {activeSelectedGap && (
                  <span className="text-[11px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">
                    ⏱ {activeSelectedGap.startFormatted} – {activeSelectedGap.endFormatted}
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-neutral-400">
                Синхронизирован с выбранным замечанием для мгновенного контроля
              </p>
            </div>
          </div>

          {/* Looping toggle */}
          <button
            type="button"
            onClick={() => setIsLoopingSnippet(!isLoopingSnippet)}
            className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition-all ${
              isLoopingSnippet
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'bg-neutral-800 text-neutral-400 hover:text-white border border-neutral-700'
            }`}
            title="Зацикливать воспроизведение выбранного фрагмента косяка"
          >
            <Repeat className={`w-3.5 h-3.5 ${isLoopingSnippet ? 'animate-pulse' : ''}`} />
            <span>Зацикливать</span>
          </button>
        </div>

        {/* Video Player */}
        <div className="space-y-2">
          <div className="relative bg-black rounded-xl overflow-hidden border border-neutral-800 shadow-md aspect-video flex items-center justify-center group">
            {videoUrl ? (
              <>
                <video
                  ref={videoRef}
                  src={videoUrl}
                  onTimeUpdate={handleVideoTimeUpdate}
                  onLoadedMetadata={e => setVideoDuration(e.currentTarget.duration)}
                  onPlay={() => setIsVideoPlaying(true)}
                  onPause={() => setIsVideoPlaying(false)}
                  className="w-full h-full object-contain"
                  playsInline
                />

                {/* Subtitle Overlay in Video */}
                {(activeSubLine?.text || activeSelectedGap?.text) && (
                  <div className="absolute bottom-3 left-4 right-4 pointer-events-none text-center">
                    <span className="inline-block px-3 py-1.5 rounded-lg bg-black/80 text-white font-medium text-xs md:text-sm shadow-lg border border-white/10 backdrop-blur-sm max-w-full truncate">
                      {activeSelectedGap?.characterName && (
                        <strong className="text-amber-400 font-bold mr-1.5">
                          [{activeSelectedGap.characterName}]:
                        </strong>
                      )}
                      {activeSubLine?.text || activeSelectedGap?.text}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="p-6 text-center space-y-2">
                <Video className="w-8 h-8 text-neutral-600 mx-auto" />
                <p className="text-xs text-neutral-400 max-w-xs">
                  Видеофайл для этой серии не загружен. Укажите ссылку на видео в карточке серии для полноценного видеоконтроля.
                </p>
              </div>
            )}
          </div>

          {/* Video Player Controls */}
          {videoUrl && (
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-2.5 space-y-2">
              {/* Scrubber progress */}
              <div className="flex items-center gap-2 text-xs font-mono text-neutral-400">
                <span className="w-12 text-right">{formatTimecode(videoCurrentTime)}</span>
                <input
                  type="range"
                  min={0}
                  max={videoDuration || 100}
                  step={0.1}
                  value={videoCurrentTime}
                  onChange={e => {
                    const val = parseFloat(e.target.value);
                    setVideoCurrentTime(val);
                    if (videoRef.current) videoRef.current.currentTime = val;
                  }}
                  className="flex-1 h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
                <span className="w-12">{formatTimecode(videoDuration)}</span>
              </div>

              {/* Buttons toolbar */}
              <div className="flex items-center justify-between pt-1 border-t border-neutral-800/80">
                <div className="flex items-center gap-1.5">
                  {/* Play/Pause */}
                  <button
                    type="button"
                    onClick={() => {
                      if (!videoRef.current) return;
                      if (isVideoPlaying) videoRef.current.pause();
                      else videoRef.current.play();
                    }}
                    className="p-2 rounded-lg bg-amber-500 text-neutral-950 hover:bg-amber-400 font-bold transition-all shadow-sm"
                    title={isVideoPlaying ? "Пауза" : "Воспроизведение"}
                  >
                    {isVideoPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
                  </button>

                  {/* Jump -2s */}
                  <button
                    type="button"
                    onClick={() => {
                      if (videoRef.current) {
                        videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 2);
                      }
                    }}
                    className="px-2 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-mono transition-colors"
                    title="Назад на 2 секунды"
                  >
                    -2с
                  </button>

                  {/* Jump +2s */}
                  <button
                    type="button"
                    onClick={() => {
                      if (videoRef.current) {
                        videoRef.current.currentTime = Math.min(videoDuration, videoRef.current.currentTime + 2);
                      }
                    }}
                    className="px-2 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-mono transition-colors"
                    title="Вперед на 2 секунды"
                  >
                    +2с
                  </button>

                  {/* Reset to defect start */}
                  {activeSelectedGap && (
                    <button
                      type="button"
                      onClick={() => {
                        if (videoRef.current) {
                          videoRef.current.currentTime = Math.max(0, (activeSelectedGap.artifactTimestampSec ?? activeSelectedGap.startSec) - 0.2);
                          videoRef.current.play().catch(() => {});
                        }
                      }}
                      className="px-2 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-amber-300 text-xs font-semibold flex items-center gap-1 transition-colors"
                      title="Вернуться к началу выбранного фрагмента"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>К фразе</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 text-xs">
                  {/* Speed selector */}
                  <div className="flex items-center gap-1 bg-neutral-950 px-1.5 py-0.5 rounded border border-neutral-800 text-[11px]">
                    <Gauge className="w-3 h-3 text-neutral-400" />
                    {[0.75, 1.0, 1.25].map(speed => (
                      <button
                        key={speed}
                        type="button"
                        onClick={() => {
                          setPlaybackRate(speed);
                          if (videoRef.current) videoRef.current.playbackRate = speed;
                        }}
                        className={`px-1 rounded ${playbackRate === speed ? 'text-amber-400 font-bold' : 'text-neutral-500 hover:text-white'}`}
                      >
                        {speed}x
                      </button>
                    ))}
                  </div>

                  {/* Mute toggle */}
                  <button
                    type="button"
                    onClick={() => {
                      if (videoRef.current) {
                        videoRef.current.muted = !isMuted;
                        setIsMuted(!isMuted);
                      }
                    }}
                    className={`p-1.5 rounded-lg border transition-colors ${
                      isMuted
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                        : 'bg-neutral-800 text-neutral-300 border-neutral-700 hover:text-white'
                    }`}
                    title={isMuted ? "Включить звук" : "Выключить звук видео"}
                  >
                    {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Subtitle Inspector & In-Place Editor */}
        <div className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-4 space-y-3.5">
          <div className="flex items-center justify-between pb-2 border-b border-neutral-800/80">
            <div className="flex items-center gap-2">
              <Edit3 className="w-4 h-4 text-purple-400" />
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                Редактор субтитра и персонажа
              </h4>
            </div>
            {activeSubLine && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">
                Строка #{activeSubLine.rawLineIndex}
              </span>
            )}
          </div>

          {/* Character Assignment & Dubber mapping */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-neutral-400 flex items-center justify-between">
              <span>Персонаж и даббер:</span>
              {activeDubberNickname && (
                <span className="text-amber-400 font-bold">
                  Озвучивает: {activeDubberNickname}
                </span>
              )}
            </label>

            <div className="grid grid-cols-1 gap-2">
              <select
                value={selectedReassignCharacter}
                onChange={e => setSelectedReassignCharacter(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
              >
                <option value="">-- Выберите персонажа для реплики --</option>
                {availableCharacters.map(char => (
                  <option key={char.characterName} value={char.characterName}>
                    {char.characterName} {char.dubberName ? `(${char.dubberName})` : ''}
                  </option>
                ))}
                <option value="__custom__">+ Другой персонаж (ввести вручную)</option>
              </select>

              {selectedReassignCharacter === '__custom__' && (
                <input
                  type="text"
                  placeholder="Имя нового персонажа..."
                  value={customCharacterName}
                  onChange={e => setCustomCharacterName(e.target.value)}
                  className="w-full bg-neutral-950 border border-amber-500/50 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
                />
              )}
            </div>
          </div>

          {/* Text Diff & Subtitle text editor */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium text-neutral-400">Текст субтитра:</span>
              {activeSelectedGap?.recognizedText && (
                <button
                  type="button"
                  onClick={() => setEditingSubText(activeSelectedGap.recognizedText || '')}
                  className="text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1 text-[11px] transition-colors"
                  title="Скопировать распознанный текст Whisper в поле субтитра"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Вставить текст из озвучки</span>
                </button>
              )}
            </div>

            {activeSelectedGap?.recognizedText && (
              <div className="p-2.5 rounded-lg bg-emerald-950/20 border border-emerald-500/30 text-xs text-emerald-200">
                <div className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider mb-1 flex items-center gap-1">
                  <Mic className="w-3 h-3" /> Распознано Whisper в дорожке:
                </div>
                <div className="font-sans italic">«{activeSelectedGap.recognizedText}»</div>
              </div>
            )}

            <textarea
              rows={3}
              value={editingSubText}
              onChange={e => setEditingSubText(e.target.value)}
              placeholder="Текст субтитра..."
              className="w-full bg-neutral-950 border border-neutral-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-amber-500 resize-none font-sans leading-relaxed"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleSaveSubChanges}
              disabled={isSavingSub}
              className="flex-1 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSavingSub ? 'Сохранение...' : 'Сохранить правку в сабах'}</span>
            </button>

            {onExportSubtitles && (
              <button
                type="button"
                onClick={handleExportSubtitlesAction}
                disabled={isExportingSub}
                className="px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 font-semibold text-xs flex items-center gap-1.5 transition-all disabled:opacity-50"
                title="Скачать обновлённые субтитры серии (.ass)"
              >
                <FileCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Экспорт сабов</span>
              </button>
            )}
          </div>
        </div>

        {/* Selected defect summary info card */}
        {activeSelectedGap && (
          <div className="bg-neutral-900/60 border border-neutral-800/80 rounded-xl p-3.5 text-xs space-y-2">
            <div className="flex items-center justify-between text-[11px] text-neutral-400 border-b border-neutral-800 pb-1.5">
              <span className="font-semibold text-white flex items-center gap-1">
                <Info className="w-3.5 h-3.5 text-blue-400" />
                Детали текущего замечания
              </span>
              <span className="font-mono text-amber-400">
                ID: {activeSelectedGap.id.slice(0, 8)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-neutral-500">Категория:</span>
                <p className="font-semibold text-neutral-200 mt-0.5">
                  {activeSelectedGap.typeLabel || activeSelectedGap.defectCategory}
                </p>
              </div>
              <div>
                <span className="text-neutral-500">Статус решения:</span>
                <p className="font-semibold text-neutral-200 mt-0.5">
                  {activeSelectedGap.resolutionAction === 'reassign_character' ? 'Переназначено' :
                   activeSelectedGap.resolutionAction === 'note_sound_engineer' ? 'Отчет звукарю' :
                   activeSelectedGap.resolutionAction === 'request_dubber_fix' ? 'Перезапись даббера' :
                   activeSelectedGap.resolutionAction === 'silence' ? 'Замена тишиной' :
                   activeSelectedGap.resolutionAction === 'actor_better_than_sub' ? 'Актёр лучше (обновить саб)' :
                   activeSelectedGap.resolutionAction === 'ignore' ? 'Пропущено' : 'К исправлению'}
                </p>
              </div>
            </div>

            {activeSelectedGap.comment && (
              <div className="pt-1.5 border-t border-neutral-800 text-[11px]">
                <span className="text-neutral-500">Примечание к исправлению:</span>
                <p className="text-neutral-300 italic mt-0.5">{activeSelectedGap.comment}</p>
              </div>
            )}
          </div>
        )}

      </div>
    </div>

        {/* Footer */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-900/95 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 text-xs">
            <span className="text-neutral-400">
              Выбрано к применению: <strong className="text-white font-bold">{selectedCount}</strong> из {gaps.length}
            </span>
            <div className="flex items-center gap-2 pl-2 border-l border-neutral-800 text-[11px] flex-wrap">
              {missingReportCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-300 border border-red-500/20">
                  Фиксов пропусков: <strong>{missingReportCount}</strong>
                </span>
              )}
              {dubberFixArtifactsCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20">
                  Перезаписей артефактов: <strong>{dubberFixArtifactsCount}</strong>
                </span>
              )}
              {soundEngineerArtifactsCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                  В отчет звукарю: <strong>{soundEngineerArtifactsCount}</strong>
                </span>
              )}
              {reassignedCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
                  Переназначений в сабах: <strong>{reassignedCount}</strong>
                </span>
              )}
              {silenceActionsCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                  Замен тишиной: <strong>{silenceActionsCount}</strong>
                </span>
              )}
              {fixSubsActionsCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
                  Правок сабов: <strong>{fixSubsActionsCount}</strong>
                </span>
              )}
              {textMismatchFixCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20">
                  Фиксов текста: <strong>{textMismatchFixCount}</strong>
                </span>
              )}
              {textMismatchActorBetterCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                  Обновлений сабов (актёр лучше): <strong>{textMismatchActorBetterCount}</strong>
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                SnippetAudioPlayer.stop();
                onClose();
              }}
              className="px-5 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white text-xs font-bold transition-colors"
            >
              Отмена
            </button>

            <button
              onClick={handleSubmit}
              disabled={selectedCount === 0 || isApplying}
              className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold transition-all flex items-center gap-2 shadow-lg shadow-blue-500/20"
            >
              {isApplying ? (
                <>
                  <Sparkles className="w-4 h-4 animate-spin" />
                  Применение решений...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Применить решения ({selectedCount})
                </>
              )}
            </button>
          </div>
        </div>

      </div>

      {/* Sound Engineer Report Modal */}
      {soundEngineerModalOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh] text-neutral-200">
            
            {/* Header */}
            <div className="p-5 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/90 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <Headphones className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Сообщение для звукорежиссера</h3>
                  <p className="text-xs text-neutral-400">Сводка наездов хвостов, конфликтов и рассинхрона таймингов</p>
                </div>
              </div>
              <button 
                onClick={() => setSoundEngineerModalOpen(false)}
                className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content Body */}
            <div className="p-5 overflow-y-auto flex-1 custom-scrollbar space-y-3">
              <div className="flex items-center justify-between text-xs text-neutral-400">
                <span>Предпросмотр сообщения (формат Markdown / Текст):</span>
                <span className="font-mono text-[11px] text-neutral-500">{soundEngineerReportText.length} симв.</span>
              </div>
              <pre className="bg-black/70 border border-neutral-800/80 rounded-xl p-4 text-xs font-mono text-neutral-200 whitespace-pre-wrap leading-relaxed select-text">
                {soundEngineerReportText}
              </pre>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-neutral-800 bg-neutral-900/90 flex items-center justify-between shrink-0 gap-3">
              <div className="text-[11px] text-neutral-400 truncate">
                Готово для вставки в Telegram, Discord или рабочий трекер
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setSoundEngineerModalOpen(false)}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-xl text-xs font-bold transition-colors"
                >
                  Закрыть
                </button>
                <button
                  onClick={handleCopyReport}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-lg shadow-indigo-600/20"
                >
                  {hasCopiedReport ? <CheckCircle2 className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                  <span>{hasCopiedReport ? 'Скопировано!' : 'Скопировать сообщение'}</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Comprehensive QA Scan Log Modal */}
      {isLogModalOpen && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh] text-neutral-200">
            {/* Header */}
            <div className="p-5 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/90 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-sky-600/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
                  <Terminal className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span>Журнал проверок дорожек и Whisper</span>
                    {activeReport?.whisperStatus?.attempted && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                        !activeReport.whisperStatus.success || !activeReport.whisperStatus.ready
                          ? 'bg-rose-950/80 text-rose-300 border-rose-500/40'
                          : 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40'
                      }`}>
                        {!activeReport.whisperStatus.success || !activeReport.whisperStatus.ready
                          ? 'Whisper: Неудачна'
                          : 'Whisper: Готова и проверена'}
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-neutral-400">
                    Детальный хронологический лог сканирования аудио, детекции VAD и сверки ASR
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setIsLogModalOpen(false)}
                className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Filter Bar */}
            <div className="px-5 py-2.5 border-b border-neutral-800 bg-neutral-950/60 flex items-center justify-between shrink-0 gap-2">
              <div className="flex items-center gap-1.5">
                {[
                  { id: 'all', label: 'Все записи', count: activeReport?.logs?.length || 0 },
                  { id: 'whisper', label: 'Whisper ASR', count: activeReport?.logs?.filter(l => l.stage === 'whisper').length || 0 },
                  { id: 'error', label: 'Ошибки & Предупреждения', count: activeReport?.logs?.filter(l => l.level === 'error' || l.level === 'warn').length || 0 },
                  { id: 'audio', label: 'Аудио & Детекторы', count: activeReport?.logs?.filter(l => l.stage !== 'whisper').length || 0 }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setLogFilterStage(tab.id as any)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                      logFilterStage === tab.id
                        ? 'bg-neutral-200 text-neutral-900 font-bold'
                        : 'bg-neutral-800/70 text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                      logFilterStage === tab.id ? 'bg-neutral-900 text-white' : 'bg-neutral-700 text-neutral-300'
                    }`}>
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  const allText = (activeReport?.logs || [])
                    .map(l => `[${l.timestamp}] [${l.stage.toUpperCase()}] [${l.level.toUpperCase()}] ${l.message}${l.details ? ' -> ' + l.details : ''}`)
                    .join('\n');
                  navigator.clipboard.writeText(allText);
                  setCopiedLogs(true);
                  toast.success('Лог проверок скопирован в буфер обмена');
                  setTimeout(() => setCopiedLogs(false), 2000);
                }}
                className="px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
              >
                {copiedLogs ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedLogs ? 'Скопировано!' : 'Копировать лог'}</span>
              </button>
            </div>

            {/* Log Terminal Console */}
            <div className="p-4 overflow-y-auto flex-1 custom-scrollbar space-y-1 bg-black/90 font-mono text-xs select-text">
              {(!activeReport?.logs || activeReport.logs.length === 0) ? (
                <div className="p-8 text-center text-neutral-500">
                  <Terminal className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <div>Записи журнала проверок отсутствуют.</div>
                  <p className="text-[11px] text-neutral-600 mt-1">Запустите анализ дорожек в окне QA, чтобы залогировать процесс.</p>
                </div>
              ) : (
                activeReport.logs
                  .filter(entry => {
                    if (logFilterStage === 'whisper') return entry.stage === 'whisper';
                    if (logFilterStage === 'error') return entry.level === 'error' || entry.level === 'warn';
                    if (logFilterStage === 'audio') return entry.stage !== 'whisper';
                    return true;
                  })
                  .map(entry => (
                    <div
                      key={entry.id}
                      className={`p-2 rounded border flex items-start gap-2.5 transition-colors ${
                        entry.level === 'error'
                          ? 'bg-rose-950/40 border-rose-500/40 text-rose-200'
                          : entry.level === 'warn'
                          ? 'bg-amber-950/30 border-amber-500/30 text-amber-200'
                          : entry.level === 'success'
                          ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-200'
                          : entry.stage === 'whisper'
                          ? 'bg-purple-950/20 border-purple-500/20 text-purple-200'
                          : 'bg-neutral-900/60 border-neutral-800 text-neutral-300'
                      }`}
                    >
                      <span className="text-[10px] text-neutral-500 shrink-0 font-mono mt-0.5">
                        {entry.timestamp}
                      </span>
                      <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded shrink-0 border ${
                        entry.stage === 'whisper'
                          ? 'bg-purple-900/60 text-purple-300 border-purple-600/40'
                          : entry.stage === 'speech'
                          ? 'bg-blue-900/60 text-blue-300 border-blue-600/40'
                          : entry.stage === 'missing'
                          ? 'bg-rose-900/60 text-rose-300 border-rose-600/40'
                          : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                      }`}>
                        {entry.stage}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="leading-relaxed font-mono">
                          {entry.message}
                        </div>
                        {entry.details && (
                          <div className="text-[11px] text-neutral-400 mt-1 font-mono break-all bg-black/40 p-1.5 rounded border border-neutral-800/80">
                            {entry.details}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
              )}
            </div>

            {/* Footer */}
            <div className="p-3.5 border-t border-neutral-800 bg-neutral-900/90 flex items-center justify-between shrink-0 text-xs text-neutral-400">
              <div className="flex items-center gap-3">
                <span>Проверено дорожек: <strong className="text-neutral-200 font-mono">{activeReport?.totalTracks ?? 0}</strong></span>
                <span>•</span>
                <span>Реплик сценария: <strong className="text-neutral-200 font-mono">{activeReport?.totalSubLines ?? 0}</strong></span>
                <span>•</span>
                <span>Выявлено замечаний: <strong className="text-amber-300 font-mono">{activeReport?.totalGapsFound ?? gaps.length}</strong></span>
              </div>
              <button
                type="button"
                onClick={() => setIsLogModalOpen(false)}
                className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs font-semibold transition-colors"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
