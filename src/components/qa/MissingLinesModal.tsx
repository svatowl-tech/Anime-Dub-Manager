import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  X, 
  Check, 
  Copy, 
  Terminal, 
  Save, 
  FileCheck, 
  Headphones, 
  Scissors 
} from 'lucide-react';
import { toast } from 'sonner';
import { safeCopyToClipboard } from '../../lib/clipboard';
import { 
  MissingLineDetection, 
  SnippetAudioPlayer,
  QAScanReport
} from '../../lib/qa/missingLinesDetector';
import { Episode, Participant, SubtitleLine, Track } from '../../types';
import { MissingLinesDefectCard } from "./MissingLinesDefectCard";
import { MissingLinesPlayerAndModals } from "./MissingLinesPlayerAndModals";
import { useMissingLinesBatchActions } from './hooks/useMissingLinesBatchActions';
import { MissingLinesFilterToolbar } from './missingLines/MissingLinesFilterToolbar';

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
  const [playingSnippetId, setPlayingSnippetId] = useState<string | null>(null);
  const [activeReassignGapId, setActiveReassignGapId] = useState<string | null>(null);
  const [customCharInput, setCustomCharInput] = useState<Record<string, string>>({});

  const updateGaps = useCallback((updater: (prev: MissingLineDetection[]) => MissingLineDetection[]) => {
    setGaps(prev => {
      const next = updater(prev);
      onSaveGaps?.(next);
      return next;
    });
  }, [onSaveGaps]);

  const batchActions = useMissingLinesBatchActions({
    gaps,
    updateGaps,
    currentThreshold,
    onReAnalyze,
    episode,
    participants,
    tracks,
    onClose,
    onOpenTimingPanel
  });

  const formatTimecode = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  useEffect(() => {
    setGaps(initialGaps);
  }, [initialGaps]);

  useEffect(() => {
    return () => {
      SnippetAudioPlayer.stop();
    };
  }, [isOpen]);

  const availableCharacters = useMemo(() => {
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
      const found = subLines.find(l => Math.abs((l.startSec ?? 0) - activeSelectedGap.startSec) < 0.35);
      if (found) return found;
    }
    return subLines.find(l => videoCurrentTime >= (l.startSec ?? 0) && videoCurrentTime <= (l.endSec ?? 0)) || null;
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

  const handleSubmit = async () => {
    const selected = gaps.filter(g => g.selected);
    if (selected.length === 0) return;
    SnippetAudioPlayer.stop();
    await onApplyFixes(selected);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-[1720px] h-[95vh] max-h-[960px] flex flex-col overflow-hidden text-neutral-200">
        
        {/* Header & Filter Toolbar */}
        <MissingLinesFilterToolbar
          totalGapsCount={gaps.length}
          selectedSensitivity={batchActions.selectedSensitivity}
          handleSensitivityChange={batchActions.handleSensitivityChange}
          isAnalyzing={isAnalyzing}
          handleGenerateReportForSE={batchActions.handleGenerateReportForSE}
          handleSaveToTiming={batchActions.handleSaveToTiming}
          isSavingToTiming={batchActions.isSavingToTiming}
          onOpenScanConfig={onOpenScanConfig}
          activeReport={activeReport}
          setIsLogModalOpen={batchActions.setIsLogModalOpen}
          onClose={onClose}
          searchQuery={batchActions.searchQuery}
          setSearchQuery={batchActions.setSearchQuery}
          selectedDubberFilter={batchActions.selectedDubberFilter}
          setSelectedDubberFilter={batchActions.setSelectedDubberFilter}
          dubbers={batchActions.dubbers}
          handleToggleSelectAll={batchActions.handleToggleSelectAll}
          filteredGapsCount={batchActions.filteredGaps.length}
          selectedCategoryTab={batchActions.selectedCategoryTab}
          setSelectedCategoryTab={batchActions.setSelectedCategoryTab}
          selectedArtifactTypeFilter={batchActions.selectedArtifactTypeFilter}
          setSelectedArtifactTypeFilter={batchActions.setSelectedArtifactTypeFilter}
          missingCount={batchActions.missingCount}
          unwantedCount={batchActions.unwantedCount}
          collisionsCount={batchActions.collisionsCount}
          overlapsCount={batchActions.overlapsCount}
          shortTimingCount={batchActions.shortTimingCount}
          longTimingCount={batchActions.longTimingCount}
          subErrorCount={batchActions.subErrorCount}
          artifactsCount={batchActions.artifactsCount}
          clippingCount={batchActions.clippingCount}
          clicksCount={batchActions.clicksCount}
          plosivesCount={batchActions.plosivesCount}
          cutoffsCount={batchActions.cutoffsCount}
          textMismatchCount={batchActions.textMismatchCount}
        />

        {/* Content Body */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-neutral-800/80 overflow-hidden">
          
          {/* Left Column: Defect Cards List */}
          <div className="lg:col-span-7 flex flex-col h-full overflow-y-auto p-4 space-y-3.5 custom-scrollbar bg-neutral-950/40">
            {batchActions.filteredGaps.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center p-6 bg-neutral-900/40 border border-neutral-800/60 rounded-2xl">
                <Scissors className="w-10 h-10 text-neutral-600 mb-2" />
                <h3 className="text-sm font-bold text-neutral-300">Замечаний в выбранной категории не найдено</h3>
                <p className="text-xs text-neutral-500 mt-1 max-w-md">
                  Попробуйте сменить фильтр или переключить чувствительность сканера
                </p>
              </div>
            ) : (
              batchActions.filteredGaps.map(gap => (
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
                  handleToggleSingle={batchActions.handleToggleSingle}
                  handlePlaySnippet={handlePlaySnippet}
                  onSeekMainPlayer={onSeekMainPlayer}
                  handleRemoveGap={handleRemoveGap}
                  handleCancelReassign={handleCancelReassign}
                  handleReassignGapCharacter={handleReassignGapCharacter}
                  handleResolutionChange={batchActions.handleResolutionChange}
                  handleCommentChange={batchActions.handleCommentChange}
                  updateGaps={updateGaps}
                />
              ))
            )}
          </div>

          {/* Right Column: Embedded Player & Action Drawer */}
          <div className="lg:col-span-5 flex flex-col h-full overflow-y-auto p-4 custom-scrollbar bg-neutral-900/80">
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
              selectedCount={batchActions.selectedCount}
              silenceActionsCount={batchActions.silenceActionsCount}
              transferActionsCount={batchActions.transferActionsCount}
              reassignedCount={batchActions.reassignedCount}
              fixSubsActionsCount={batchActions.fixSubsActionsCount}
              missingReportCount={batchActions.missingReportCount}
              dubberFixArtifactsCount={batchActions.dubberFixArtifactsCount}
              soundEngineerArtifactsCount={batchActions.soundEngineerArtifactsCount}
              textMismatchFixCount={batchActions.textMismatchFixCount}
              textMismatchActorBetterCount={batchActions.textMismatchActorBetterCount}
              episode={episode}
              isSavingToTiming={batchActions.isSavingToTiming}
              handleSaveToTiming={batchActions.handleSaveToTiming}
              handleGenerateReportForSE={batchActions.handleGenerateReportForSE}
              onClose={onClose}
              handleSubmit={handleSubmit}
              isApplying={isApplying}
              soundEngineerModalOpen={batchActions.soundEngineerModalOpen}
              setSoundEngineerModalOpen={batchActions.setSoundEngineerModalOpen}
              soundEngineerReportText={batchActions.soundEngineerReportText}
              setSoundEngineerReportText={batchActions.setSoundEngineerReportText}
              hasCopiedReport={batchActions.hasCopiedReport}
              handleCopyReport={batchActions.handleCopyReport}
              onOpenTimingPanel={onOpenTimingPanel}
              isLogModalOpen={batchActions.isLogModalOpen}
              setIsLogModalOpen={batchActions.setIsLogModalOpen}
              activeReport={activeReport}
              logFilterStage={batchActions.logFilterStage}
              setLogFilterStage={batchActions.setLogFilterStage}
              copiedLogs={batchActions.copiedLogs}
              setCopiedLogs={batchActions.setCopiedLogs}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
