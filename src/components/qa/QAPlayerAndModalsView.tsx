import React from "react";
import {
  Play,
  Pause,
  CheckCircle,
  XCircle,
  AlertCircle,
  MessageSquare,
  Volume2,
  Check,
  X,
  Activity,
  User,
  Clock,
  Trash2,
  Sparkles,
  Save,
  SkipForward,
  Scissors,
  VolumeX,
  Sliders
} from "lucide-react";
import { toast } from "sonner";
import { safeCopyToClipboard } from "../../lib/clipboard";
import { Episode, Participant, Track, SubtitleLine } from "../../types";
import { TrackWaveform } from "./TrackWaveform";
import { MissingLinesModal } from "./MissingLinesModal";
import { ExportModal } from "../ExportModal";
import { ConfirmModal } from "../ui/ConfirmModal";
import { NormalizationMetrics } from "../../lib/qa/audioNormalizer";
import { MissingLineDetection, GapDetectionOptions, QAScanReport } from "../../lib/qa/missingLinesDetector";
import { QAScanConfigModal } from "./QAScanConfigModal";
import { saveQAGapsToTimingProject } from "../../lib/qa/timingSyncService";
import WaveSurfer from "wavesurfer.js";

export interface QAPlayerAndModalsViewProps {
  currentEpisode: Episode;
  tracks: Track[];
  selectedTrackId: string | null;
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
  handleExportSoundEngineer: (targetDir: string, skipConversion: boolean, smartExport?: boolean, uploadToYandex?: boolean, additionalProcessing?: boolean, autoApplyFixes?: boolean, includeSubtitles?: boolean, autoTiming?: boolean) => Promise<void>;
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
  return (
    <>
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
                      {[...selectedTrack.comments].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)).map(comment => (
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
          tracks={tracks}
          onOpenTimingPanel={() => {
            setIsGapModalOpen(false);
            onNavigate?.('timing');
          }}
          onApplyFixes={handleApplyGapFixes}
          onSeekMainPlayer={(timeSec) => {
            handleSeekToTime(timeSec);
          }}
          isApplying={isApplyingGapFixes}
          onReAnalyze={handleRunGapDetection}
          onOpenScanConfig={() => setIsScanConfigModalOpen(true)}
          isAnalyzing={isAnalyzingGaps}
          currentThreshold={gapSensitivityThreshold}
          scanReport={qaScanReport || (detectedGaps as any)?.scanReport}
          videoUrl={videoUrl}
          subLines={subLines}
          onUpdateSubLine={handleUpdateSubLineFromModal}
          onExportSubtitles={handleExportSubtitlesFromModal}
          onSaveGaps={handleSaveDetectedGaps}
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
                  onClick={async () => {
                    if (!generatedMessage) return;
                    try {
                      const ok = await safeCopyToClipboard(generatedMessage);
                      if (ok) {
                        setIsMessageCopied(true);
                        toast.success('Скопировано в буфер обмена!');
                        setTimeout(() => setIsMessageCopied(false), 2000);
                      } else {
                        toast.error('Не удалось скопировать в буфер обмена');
                      }
                    } catch (e: any) {
                      toast.error('Ошибка копирования: ' + (e?.message || String(e)));
                    }
                  }}
                  className={`flex-1 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer ${
                    isMessageCopied ? 'bg-emerald-600 text-white shadow-emerald-500/20' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/20'
                  }`}
                >
                  {isMessageCopied ? <Check className="w-5 h-5" /> : <Save className="w-5 h-5" />}
                  {isMessageCopied ? 'Скопировано!' : 'Скопировать текст'}
                </button>
                <button
                  onClick={async () => {
                    if (!currentEpisode) return;
                    try {
                      const res = await saveQAGapsToTimingProject(currentEpisode, detectedGaps, tracks);
                      toast.success(
                        `✓ Записано в файл тайминга! (Наездов: ${res.summary.overlapsCount}, коллизий: ${res.summary.collisionsCount}, рассинхронов: ${res.summary.desyncCount})`
                      );
                      setIsMessageModalOpen(false);
                      onNavigate?.('timing');
                    } catch (e: any) {
                      toast.error('Ошибка записи в тайминг: ' + (e?.message || String(e)));
                    }
                  }}
                  className="px-6 py-3 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-amber-600/25"
                  title="Записать найденные замечания в файл тайминга серии и сразу открыть Тайминг видео (если сводите серию сами)"
                >
                  <Clock className="w-5 h-5 text-white" />
                  <span>Записать в тайминг (свожу сам)</span>
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
};
