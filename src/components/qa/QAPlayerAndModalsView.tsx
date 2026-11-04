import React from "react";
import {
  Play,
  Pause,
  X,
  Clock,
  SkipForward,
  SkipBack,
  Sliders,
  RotateCcw
} from "lucide-react";
import { toast } from "sonner";
import { Episode, Participant, Track, SubtitleLine } from "../../types";
import { NormalizationMetrics } from "../../lib/qa/audioNormalizer";
import { MissingLineDetection, GapDetectionOptions, QAScanReport } from "../../lib/qa/missingLinesDetector";
import { RotaryKnob } from "./RotaryKnob";
import WaveSurfer from "wavesurfer.js";
import { QAFixIssueBar } from "./player/QAFixIssueBar";
import { QASingleTrackView } from "./player/QASingleTrackView";
import { QAPlayerModalsContainer } from "./modals/QAPlayerModalsContainer";

export interface QAPlayerAndModalsViewProps {
  currentEpisode: Episode;
  tracks: Track[];
  selectedTrackId: string | null;
  setSelectedTrackId?: React.Dispatch<React.SetStateAction<string | null>>;
  selectedTrack: Track | undefined;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoUrl: string | undefined;
  handleVideoPlay: () => void;
  handleVideoPause: () => void;
  handleVideoTimeUpdate: () => void;
  handleVideoSeeking: () => void;
  handleVideoEnded: () => void;
  duration: number;
  setDuration: React.Dispatch<React.SetStateAction<number>>;
  currentTime: number;
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>;
  handleSeekToTime: (time: number) => void;
  isPlaying: boolean;
  togglePlay: () => void;
  seekToNext: () => void;
  seekToPrev: () => void;
  isManualDubberOverride: boolean;
  setIsManualDubberOverride: React.Dispatch<React.SetStateAction<boolean>>;
  manualDubberId: string;
  setManualDubberId: React.Dispatch<React.SetStateAction<string>>;
  handleStop: () => void;
  handlePause: () => void;
  isAutoNormalize: boolean;
  toggleAutoNormalize: () => void;
  originalVolume: number;
  setOriginalVolume: React.Dispatch<React.SetStateAction<number>>;
  normalizationMetrics: Record<string, NormalizationMetrics>;
  volumes: Record<string, number>;
  setVolumes: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  currentCharacter: string | null;
  currentDubberNickname: string | null;
  currentSubtitleText: string | null;
  currentSubId?: string | null;
  handleReassignCharacter: (newCharacterName: string) => Promise<void>;
  newComment: string;
  setNewComment: React.Dispatch<React.SetStateAction<string>>;
  handleAddComment: (textOverride?: string) => Promise<void>;
  detectSilence: () => Promise<void>;
  isAnalyzingSilence: boolean;
  handleStatusChange: (id: string, status: Track["status"]) => Promise<void>;
  isMuted: boolean;
  setIsMuted: React.Dispatch<React.SetStateAction<boolean>>;
  handleDeleteComment: (trackId: string, commentId: string) => Promise<void>;
  mutedTracks: Set<string>;
  setMutedTracks: React.Dispatch<React.SetStateAction<Set<string>>>;
  subLines: SubtitleLine[];
  commentModal: { isOpen: boolean; region: any } | null;
  setCommentModal: React.Dispatch<React.SetStateAction<{ isOpen: boolean; region: any } | null>>;
  wavesurferRef: React.MutableRefObject<WaveSurfer | null>;
  isScanConfigModalOpen: boolean;
  setIsScanConfigModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  gapScanOptions: GapDetectionOptions;
  setGapScanOptions: React.Dispatch<React.SetStateAction<GapDetectionOptions>>;
  handleExecuteGapDetection: (overrideOptions?: GapDetectionOptions) => Promise<void>;
  isGapModalOpen: boolean;
  setIsGapModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  detectedGaps: MissingLineDetection[];
  participants: Participant[];
  onNavigate?: (tab: "dashboard" | "subtitles" | "qa" | "timing" | "mixing" | "release" | "telegram" | "settings" | "database" | "cover" | "stats" | "archive") => void;
  handleApplyGapFixes: (selectedGaps: MissingLineDetection[]) => Promise<void>;
  isApplyingGapFixes: boolean;
  handleRunGapDetection: (overrideThreshold?: number) => Promise<void>;
  isAnalyzingGaps: boolean;
  gapSensitivityThreshold: number;
  qaScanReport: QAScanReport | null;
  handleUpdateSubLineFromModal: (updatedLine: { rawLineIndex: number; name?: string; text?: string; start?: string; end?: string }) => Promise<void>;
  handleExportSubtitlesFromModal: () => Promise<void>;
  handleSaveDetectedGaps: (updatedGaps: MissingLineDetection[]) => void;
  isExportModalOpen: boolean;
  setIsExportModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleExportSoundEngineer: (targetDir: string, skipConversion: boolean, smartExport?: boolean, uploadToYandex?: boolean, additionalProcessing?: boolean, autoApplyFixes?: boolean, includeSubtitles?: boolean, autoTiming?: boolean, selectedTrackIds?: string[]) => Promise<void>;
  isUploading: boolean;
  isMessageModalOpen: boolean;
  setIsMessageModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  generatedMessage: string | null;
  isMessageCopied: boolean;
  setIsMessageCopied: React.Dispatch<React.SetStateAction<boolean>>;
  isBaking: boolean;
  bakeProgress: number;
  bakeStatus: string;
  confirmState: {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    variant?: "danger" | "warning" | "info";
  };
  setConfirmState: React.Dispatch<React.SetStateAction<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    variant?: "danger" | "warning" | "info";
  }>>;
}

export const QAPlayerAndModalsView: React.FC<QAPlayerAndModalsViewProps> = ({
  currentEpisode,
  tracks,
  selectedTrackId,
  setSelectedTrackId,
  selectedTrack,
  videoRef,
  videoUrl,
  handleVideoPlay,
  handleVideoPause,
  handleVideoTimeUpdate,
  handleVideoSeeking,
  handleVideoEnded,
  duration,
  setDuration,
  currentTime,
  setCurrentTime,
  handleSeekToTime,
  isPlaying,
  togglePlay,
  seekToNext,
  seekToPrev,
  isManualDubberOverride,
  setIsManualDubberOverride,
  manualDubberId,
  setManualDubberId,
  handleStop,
  handlePause,
  isAutoNormalize,
  toggleAutoNormalize,
  originalVolume,
  setOriginalVolume,
  normalizationMetrics,
  volumes,
  setVolumes,
  currentCharacter,
  currentDubberNickname,
  currentSubtitleText,
  currentSubId,
  handleReassignCharacter,
  newComment,
  setNewComment,
  handleAddComment,
  detectSilence,
  isAnalyzingSilence,
  handleStatusChange,
  isMuted,
  setIsMuted,
  handleDeleteComment,
  mutedTracks,
  setMutedTracks,
  subLines,
  commentModal,
  setCommentModal,
  wavesurferRef,
  isScanConfigModalOpen,
  setIsScanConfigModalOpen,
  gapScanOptions,
  setGapScanOptions,
  handleExecuteGapDetection,
  isGapModalOpen,
  setIsGapModalOpen,
  detectedGaps,
  participants,
  onNavigate,
  handleApplyGapFixes,
  isApplyingGapFixes,
  handleRunGapDetection,
  isAnalyzingGaps,
  gapSensitivityThreshold,
  qaScanReport,
  handleUpdateSubLineFromModal,
  handleExportSubtitlesFromModal,
  handleSaveDetectedGaps,
  isExportModalOpen,
  setIsExportModalOpen,
  handleExportSoundEngineer,
  isUploading,
  isMessageModalOpen,
  setIsMessageModalOpen,
  generatedMessage,
  isMessageCopied,
  setIsMessageCopied,
  isBaking,
  bakeProgress,
  bakeStatus,
  confirmState,
  setConfirmState
}) => {
  const availableDubbers = React.useMemo(() => {
    const list: Array<{ id: string; name: string; roles: string; trackId?: string }> = [];
    const seen = new Set<string>();

    (currentEpisode?.assignments || []).forEach(a => {
      const dId = a.substituteId || a.dubberId;
      if (!dId) return;
      const nick = a.substitute?.nickname || a.dubber?.nickname || a.characterName || 'Даббер';
      if (!seen.has(dId)) {
        seen.add(dId);
        const dubberRoles = (currentEpisode?.assignments || [])
          .filter(other => (other.substituteId || other.dubberId) === dId)
          .map(other => other.characterName)
          .filter(Boolean);

        const matchingTrack = tracks.find(t => t.id === dId || t.id.startsWith(dId + '__'));
        list.push({
          id: dId,
          name: nick,
          roles: dubberRoles.join(', '),
          trackId: matchingTrack?.id || dId
        });
      }
    });

    tracks.forEach(t => {
      if (t.id === 'original') return;
      const baseId = t.id.split('__')[0];
      if (!seen.has(baseId)) {
        seen.add(baseId);
        list.push({
          id: baseId,
          name: t.participant,
          roles: t.character,
          trackId: t.id
        });
      }
    });

    return list;
  }, [currentEpisode?.assignments, tracks]);

  const dubberTracks = React.useMemo(() => {
    return tracks.filter(t => t.id !== 'original');
  }, [tracks]);

  const handleResetAllVolumes = () => {
    setOriginalVolume(0.5);
    if (videoRef.current) videoRef.current.volume = 0.5;
    setIsMuted(false);
    setMutedTracks(new Set());
    const resetMap: Record<string, number> = {};
    tracks.forEach(t => {
      resetMap[t.id] = 0.8;
    });
    setVolumes(resetMap);
    toast.success('Уровни громкости сброшены по умолчанию');
  };

  const renderFixIssueBar = () => (
    <QAFixIssueBar
      currentEpisode={currentEpisode}
      tracks={tracks}
      selectedTrackId={selectedTrackId}
      selectedTrack={selectedTrack}
      currentTime={currentTime}
      isPlaying={isPlaying}
      handlePause={handlePause}
      seekToNext={seekToNext}
      seekToPrev={seekToPrev}
      handleSeekToTime={handleSeekToTime}
      currentCharacter={currentCharacter}
      currentDubberNickname={currentDubberNickname}
      currentSubtitleText={currentSubtitleText}
      currentSubId={currentSubId}
      handleReassignCharacter={handleReassignCharacter}
      isManualDubberOverride={isManualDubberOverride}
      setIsManualDubberOverride={setIsManualDubberOverride}
      manualDubberId={manualDubberId}
      setManualDubberId={setManualDubberId}
      newComment={newComment}
      setNewComment={setNewComment}
      handleAddComment={handleAddComment}
      handleDeleteComment={handleDeleteComment}
      detectedGaps={detectedGaps}
      handleApplyGapFixes={handleApplyGapFixes}
      isApplyingGapFixes={isApplyingGapFixes}
      subLines={subLines}
    />
  );

  return (
    <>
      {/* Main Content - Player & Comments */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedTrackId === 'all' ? (
          <div className="flex-1 flex flex-col overflow-y-auto p-4 space-y-3">
            <div className="aspect-video bg-black rounded-xl overflow-hidden border border-neutral-800 relative group max-h-[46vh] mx-auto w-full shrink-0">
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
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={seekToPrev} 
                        className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all"
                        title="К предыдущей реплике (Стрелка влево / Shift+A)"
                      >
                        <SkipBack className="w-5 h-5" />
                      </button>
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
                        title="К следующей реплике (Стрелка вправо / Shift+D)"
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

            {/* Miniature Rotary Knob Mixer Strip */}
            <div className="bg-neutral-900/90 border border-neutral-800 rounded-xl px-3.5 py-2.5 shrink-0">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <Sliders className="w-3.5 h-3.5 text-blue-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-200">
                    Микшер громкости даберов
                  </h3>
                  <span className="text-[10px] text-neutral-500 hidden md:inline">
                    (крутилки: тяните вверх/вниз или колесиком мыши · 2× клик — сброс)
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleResetAllVolumes}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-neutral-800 hover:bg-neutral-750 text-neutral-300 border border-neutral-700/80 transition-colors"
                    title="Сбросить все крутилки громкости к стандартным значениям"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Сброс</span>
                  </button>

                  <button
                    type="button"
                    onClick={toggleAutoNormalize}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                      isAutoNormalize 
                        ? 'bg-blue-600/20 text-blue-300 border-blue-500/40 hover:bg-blue-600/30' 
                        : 'bg-neutral-800 text-neutral-400 border-neutral-700 hover:bg-neutral-700'
                    }`}
                    title="Нормализует громкость всех дорожек до целевого уровня в реальном времени"
                  >
                    <Sliders className="w-3 h-3" />
                    <span>{isAutoNormalize ? 'Авто-норм: ВКЛ' : 'Авто-норм: ВЫКЛ'}</span>
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5 scrollbar-thin">
                {/* Original RAW Video Volume Knob */}
                <RotaryKnob
                  value={originalVolume}
                  defaultValue={0.5}
                  onChange={(v) => {
                    setOriginalVolume(v);
                    if (videoRef.current) videoRef.current.volume = v;
                    if (v > 0 && isMuted) setIsMuted(false);
                  }}
                  label="Оригинал"
                  sublabel="РАВ (Видео)"
                  accentColor="neutral"
                  isMuted={isMuted || originalVolume === 0}
                  onToggleMute={() => {
                    const nextMuted = !isMuted;
                    setIsMuted(nextMuted);
                    if (videoRef.current) {
                      videoRef.current.volume = nextMuted ? 0 : originalVolume;
                    }
                  }}
                />

                <div className="h-14 w-px bg-neutral-800 shrink-0 mx-0.5" />

                {/* Dubber Knobs */}
                {dubberTracks.map(track => {
                  const norm = normalizationMetrics[track.id];
                  const isTrackMuted = mutedTracks.has(track.id);
                  const gainBadge =
                    isAutoNormalize && norm && norm.status === 'ready'
                      ? `${norm.gainDb > 0 ? '+' : ''}${norm.gainDb}dB`
                      : undefined;
                  const gainTitle =
                    norm && norm.status === 'ready'
                      ? `Пик: ${norm.peakDb} dBFS, RMS: ${norm.rmsDb} dBFS. Коррекция: ${norm.gainDb > 0 ? '+' : ''}${norm.gainDb} dB`
                      : 'Анализ громкости...';

                  return (
                    <RotaryKnob
                      key={track.id}
                      value={volumes[track.id] ?? 0.8}
                      defaultValue={0.8}
                      onChange={(v) => {
                        setVolumes(prev => ({ ...prev, [track.id]: v }));
                        if (v > 0 && isTrackMuted) {
                          setMutedTracks(prev => {
                            const next = new Set(prev);
                            next.delete(track.id);
                            return next;
                          });
                        }
                      }}
                      label={track.participant}
                      sublabel={track.character}
                      accentColor={track.status === 'approved' ? 'emerald' : track.status === 'fixes_needed' ? 'amber' : 'blue'}
                      isMuted={isTrackMuted || (volumes[track.id] ?? 0.8) === 0}
                      onToggleMute={() => {
                        setMutedTracks(prev => {
                          const next = new Set(prev);
                          if (next.has(track.id)) next.delete(track.id);
                          else next.add(track.id);
                          return next;
                        });
                      }}
                      gainBadge={gainBadge}
                      gainTitle={gainTitle}
                      fixesCount={track.comments.length}
                      onSelectTrack={() => setSelectedTrackId?.(track.id)}
                    />
                  );
                })}
              </div>
            </div>

            {/* Fix Issue Bar with Active Phrase Fix Indicator & History */}
            {renderFixIssueBar()}
          </div>
        ) : selectedTrack ? (
          <QASingleTrackView
            currentEpisode={currentEpisode}
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
            handleStop={handleStop}
            detectSilence={detectSilence}
            isAnalyzingSilence={isAnalyzingSilence}
            handleStatusChange={handleStatusChange}
            currentCharacter={currentCharacter}
            currentDubberNickname={currentDubberNickname}
            currentSubtitleText={currentSubtitleText}
            handleReassignCharacter={handleReassignCharacter}
            volumes={volumes}
            setVolumes={setVolumes}
            isAutoNormalize={isAutoNormalize}
            normalizationMetrics={normalizationMetrics}
            isMuted={isMuted}
            setIsMuted={setIsMuted}
            originalVolume={originalVolume}
            setOriginalVolume={setOriginalVolume}
            handleDeleteComment={handleDeleteComment}
            renderFixIssueBar={renderFixIssueBar}
            mutedTracks={mutedTracks}
            setMutedTracks={setMutedTracks}
            subLines={subLines}
            setCommentModal={setCommentModal}
            wavesurferRef={wavesurferRef}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-neutral-600 italic">
            Выберите дорожку для начала проверки
          </div>
        )}
      </div>

      <QAPlayerModalsContainer
        currentEpisode={currentEpisode}
        tracks={tracks}
        selectedTrack={selectedTrack}
        currentTime={currentTime}
        handleSeekToTime={handleSeekToTime}
        seekToNext={seekToNext}
        seekToPrev={seekToPrev}
        subLines={subLines}
        currentSubtitleText={currentSubtitleText}
        currentDubberNickname={currentDubberNickname}
        commentModal={commentModal}
        setCommentModal={setCommentModal}
        newComment={newComment}
        setNewComment={setNewComment}
        handleAddComment={handleAddComment}
        isManualDubberOverride={isManualDubberOverride}
        setIsManualDubberOverride={setIsManualDubberOverride}
        manualDubberId={manualDubberId}
        setManualDubberId={setManualDubberId}
        availableDubbers={availableDubbers}
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
        videoUrl={videoUrl}
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
    </>
  );
};
