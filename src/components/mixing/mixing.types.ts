import React from 'react';
import { 
  Episode, 
  MixingManifest, 
  MixingFileItem, 
  PipelineStep, 
  MixingModuleDef,
  MixingModulePreset,
  PipelinePreset
} from '../../types';

export interface MixingLogEntry {
  id: string;
  timestamp: string; // HH:mm:ss.ms
  fullTime: string;  // ISO
  level: 'info' | 'warn' | 'error' | 'debug' | 'success';
  tag: string;
  message: string;
  stepId?: string;
  meta?: any;
}

export interface MixingPanelProps {
  currentEpisode?: Episode | null;
  onRefresh?: () => void;
}

export interface Vst3PluginItem {
  name: string;
  path: string;
  subPlugins?: string[];
  vendor?: string;
  category?: string;
}

export interface Vst3UserPreset {
  id: string;
  title: string;
  name: string;
  description?: string;
  vst3Path: string;
  pluginName: string;
  subPluginName?: string;
  stateFile?: string;
  wetMixPercent: number;
  outputGainDb: number;
  createdAt?: string;
}

export interface SelectedAudioTrackInfo {
  id: string;
  name: string;
  path: string;
  label: string;
  stepId?: string;
  isModuleMix?: boolean;
  isFinalVideo?: boolean;
  mixFiles?: MixingFileItem[];
}

export interface MixingHeaderProps {
  currentEpisode?: Episode | null;
  workingDir: string;
  manifest: MixingManifest | null;
  activeProcessingStepId: string | null;
  isAborting: boolean;
  isSavingFinalVideo: boolean;
  onOpenImportModal: () => void;
  onOpenPresetsModal: () => void;
  onOpenExternalImportModal: () => void;
  onOpenVst3Modal: () => void;
  onOpenExportSeModal: () => void;
  onOpenAcousticMatchModal: () => void;
  onRunAllSteps: () => void;
  onAbortProcessing: () => void;
  onSaveFinalVideo: () => void;
  onRefreshSources: () => void;
  onSavePipeline: () => void;
  onToggleLogs: () => void;
  isLogsOpen: boolean;
  unreadLogsCount: number;
}

export interface MixingPipelineViewProps {
  manifest: MixingManifest | null;
  activeProcessingStepId: string | null;
  isAborting: boolean;
  stepProgress: Record<string, number>;
  expandedSettings: Record<string, boolean>;
  setExpandedSettings: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  expandedTracks: Record<string, boolean>;
  setExpandedTracks: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  selectedAudioTrack: SelectedAudioTrackInfo | null;
  isDownloadingUvrModel: boolean;
  uvrDownloadPercent: number;
  getModuleMeta: (moduleId: string) => MixingModuleDef | undefined;
  onSelectModuleMix: (step: PipelineStep) => void;
  onSelectTrackForInspection: (item: MixingFileItem, label: string, stepId?: string) => void;
  onClearStep: (stepId: string, singleFilePath?: string) => void;
  onMoveStepUp: (index: number) => void;
  onMoveStepDown: (index: number) => void;
  onToggleStep: (index: number) => void;
  onDeleteStep: (index: number) => void;
  onRunStep: (stepId: string) => void;
  onAbortProcessing: () => void;
  onUpdateStepTracks: (stepId: string, action: "toggle_exclude" | "clear_exclusions" | "add_custom" | "remove_custom", trackKey?: string, trackPaths?: string[]) => void;
  onAddCustomTrackToStep: (stepId: string) => void;
  onDownloadUvrModel: (targetModelId?: string) => void;
  onApplyPreset: (stepId: string, preset: MixingModulePreset) => void;
  onUpdateStepParams: (stepId: string, paramKey: string, value: any) => void;
  onOpenAddModuleModal: () => void;
  onResetToDefaultPipeline: () => void;
}

export interface MixingStepCardProps {
  step: PipelineStep;
  index: number;
  totalSteps: number;
  manifest: MixingManifest | null;
  activeProcessingStepId: string | null;
  isProcessing: boolean;
  isExpanded: boolean;
  isTracksExpanded: boolean;
  progressPercent: number;
  selectedAudioTrack: SelectedAudioTrackInfo | null;
  isDownloadingUvrModel: boolean;
  uvrDownloadPercent: number;
  meta?: MixingModuleDef;
  onToggleExpand: () => void;
  onToggleTracksExpand: () => void;
  onSelectModuleMix: (step: PipelineStep) => void;
  onSelectTrackForInspection: (item: MixingFileItem, label: string, stepId?: string) => void;
  onClearStep: (stepId: string, singleFilePath?: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleEnable: () => void;
  onDelete: () => void;
  onRun: () => void;
  onAbort: () => void;
  onUpdateStepTracks: (stepId: string, action: "toggle_exclude" | "clear_exclusions" | "add_custom" | "remove_custom", trackKey?: string, trackPaths?: string[]) => void;
  onAddCustomTrack: () => void;
  onDownloadUvrModel: (targetModelId?: string) => void;
  onApplyPreset: (preset: MixingModulePreset) => void;
  onUpdateParams: (paramKey: string, value: any) => void;
}

export interface MixingImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  importSource: 'qa' | 'timing';
  setImportSource: (src: 'qa' | 'timing') => void;
  importAutoTiming: boolean;
  setImportAutoTiming: (v: boolean) => void;
  importAutoFixes: boolean;
  setImportAutoFixes: (v: boolean) => void;
  importSubtitles: boolean;
  setImportSubtitles: (v: boolean) => void;
  customTargetDir: string;
  setCustomTargetDir: (v: string) => void;
  workingDir: string;
  isImporting: boolean;
  importProgress: number;
  importStatusMessage: string;
  onStartImport: () => void;
}

export interface MixingExportSeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentEpisode?: Episode | null;
  manifest: MixingManifest | null;
  workingDir: string;
  exportSeTargetDir: string;
  setExportSeTargetDir: (dir: string) => void;
  exportSeSourceStepId: string;
  setExportSeSourceStepId: (stepId: string) => void;
  exportSeSkipConversion: boolean;
  setExportSeSkipConversion: (v: boolean) => void;
  exportSeIncludeSubtitles: boolean;
  setExportSeIncludeSubtitles: (v: boolean) => void;
  exportSeAdditionalProcessing: boolean;
  setExportSeAdditionalProcessing: (v: boolean) => void;
  isExportingSe: boolean;
  exportSeProgress: number;
  exportSeStatusMsg: string;
  inspectedSeTracks: any[];
  selectedSeTrackPaths: Set<string>;
  setSelectedSeTrackPaths: React.Dispatch<React.SetStateAction<Set<string>>>;
  isInspectingSeTracks: boolean;
  onStartExport: () => void;
  mixLog: (level: 'info' | 'warn' | 'error' | 'debug' | 'success', tag: string, message: string, meta?: any, stepId?: string) => void;
}

export interface MixingPresetsModalProps {
  isOpen: boolean;
  onClose: () => void;
  pipelinePresets: PipelinePreset[];
  isLoadingPresets: boolean;
  onApplyPreset: (preset: PipelinePreset) => void;
  onDeletePreset: (presetId: string, e: React.MouseEvent) => void;
  onOpenSavePresetModal: () => void;
  onExportToFile: () => void;
  onImportFromFile: () => void;
  getModuleMeta: (moduleId: string) => MixingModuleDef | undefined;
}

export interface MixingSavePresetModalProps {
  isOpen: boolean;
  onClose: () => void;
  name: string;
  setName: (v: string) => void;
  desc: string;
  setDesc: (v: string) => void;
  onSave: () => void;
}

export interface MixingExternalImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoPath: string;
  setVideoPath: (v: string) => void;
  subPath: string;
  setSubPath: (v: string) => void;
  audioPaths: string[];
  setAudioPaths: React.Dispatch<React.SetStateAction<string[]>>;
  isSubmitting: boolean;
  onSubmit: () => void;
  onSelectFile: (type: 'video' | 'subtitles' | 'audio') => void;
}

export interface MixingAcousticMatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  origVocalsPath: string;
  setOrigVocalsPath: (p: string) => void;
  origVocalsError: string | null;
  ourVocalsPath: string;
  setOurVocalsPath: (p: string) => void;
  ourVocalsError: string | null;
  isAnalyzingAcoustics: boolean;
  acousticProfile: any;
  selectedEffectFilter: string;
  setSelectedEffectFilter: (f: string) => void;
  loudnessStrength: number;
  setLoudnessStrength: (v: number) => void;
  reverbStrength: number;
  setReverbStrength: (v: number) => void;
  eqStrength: number;
  setEqStrength: (v: number) => void;
  targetLufsOffset: number;
  setTargetLufsOffset: (v: number) => void;
  isApplyingAcousticMatch: boolean;
  acousticMatchResult: any;
  onAnalyzeOriginal: (path: string) => void;
  onApplyMatch: () => void;
  onAddToPipeline: () => void;
  onSeek: (time: number) => void;
}

export interface MixingVst3ModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDesktopSupported: boolean;
  installedPlugins: Vst3PluginItem[];
  isScanning: boolean;
  selectedPlugin: Vst3PluginItem | null;
  setSelectedPlugin: (plugin: Vst3PluginItem | null) => void;
  subPluginName: string;
  setSubPluginName: (name: string) => void;
  inspectedParameters: any[];
  isInspecting: boolean;
  userPresets: Vst3UserPreset[];
  wetMixPercent: number;
  setWetMixPercent: (v: number) => void;
  outputGainDb: number;
  setOutputGainDb: (v: number) => void;
  snippetDurationSec: number;
  setSnippetDurationSec: (v: number) => void;
  isPreviewing: boolean;
  onScanPlugins: () => void;
  onSelectPluginFile: () => void;
  onOpenNativeEditor: () => void;
  onCloseNativeEditor: () => void;
  onPreviewSnippet: () => void;
  onSavePreset: (title: string, desc: string) => void;
  onApplyPreset: (presetId: string) => void;
  onDeletePreset: (presetId: string) => void;
}

export interface MixingLogsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  logs: MixingLogEntry[];
  onClearLogs: () => void;
  onCopyLogs: () => void;
}
