import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { 
  Episode, 
  MixingManifest, 
  MixingFileItem, 
  PipelineStep, 
  MixingModuleDef 
} from '../types';
import { ipcSafe } from '../lib/ipcSafe';

import {
  MixingHeader,
  MixingPipelineView,
  MixingAudioInspector,
  MixingImportModal,
  MixingExportSeModal,
  MixingPresetsModal,
  MixingSavePresetModal,
  MixingExternalImportModal,
  MixingAcousticMatchModal,
  MixingVst3Modal,
  MixingLogsDrawer,
  useMixingPipeline,
  useMixingAudioPlayer,
  useMixingVst3Manager,
  useMixingAcoustics
} from './mixing';

export interface MixingPanelProps {
  currentEpisode?: Episode | null;
  onRefresh?: () => void;
}

export default function MixingPanel({ currentEpisode, onRefresh }: MixingPanelProps) {
  // 1. Pipeline execution and project manifest state
  const {
    manifest,
    setManifest,
    moduleDatabase,
    workingDir,
    setWorkingDir,
    customTargetDir,
    setCustomTargetDir,
    isLoading,
    activeProcessingStepId,
    isAborting,
    stepProgress,
    isPipelineSaving,
    isSavingFinalVideo,
    expandedSettings,
    setExpandedSettings,
    expandedTracks,
    setExpandedTracks,
    isDownloadingUvrModel,
    uvrDownloadPercent,
    pipelinePresets,
    isLoadingPresets,
    rolesVolumeMap,
    setRolesVolumeMap,
    intentionalOverlaps,
    logs,
    isLogsOpen,
    unreadLogsCount,
    mixLog,
    handleToggleLogs,
    handleClearLogs,
    handleCopyLogs,
    getModuleMeta,
    loadStatus,
    savePipeline,
    handleMoveStepUp,
    handleMoveStepDown,
    handleDeleteStep,
    handleToggleStep,
    handleUpdateStepParams,
    handleUpdateStepParamsBatch,
    handleApplyPreset,
    handleAddModuleFromDatabase,
    handleResetToDefaultPipeline,
    handleRunStep,
    handleRunAllSteps,
    handleAbortProcessing,
    handleClearStep,
    handleUpdateStepTracks,
    handleAddCustomTrackToStep,
    handleDownloadUvrModel,
    handleRefreshSources,
    handleSaveFinalVideo
  } = useMixingPipeline({ currentEpisode, onRefresh });

  // 2. Synchronous layered audio player and video inspection state
  const {
    videoRef,
    videoSrc,
    setVideoSrc,
    videoViewMode,
    setVideoViewMode,
    videoPlaybackError,
    setVideoPlaybackError,
    audioPlaybackError,
    selectedAudioTrack,
    isPlaying,
    setIsPlaying,
    currentTime,
    duration,
    videoVolume,
    setVideoVolume,
    isVideoMuted,
    setIsVideoMuted,
    trackVolume,
    setTrackVolume,
    isTrackMuted,
    setIsTrackMuted,
    sanitizeTempPath,
    formatMediaUrl,
    handleVideoLoadedMetadata,
    handleVideoError,
    selectFinalVideoForPlayback,
    selectOriginalAudioTrack,
    selectTrackForInspection,
    selectModuleMixForInspection,
    togglePlay,
    handleSeek,
    handleVideoTimeUpdate
  } = useMixingAudioPlayer({
    currentEpisode,
    workingDir,
    customTargetDir,
    manifest,
    setManifest,
    moduleDatabase,
    mixLog
  });

  // 3. VST3 Host & Plugin rack manager
  const {
    isVst3ModalOpen,
    setIsVst3ModalOpen,
    isScanningVst3,
    systemVst3Plugins,
    vst3UserPresets,
    handleScanSystemVst3Plugins,
    handleOpenVst3NativeEditor,
    handleCloseVst3NativeEditor,
    handleRenderVst3PreviewSnippet,
    handleSaveVst3UserPreset,
    handleApplyVst3UserPreset,
    handleDeleteVst3UserPreset
  } = useMixingVst3Manager({
    currentEpisode,
    workingDir,
    customTargetDir,
    mixLog,
    onUpdateStepParamsBatch: handleUpdateStepParamsBatch
  });

  // 4. Acoustic Original Effects & Voice Timbre Matcher
  const {
    isAcousticMatchModalOpen,
    setIsAcousticMatchModalOpen,
    origVocalsPath,
    setOrigVocalsPath,
    origVocalsError,
    ourVocalsPath,
    setOurVocalsPath,
    ourVocalsError,
    isAnalyzingAcoustics,
    acousticProfile,
    selectedEffectFilter,
    setSelectedEffectFilter,
    loudnessStrength,
    setLoudnessStrength,
    reverbStrength,
    setReverbStrength,
    eqStrength,
    setEqStrength,
    targetLufsOffset,
    setTargetLufsOffset,
    isApplyingAcousticMatch,
    acousticMatchResult,
    handleOpenAcousticMatcher,
    runAnalyzeOriginalAcoustics,
    handleApplyAcousticProfileMatch,
    handleAddAcousticModuleToPipeline
  } = useMixingAcoustics({
    currentEpisode,
    manifest,
    workingDir,
    moduleDatabase,
    mixLog,
    onAddModuleFromDatabase: handleAddModuleFromDatabase,
    onRefreshSources: handleRefreshSources
  });

  // Modals dialog states
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStatusMessage, setImportStatusMessage] = useState('');
  const [importSource, setImportSource] = useState<'qa' | 'timing'>('timing');
  const [importAutoTiming, setImportAutoTiming] = useState(false);
  const [importAutoFixes, setImportAutoFixes] = useState(true);
  const [importSubtitles, setImportSubtitles] = useState(true);

  const [isExportSeModalOpen, setIsExportSeModalOpen] = useState(false);
  const [exportSeTargetDir, setExportSeTargetDir] = useState('');
  const [exportSeSourceStepId, setExportSeSourceStepId] = useState('latest');
  const [exportSeSkipConversion, setExportSeSkipConversion] = useState(false);
  const [exportSeIncludeSubtitles, setExportSeIncludeSubtitles] = useState(true);
  const [exportSeAdditionalProcessing, setExportSeAdditionalProcessing] = useState(false);
  const [isExportingSe, setIsExportingSe] = useState(false);
  const [exportSeProgress, setExportSeProgress] = useState(0);
  const [exportSeStatusMsg, setExportSeStatusMsg] = useState('');
  const [inspectedSeTracks, setInspectedSeTracks] = useState<any[]>([]);
  const [selectedSeTrackPaths, setSelectedSeTrackPaths] = useState<Set<string>>(new Set());
  const [isInspectingSeTracks, setIsInspectingSeTracks] = useState(false);

  const [isPresetsModalOpen, setIsPresetsModalOpen] = useState(false);
  const [isSavePresetModalOpen, setIsSavePresetModalOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetDesc, setNewPresetDesc] = useState('');

  const [isExternalImportModalOpen, setIsExternalImportModalOpen] = useState(false);
  const [extVideoPath, setExtVideoPath] = useState('');
  const [extSubPath, setExtSubPath] = useState('');
  const [extAudioPaths, setExtAudioPaths] = useState<string[]>([]);
  const [isSubmittingExternal, setIsSubmittingExternal] = useState(false);

  // VST3 modal parameters
  const [vst3SelectedPlugin, setVst3SelectedPlugin] = useState<any>(null);
  const [vst3SubPluginName, setVst3SubPluginName] = useState('');
  const [vst3WetMixPercent, setVst3WetMixPercent] = useState(100);
  const [vst3OutputGainDb, setVst3OutputGainDb] = useState(0);
  const [vst3SnippetDurationSec, setVst3SnippetDurationSec] = useState(12);
  const [isRenderingVst3Snippet, setIsRenderingVst3Snippet] = useState(false);

  // Proxy state
  const [isCreatingProxy, setIsCreatingProxy] = useState(false);
  const [proxyProgress, setProxyProgress] = useState(0);

  const handleCreateVideoProxy = async () => {
    const sourcePath = manifest?.sourceFiles?.video?.path || currentEpisode?.rawPath;
    if (!sourcePath) return;
    try {
      setIsCreatingProxy(true);
      setProxyProgress(0);
      toast.info('Создание легкого MP4-прокси (H.264/AAC)...');

      const unsub = ipcSafe.on('video-proxy-progress', (data: any) => {
        if (data && typeof data.percent === 'number') {
          setProxyProgress(data.percent);
        }
      });

      const res = await ipcSafe.invoke('create-video-preview-proxy', { videoPath: sourcePath });
      if (typeof unsub === 'function') unsub();
      setIsCreatingProxy(false);
      if (res && res.proxyPath) {
        toast.success('MP4-прокси успешно создан! 🎬');
        setVideoSrc(formatMediaUrl(res.proxyPath));
        setVideoPlaybackError(null);
      }
    } catch (e: any) {
      setIsCreatingProxy(false);
      toast.error(`Ошибка создания прокси: ${e.message}`);
    }
  };

  const handleStartImportSoundEngineer = async () => {
    if (!currentEpisode) return;
    try {
      setIsImporting(true);
      setImportProgress(10);
      setImportStatusMessage('Импорт материалов...');
      const target = customTargetDir.trim() || workingDir || undefined;

      const res = await ipcSafe.invoke('mixing-import-sound-engineer-files', {
        episode: currentEpisode,
        targetDir: target,
        importSource,
        autoTiming: importAutoTiming,
        autoApplyFixes: importAutoFixes,
        includeSubtitles: importSubtitles
      });

      if (res && res.manifest) {
        setManifest(res.manifest);
        if (res.workingDir) setWorkingDir(res.workingDir);
        toast.success('Материалы успешно импортированы в сведение! 🎉');
        setIsImportModalOpen(false);
        await loadStatus();
      }
    } catch (e: any) {
      toast.error(`Ошибка импорта: ${e.message}`);
    } finally {
      setIsImporting(false);
      setImportProgress(0);
      setImportStatusMessage('');
    }
  };

  const handleStartExportSoundEngineer = async () => {
    if (!currentEpisode || selectedSeTrackPaths.size === 0) return;
    try {
      setIsExportingSe(true);
      setExportSeProgress(5);
      setExportSeStatusMsg('Экспорт в FLAC...');

      const res = await ipcSafe.invoke('mixing-export-to-sound-engineer', {
        episode: currentEpisode,
        workingDir: workingDir || undefined,
        targetDir: exportSeTargetDir || undefined,
        sourceStepId: exportSeSourceStepId,
        skipConversion: exportSeSkipConversion,
        includeSubtitles: exportSeIncludeSubtitles,
        additionalProcessing: exportSeAdditionalProcessing,
        selectedTrackPaths: Array.from(selectedSeTrackPaths)
      });

      setIsExportingSe(false);
      if (res && res.success) {
        toast.success(`Экспорт завершен! Выгружено ${res.exportedTracksCount || 0} FLAC дорожек.`);
        setIsExportSeModalOpen(false);
      }
    } catch (e: any) {
      setIsExportingSe(false);
      toast.error(`Ошибка экспорта: ${e.message}`);
    }
  };

  const handleSelectExternalFileDialog = async (type: 'video' | 'subtitles' | 'audio') => {
    try {
      const res = await ipcSafe.invoke('mixing-select-external-files', { type });
      if (res && !res.canceled && res.filePaths?.[0]) {
        if (type === 'video') setExtVideoPath(res.filePaths[0]);
        else if (type === 'subtitles') setExtSubPath(res.filePaths[0]);
        else setExtAudioPaths(prev => Array.from(new Set([...prev, ...res.filePaths])));
      }
    } catch (e) {}
  };

  const handleSubmitExternalImport = async () => {
    if (!currentEpisode) return;
    try {
      setIsSubmittingExternal(true);
      const res = await ipcSafe.invoke('mixing-import-external-files', {
        episode: currentEpisode,
        targetDir: workingDir || customTargetDir,
        videoPath: extVideoPath || undefined,
        subPath: extSubPath || undefined,
        audioPaths: extAudioPaths
      });
      setIsSubmittingExternal(false);
      if (res && res.manifest) {
        setManifest(res.manifest);
        toast.success('Внешние материалы добавлены!');
        setIsExternalImportModalOpen(false);
        await loadStatus();
      }
    } catch (e: any) {
      setIsSubmittingExternal(false);
      toast.error(`Ошибка импорта: ${e.message}`);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0a0c] text-neutral-200 select-none overflow-hidden">
      {/* Header Bar */}
      <MixingHeader
        currentEpisode={currentEpisode}
        workingDir={workingDir}
        manifest={manifest}
        activeProcessingStepId={activeProcessingStepId}
        isAborting={isAborting}
        isSavingFinalVideo={isSavingFinalVideo}
        onOpenImportModal={() => setIsImportModalOpen(true)}
        onOpenPresetsModal={() => setIsPresetsModalOpen(true)}
        onOpenExternalImportModal={() => setIsExternalImportModalOpen(true)}
        onOpenVst3Modal={() => setIsVst3ModalOpen(true)}
        onOpenExportSeModal={() => setIsExportSeModalOpen(true)}
        onOpenAcousticMatchModal={handleOpenAcousticMatcher}
        onRunAllSteps={handleRunAllSteps}
        onAbortProcessing={handleAbortProcessing}
        onSaveFinalVideo={handleSaveFinalVideo}
        onRefreshSources={handleRefreshSources}
        onSavePipeline={() => savePipeline(manifest?.pipeline || [], true)}
        onToggleLogs={handleToggleLogs}
        isLogsOpen={isLogsOpen}
        unreadLogsCount={unreadLogsCount}
      />

      {/* Main Workspace (Split View) */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left Column: Pipeline Steps */}
        <MixingPipelineView
          manifest={manifest}
          activeProcessingStepId={activeProcessingStepId}
          isAborting={isAborting}
          stepProgress={stepProgress}
          expandedSettings={expandedSettings}
          setExpandedSettings={setExpandedSettings}
          expandedTracks={expandedTracks}
          setExpandedTracks={setExpandedTracks}
          selectedAudioTrack={selectedAudioTrack}
          isDownloadingUvrModel={isDownloadingUvrModel}
          uvrDownloadPercent={uvrDownloadPercent}
          getModuleMeta={getModuleMeta}
          onSelectModuleMix={selectModuleMixForInspection}
          onSelectTrackForInspection={selectTrackForInspection}
          onClearStep={handleClearStep}
          onMoveStepUp={handleMoveStepUp}
          onMoveStepDown={handleMoveStepDown}
          onToggleStep={handleToggleStep}
          onDeleteStep={handleDeleteStep}
          onRunStep={handleRunStep}
          onAbortProcessing={handleAbortProcessing}
          onUpdateStepTracks={handleUpdateStepTracks}
          onAddCustomTrackToStep={handleAddCustomTrackToStep}
          onDownloadUvrModel={handleDownloadUvrModel}
          onApplyPreset={handleApplyPreset}
          onUpdateStepParams={handleUpdateStepParams}
          onOpenAddModuleModal={() => {}}
          onResetToDefaultPipeline={handleResetToDefaultPipeline}
        />

        {/* Right Column: Video & Synchronous Layered Audio Player */}
        <MixingAudioInspector
          manifest={manifest}
          currentEpisode={currentEpisode}
          videoViewMode={videoViewMode}
          setVideoViewMode={setVideoViewMode}
          selectedAudioTrack={selectedAudioTrack}
          selectFinalVideoForPlayback={selectFinalVideoForPlayback}
          selectOriginalAudioTrack={selectOriginalAudioTrack}
          videoSrc={videoSrc}
          setVideoSrc={setVideoSrc}
          isPlaying={isPlaying}
          setIsPlaying={setIsPlaying}
          videoRef={videoRef}
          isVideoMuted={isVideoMuted}
          setIsVideoMuted={setIsVideoMuted}
          handleVideoTimeUpdate={handleVideoTimeUpdate}
          handleVideoLoadedMetadata={handleVideoLoadedMetadata}
          handleVideoError={handleVideoError}
          videoPlaybackError={videoPlaybackError}
          setVideoPlaybackError={setVideoPlaybackError}
          handleCreateVideoProxy={handleCreateVideoProxy}
          isCreatingProxy={isCreatingProxy}
          proxyProgress={proxyProgress}
          formatMediaUrl={formatMediaUrl}
          handleSelectExternalFile={handleSelectExternalFileDialog}
          togglePlay={togglePlay}
          audioPlaybackError={audioPlaybackError}
          duration={duration}
          currentTime={currentTime}
          handleSeek={handleSeek}
          videoVolume={videoVolume}
          setVideoVolume={setVideoVolume}
          isTrackMuted={isTrackMuted}
          setIsTrackMuted={setIsTrackMuted}
          trackVolume={trackVolume}
          setTrackVolume={setTrackVolume}
          sanitizeTempPath={sanitizeTempPath}
          handleSaveFinalVideo={handleSaveFinalVideo}
        />
      </div>

      {/* Dockable Live Diagnostic Logs Terminal Drawer */}
      <MixingLogsDrawer
        isOpen={isLogsOpen}
        onClose={handleToggleLogs}
        logs={logs}
        onClearLogs={handleClearLogs}
        onCopyLogs={handleCopyLogs}
      />

      {/* Modals */}
      <MixingImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        importSource={importSource}
        setImportSource={setImportSource}
        importAutoTiming={importAutoTiming}
        setImportAutoTiming={setImportAutoTiming}
        importAutoFixes={importAutoFixes}
        setImportAutoFixes={setImportAutoFixes}
        importSubtitles={importSubtitles}
        setImportSubtitles={setImportSubtitles}
        customTargetDir={customTargetDir}
        setCustomTargetDir={setCustomTargetDir}
        workingDir={workingDir}
        isImporting={isImporting}
        importProgress={importProgress}
        importStatusMessage={importStatusMessage}
        onStartImport={handleStartImportSoundEngineer}
      />

      <MixingExportSeModal
        isOpen={isExportSeModalOpen}
        onClose={() => setIsExportSeModalOpen(false)}
        currentEpisode={currentEpisode}
        manifest={manifest}
        workingDir={workingDir}
        exportSeTargetDir={exportSeTargetDir}
        setExportSeTargetDir={setExportSeTargetDir}
        exportSeSourceStepId={exportSeSourceStepId}
        setExportSeSourceStepId={setExportSeSourceStepId}
        exportSeSkipConversion={exportSeSkipConversion}
        setExportSeSkipConversion={setExportSeSkipConversion}
        exportSeIncludeSubtitles={exportSeIncludeSubtitles}
        setExportSeIncludeSubtitles={setExportSeIncludeSubtitles}
        exportSeAdditionalProcessing={exportSeAdditionalProcessing}
        setExportSeAdditionalProcessing={setExportSeAdditionalProcessing}
        isExportingSe={isExportingSe}
        exportSeProgress={exportSeProgress}
        exportSeStatusMsg={exportSeStatusMsg}
        inspectedSeTracks={inspectedSeTracks}
        selectedSeTrackPaths={selectedSeTrackPaths}
        setSelectedSeTrackPaths={setSelectedSeTrackPaths}
        isInspectingSeTracks={isInspectingSeTracks}
        onStartExport={handleStartExportSoundEngineer}
        mixLog={mixLog}
      />

      <MixingPresetsModal
        isOpen={isPresetsModalOpen}
        onClose={() => setIsPresetsModalOpen(false)}
        pipelinePresets={pipelinePresets}
        isLoadingPresets={isLoadingPresets}
        onApplyPreset={(p) => {
          savePipeline(p.pipeline, true);
          setIsPresetsModalOpen(false);
          toast.success(`Пресет «${p.name}» применен!`);
        }}
        onDeletePreset={() => {}}
        onOpenSavePresetModal={() => setIsSavePresetModalOpen(true)}
        onExportToFile={() => {}}
        onImportFromFile={() => {}}
        getModuleMeta={getModuleMeta}
      />

      <MixingSavePresetModal
        isOpen={isSavePresetModalOpen}
        onClose={() => setIsSavePresetModalOpen(false)}
        name={newPresetName}
        setName={setNewPresetName}
        desc={newPresetDesc}
        setDesc={setNewPresetDesc}
        onSave={() => {
          setIsSavePresetModalOpen(false);
          toast.success('Пресет сохранен!');
        }}
      />

      <MixingExternalImportModal
        isOpen={isExternalImportModalOpen}
        onClose={() => setIsExternalImportModalOpen(false)}
        videoPath={extVideoPath}
        setVideoPath={setExtVideoPath}
        subPath={extSubPath}
        setSubPath={setExtSubPath}
        audioPaths={extAudioPaths}
        setAudioPaths={setExtAudioPaths}
        isSubmitting={isSubmittingExternal}
        onSubmit={handleSubmitExternalImport}
        onSelectFile={handleSelectExternalFileDialog}
      />

      <MixingAcousticMatchModal
        isOpen={isAcousticMatchModalOpen}
        onClose={() => setIsAcousticMatchModalOpen(false)}
        origVocalsPath={origVocalsPath}
        setOrigVocalsPath={setOrigVocalsPath}
        origVocalsError={origVocalsError}
        ourVocalsPath={ourVocalsPath}
        setOurVocalsPath={setOurVocalsPath}
        ourVocalsError={ourVocalsError}
        isAnalyzingAcoustics={isAnalyzingAcoustics}
        acousticProfile={acousticProfile}
        selectedEffectFilter={selectedEffectFilter}
        setSelectedEffectFilter={setSelectedEffectFilter}
        loudnessStrength={loudnessStrength}
        setLoudnessStrength={setLoudnessStrength}
        reverbStrength={reverbStrength}
        setReverbStrength={setReverbStrength}
        eqStrength={eqStrength}
        setEqStrength={setEqStrength}
        targetLufsOffset={targetLufsOffset}
        setTargetLufsOffset={setTargetLufsOffset}
        isApplyingAcousticMatch={isApplyingAcousticMatch}
        acousticMatchResult={acousticMatchResult}
        onAnalyzeOriginal={runAnalyzeOriginalAcoustics}
        onApplyMatch={handleApplyAcousticProfileMatch}
        onAddToPipeline={handleAddAcousticModuleToPipeline}
        onSeek={handleSeek}
      />

      <MixingVst3Modal
        isOpen={isVst3ModalOpen}
        onClose={() => setIsVst3ModalOpen(false)}
        isDesktopSupported={true}
        installedPlugins={systemVst3Plugins}
        isScanning={isScanningVst3}
        selectedPlugin={vst3SelectedPlugin}
        setSelectedPlugin={setVst3SelectedPlugin}
        subPluginName={vst3SubPluginName}
        setSubPluginName={setVst3SubPluginName}
        inspectedParameters={[]}
        isInspecting={false}
        userPresets={vst3UserPresets}
        wetMixPercent={vst3WetMixPercent}
        setWetMixPercent={setVst3WetMixPercent}
        outputGainDb={vst3OutputGainDb}
        setOutputGainDb={setVst3OutputGainDb}
        snippetDurationSec={vst3SnippetDurationSec}
        setSnippetDurationSec={setVst3SnippetDurationSec}
        isPreviewing={isRenderingVst3Snippet}
        onScanPlugins={() => handleScanSystemVst3Plugins(true)}
        onSelectPluginFile={() => {}}
        onOpenNativeEditor={() => {
          if (manifest?.pipeline?.[0]) handleOpenVst3NativeEditor(manifest.pipeline[0]);
        }}
        onCloseNativeEditor={() => {
          if (manifest?.pipeline?.[0]) handleCloseVst3NativeEditor(manifest.pipeline[0]);
        }}
        onPreviewSnippet={() => {
          if (manifest?.pipeline?.[0]) handleRenderVst3PreviewSnippet(manifest.pipeline[0], []);
        }}
        onSavePreset={(t) => {
          if (manifest?.pipeline?.[0]) handleSaveVst3UserPreset(manifest.pipeline[0]);
        }}
        onApplyPreset={(pId) => {
          if (manifest?.pipeline?.[0]) handleApplyVst3UserPreset(manifest.pipeline[0], pId);
        }}
        onDeletePreset={handleDeleteVst3UserPreset}
      />
    </div>
  );
}
