import { useEffect, useState, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { Episode, Participant, Track } from '../types';
import { TrackSidebar } from './qa/TrackSidebar';
import { generateFixesIssuedMessage } from '../lib/templates';
import { getParticipants } from '../services/dbService';
import { NormalizationMetrics } from '../lib/qa/audioNormalizer';
import { detectEpisodeGaps, MissingLineDetection, GapDetectionOptions, QAScanReport } from '../lib/qa/missingLinesDetector';
import { saveQAGapsToTimingProject } from '../lib/qa/timingSyncService';

import { useQAGapFixApplier } from "./qa/useQAGapFixApplier";
import { QAPlayerAndModalsView } from "./qa/QAPlayerAndModalsView";
import { useQAPanelAudioSync } from './qa/hooks/useQAPanelAudioSync';
import { useQAPanelEpisodeData } from './qa/hooks/useQAPanelEpisodeData';

interface QAPanelProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
  onNavigate?: (tab: 'dashboard' | 'subtitles' | 'qa' | 'timing' | 'mixing' | 'release' | 'telegram' | 'settings' | 'database' | 'cover' | 'stats' | 'archive') => void;
}

export default function QAPanel({ currentEpisode, onRefresh, onNavigate }: QAPanelProps) {
  const [mutedTracks, setMutedTracks] = useState<Set<string>>(new Set());
  const [commentModal, setCommentModal] = useState<{ isOpen: boolean; region: any } | null>(null);
  const [newComment, setNewComment] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [originalVolume, setOriginalVolume] = useState(0.5);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [generatedMessage, setGeneratedMessage] = useState<string | null>(null);
  const [isMessageModalOpen, setIsMessageModalOpen] = useState(false);
  const [isMessageCopied, setIsMessageCopied] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isUploading] = useState(false);
  const [isBaking, setIsBaking] = useState(false);
  const [bakeProgress, setBakeProgress] = useState(0);
  const [bakeStatus, setBakeStatus] = useState('');
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  
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

  const [isSplitMultiTracks, setIsSplitMultiTracks] = useState<boolean>(() => {
    return localStorage.getItem('qa_split_multi_tracks') !== 'false';
  });

  const toggleAutoNormalize = useCallback(() => {
    setIsAutoNormalize(prev => {
      const next = !prev;
      localStorage.setItem('qa_auto_normalize', String(next));
      toast.info(next ? 'Авто-нормализация громкости превью включена' : 'Авто-нормализация громкости превью выключена');
      return next;
    });
  }, []);

  const toggleSplitMultiTracks = useCallback(() => {
    setIsSplitMultiTracks(prev => {
      const next = !prev;
      localStorage.setItem('qa_split_multi_tracks', String(next));
      toast.info(next ? 'Импорт всех версий как отдельных параллельных дорожек включен' : 'Группировка версий в выпадающий список включена');
      return next;
    });
  }, []);

  useEffect(() => {
    getParticipants().then(p => setParticipants(p));
  }, []);

  // Restore persisted QA results for current episode
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

  const gapsByTrack = useMemo(() => {
    const map: Record<string, number> = {};
    for (const gap of detectedGaps) {
      map[gap.trackId] = (map[gap.trackId] || 0) + 1;
    }
    return map;
  }, [detectedGaps]);

  // Hook 1: Episode data, tracks, subtitles, comments, and file operations
  const {
    tracks,
    setTracks,
    subLines,
    setSubLines,
    currentCharacter,
    currentDubberNickname,
    currentSubtitleText,
    currentSubId,
    videoUrl,
    handleReassignCharacter,
    handleUpdateSubLineFromModal,
    handleExportSubtitlesFromModal,
    handleAddComment,
    handleDeleteComment,
    handleApproveAll,
    handleStatusChange,
    handleFileUpload,
    handleFileDelete
  } = useQAPanelEpisodeData({
    currentEpisode,
    onRefresh,
    isSplitMultiTracks,
    selectedTrackId,
    setSelectedTrackId,
    currentTime,
    newComment,
    setNewComment,
    isManualDubberOverride,
    manualDubberId,
    setConfirmState
  });

  // Hook 2: Audio playback, WaveSurfer synchronization, normalization, and hotkeys
  const {
    wavesurferRef,
    videoRef,
    isAnalyzingSilence,
    handleVideoPlay,
    handleVideoPause,
    handleVideoTimeUpdate,
    handleVideoSeeking,
    handleVideoEnded,
    handleSeekToTime,
    togglePlay,
    handlePause,
    handleStop,
    seekToNext,
    seekToPrev,
    detectSilence
  } = useQAPanelAudioSync({
    tracks,
    selectedTrackId,
    subLines,
    currentTime,
    setCurrentTime,
    duration,
    setDuration,
    isPlaying,
    setIsPlaying,
    volumes,
    isAutoNormalize,
    normalizationMetrics,
    setNormalizationMetrics,
    isMuted,
    currentEpisodeId: currentEpisode?.id,
    currentSubtitleText,
    currentSubId,
    onAddQuickFixComment: handleAddComment
  });

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
        optionsToUse
      );

      setDetectedGaps(gaps);
      if (currentEpisode?.id) {
        try {
          localStorage.setItem(`qa_detected_gaps_${currentEpisode.id}`, JSON.stringify(gaps));
          if ((gaps as any)?.scanReport) {
            localStorage.setItem(`qa_scan_report_${currentEpisode.id}`, JSON.stringify((gaps as any).scanReport));
          }
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

  // Hook 3: Gap fix application, templates generation, baking, sound engineer export
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

  const selectedTrack = tracks.find(t => t.id === selectedTrackId);

  if (!currentEpisode) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500">
        Выберите серию в Дашборде для проверки качества
      </div>
    );
  }

  return (
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
        setSelectedTrackId={setSelectedTrackId}
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
        currentSubId={currentSubId}
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
  );
}
