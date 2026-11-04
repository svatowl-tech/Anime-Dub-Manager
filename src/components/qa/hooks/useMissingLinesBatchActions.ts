import { useState, useMemo } from 'react';
import { MissingLineDetection, DefectCategory, DefectResolution, QAScanReport } from '../../../lib/qa/missingLinesDetector';
import { AudioArtifactType } from '../../../lib/qa/artifactDetector';
import { Episode, Participant, Track } from '../../../types';
import { generateSoundEngineerQAReport } from '../../../lib/templates';
import { saveQAGapsToTimingProject } from '../../../lib/qa/timingSyncService';
import { safeCopyToClipboard } from '../../../lib/clipboard';
import { toast } from 'sonner';

export interface UseMissingLinesBatchActionsParams {
  gaps: MissingLineDetection[];
  updateGaps: (updater: (prev: MissingLineDetection[]) => MissingLineDetection[]) => void;
  currentThreshold?: number;
  onReAnalyze?: (dynamicThresholdDb?: number) => void;
  episode?: Episode | null;
  participants?: Participant[];
  tracks?: Track[];
  onClose: () => void;
  onOpenTimingPanel?: () => void;
}

export function useMissingLinesBatchActions({
  gaps,
  updateGaps,
  currentThreshold = 3.0,
  onReAnalyze,
  episode,
  participants,
  tracks = [],
  onClose,
  onOpenTimingPanel
}: UseMissingLinesBatchActionsParams) {
  const [selectedCategoryTab, setSelectedCategoryTab] = useState<'all' | DefectCategory | 'sub_error'>('all');
  const [selectedArtifactTypeFilter, setSelectedArtifactTypeFilter] = useState<'all' | AudioArtifactType>('all');
  const [selectedDubberFilter, setSelectedDubberFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [logFilterStage, setLogFilterStage] = useState<'all' | 'whisper' | 'error' | 'audio'>('all');
  const [copiedLogs, setCopiedLogs] = useState(false);

  const [soundEngineerModalOpen, setSoundEngineerModalOpen] = useState(false);
  const [soundEngineerReportText, setSoundEngineerReportText] = useState('');
  const [hasCopiedReport, setHasCopiedReport] = useState(false);

  const [selectedSensitivity, setSelectedSensitivity] = useState<number>(currentThreshold);
  const [isSavingToTiming, setIsSavingToTiming] = useState(false);

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

  const dubbers = useMemo(() => {
    return Array.from(new Set(
      gaps.flatMap(g => [g.dubberName, g.secondDubberName].filter(Boolean) as string[])
    ));
  }, [gaps]);

  const filteredGaps = useMemo(() => {
    return gaps.filter(gap => {
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
          // keep
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
  }, [gaps, selectedCategoryTab, selectedArtifactTypeFilter, selectedDubberFilter, searchQuery]);

  const selectedGaps = useMemo(() => gaps.filter(g => g.selected), [gaps]);
  const selectedCount = selectedGaps.length;

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

  const handleGenerateReportForSE = () => {
    let report = '';
    if (episode) {
      report = generateSoundEngineerQAReport(episode, gaps, participants || []);
    } else {
      const mockEp: any = { id: 'current', number: 1, title: 'Серия' };
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

  const handleSaveToTiming = async (navigateToTiming: boolean = false) => {
    if (!episode) return;
    setIsSavingToTiming(true);
    try {
      const res = await saveQAGapsToTimingProject(episode, gaps, tracks || []);
      toast.success(
        `✓ Записано в файл тайминга! (Наездов: ${res.summary.overlapsCount}, коллизий: ${res.summary.collisionsCount}, рассинхронов: ${res.summary.desyncCount})`
      );
      if (navigateToTiming) {
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

  return {
    selectedCategoryTab,
    setSelectedCategoryTab,
    selectedArtifactTypeFilter,
    setSelectedArtifactTypeFilter,
    selectedDubberFilter,
    setSelectedDubberFilter,
    searchQuery,
    setSearchQuery,
    isLogModalOpen,
    setIsLogModalOpen,
    logFilterStage,
    setLogFilterStage,
    copiedLogs,
    setCopiedLogs,
    soundEngineerModalOpen,
    setSoundEngineerModalOpen,
    soundEngineerReportText,
    setSoundEngineerReportText,
    hasCopiedReport,
    selectedSensitivity,
    isSavingToTiming,
    missingCount,
    unwantedCount,
    collisionsCount,
    overlapsCount,
    shortTimingCount,
    longTimingCount,
    subErrorCount,
    artifactsCount,
    clippingCount,
    clicksCount,
    plosivesCount,
    cutoffsCount,
    textMismatchCount,
    dubbers,
    filteredGaps,
    selectedGaps,
    selectedCount,
    silenceActionsCount,
    transferActionsCount,
    fixSubsActionsCount,
    missingReportCount,
    reassignedCount,
    dubberFixArtifactsCount,
    soundEngineerArtifactsCount,
    textMismatchFixCount,
    textMismatchActorBetterCount,
    handleToggleSelectAll,
    handleToggleSingle,
    handleCommentChange,
    handleResolutionChange,
    handleGenerateReportForSE,
    handleCopyReport,
    handleSensitivityChange,
    handleSaveToTiming
  };
}
