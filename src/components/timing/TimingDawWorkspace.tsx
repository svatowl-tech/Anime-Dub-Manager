import React from "react";
import {
  Play,
  Pause,
  RotateCcw,
  Scissors,
  Sparkles,
  AlertTriangle,
  FolderOpen,
  ZoomIn,
  ZoomOut,
  ChevronDown,
  Volume2,
  VolumeX,
  MoveHorizontal,
  Activity,
  X,
  Trash2,
  Loader2,
  Zap,
  Copy
} from "lucide-react";
import { Episode, Track, SubtitleLine } from "../../types";
import { ClipWaveform } from "./TimingClipWaveform";
import {
  AudioClip,
  MissingSubtitleMarker,
  VoiceCollisionMarker,
  NoiseCalibration,
  isFixTrack,
  formatSeconds
} from "./timingAudioUtils";

export const TimingDawWorkspace: React.FC<{
  currentEpisode: Episode | null;
  tracks: Track[];
  audioClips: Record<string, AudioClip[]>;
  collisions: VoiceCollisionMarker[];
  missingSubtitles: MissingSubtitleMarker[];
  trackSubLinesMap: Record<string, SubtitleLine[]>;
  calibrationsByTrack: Record<string, NoiseCalibration>;
  duration: number;
  currentTime: number;
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>;
  isPlaying: boolean;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  zoomLevel: number;
  setZoomLevel: React.Dispatch<React.SetStateAction<number>>;
  timeRulerTicks: number[];
  mutedTracks: Set<string>;
  toggleMute: (trackId: string) => void;
  volumes: Record<string, number>;
  originalVolume: number;
  setOriginalVolume: React.Dispatch<React.SetStateAction<number>>;
  selectedClipId: string | null;
  setSelectedClipId: React.Dispatch<React.SetStateAction<string | null>>;
  activeSelectedClip: { clip: AudioClip; trackId: string } | null;
  trackHeightMode: "standard" | "compact" | "fit";
  isImporting: boolean;
  importProgress: number;
  statusMessage: string;
  importDecodedTracks: Array<{ id: string; name: string; duration?: number; status: "pending" | "decoding" | "done" | "error" }>;
  aiProcessingTrackId: string | null;
  activeAiMenuTrackId: string | null;
  setActiveAiMenuTrackId: React.Dispatch<React.SetStateAction<string | null>>;
  isLogDrawerOpen: boolean;
  operationLogs: Array<{ time: string; msg: string; level: "info" | "success" | "warn" | "error" }>;
  setOperationLogs: React.Dispatch<React.SetStateAction<Array<{ time: string; msg: string; level: "info" | "success" | "warn" | "error" }>>>;
  timelineContainerRef: React.MutableRefObject<HTMLDivElement | null>;
  timeRulerContainerRef: React.MutableRefObject<HTMLDivElement | null>;
  audioBuffersRef: React.MutableRefObject<Record<string, AudioBuffer>>;
  handleTimeRulerClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleTimelineScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  handleTimelineWheel: (e: React.WheelEvent<HTMLDivElement>) => void;
  handleSetRoleVolume: (trackId: string, volMultiplier: number) => void;
  handleSetClipVolume: (trackId: string, clipId: string, volPct: number) => void;
  handleAICleanupTrack: (trackId: string, actionType: "deplosive" | "thickener" | "leveler" | "dereverb" | "headroom" | "voicefixer" | "denoise") => void;
  handleClipMouseDown: (e: React.MouseEvent, trackId: string, clip: AudioClip) => void;
  handleResizeMouseDown: (e: React.MouseEvent, trackId: string, clip: AudioClip, edge: "start" | "end") => void;
  handleFixSingleClip: (trackId: string, clipId: string) => void;
  handleResolveSingleOverlap: (trackId: string, clipId: string) => void;
  handleNudgeClip: (trackId: string, clipId: string, deltaSec: number) => void;
  handleSplitClip: (trackId: string, clipId: string) => void;
  handleDeleteClip: (clipId: string, explicitTrackId?: string) => void;
  handleExpandClip: (trackId: string, clipId: string, side: "start" | "end", deltaSec: number) => void;
  handleResetClipToOriginal: (trackId: string, clipId: string) => void;
  handleTriggerUploadMissing: (marker: MissingSubtitleMarker) => void;
  handleCopyMissingTimecode: (text: string, startSec: number, endSec: number) => void;
  handleDismissMissing: (markerId: string) => void;
  handleImportFromQA: () => void;
}> = (props) => {
  const {
    currentEpisode,
    tracks,
    audioClips,
    collisions,
    missingSubtitles,
    trackSubLinesMap,
    calibrationsByTrack,
    duration,
    currentTime,
    setCurrentTime,
    isPlaying,
    setIsPlaying,
    zoomLevel,
    setZoomLevel,
    timeRulerTicks,
    mutedTracks,
    toggleMute,
    volumes,
    originalVolume,
    setOriginalVolume,
    selectedClipId,
    setSelectedClipId,
    activeSelectedClip,
    trackHeightMode,
    isImporting,
    importProgress,
    statusMessage,
    importDecodedTracks,
    aiProcessingTrackId,
    activeAiMenuTrackId,
    setActiveAiMenuTrackId,
    isLogDrawerOpen,
    operationLogs,
    setOperationLogs,
    timelineContainerRef,
    timeRulerContainerRef,
    audioBuffersRef,
    handleTimeRulerClick,
    handleTimelineScroll,
    handleTimelineWheel,
    handleSetRoleVolume,
    handleSetClipVolume,
    handleAICleanupTrack,
    handleClipMouseDown,
    handleResizeMouseDown,
    handleFixSingleClip,
    handleResolveSingleOverlap,
    handleNudgeClip,
    handleSplitClip,
    handleDeleteClip,
    handleExpandClip,
    handleResetClipToOriginal,
    handleTriggerUploadMissing,
    handleCopyMissingTimecode,
    handleDismissMissing,
    handleImportFromQA
  } = props;

  return (
    <>
      {/* Main Multitrack Workspace: Synchronized Top Bar and Unified Vertical Scroll */}
      <div className="flex-1 flex flex-col overflow-hidden relative select-none">
        {/* Top Header Row: Left Title + Timecode Ruler (horizontal scroll synchronized) */}
        <div className="h-9 bg-neutral-900 border-b border-neutral-800 flex shrink-0 z-30">
          <div className="w-64 border-r border-neutral-800 px-3 flex items-center text-[11px] font-bold text-neutral-400 uppercase tracking-wider shrink-0 bg-neutral-900">
            Дорожки (Клипы аудио)
          </div>
          <div 
            ref={timeRulerContainerRef}
            onClick={handleTimeRulerClick}
            className="flex-1 overflow-hidden relative font-mono text-[10px] text-neutral-400 bg-neutral-900/90 cursor-pointer"
          >
            <div 
              className="relative h-full"
              style={{ width: `${Math.max(800, duration * zoomLevel)}px` }}
            >
              {timeRulerTicks.map(sec => (
                <div
                  key={sec}
                  className="absolute border-l border-neutral-800 pl-1 py-1 h-full flex items-center"
                  style={{ left: `${sec * zoomLevel}px` }}
                >
                  {formatSeconds(sec)}
                </div>
              ))}
              {/* Playhead Cursor Marker on Time Ruler */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-40 pointer-events-none shadow-[0_0_8px_rgba(251,191,36,0.8)]"
                style={{ left: `${currentTime * zoomLevel}px` }}
              />
            </div>
          </div>
        </div>

        {/* Unified DAW Multitrack Workspace: Single scroll container handles vertical and horizontal DAW scrolling */}
        <div 
          ref={timelineContainerRef}
          onScroll={handleTimelineScroll}
          onWheel={handleTimelineWheel}
          className="flex-1 overflow-auto relative bg-[#06070a]"
        >
          {/* Prominent Import Progress Card Overlay during initial import or re-import */}
          {isLoading && tracks.length === 0 && (
            <div className="absolute inset-0 bg-[#07090e]/95 backdrop-blur-sm z-50 flex flex-col items-center justify-center p-6 text-center">
              <div className="max-w-xl w-full bg-neutral-900/90 border border-indigo-500/40 rounded-2xl p-6 shadow-2xl flex flex-col gap-4 animate-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 text-left">
                    <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                      <Activity className="w-5 h-5 animate-pulse" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">Импорт и декодирование аудиодорожек</h3>
                      <p className="text-xs text-neutral-400">Подготовка DAW-таймлайна для серии #{currentEpisode?.number || 1}</p>
                    </div>
                  </div>
                  <span className="font-mono text-base font-extrabold text-indigo-400 bg-indigo-950/80 px-3 py-1 rounded-lg border border-indigo-700/60">
                    {importProgress}%
                  </span>
                </div>

                {/* Big Progress Bar */}
                <div className="space-y-1.5">
                  <div className="w-full bg-neutral-950 rounded-full h-3 overflow-hidden border border-neutral-800 p-0.5">
                    <div 
                      className="bg-gradient-to-r from-blue-500 via-indigo-500 to-amber-400 h-full rounded-full transition-all duration-300 shadow-[0_0_16px_rgba(99,102,241,0.8)]"
                      style={{ width: `${Math.max(4, Math.min(100, importProgress))}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-neutral-400">
                    <span className="truncate pr-2 font-mono text-neutral-300">{statusMessage || 'Обработка...'}</span>
                    <span className="shrink-0 text-indigo-300 font-mono">{importProgress}%</span>
                  </div>
                </div>

                {/* Track decoding checklist */}
                {importDecodedTracks.length > 0 && (
                  <div className="bg-neutral-950/70 border border-neutral-800/80 rounded-xl p-3 max-h-48 overflow-y-auto text-left text-xs space-y-1.5 font-mono">
                    <div className="text-[10px] text-neutral-400 font-sans uppercase font-bold tracking-wider mb-1 flex items-center justify-between">
                      <span>Декодирование дорожек ({importDecodedTracks.filter(t => t.status === 'done').length}/{importDecodedTracks.length}):</span>
                      <span className="text-indigo-400">WebAudio PCM</span>
                    </div>
                    {importDecodedTracks.map(t => (
                      <div key={t.id} className="flex items-center justify-between py-0.5 text-[11px]">
                        <span className="flex items-center gap-2 truncate pr-2 text-neutral-200">
                          {t.status === 'done' ? <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> :
                           t.status === 'decoding' ? <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin shrink-0" /> :
                           t.status === 'error' ? <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" /> :
                           <Clock className="w-3.5 h-3.5 text-neutral-600 shrink-0" />}
                          <span className={t.status === 'decoding' ? 'text-indigo-300 font-bold' : ''}>{t.name}</span>
                        </span>
                        <span className="text-[10px] text-neutral-500 shrink-0">
                          {t.duration ? `${t.duration.toFixed(1)}s` : t.status === 'decoding' ? 'декодирование...' : 'ожидание'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div 
            className="flex flex-col relative"
            style={{ width: `${256 + Math.max(800, duration * zoomLevel)}px` }}
          >
            {/* Track 1: Original Audio Track Row (h-16 = 64px) */}
            <div className="flex h-16 border-b border-neutral-800/80 bg-neutral-950/50 shrink-0">
              {/* Sticky Header */}
              <div className="w-64 sticky left-0 z-20 shrink-0 bg-neutral-950 border-r border-neutral-800/80 p-2.5 flex flex-col justify-between select-none">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5" />
                    Оригинал (Видео)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-neutral-500">Громкость:</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={originalVolume}
                    onChange={(e) => setOriginalVolume(Number(e.target.value))}
                    className="w-full accent-amber-500 h-1 bg-neutral-800 rounded"
                  />
                </div>
              </div>

              {/* Original Track Lane */}
              <div 
                onClick={handleTimelineClick}
                className="relative shrink-0 flex items-center bg-neutral-950/30 overflow-hidden cursor-crosshair"
                style={{ width: `${Math.max(800, duration * zoomLevel)}px` }}
              >
                {/* Playhead Cursor Line */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-10 pointer-events-none shadow-[0_0_8px_rgba(251,191,36,0.6)]"
                  style={{ left: `${currentTime * zoomLevel}px` }}
                />
                <div className="absolute inset-0 opacity-15 bg-[linear-gradient(90deg,#3b82f6_1px,transparent_1px)] bg-[size:16px_100%]" />
                <div className="absolute inset-x-0 h-10 my-auto bg-blue-500/10 border-y border-blue-500/20 rounded flex items-center justify-center text-[10px] text-blue-300 font-mono">
                  Оригинальный звук серии ({formatSeconds(duration)})
                </div>
              </div>
            </div>

            {/* Tracks 2..N: Subtitle Row + Audio Clip Track Row for each track */}
            {tracks.map(track => {
              const clips = audioClips[track.id] || [];
              const isMuted = mutedTracks.has(track.id);
              const matchingSubs = trackSubLinesMap[track.id] || [];
              const dubberName = track.participant || track.dubberName || 'Даббер';
              const characterName = track.character || track.characterName || 'Персонаж';

              const subHeightClass = trackHeightMode === 'compact' ? 'h-5' : trackHeightMode === 'fit' ? 'h-4' : 'h-6';
              const audioHeightClass = trackHeightMode === 'compact' ? 'h-16' : trackHeightMode === 'fit' ? 'h-14' : 'h-28';

              return (
                <div key={track.id} id={`track-row-${track.id}`} className="flex flex-col shrink-0">
                  {/* Subtitle Lane Row */}
                  <div className={`flex ${subHeightClass} border-b border-indigo-900/40 bg-[#0e1222] shrink-0`}>
                    <div className="w-64 sticky left-0 z-20 shrink-0 bg-[#0e1222] border-r border-indigo-900/40 px-2.5 flex items-center text-indigo-300 text-[9px] font-bold font-mono tracking-wider uppercase select-none">
                      <span className="truncate">💬 Сабы: {characterName}</span>
                    </div>
                    <div 
                      onClick={handleTimelineClick}
                      className="relative shrink-0 bg-[#0c1020] flex items-center overflow-hidden cursor-crosshair"
                      style={{ width: `${Math.max(800, duration * zoomLevel)}px` }}
                    >
                      {/* Playhead Cursor Line */}
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-10 pointer-events-none shadow-[0_0_8px_rgba(251,191,36,0.6)]"
                        style={{ left: `${currentTime * zoomLevel}px` }}
                      />
                      {matchingSubs.map(sub => (
                        <div
                          key={sub.id}
                          className="absolute inset-y-0.5 bg-indigo-900/70 border border-indigo-500/60 rounded px-1.5 text-[9px] text-indigo-100 font-mono truncate flex items-center leading-none shadow-sm"
                          style={{
                            left: `${sub.startSec * zoomLevel}px`,
                            width: `${Math.max(24, (sub.endSec - sub.startSec) * zoomLevel)}px`
                          }}
                          title={`Субтитры [${formatSeconds(sub.startSec)} - ${formatSeconds(sub.endSec)}]: ${sub.text}`}
                        >
                          💬 {sub.text}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Audio Track Row */}
                  <div className={`flex ${audioHeightClass} border-b border-neutral-800 bg-[#090b10] shrink-0`}>
                    {/* Sticky Audio Header */}
                    <div className={`w-64 sticky left-0 z-20 shrink-0 bg-neutral-900 border-r border-neutral-800 ${trackHeightMode === 'fit' ? 'p-1.5' : 'p-2.5'} flex flex-col justify-between hover:bg-neutral-900/90 transition select-none`}>
                      <div>
                        <div className="flex items-center justify-between">
                          <div className="truncate pr-1">
                            <div className="text-xs font-bold text-neutral-100 truncate">
                              🎙 {dubberName}
                            </div>
                            <div className="text-[10px] text-indigo-400 truncate font-mono">
                              {characterName}
                            </div>
                          </div>

                          <button
                            onClick={() => setMutedTracks(prev => {
                              const next = new Set(prev);
                              if (next.has(track.id)) next.delete(track.id);
                              else next.add(track.id);
                              return next;
                            })}
                            className={`p-1 rounded text-xs transition ${
                              mutedTracks.has(track.id) ? 'bg-red-500/20 text-red-400' : 'text-neutral-400 hover:text-neutral-200'
                            }`}
                          >
                            {mutedTracks.has(track.id) ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                          </button>
                        </div>

                        {/* Track Type Badge & File Info */}
                        <div className="mt-0.5 flex items-center gap-1.5 overflow-hidden">
                          {isFixTrack(track) ? (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-amber-950/80 text-amber-300 border border-amber-800/60 uppercase shrink-0">
                              Фикс
                            </span>
                          ) : track.participant.includes('Дорожка 2') ? (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-purple-950/80 text-purple-300 border border-purple-800/60 uppercase shrink-0">
                              Слой 2 (Внахлест)
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-indigo-950/80 text-indigo-300 border border-indigo-800/60 uppercase shrink-0">
                              Основная
                            </span>
                          )}
                          <span 
                            className="text-[9px] text-neutral-400 font-mono truncate hover:text-neutral-200"
                            title={track.filePath}
                          >
                            {track.filePath.split(/[/\\]/).pop()}
                          </span>
                        </div>
                      </div>

                      {/* Volume Control Presets */}
                      {trackHeightMode === 'compact' || trackHeightMode === 'fit' ? (
                        <div className="flex items-center justify-between pt-0.5 border-t border-neutral-800/40 text-[9px] text-neutral-400">
                          <span className="font-mono text-amber-300 font-bold">
                            {Math.round((volumes[track.id] ?? 1.0) * 100)}%
                          </span>
                          <div className="flex items-center gap-0.5">
                            <button
                              onClick={() => handleSetRoleVolume(track.id, 1.0)}
                              className={`px-1 py-0.5 rounded text-[8px] font-semibold border ${
                                (volumes[track.id] ?? 1.0) === 1.0 ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                              }`}
                            >
                              100%
                            </button>
                            <button
                              onClick={() => handleSetRoleVolume(track.id, 0.7)}
                              className={`px-1 py-0.5 rounded text-[8px] font-semibold border ${
                                (volumes[track.id] ?? 1.0) === 0.7 ? 'bg-amber-600 text-white border-amber-500' : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                              }`}
                            >
                              70%
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1 pt-1 border-t border-neutral-800/50">
                          <div className="flex items-center justify-between text-[9px] text-neutral-400">
                            <span>Громкость роли:</span>
                            <span className="font-mono text-amber-300 font-bold">
                              {Math.round((volumes[track.id] ?? 1.0) * 100)}%
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleSetRoleVolume(track.id, 1.0)}
                              className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border transition ${
                                (volumes[track.id] ?? 1.0) === 1.0 ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                              }`}
                            >
                              100%
                            </button>
                            <button
                              onClick={() => handleSetRoleVolume(track.id, 0.7)}
                              className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border transition ${
                                (volumes[track.id] ?? 1.0) === 0.7 ? 'bg-amber-600 text-white border-amber-500' : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                              }`}
                            >
                              70%
                            </button>
                            <button
                              onClick={() => handleSetRoleVolume(track.id, 0.5)}
                              className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border transition ${
                                (volumes[track.id] ?? 1.0) === 0.5 ? 'bg-purple-600 text-white border-purple-500' : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                              }`}
                            >
                              50%
                            </button>
                          </div>
                        </div>
                      )}

                      {/* AI Audio Cleanup & Polish Action Menu */}
                      <div className="relative mt-1">
                        <button
                          onClick={() => setActiveAiMenuTrackId(activeAiMenuTrackId === track.id ? null : track.id)}
                          disabled={aiProcessingTrackId === track.id}
                          className={`w-full px-2 py-1 rounded text-[10px] font-bold flex items-center justify-between border transition ${
                            aiProcessingTrackId === track.id
                              ? 'bg-amber-950/70 border-amber-800 text-amber-300 animate-pulse'
                              : 'bg-indigo-950/60 hover:bg-indigo-900/80 border-indigo-800/60 text-indigo-200'
                          }`}
                          title="Интеллектуальная AI очистка, De-Plosive, De-Reverb и сатурация дорожки"
                        >
                          <span className="flex items-center gap-1.5 truncate">
                            {aiProcessingTrackId === track.id ? (
                              <Loader2 className="w-3 h-3 animate-spin text-amber-400 shrink-0" />
                            ) : (
                              <Sparkles className="w-3 h-3 text-indigo-400 shrink-0" />
                            )}
                            <span>{aiProcessingTrackId === track.id ? 'Обработка AI...' : '✨ AI Тюнинг'}</span>
                          </span>
                          <ChevronDown className="w-3 h-3 opacity-60" />
                        </button>

                        {activeAiMenuTrackId === track.id && (
                          <div className="absolute left-0 bottom-full mb-1 z-50 w-60 bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl p-1.5 text-xs flex flex-col gap-1 backdrop-blur-md">
                            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo-400 border-b border-neutral-800">
                              AI & DSP Реставрация речи
                            </div>
                            <button
                              onClick={() => handleAICleanupTrack(track.id, 'deplosive')}
                              className="w-full px-2.5 py-1.5 rounded-lg hover:bg-indigo-950/80 hover:text-indigo-200 text-neutral-300 flex items-center gap-2 text-left transition"
                            >
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              <div className="flex flex-col">
                                <span className="font-semibold text-[11px]">De-Plosive Pro</span>
                                <span className="text-[9px] text-neutral-400">Подавление задувов и хлопков «П»/«Б»</span>
                              </div>
                            </button>
                            <button
                              onClick={() => handleAICleanupTrack(track.id, 'thickener')}
                              className="w-full px-2.5 py-1.5 rounded-lg hover:bg-indigo-950/80 hover:text-indigo-200 text-neutral-300 flex items-center gap-2 text-left transition"
                            >
                              <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                              <div className="flex flex-col">
                                <span className="font-semibold text-[11px]">Vocal Thickener</span>
                                <span className="text-[9px] text-neutral-400">Плотность тела + ленточная сатурация</span>
                              </div>
                            </button>
                            <button
                              onClick={() => handleAICleanupTrack(track.id, 'leveler')}
                              className="w-full px-2.5 py-1.5 rounded-lg hover:bg-indigo-950/80 hover:text-indigo-200 text-neutral-300 flex items-center gap-2 text-left transition"
                            >
                              <Sliders className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                              <div className="flex flex-col">
                                <span className="font-semibold text-[11px]">Speech Leveler</span>
                                <span className="text-[9px] text-neutral-400">Выравнивание скачков громкости</span>
                              </div>
                            </button>
                            <button
                              onClick={() => handleAICleanupTrack(track.id, 'dereverb')}
                              className="w-full px-2.5 py-1.5 rounded-lg hover:bg-indigo-950/80 hover:text-indigo-200 text-neutral-300 flex items-center gap-2 text-left transition"
                            >
                              <Radio className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                              <div className="flex flex-col">
                                <span className="font-semibold text-[11px]">Spectral De-Reverb</span>
                                <span className="text-[9px] text-neutral-400">Подавление комнатного эха</span>
                              </div>
                            </button>
                            <button
                              onClick={() => handleAICleanupTrack(track.id, 'headroom')}
                              className="w-full px-2.5 py-1.5 rounded-lg hover:bg-indigo-950/80 hover:text-indigo-200 text-neutral-300 flex items-center gap-2 text-left transition"
                            >
                              <Activity className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                              <div className="flex flex-col">
                                <span className="font-semibold text-[11px]">Headroom Recovery</span>
                                <span className="text-[9px] text-neutral-400">Разгон тихих фраз к -6 dBFS</span>
                              </div>
                            </button>
                            <button
                              onClick={() => handleAICleanupTrack(track.id, 'voicefixer')}
                              className="w-full px-2.5 py-1.5 rounded-lg hover:bg-indigo-950/80 hover:text-indigo-200 text-neutral-300 flex items-center gap-2 text-left transition"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 text-pink-400 shrink-0" />
                              <div className="flex flex-col">
                                <span className="font-semibold text-[11px]">VoiceFixer Air-Boost</span>
                                <span className="text-[9px] text-neutral-400">Восстановление гармоник и верхов</span>
                              </div>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Audio Lane */}
                    <div 
                      onClick={handleTimelineClick}
                      className={`relative shrink-0 flex items-center bg-[#090b10] overflow-hidden select-none transition cursor-crosshair ${
                        isMuted ? 'opacity-30' : ''
                      }`}
                      style={{ width: `${Math.max(800, duration * zoomLevel)}px` }}
                    >
                      {/* Playhead Cursor Line */}
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-10 pointer-events-none shadow-[0_0_8px_rgba(251,191,36,0.6)]"
                        style={{ left: `${currentTime * zoomLevel}px` }}
                      />
                      {/* Subtle DAW track background grid lines */}
                      <div className="absolute inset-0 opacity-10 bg-[linear-gradient(90deg,#3b82f6_1px,transparent_1px)] bg-[size:32px_100%]" />
                      <div className="absolute inset-x-0 top-1/2 h-px bg-neutral-800/40 pointer-events-none" />

                      {/* Sliced Real Audio Clips with PCM Waveforms */}
                      {clips.map(clip => {
                        const clipLeftPx = (clip.clipStartSec + (clip.offsetSec || 0)) * zoomLevel;
                        const clipWidthPx = Math.max(36, clip.durationSec * zoomLevel);
                        const isSelected = selectedClipId === clip.id;

                        return (
                          <div
                            key={clip.id}
                            onClick={(e) => { e.stopPropagation(); setSelectedClipId(clip.id); }}
                            onMouseDown={(e) => handleClipMouseDown(e, track.id, clip)}
                            className={`absolute top-1 bottom-1 rounded-md border flex flex-col justify-between overflow-hidden shadow-lg transition-all cursor-grab active:cursor-grabbing select-none ${
                              clip.hasCollision
                                ? 'bg-red-950/90 border-red-500 shadow-red-500/20 ring-1 ring-red-500/50'
                                : clip.isSelfOverlap
                                ? 'bg-purple-950/90 border-purple-400 shadow-purple-500/20'
                                : clip.timingIssue === 'desync'
                                ? 'bg-amber-950/90 border-amber-400 ring-1 ring-amber-400/50 shadow-amber-500/25'
                                : clip.timingIssue === 'orphan'
                                ? 'bg-cyan-950/90 border-cyan-400 ring-1 ring-cyan-400/50 shadow-cyan-500/25'
                                : clip.isFix
                                ? 'bg-amber-950/90 border-amber-400 shadow-amber-500/20'
                                : isSelected
                                ? 'bg-indigo-900/90 border-indigo-300 ring-2 ring-indigo-400 shadow-indigo-500/30'
                                : 'bg-[#151a2d]/90 border-indigo-600/80 hover:border-indigo-400'
                            }`}
                            style={{
                              left: `${clipLeftPx}px`,
                              width: `${clipWidthPx}px`
                            }}
                            title={`Клип: ${clip.dubberName} (${formatSeconds(clip.clipStartSec + (clip.offsetSec || 0))})\nСубтитры: "${clip.text}"${clip.recognizedText ? `\nРаспознано Виспером: "${clip.recognizedText}" (сходство: ${clip.whisperMatchedScore || 100}%)` : ''}\nДлительность: ${clip.durationSec.toFixed(2)}с (от тишины до тишины)`}
                          >
                            {/* Left Edge Resize Handle (Reveals audio from silence or trims start) */}
                            <div
                              onMouseDown={(e) => handleResizeMouseDown(e, track.id, clip, 'start')}
                              className="absolute top-0 bottom-0 left-0 w-2.5 z-30 cursor-ew-resize group/edge flex items-center justify-center hover:bg-amber-400/40 transition-colors"
                              title="Потяните влево для раскрытия начала фразы из тишины, или вправо для подрезки"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="w-0.5 h-6 rounded-full bg-neutral-400/50 group-hover/edge:bg-amber-300 group-hover/edge:w-1 transition-all" />
                            </div>

                            {/* Right Edge Resize Handle (Reveals audio from silence or trims tail) */}
                            <div
                              onMouseDown={(e) => handleResizeMouseDown(e, track.id, clip, 'end')}
                              className="absolute top-0 bottom-0 right-0 w-2.5 z-30 cursor-ew-resize group/edge flex items-center justify-center hover:bg-amber-400/40 transition-colors"
                              title="Потяните вправо для раскрытия хвоста фразы (вздоха/затухания) из тишины, или влево для подрезки"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="w-0.5 h-6 rounded-full bg-neutral-400/50 group-hover/edge:bg-amber-300 group-hover/edge:w-1 transition-all" />
                            </div>

                            {/* Clip Top Header Badge */}
                            <div className={`px-2 py-0.5 text-[9px] font-mono flex items-center justify-between border-b ${
                              clip.isFix 
                                ? 'bg-amber-900/60 border-amber-500/40 text-amber-200' 
                                : clip.hasCollision
                                ? 'bg-red-900/60 border-red-500/40 text-red-200'
                                : clip.timingIssue === 'desync'
                                ? 'bg-amber-900/60 border-amber-500/40 text-amber-200'
                                : clip.timingIssue === 'orphan'
                                ? 'bg-cyan-900/60 border-cyan-500/40 text-cyan-200'
                                : clip.isSelfOverlap
                                ? 'bg-purple-900/60 border-purple-500/40 text-purple-200'
                                : 'bg-indigo-950/80 border-indigo-800/50 text-indigo-200'
                            }`}>
                              <div className="flex items-center gap-1 truncate font-bold">
                                {clip.isFix && <span className="bg-amber-500 text-neutral-950 px-1 rounded text-[8px] font-black">ФИКС</span>}
                                {clip.hasCollision && <span className="bg-red-500 text-white px-1 rounded text-[8px] font-black">НАЕЗД</span>}
                                {clip.timingIssue === 'desync' && (
                                  <span className="bg-amber-500 text-neutral-950 px-1 rounded text-[8px] font-black shrink-0" title={clip.timingIssueText}>
                                    {clip.timeDiffSec && clip.timeDiffSec > 0 ? `⏳ +${clip.timeDiffSec}с` : `⏳ ${clip.timeDiffSec || ''}с`}
                                  </span>
                                )}
                                {clip.timingIssue === 'orphan' && (
                                  <span className="bg-cyan-500 text-neutral-950 px-1 rounded text-[8px] font-black shrink-0" title={clip.timingIssueText}>
                                    🎙 ВНЕ САБОВ
                                  </span>
                                )}
                                {clip.isSelfOverlap && <span className="bg-purple-500 text-white px-1 rounded text-[8px] font-black">СЛОЙ</span>}
                                {clip.recognizedText && (
                                  <span className="bg-emerald-600/90 text-white px-1 rounded text-[7.5px] font-mono font-bold" title={`Виспер: "${clip.recognizedText}"`}>
                                    ASR
                                  </span>
                                )}
                                <span>{formatSeconds(clip.clipStartSec + (clip.offsetSec || 0))}</span>
                                <span className="text-neutral-300 font-sans truncate max-w-[110px] font-medium opacity-90" title={clip.recognizedText ? `Субтитры: "${clip.text}"\nВиспер: "${clip.recognizedText}"` : clip.text}>
                                  {clip.text}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <span className="text-[8px] font-bold text-amber-300">
                                  {clip.volumePercent || 100}%
                                </span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteClip(clip.id, track.id);
                                  }}
                                  className="p-0.5 text-neutral-400 hover:text-red-300 hover:bg-red-900/60 rounded transition"
                                  title="Удалить фразу / лишний звук (Delete)"
                                >
                                  <Trash2 className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            </div>

                            {/* Real Waveform Canvas inside Clip */}
                            <div className="flex-1 w-full relative overflow-hidden">
                              <ClipWaveform
                                audioBuffer={audioBuffersRef.current[clip.sourceAudioTrackId || track.id]}
                                sourceStartSec={clip.sourceStartSec}
                                sourceEndSec={clip.sourceEndSec}
                                width={Math.round(clipWidthPx)}
                                height={68}
                                color={clip.hasCollision ? '#ef4444' : clip.timingIssue === 'desync' ? '#f59e0b' : clip.timingIssue === 'orphan' ? '#06b6d4' : clip.isSelfOverlap ? '#c084fc' : clip.isFix ? '#fbbf24' : '#818cf8'}
                                volumePercent={clip.volumePercent}
                              />
                              {clip.recognizedText && clip.recognizedText !== clip.text && (
                                <div className="absolute bottom-1 left-1 right-1 pointer-events-none px-1 py-0.5 rounded bg-black/80 text-[8px] text-emerald-300 font-sans italic truncate border border-emerald-500/30">
                                  🎙 {clip.recognizedText}
                                </div>
                              )}
                            </div>

                            {/* Clip Bottom Action Tools (Split, Expand & Nudge, Surgical Fixes) */}
                            <div className="px-1 py-0.5 bg-black/50 flex items-center justify-between opacity-0 hover:opacity-100 transition text-[8px] z-20">
                              <div className="flex items-center gap-0.5">
                                {clip.timingIssue === 'desync' && typeof clip.targetSubStartSec === 'number' && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleFixSingleClip(track.id, clip.id); }}
                                    className="px-1.5 py-0.5 bg-amber-600 hover:bg-amber-500 text-white rounded font-bold transition shadow mr-0.5"
                                    title={`Поставить фразу точно на субтитр (${formatSeconds(clip.targetSubStartSec)})`}
                                  >
                                    🎯 К субтитру
                                  </button>
                                )}
                                {clip.hasCollision && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleResolveSingleOverlap(track.id, clip.id); }}
                                    className="px-1.5 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded font-bold transition shadow mr-0.5"
                                    title="Раздвинуть наезд"
                                  >
                                    ↔️ Раздвинуть
                                  </button>
                                )}
                                {clip.timingIssue === 'orphan' && typeof clip.targetSubStartSec === 'number' && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleFixSingleClip(track.id, clip.id); }}
                                    className="px-1.5 py-0.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-bold transition shadow mr-0.5"
                                    title={`Подставить к найденному субтитру (${formatSeconds(clip.targetSubStartSec)})`}
                                  >
                                    🎯 К сабу
                                  </button>
                                )}
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleSplitClip(track.id, clip.id); }}
                                  className="px-1 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 rounded border border-neutral-700 font-bold"
                                  title="Разрезать клип на 2 части"
                                >
                                  ✂
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleExpandClip(track.id, clip.id, 'start', 0.25); }}
                                  className="px-1 py-0.5 bg-amber-950/70 hover:bg-amber-800 text-amber-300 rounded border border-amber-700/60 font-mono"
                                  title="Раскрыть начало на +0.25с из тишины"
                                >
                                  ◀+0.25с
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleExpandClip(track.id, clip.id, 'end', 0.25); }}
                                  className="px-1 py-0.5 bg-amber-950/70 hover:bg-amber-800 text-amber-300 rounded border border-amber-700/60 font-mono"
                                  title="Раскрыть хвост на +0.25с из тишины"
                                >
                                  +0.25с▶
                                </button>
                              </div>
                              <div className="flex items-center gap-0.5">
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleNudgeClip(track.id, clip.id, -0.05); }}
                                  className="px-1 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded border border-neutral-700 font-mono"
                                  title="-50 мс"
                                >
                                  -50ms
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleNudgeClip(track.id, clip.id, 0.05); }}
                                  className="px-1 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded border border-neutral-700 font-mono"
                                  title="+50 мс"
                                >
                                  +50ms
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDeleteClip(clip.id, track.id); }}
                                  className="px-1 py-0.5 bg-red-950/80 hover:bg-red-800 text-red-300 hover:text-white rounded border border-red-700/60 font-bold ml-0.5 transition"
                                  title="Удалить фразу из тайминга и монтажа (Delete)"
                                >
                                  <Trash2 className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      {/* Interactive Missing Subtitle Placeholder Slots on this Track Lane */}
                      {missingSubtitles
                        .filter(m => m.trackId === track.id)
                        .map(marker => {
                          const markerLeftPx = marker.startSec * zoomLevel;
                          const markerWidthPx = Math.max(72, (marker.endSec - marker.startSec) * zoomLevel);
                          return (
                            <div
                              key={marker.id}
                              onClick={(e) => { e.stopPropagation(); jumpToTime(marker.startSec); }}
                              className="absolute top-1 bottom-1 rounded-md border-2 border-dashed border-amber-500/80 bg-amber-950/40 hover:bg-amber-900/50 z-20 flex flex-col justify-between p-1.5 shadow-lg shadow-amber-950/40 transition select-none cursor-pointer group backdrop-blur-[2px]"
                              style={{
                                left: `${markerLeftPx}px`,
                                width: `${markerWidthPx}px`
                              }}
                              title={`Пропущена реплика «${marker.characterName}» [${formatSeconds(marker.startSec)} - ${formatSeconds(marker.endSec)}]:\n«${marker.text}»\nНажмите для загрузки реплики отдельно`}
                            >
                              <div className="flex items-center justify-between gap-1 text-[8.5px] font-mono leading-none">
                                <span className="flex items-center gap-1 font-bold text-amber-300">
                                  <AlertTriangle className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                                  <span className="bg-amber-500/20 text-amber-300 px-1 py-0.5 rounded border border-amber-500/40">ПРОПУСК</span>
                                  <span>{formatSeconds(marker.startSec)}</span>
                                </span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDismissMissing(marker.id); }}
                                  className="p-0.5 text-neutral-400 hover:text-neutral-200 rounded opacity-0 group-hover:opacity-100 transition"
                                  title="Скрыть этот пропуск"
                                >
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              </div>

                              <div className="text-[10px] text-amber-100 font-sans font-medium truncate my-auto px-0.5 opacity-90" title={marker.text}>
                                💬 «{marker.text}»
                              </div>

                              <div className="flex items-center justify-between gap-1 pt-0.5 border-t border-amber-800/40 text-[8px]">
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleTriggerUploadMissing(marker); }}
                                  className="px-1.5 py-0.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded flex items-center gap-1 shadow transition"
                                  title="Загрузить аудиофайл реплики отдельно"
                                >
                                  <Download className="w-2.5 h-2.5" />
                                  <span>+ Загрузить</span>
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleCopyMissingTimecode(marker.text, marker.startSec, marker.endSec); }}
                                  className="px-1 py-0.5 bg-neutral-900/80 hover:bg-neutral-800 text-amber-300 rounded border border-amber-700/60 font-mono transition"
                                  title="Скопировать таймкод в буфер обмена"
                                >
                                  <Copy className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Bottom floating scroll hint when in standard height mode and tracks exceed screen */}
            {tracks.length > 4 && trackHeightMode === 'standard' && (
              <div className="sticky bottom-3 z-30 flex justify-center pointer-events-none mt-2">
                <button
                  onClick={() => {
                    if (timelineContainerRef.current) {
                      timelineContainerRef.current.scrollTop += 300;
                    }
                  }}
                  className="pointer-events-auto bg-neutral-900/95 hover:bg-neutral-800 text-neutral-200 border border-indigo-500/50 hover:border-indigo-400 px-4 py-1.5 rounded-full text-xs font-semibold shadow-2xl flex items-center gap-2 backdrop-blur transition hover:scale-105"
                >
                  <ChevronDown className="w-3.5 h-3.5 text-indigo-400 animate-bounce" />
                  <span>Всего {tracks.length} дорожек. Нажмите для скролла или переключите «Компактный вид»</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer Playback, Inspector & Zoom Controls */}
      <footer className="bg-neutral-900 border-t border-neutral-800 p-2.5 px-4 shrink-0 flex items-center justify-between gap-4">
        {/* Playback Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="w-8 h-8 bg-amber-600 hover:bg-amber-500 text-white rounded-lg flex items-center justify-center shadow transition"
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </button>
          <button
            onClick={() => setCurrentTime(0)}
            className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <div className="font-mono text-xs text-neutral-200 bg-neutral-950 px-3 py-1.5 rounded-lg border border-neutral-800">
            <span className="text-amber-400 font-bold">{formatSeconds(currentTime)}</span>
            <span className="text-neutral-600 mx-1">/</span>
            <span className="text-neutral-400">{formatSeconds(duration)}</span>
          </div>
        </div>

        {/* Selected Clip Volume & Expansion Inspector */}
        {activeSelectedClip && (
          <div className="flex items-center gap-3 bg-neutral-950 px-3 py-1.5 rounded-xl border border-indigo-800 text-xs shadow-lg">
            <span className="font-bold text-indigo-300 max-w-[150px] truncate" title={activeSelectedClip.clip.text}>
              {activeSelectedClip.clip.characterName}: {activeSelectedClip.clip.text}
            </span>
            <div className="flex items-center gap-2 border-l border-neutral-800 pl-2.5">
              <span className="text-[10px] text-neutral-400">Громкость:</span>
              <input
                type="range"
                min="0"
                max="200"
                step="5"
                value={activeSelectedClip.clip.volumePercent ?? 100}
                onChange={(e) => handleSetClipVolume(activeSelectedClip.trackId, activeSelectedClip.clip.id, Number(e.target.value))}
                className="w-20 accent-indigo-500 h-1.5 bg-neutral-800 rounded cursor-pointer"
              />
              <span className="font-mono text-xs text-amber-300 font-bold w-9 text-right">
                {activeSelectedClip.clip.volumePercent ?? 100}%
              </span>
            </div>

            {/* Quick manual expansion buttons: reveal cut audio from silence */}
            <div className="flex items-center gap-1 border-l border-neutral-800 pl-2.5">
              <span className="text-[10px] text-neutral-400 mr-0.5">Границы:</span>
              <button
                onClick={() => handleExpandClip(activeSelectedClip.trackId, activeSelectedClip.clip.id, 'start', 0.5)}
                className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 rounded text-[10px] border border-neutral-700 transition"
                title="Раскрыть начало фразы на +0.5 сек из тишины"
              >
                ◀ +0.5с
              </button>
              <button
                onClick={() => handleExpandClip(activeSelectedClip.trackId, activeSelectedClip.clip.id, 'end', 0.5)}
                className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 rounded text-[10px] border border-neutral-700 transition"
                title="Раскрыть хвост фразы на +0.5 сек из тишины"
              >
                +0.5с ▶
              </button>
              <button
                onClick={() => handleExpandClip(activeSelectedClip.trackId, activeSelectedClip.clip.id, 'end', 1.0)}
                className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 rounded text-[10px] border border-neutral-700 transition"
                title="Раскрыть хвост фразы на +1.0 сек из тишины"
              >
                +1.0с ▶
              </button>
              <button
                onClick={() => handleResetClipToOriginal(activeSelectedClip.trackId, activeSelectedClip.clip.id)}
                className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white rounded text-[10px] border border-neutral-700 transition"
                title="Сбросить границы клипа к исходной детекции"
              >
                Сброс
              </button>
              <button
                onClick={() => handleDeleteClip(activeSelectedClip.clip.id, activeSelectedClip.trackId)}
                className="px-2 py-0.5 bg-red-950/80 hover:bg-red-800 text-red-300 hover:text-white rounded text-[10px] font-semibold border border-red-700/60 transition flex items-center gap-1 ml-1"
                title="Удалить выбранную фразу / шум (Delete)"
              >
                <Trash2 className="w-3 h-3" />
                <span>Удалить (Del)</span>
              </button>
            </div>
          </div>
        )}

        {/* Zoom Controls */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-neutral-400">Масштаб:</span>
          <button
            onClick={() => setZoomLevel(prev => Math.max(10, prev - 10))}
            className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <input
            type="range"
            min="10"
            max="120"
            value={zoomLevel}
            onChange={(e) => setZoomLevel(Number(e.target.value))}
            className="w-24 accent-amber-500 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
          />
          <button
            onClick={() => setZoomLevel(prev => Math.min(120, prev + 10))}
            className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </footer>

      {/* Expandable Operation Logs Drawer */}
      {isLogDrawerOpen && (
        <div className="bg-neutral-900 border-t border-neutral-800 h-44 flex flex-col shrink-0">
          <div className="p-2 px-4 bg-neutral-950 border-b border-neutral-800 flex items-center justify-between text-xs font-bold text-neutral-300">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-amber-400" />
              <span>Журнал операций тайминга ({operationLogs.length})</span>
            </div>
            <button
              onClick={() => setOperationLogs([])}
              className="text-[10px] text-neutral-400 hover:text-white"
            >
              Очистить
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 px-4 space-y-1 font-mono text-[11px]">
            {operationLogs.map((log, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="text-neutral-500">[{log.time}]</span>
                <span className={
                  log.level === 'error' ? 'text-red-400' :
                  log.level === 'warn' ? 'text-amber-400' :
                  log.level === 'success' ? 'text-emerald-400' :
                  'text-neutral-300'
                }>
                  {log.msg}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
};
