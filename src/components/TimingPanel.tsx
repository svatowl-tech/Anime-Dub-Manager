import React from 'react';
import { ExportModal } from './ExportModal';
import { TimingSettingsModal } from './TimingSettingsModal';
import {
  AudioClip,
  IntentionalOverlapTrackEntry,
  IntentionalOverlapMoment,
  TimingIssueType,
  TimingIssue,
  MissingSubtitleMarker,
  StitchedFixMarker,
  VoiceCollisionMarker,
  TimingPanelProps,
  NoiseCalibration,
  isFixTrack,
  analyzeTrackAudioNoiseFloor,
  TimingHeader,
  TimingActiveProcessBar,
  TimingQAPassportBanner,
  TimingIssuesDrawer,
  TimingFinalReportBanner,
  TimingCalibrationBanner,
  TimingTrackNavigationBar,
  TimingOperationLogsDrawer,
  TimingFloatingVideoWindow,
  TimingTimeRulerHeader,
  TimingOriginalAndStemsRow,
  TimingDubberTracksTimeline,
  TimingFooter,
  TimingResetConfirmModal,
  TimingStemsModal,
  useTimingStateController,
  useTimingPlaybackAndStems,
  useTimingTimelineInteractions,
  useTimingEpisodeLoader,
  useTimingSyncAndPersistence,
  useTimingSilenceAndFixes,
  useTimingStage1Analysis,
  useTimingSelfHealingAndOverlaps,
  useTimingStage2AndClips,
  useTimingExportController,
} from './timing';

export type {
  AudioClip,
  IntentionalOverlapTrackEntry,
  IntentionalOverlapMoment,
  TimingIssueType,
  TimingIssue,
  MissingSubtitleMarker,
  StitchedFixMarker,
  VoiceCollisionMarker,
  TimingPanelProps,
  NoiseCalibration,
};
export { isFixTrack, analyzeTrackAudioNoiseFloor };

export default function TimingPanel({ currentEpisode, onRefresh: _onRefresh, onNavigate }: TimingPanelProps) {
  const s = useTimingStateController();

  // 1. Playback & Original Stems Hook
  const {
    stopAllScheduledClips,
    seekToTime,
    jumpToTime,
    handleSeparateOriginalStems,
    handleImportOriginalStem,
    handleExportStemsToFolder,
  } = useTimingPlaybackAndStems({
    currentEpisode,
    tracks: s.tracks,
    audioClips: s.audioClips,
    mutedTracks: s.mutedTracks,
    volumes: s.volumes,
    isAutoNormalize: s.isAutoNormalize,
    normalizationMetrics: s.normalizationMetrics,
    isOriginalMuted: s.isOriginalMuted,
    originalVolume: s.originalVolume,
    originalStems: s.originalStems,
    setOriginalStems: s.setOriginalStems,
    selectedStemModel: s.selectedStemModel,
    isPlaying: s.isPlaying,
    setIsPlaying: s.setIsPlaying,
    currentTimeRef: s.currentTimeRef,
    setCurrentTime: s.setCurrentTime,
    duration: s.duration,
    zoomLevel: s.zoomLevel,
    videoRef: s.videoRef,
    vocalsAudioRef: s.vocalsAudioRef,
    instrumentalAudioRef: s.instrumentalAudioRef,
    playbackRef: s.playbackRef,
    timelineContainerRef: s.timelineContainerRef,
    audioElementsRef: s.audioElementsRef,
    audioBuffersRef: s.audioBuffersRef,
    activeClipNodesRef: s.activeClipNodesRef,
    updateProcess: s.updateProcess,
    setActiveProcess: s.setActiveProcess,
    addLog: s.addLog,
  });

  // 2. Timeline Interactions Hook
  const {
    handleTriggerUploadMissing,
    handleMissingFileSelected,
    handleDismissMissing,
    handleTimelineScroll,
    handleTimelineWheel,
    handleClipMouseDown,
    handleResizeMouseDown,
    handleExpandClip,
    handleResetClipToOriginal,
    handleDeleteClip,
    handleTimelineClick,
    handleTimeRulerClick,
  } = useTimingTimelineInteractions({
    currentEpisode,
    audioClips: s.audioClips,
    setAudioClips: s.setAudioClips,
    draggingClip: s.draggingClip,
    setDraggingClip: s.setDraggingClip,
    selectedClipId: s.selectedClipId,
    setSelectedClipId: s.setSelectedClipId,
    activeMissingMarker: s.activeMissingMarker,
    setActiveMissingMarker: s.setActiveMissingMarker,
    missingFileInputRef: s.missingFileInputRef,
    setMissingSubtitles: s.setMissingSubtitles,
    setTimingIssues: s.setTimingIssues,
    setNormalizationMetrics: s.setNormalizationMetrics,
    setIsLoading: s.setIsLoading,
    setIsPlaying: s.setIsPlaying,
    duration: s.duration,
    zoomLevel: s.zoomLevel,
    timelineContainerRef: s.timelineContainerRef,
    timeRulerContainerRef: s.timeRulerContainerRef,
    audioBuffersRef: s.audioBuffersRef,
    seekToTime,
    updateProcess: s.updateProcess,
    clearProcess: s.clearProcess,
    addLog: s.addLog,
  });

  // 3. Episode Data Loader Hook
  const { loadEpisodeData } = useTimingEpisodeLoader({
    currentEpisode,
    setTracks: s.setTracks,
    setAudioClips: s.setAudioClips,
    setCollisions: s.setCollisions,
    setIntentionalOverlaps: s.setIntentionalOverlaps,
    setQaPassportLoaded: s.setQaPassportLoaded,
    savedPassportRef: s.savedPassportRef,
    allCatalogTracksRef: s.allCatalogTracksRef,
    isStateRestoredRef: s.isStateRestoredRef,
    setSavedTimingStateInfo: s.setSavedTimingStateInfo,
    setIsSilenceRemoved: s.setIsSilenceRemoved,
    setIsFixesStitched: s.setIsFixesStitched,
    setTimingIssues: s.setTimingIssues,
    setMissingSubtitles: s.setMissingSubtitles,
    setIsTimingAnalyzed: s.setIsTimingAnalyzed,
    setIsIssuesDrawerOpen: s.setIsIssuesDrawerOpen,
    setIsLoading: s.setIsLoading,
    setImportDecodedTracks: s.setImportDecodedTracks,
    setTrackHeightMode: s.setTrackHeightMode,
    setRawSubtitles: s.setRawSubtitles,
    setTrackSubLinesMap: s.setTrackSubLinesMap,
    setVideoUrl: s.setVideoUrl,
    setOriginalPeaks: s.setOriginalPeaks,
    setIsOriginalMuted: s.setIsOriginalMuted,
    handleChangeOriginalWaveScale: s.handleChangeOriginalWaveScale,
    setIsOriginalWaveNormalized: s.setIsOriginalWaveNormalized,
    handleChangeOriginalTrackHeight: s.handleChangeOriginalTrackHeight,
    setNormalizationMetrics: s.setNormalizationMetrics,
    timingSettings: s.timingSettings,
    setTimingSettings: s.setTimingSettings,
    setCalibrationsByTrack: s.setCalibrationsByTrack,
    setDuration: s.setDuration,
    setZoomLevel: s.setZoomLevel,
    setMutedTracks: s.setMutedTracks,
    setVolumes: s.setVolumes,
    setOriginalVolume: s.setOriginalVolume,
    setOriginalStems: s.setOriginalStems,
    setSelectedStemModel: s.setSelectedStemModel,
    setFinalVerificationReport: s.setFinalVerificationReport,
    audioElementsRef: s.audioElementsRef,
    audioBuffersRef: s.audioBuffersRef,
    trackFileSizesRef: s.trackFileSizesRef,
    origBuffersByTrackRef: s.origBuffersByTrackRef,
    fixBuffersByActorRef: s.fixBuffersByActorRef,
    updateProcess: s.updateProcess,
    clearProcess: s.clearProcess,
    addLog: s.addLog,
  });

  // 4. QA Sync, Reset, Auto-Save & Import Hook
  const {
    handleSyncFromQA,
    handleResetTimingToStart,
    handleImportFromQA,
  } = useTimingSyncAndPersistence({
    currentEpisode,
    tracks: s.tracks,
    audioClips: s.audioClips,
    trackSubLinesMap: s.trackSubLinesMap,
    subtitles: s.subtitles,
    isSilenceRemoved: s.isSilenceRemoved,
    isFixesStitched: s.isFixesStitched,
    isTimingAnalyzed: s.isTimingAnalyzed,
    collisions: s.collisions,
    intentionalOverlaps: s.intentionalOverlaps,
    timingIssues: s.timingIssues,
    missingSubtitles: s.missingSubtitles,
    qaPassportLoaded: s.qaPassportLoaded,
    finalVerificationReport: s.finalVerificationReport,
    calibrationsByTrack: s.calibrationsByTrack,
    volumes: s.volumes,
    mutedTracks: s.mutedTracks,
    originalVolume: s.originalVolume,
    isOriginalMuted: s.isOriginalMuted,
    originalWaveScale: s.originalWaveScale,
    isOriginalWaveNormalized: s.isOriginalWaveNormalized,
    originalTrackHeight: s.originalTrackHeight,
    zoomLevel: s.zoomLevel,
    trackHeightMode: s.trackHeightMode,
    timingSettings: s.timingSettings,
    originalStems: s.originalStems,
    isLoading: s.isLoading,
    audioBuffersRef: s.audioBuffersRef,
    savedPassportRef: s.savedPassportRef,
    allCatalogTracksRef: s.allCatalogTracksRef,
    isStateRestoredRef: s.isStateRestoredRef,
    videoRef: s.videoRef,
    currentTimeRef: s.currentTimeRef,
    setAudioClips: s.setAudioClips,
    setCollisions: s.setCollisions,
    setIntentionalOverlaps: s.setIntentionalOverlaps,
    setTimingIssues: s.setTimingIssues,
    setMissingSubtitles: s.setMissingSubtitles,
    setIsTimingAnalyzed: s.setIsTimingAnalyzed,
    setIsIssuesDrawerOpen: s.setIsIssuesDrawerOpen,
    setQaPassportLoaded: s.setQaPassportLoaded,
    setIsLoading: s.setIsLoading,
    setIsImporting: s.setIsImporting,
    setIsResetConfirmOpen: s.setIsResetConfirmOpen,
    setIsPlaying: s.setIsPlaying,
    setCurrentTime: s.setCurrentTime,
    setSavedTimingStateInfo: s.setSavedTimingStateInfo,
    setIsSilenceRemoved: s.setIsSilenceRemoved,
    setIsFixesStitched: s.setIsFixesStitched,
    setFinalVerificationReport: s.setFinalVerificationReport,
    setCalibrationsByTrack: s.setCalibrationsByTrack,
    setSelectedClipId: s.setSelectedClipId,
    stopAllScheduledClips,
    loadEpisodeData,
    updateProcess: s.updateProcess,
    clearProcess: s.clearProcess,
    addLog: s.addLog,
  });

  // 5. Silence Cutting & Two-Scenario Fix Stitching Hook
  const {
    handleCutSilence,
    handleStitchFixes,
  } = useTimingSilenceAndFixes({
    tracks: s.tracks,
    audioClips: s.audioClips,
    trackSubLinesMap: s.trackSubLinesMap,
    timingSettings: s.timingSettings,
    normalizationMetrics: s.normalizationMetrics,
    duration: s.duration,
    audioBuffersRef: s.audioBuffersRef,
    audioElementsRef: s.audioElementsRef,
    origBuffersByTrackRef: s.origBuffersByTrackRef,
    fixBuffersByActorRef: s.fixBuffersByActorRef,
    setTracks: s.setTracks,
    setAudioClips: s.setAudioClips,
    setCalibrationsByTrack: s.setCalibrationsByTrack,
    setNormalizationMetrics: s.setNormalizationMetrics,
    setIsSilenceRemoved: s.setIsSilenceRemoved,
    setIsFixesStitched: s.setIsFixesStitched,
    setIsLoading: s.setIsLoading,
    updateProcess: s.updateProcess,
    clearProcess: s.clearProcess,
    addLog: s.addLog,
  });

  // 6. Stage 1 Analysis (Whisper Orphans, Monotonic Matching, Physics & Unison) Hook
  const { handleAnalyzeTiming } = useTimingStage1Analysis({
    tracks: s.tracks,
    audioClips: s.audioClips,
    trackSubLinesMap: s.trackSubLinesMap,
    subtitles: s.subtitles,
    isSilenceRemoved: s.isSilenceRemoved,
    timingSettings: s.timingSettings,
    intentionalOverlaps: s.intentionalOverlaps,
    audioBuffersRef: s.audioBuffersRef,
    setAudioClips: s.setAudioClips,
    setTimingIssues: s.setTimingIssues,
    setMissingSubtitles: s.setMissingSubtitles,
    setCollisions: s.setCollisions,
    setIntentionalOverlaps: s.setIntentionalOverlaps,
    setIsSilenceRemoved: s.setIsSilenceRemoved,
    setIsTimingAnalyzed: s.setIsTimingAnalyzed,
    setIsIssuesDrawerOpen: s.setIsIssuesDrawerOpen,
    setIsLoading: s.setIsLoading,
    updateProcess: s.updateProcess,
    clearProcess: s.clearProcess,
    addLog: s.addLog,
  });

  // 7. Overlap Role Controls, Physics Toggles & Iterative Self-Healing Audit Hook
  const {
    handleActivateClipOverlapMode,
    handleRemoveClipOverlapMode,
    handleToggleClipOverlapRole,
    handleToggleClipPhysics,
    bindTrackClipsToSubtitlesMonotonically,
    runIterativeSelfHealingAudit,
    separateOverlappingClipPair,
  } = useTimingSelfHealingAndOverlaps({
    tracks: s.tracks,
    trackSubLinesMap: s.trackSubLinesMap,
    subtitles: s.subtitles,
    timingSettings: s.timingSettings,
    audioBuffersRef: s.audioBuffersRef,
    origBuffersByTrackRef: s.origBuffersByTrackRef,
    fixBuffersByActorRef: s.fixBuffersByActorRef,
    setAudioClips: s.setAudioClips,
    setIntentionalOverlaps: s.setIntentionalOverlaps,
    addLog: s.addLog,
  });

  // 8. Stage 2 Auto-Timing, Single Clip/Overlap Fixers, Clip Tools & AI Cleanup Hook
  const {
    handleApplyTargetedAutoTiming,
    handleFixSingleClip,
    handleResolveSingleOverlap,
    handleCopyMissingTimecode,
    handleSetRoleVolume,
    handleSetClipVolume,
    handleSplitClip,
    handleNudgeClip,
    handleAICleanupTrack,
  } = useTimingStage2AndClips({
    tracks: s.tracks,
    audioClips: s.audioClips,
    trackSubLinesMap: s.trackSubLinesMap,
    subtitles: s.subtitles,
    timingIssues: s.timingIssues,
    audioBuffersRef: s.audioBuffersRef,
    setAudioClips: s.setAudioClips,
    setTimingIssues: s.setTimingIssues,
    setCollisions: s.setCollisions,
    setMissingSubtitles: s.setMissingSubtitles,
    setFinalVerificationReport: s.setFinalVerificationReport,
    setVolumes: s.setVolumes,
    setNormalizationMetrics: s.setNormalizationMetrics,
    setAiProcessingTrackId: s.setAiProcessingTrackId,
    setActiveAiMenuTrackId: s.setActiveAiMenuTrackId,
    setIsLoading: s.setIsLoading,
    bindTrackClipsToSubtitlesMonotonically,
    runIterativeSelfHealingAudit,
    separateOverlappingClipPair,
    updateProcess: s.updateProcess,
    clearProcess: s.clearProcess,
    addLog: s.addLog,
  });

  // 9. Export Controller & Memoized Timeline Selectors Hook
  const {
    handleExportToMixing,
    handleExportSoundEngineerFromTiming,
    timeRulerTicks,
    activeSelectedClip,
  } = useTimingExportController({
    currentEpisode,
    tracks: s.tracks,
    audioClips: s.audioClips,
    trackSubLinesMap: s.trackSubLinesMap,
    intentionalOverlaps: s.intentionalOverlaps,
    volumes: s.volumes,
    originalStems: s.originalStems,
    duration: s.duration,
    zoomLevel: s.zoomLevel,
    selectedClipId: s.selectedClipId,
    onNavigate,
    setIntentionalOverlaps: s.setIntentionalOverlaps,
    setIsExportingToMixing: s.setIsExportingToMixing,
    setIsExportingSE: s.setIsExportingSE,
    setExportProgress: s.setExportProgress,
    setIsExportModalOpen: s.setIsExportModalOpen,
    updateProcess: s.updateProcess,
    clearProcess: s.clearProcess,
    addLog: s.addLog,
  });

  return (
    <div className="flex flex-col h-full bg-[#08090d] text-neutral-100 overflow-hidden font-sans">
      {/* Hidden file picker for uploading missing audio lines */}
      <input
        ref={s.missingFileInputRef}
        type="file"
        accept="audio/*,.wav,.mp3,.aac,.m4a,.flac,.ogg"
        className="hidden"
        onChange={handleMissingFileSelected}
      />

      <TimingHeader
        currentEpisode={currentEpisode}
        savedTimingStateInfo={s.savedTimingStateInfo}
        isLoading={s.isLoading}
        statusMessage={s.statusMessage}
        isImporting={s.isImporting}
        importProgress={s.importProgress}
        tracksCount={s.tracks.length}
        isSilenceRemoved={s.isSilenceRemoved}
        isFixesStitched={s.isFixesStitched}
        isTimingAnalyzed={s.isTimingAnalyzed}
        timingIssuesCount={s.timingIssues.length}
        qaPassportLoaded={s.qaPassportLoaded}
        isIssuesDrawerOpen={s.isIssuesDrawerOpen}
        isLogDrawerOpen={s.isLogDrawerOpen}
        operationLogsCount={s.operationLogs.length}
        originalStems={s.originalStems}
        exportingToMixing={s.exportingToMixing}
        isVideoOpen={s.isVideoOpen}
        videoUrl={s.videoUrl}
        isOriginalMuted={s.isOriginalMuted}
        isAutoNormalize={s.isAutoNormalize}
        onOpenResetConfirm={() => s.setIsResetConfirmOpen(true)}
        onOpenSettingsModal={() => s.setIsSettingsModalOpen(true)}
        onToggleVideoOpen={() => s.setIsVideoOpen(prev => !prev)}
        onToggleAutoNormalize={s.handleToggleAutoNormalize}
        onImportFromQA={handleImportFromQA}
        onCutSilence={handleCutSilence}
        onStitchFixes={handleStitchFixes}
        onAnalyzeTiming={handleAnalyzeTiming}
        onApplyTargetedAutoTiming={handleApplyTargetedAutoTiming}
        onSyncFromQA={handleSyncFromQA}
        onToggleIssuesDrawer={() => s.setIsIssuesDrawerOpen(!s.isIssuesDrawerOpen)}
        onToggleLogDrawer={() => s.setIsLogDrawerOpen(!s.isLogDrawerOpen)}
        onOpenStemsModal={() => s.setIsStemsModalOpen(true)}
        onOpenExportModal={() => s.setIsExportModalOpen(true)}
        onExportToMixing={handleExportToMixing}
      />

      <TimingActiveProcessBar
        activeProcess={s.activeProcess}
        isLoading={s.isLoading}
        statusMessage={s.statusMessage}
        importProgress={s.importProgress}
        importDecodedTracks={s.importDecodedTracks}
      />

      <TimingQAPassportBanner
        qaPassportLoaded={s.qaPassportLoaded}
        timingIssuesCount={s.timingIssues.length}
        onOpenIssuesDrawer={() => s.setIsIssuesDrawerOpen(true)}
        onSyncFromQA={handleSyncFromQA}
      />

      <TimingIssuesDrawer
        isOpen={s.isIssuesDrawerOpen}
        timingIssues={s.timingIssues}
        activeIssueFilter={s.activeIssueFilter}
        missingSubtitles={s.missingSubtitles}
        onChangeFilter={s.setActiveIssueFilter}
        onApplyTargetedAutoTiming={handleApplyTargetedAutoTiming}
        onClose={() => s.setIsIssuesDrawerOpen(false)}
        onJumpToTime={jumpToTime}
        onFixSingleClip={handleFixSingleClip}
        onResolveSingleOverlap={handleResolveSingleOverlap}
        onTriggerUploadMissing={handleTriggerUploadMissing}
        onCopyMissingTimecode={handleCopyMissingTimecode}
      />

      <TimingFinalReportBanner
        report={s.finalVerificationReport}
        onJumpToTime={jumpToTime}
        onDismiss={() => s.setFinalVerificationReport(null)}
      />

      <TimingCalibrationBanner
        calibrationsByTrack={s.calibrationsByTrack}
        tracks={s.tracks}
      />

      <TimingTrackNavigationBar
        tracks={s.tracks}
        audioClips={s.audioClips}
        mutedTracks={s.mutedTracks}
        normalizationMetrics={s.normalizationMetrics}
        isAutoNormalize={s.isAutoNormalize}
        originalWaveScale={s.originalWaveScale}
        isOriginalWaveNormalized={s.isOriginalWaveNormalized}
        trackHeightMode={s.trackHeightMode}
        onChangeOriginalWaveScale={s.handleChangeOriginalWaveScale}
        onToggleOriginalWaveNorm={s.handleToggleOriginalWaveNorm}
        onChangeTrackHeightMode={s.setTrackHeightMode}
      />

      {/* Main Multitrack Workspace: Synchronized Top Bar, Floating Video Window, and Unified Vertical Scroll */}
      <div className="flex-1 flex flex-col overflow-hidden relative select-none">
        <TimingFloatingVideoWindow
          isVideoOpen={s.isVideoOpen}
          videoSize={s.videoSize}
          videoPos={s.videoPos}
          draggingVideo={s.draggingVideo}
          currentTime={s.currentTime}
          isOriginalMuted={s.isOriginalMuted}
          originalVolume={s.originalVolume}
          videoUrl={s.videoUrl}
          videoRef={s.videoRef}
          videoDragMovedRef={s.videoDragMovedRef}
          onStartDrag={s.setDraggingVideo}
          onChangeVideoSize={s.handleChangeVideoSize}
          onToggleOriginalMute={() => s.setIsOriginalMuted(prev => !prev)}
          onToggleVideoOpen={s.handleToggleVideoOpen}
          onUpdateDuration={(d) => s.setDuration(prev => Math.max(prev, d))}
          onTogglePlay={() => s.setIsPlaying(prev => !prev)}
        />

        {/* Top Header Row: Left Title + Timecode Ruler (horizontal scroll synchronized) */}
        <TimingTimeRulerHeader
          isAutoNormalize={s.isAutoNormalize}
          duration={s.duration}
          zoomLevel={s.zoomLevel}
          currentTime={s.currentTime}
          timeRulerTicks={timeRulerTicks}
          timeRulerContainerRef={s.timeRulerContainerRef}
          onTimeRulerClick={handleTimeRulerClick}
        />

        {/* Unified DAW Multitrack Workspace: Single scroll container handles vertical and horizontal DAW scrolling */}
        <div
          ref={s.timelineContainerRef}
          onScroll={handleTimelineScroll}
          onWheel={handleTimelineWheel}
          className="flex-1 overflow-auto relative bg-[#06070a]"
        >
          <div
            className="flex flex-col relative"
            style={{ width: `${256 + Math.max(800, s.duration * s.zoomLevel)}px` }}
          >
            {/* Track 1: Original Track(s) — Dual Stems (Vocals & M&E) or Single Video Audio */}
            <TimingOriginalAndStemsRow
              originalStems={s.originalStems}
              originalTrackHeight={s.originalTrackHeight}
              originalPeaks={s.originalPeaks}
              originalVolume={s.originalVolume}
              isOriginalMuted={s.isOriginalMuted}
              originalWaveScale={s.originalWaveScale}
              isOriginalWaveNormalized={s.isOriginalWaveNormalized}
              isVideoOpen={s.isVideoOpen}
              videoUrl={s.videoUrl}
              duration={s.duration}
              zoomLevel={s.zoomLevel}
              currentTime={s.currentTime}
              setOriginalStems={s.setOriginalStems}
              setIsStemsModalOpen={s.setIsStemsModalOpen}
              setIsVideoOpen={s.setIsVideoOpen}
              setIsOriginalMuted={s.setIsOriginalMuted}
              setOriginalVolume={s.setOriginalVolume}
              setResizingOrigTrack={s.setResizingOrigTrack}
              handleTimelineClick={handleTimelineClick}
              handleToggleOriginalWaveNorm={s.handleToggleOriginalWaveNorm}
              handleChangeOriginalTrackHeight={s.handleChangeOriginalTrackHeight}
              handleChangeOriginalWaveScale={s.handleChangeOriginalWaveScale}
            />

            {/* Tracks 2..N: Subtitle Row + Audio Clip Track Row for each track */}
            <TimingDubberTracksTimeline
              tracks={s.tracks}
              audioClips={s.audioClips}
              mutedTracks={s.mutedTracks}
              trackSubLinesMap={s.trackSubLinesMap}
              trackHeightMode={s.trackHeightMode}
              duration={s.duration}
              zoomLevel={s.zoomLevel}
              currentTime={s.currentTime}
              isAutoNormalize={s.isAutoNormalize}
              normalizationMetrics={s.normalizationMetrics}
              volumes={s.volumes}
              aiProcessingTrackId={s.aiProcessingTrackId}
              activeAiMenuTrackId={s.activeAiMenuTrackId}
              selectedClipId={s.selectedClipId}
              missingSubtitles={s.missingSubtitles}
              audioBuffersRef={s.audioBuffersRef}
              timelineContainerRef={s.timelineContainerRef}
              setMutedTracks={s.setMutedTracks}
              setActiveAiMenuTrackId={s.setActiveAiMenuTrackId}
              setSelectedClipId={s.setSelectedClipId}
              handleTimelineClick={handleTimelineClick}
              handleSetRoleVolume={handleSetRoleVolume}
              handleAICleanupTrack={handleAICleanupTrack}
              handleClipMouseDown={handleClipMouseDown}
              handleResizeMouseDown={handleResizeMouseDown}
              handleToggleClipOverlapRole={handleToggleClipOverlapRole}
              handleRemoveClipOverlapMode={handleRemoveClipOverlapMode}
              handleActivateClipOverlapMode={handleActivateClipOverlapMode}
              handleToggleClipPhysics={handleToggleClipPhysics}
              handleFixSingleClip={handleFixSingleClip}
              handleResolveSingleOverlap={handleResolveSingleOverlap}
              handleSplitClip={handleSplitClip}
              handleExpandClip={handleExpandClip}
              handleNudgeClip={handleNudgeClip}
              handleDeleteClip={handleDeleteClip}
              jumpToTime={jumpToTime}
              handleDismissMissing={handleDismissMissing}
              handleTriggerUploadMissing={handleTriggerUploadMissing}
              handleCopyMissingTimecode={handleCopyMissingTimecode}
            />
          </div>
        </div>
      </div>

      <TimingFooter
        isPlaying={s.isPlaying}
        currentTime={s.currentTime}
        duration={s.duration}
        zoomLevel={s.zoomLevel}
        activeSelectedClip={activeSelectedClip}
        onTogglePlay={() => s.setIsPlaying(!s.isPlaying)}
        onSeekToStart={() => seekToTime(0)}
        onSetClipVolume={handleSetClipVolume}
        onExpandClip={handleExpandClip}
        onResetClipToOriginal={handleResetClipToOriginal}
        onDeleteClip={handleDeleteClip}
        onChangeZoomLevel={s.setZoomLevel}
      />

      <TimingOperationLogsDrawer
        isOpen={s.isLogDrawerOpen}
        logs={s.operationLogs}
        onClear={() => s.setOperationLogs([])}
      />

      {/* Export Modal */}
      <ExportModal
        isOpen={s.isExportModalOpen}
        onClose={() => s.setIsExportModalOpen(false)}
        episode={currentEpisode!}
        role="SOUND_ENGINEER"
        onExport={handleExportSoundEngineerFromTiming}
        isExporting={s.isExportingSE}
        progress={s.exportProgress}
      />

      {/* Timing and Silence Settings Modal */}
      <TimingSettingsModal
        isOpen={s.isSettingsModalOpen}
        onClose={() => s.setIsSettingsModalOpen(false)}
        settings={s.timingSettings}
        onSave={s.handleSaveSettings}
      />

      <TimingResetConfirmModal
        isOpen={s.isResetConfirmOpen}
        onClose={() => s.setIsResetConfirmOpen(false)}
        onConfirm={handleResetTimingToStart}
      />

      <TimingStemsModal
        isOpen={s.isStemsModalOpen}
        originalStems={s.originalStems}
        selectedStemModel={s.selectedStemModel}
        onClose={() => s.setIsStemsModalOpen(false)}
        onSelectStemModel={s.setSelectedStemModel}
        onToggleShowStems={(show) => s.setOriginalStems(prev => ({ ...prev, hasStems: show }))}
        onExportStemsToFolder={handleExportStemsToFolder}
        onImportOriginalStem={handleImportOriginalStem}
        onSeparateOriginalStems={handleSeparateOriginalStems}
      />
    </div>
  );
}
