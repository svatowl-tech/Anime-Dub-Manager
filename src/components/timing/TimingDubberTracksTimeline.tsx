import React from 'react';
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, Copy, Download, Loader2, Radio, ShieldCheck, Sliders, Sparkles, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import { Track, SubtitleLine } from '../../types';
import { NormalizationMetrics } from '../../lib/qa/audioNormalizer';
import { AudioClip, MissingSubtitleMarker } from './timing.types';
import { formatSeconds, isFixTrack } from './timing.utils';
import { ClipWaveform } from './ClipWaveform';

export interface TimingDubberTracksTimelineProps {
  tracks: Track[];
  audioClips: Record<string, AudioClip[]>;
  mutedTracks: Set<string>;
  trackSubLinesMap: Record<string, SubtitleLine[]>;
  trackHeightMode: 'standard' | 'compact' | 'fit';
  duration: number;
  zoomLevel: number;
  currentTime: number;
  isAutoNormalize: boolean;
  normalizationMetrics: Record<string, NormalizationMetrics>;
  volumes: Record<string, number>;
  aiProcessingTrackId: string | null;
  activeAiMenuTrackId: string | null;
  selectedClipId: string | null;
  missingSubtitles: MissingSubtitleMarker[];
  audioBuffersRef: React.MutableRefObject<Record<string, AudioBuffer>>;
  timelineContainerRef: React.RefObject<HTMLDivElement | null>;
  setMutedTracks: React.Dispatch<React.SetStateAction<Set<string>>>;
  setActiveAiMenuTrackId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedClipId: React.Dispatch<React.SetStateAction<string | null>>;
  handleTimelineClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleSetRoleVolume: (trackId: string, volMultiplier: number) => void;
  handleAICleanupTrack: (
    trackId: string,
    actionType: 'deplosive' | 'thickener' | 'leveler' | 'dereverb' | 'headroom' | 'voicefixer' | 'denoise'
  ) => Promise<void>;
  handleClipMouseDown: (e: React.MouseEvent, trackId: string, clip: AudioClip) => void;
  handleResizeMouseDown: (e: React.MouseEvent, trackId: string, clip: AudioClip, edge: 'start' | 'end') => void;
  handleToggleClipOverlapRole: (trackId: string, clipId: string) => void;
  handleRemoveClipOverlapMode: (trackId: string, clipId: string) => void;
  handleActivateClipOverlapMode: (trackId: string, clipId: string, targetRole?: 'main' | 'secondary') => void;
  handleToggleClipPhysics: (trackId: string, clipId: string) => void;
  handleFixSingleClip: (trackId: string, clipId: string) => void;
  handleResolveSingleOverlap: (trackId: string, clipId?: string, issueTimeSec?: number, explicitOverlappingClipId?: string) => void;
  handleSplitClip: (trackId: string, clipId: string) => void;
  handleExpandClip: (trackId: string, clipId: string, side: 'start' | 'end', deltaSec: number) => void;
  handleNudgeClip: (trackId: string, clipId: string, deltaSec: number) => void;
  handleDeleteClip: (clipId: string, trackId?: string) => void;
  jumpToTime: (timeSec: number) => void;
  handleDismissMissing: (markerId: string) => void;
  handleTriggerUploadMissing: (marker: MissingSubtitleMarker) => void;
  handleCopyMissingTimecode: (text: string, startSec: number, endSec: number) => void;
}

export const TimingDubberTracksTimeline: React.FC<TimingDubberTracksTimelineProps> = ({
  tracks, audioClips, mutedTracks, trackSubLinesMap, trackHeightMode,
  duration, zoomLevel, currentTime, isAutoNormalize, normalizationMetrics,
  volumes, aiProcessingTrackId, activeAiMenuTrackId, selectedClipId,
  missingSubtitles, audioBuffersRef, timelineContainerRef, setMutedTracks,
  setActiveAiMenuTrackId, setSelectedClipId, handleTimelineClick,
  handleSetRoleVolume, handleAICleanupTrack, handleClipMouseDown,
  handleResizeMouseDown, handleToggleClipOverlapRole, handleRemoveClipOverlapMode,
  handleActivateClipOverlapMode, handleToggleClipPhysics, handleFixSingleClip,
  handleResolveSingleOverlap, handleSplitClip, handleExpandClip, handleNudgeClip,
  handleDeleteClip, jumpToTime, handleDismissMissing, handleTriggerUploadMissing,
  handleCopyMissingTimecode,
}) => {
  return (
    <>
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

                    <div className="flex items-center gap-1 shrink-0">
                      {isAutoNormalize && normalizationMetrics[track.id] && (
                        <span
                          className="px-1 py-0.5 rounded text-[9px] font-mono tabular-nums font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-700/50"
                          title={`Авто-нормализация как в QA: ${normalizationMetrics[track.id].gainDb > 0 ? '+' : ''}${normalizationMetrics[track.id].gainDb.toFixed(1)} dB (RMS: ${normalizationMetrics[track.id].rmsDb.toFixed(1)} dBFS, Peak: ${normalizationMetrics[track.id].peakDb.toFixed(1)} dBFS)`}
                        >
                          {normalizationMetrics[track.id].gainDb > 0 ? `+${normalizationMetrics[track.id].gainDb.toFixed(1)}` : normalizationMetrics[track.id].gainDb.toFixed(1)}dB
                        </span>
                      )}
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
                  const clipWidthPx = Math.max(8, Math.round(clip.durationSec * zoomLevel));
                  const isSelected = selectedClipId === clip.id;

                  return (
                    <div
                      key={clip.id}
                      onClick={(e) => { e.stopPropagation(); setSelectedClipId(clip.id); }}
                      onMouseDown={(e) => handleClipMouseDown(e, track.id, clip)}
                      className={`absolute top-1 bottom-1 rounded-md border flex flex-col justify-between overflow-hidden shadow-lg transition-all cursor-grab active:cursor-grabbing select-none ${
                        clip.hasCollision
                          ? 'bg-red-950/90 border-red-500 shadow-red-500/20 ring-1 ring-red-500/50'
                          : clip.isPhysics
                          ? 'bg-fuchsia-950/85 border-fuchsia-500/80 shadow-fuchsia-500/15'
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
                      title={`Клип: ${clip.dubberName} (${formatSeconds(clip.clipStartSec + (clip.offsetSec || 0))})\nТип: ${clip.isPhysics ? '⚡ Физика (охи/вздохи/смех — защищено от сдвига на сабы)' : '💬 Диалоговая фраза'}\nСубтитры: "${clip.text}"${clip.recognizedText ? `\nРаспознано Виспером: "${clip.recognizedText}" (сходство: ${clip.whisperMatchedScore || 100}%)` : ''}\nДлительность: ${clip.durationSec.toFixed(2)}с (от тишины до тишины)`}
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
                          : clip.isPhysics
                          ? 'bg-fuchsia-900/60 border-fuchsia-500/40 text-fuchsia-200'
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
                          {clip.recoveredFrom && (
                            <span
                              className="bg-emerald-500 text-neutral-950 px-1 rounded text-[8px] font-black shrink-0"
                              title={`Фраза автоматически найдена и восстановлена финальным аудитом из ${clip.recoveredFrom === 'fix' ? 'дорожки фиксов' : 'оригинальной дорожки'}`}
                            >
                              🚑 {clip.recoveredFrom === 'fix' ? 'ВОССТ.ФИКС' : 'ВОССТ.ОРИГ'}
                            </span>
                          )}
                          {clip.isPhysics && (
                            <span
                              className="bg-fuchsia-500 text-white px-1 rounded text-[8px] font-black shrink-0"
                              title="Физика (охи/вздохи/смех вне субтитров — защищена от притягивания к чужим сабам)"
                            >
                              ⚡ ФИЗИКА
                            </span>
                          )}
                          {clip.coveredSubIds && clip.coveredSubIds.length > 1 && (
                            <span
                              className="bg-sky-500 text-neutral-950 px-1 rounded text-[8px] font-black shrink-0"
                              title={`Один слитный аудиоклип покрывает сразу ${clip.coveredSubIds.length} идущих подряд субтитра персонажа`}
                            >
                              🔗 x{clip.coveredSubIds.length} САБА
                            </span>
                          )}
                          {clip.isUnisonPhrase && (
                            <span
                              className="bg-indigo-400 text-neutral-950 px-1 rounded text-[8px] font-black shrink-0"
                              title="Синхронный хор / унисон (выровнено по пику вступления голоса)"
                            >
                              🎙 УНИСОН
                            </span>
                          )}
                          {clip.timingNotRequired && !clip.timingIssue && !clip.hasCollision && (
                            <span
                              className="bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 px-1 rounded text-[8px] font-bold shrink-0"
                              title={clip.timingNotRequiredReason || 'Фраза в пределах саба (хвост ≤30%) — тайминг не требуется'}
                            >
                              ✓ В САБЕ (≤30%)
                            </span>
                          )}
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
                          {/* Direct Main Voice Selector and Mode Removal on Overlapping Clips */}
                          {clip.overlapRole && (
                            <div className="flex items-center gap-0.5">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleClipOverlapRole(track.id, clip.id);
                                }}
                                className={`px-1.5 py-0.2 rounded text-[8px] font-black transition border ${
                                  clip.overlapRole === 'main'
                                    ? 'bg-emerald-500 text-neutral-950 border-emerald-300 shadow-sm'
                                    : 'bg-neutral-900/90 hover:bg-emerald-950 text-amber-300 border-amber-500/50'
                                }`}
                                title={
                                  clip.overlapRole === 'main'
                                    ? '★ Главный голос (0 дБ) в одновременной речи. Кликните для переключения на Второй (-10 дБ).'
                                    : '🔉 Второй голос (-10 дБ) в одновременной речи. Кликните для переключения на Главный (0 дБ).'
                                }
                              >
                                {clip.overlapRole === 'main' ? '★ Главный (0дБ)' : '🔉 Второй (-10дБ)'}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveClipOverlapMode(track.id, clip.id);
                                }}
                                className="px-1 py-0.2 rounded text-[8px] font-bold bg-neutral-800 hover:bg-red-950 text-neutral-400 hover:text-red-300 border border-neutral-700 transition"
                                title="Убрать режим Главный/Второй (снять приглушение -10 дБ, вернуть обычный режим фразы)"
                              >
                                ✕
                              </button>
                            </div>
                          )}
                          <span className="text-[8px] font-bold text-amber-300">
                            {clip.volumePercent || 100}%
                            {typeof clip.volumeGainDb === 'number' && clip.volumeGainDb !== 0 ? ` (${clip.volumeGainDb > 0 ? '+' : ''}${clip.volumeGainDb}dB)` : ''}
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
                          color={clip.hasCollision ? '#ef4444' : clip.isPhysics ? '#d946ef' : clip.timingIssue === 'desync' ? '#f59e0b' : clip.timingIssue === 'orphan' ? '#06b6d4' : clip.isSelfOverlap ? '#c084fc' : clip.isFix ? '#fbbf24' : '#818cf8'}
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
                          {clip.overlapRole ? (
                            <div className="flex items-center gap-0.5 mr-0.5">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleClipOverlapRole(track.id, clip.id);
                                }}
                                className={`px-1.5 py-0.5 rounded font-bold transition shadow ${
                                  clip.overlapRole === 'main'
                                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                                    : 'bg-amber-700 hover:bg-amber-600 text-white'
                                }`}
                                title="Переключить роль: Главный (0 дБ) <-> Второй (-10 дБ)"
                              >
                                {clip.overlapRole === 'main' ? '★ Главный 0дБ' : '🔉 Сделать главным'}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveClipOverlapMode(track.id, clip.id);
                                }}
                                className="px-1 py-0.5 rounded bg-neutral-800 hover:bg-red-900 text-neutral-300 hover:text-white font-bold transition border border-neutral-700"
                                title="Убрать режим Главный/Второй с этой фразы (сбросить приглушение на 0 дБ)"
                              >
                                🚫 Снять
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-0.5 mr-0.5">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleActivateClipOverlapMode(track.id, clip.id, 'main');
                                }}
                                className="px-1.5 py-0.5 rounded font-bold transition shadow bg-neutral-850 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/60"
                                title="Активировать режим одновременной речи: сделать эту фразу Главной (0 дБ)"
                              >
                                ★ Главный
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleActivateClipOverlapMode(track.id, clip.id, 'secondary');
                                }}
                                className="px-1.5 py-0.5 rounded font-bold transition shadow bg-neutral-850 hover:bg-amber-950 text-amber-300 border border-amber-700/60"
                                title="Активировать режим одновременной речи: сделать эту фразу Второй (-10 дБ)"
                              >
                                🔉 Второй
                              </button>
                            </div>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleClipPhysics(track.id, clip.id);
                            }}
                            className={`px-1 py-0.5 rounded border font-bold transition mr-0.5 ${
                              clip.isPhysics
                                ? 'bg-fuchsia-700 hover:bg-fuchsia-600 text-white border-fuchsia-400'
                                : 'bg-neutral-800 hover:bg-neutral-700 text-fuchsia-300 border-neutral-700'
                            }`}
                            title={
                              clip.isPhysics
                                ? 'Сейчас помечено как «Физика» (охи/вздохи). Нажмите, чтобы сделать обычной диалоговой фразой.'
                                : 'Пометить этот звук как «Физика» (охи/вздохи/смех), чтобы автотайминг не двигал его на субтитры.'
                            }
                          >
                            {clip.isPhysics ? '⚡ Физика' : '💬 Фраза'}
                          </button>
                          {clip.timingIssue === 'desync' && typeof clip.targetSubStartSec === 'number' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleFixSingleClip(track.id, clip.id); }}
                              className="px-1.5 py-0.5 bg-amber-600 hover:bg-amber-500 text-white rounded font-bold transition shadow mr-0.5"
                              title={`Поставить фразу точно на субтитр (${formatSeconds(clip.targetSubStartSec)})`}
                            >
                              🎯 К субтитру
                            </button>
                          )}
                          {(clip.hasCollision || clip.timingIssue === 'overlap') && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleResolveSingleOverlap(track.id, clip.id, clip.clipStartSec + (clip.offsetSec || 0), clip.overlappingClipId);
                              }}
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
    </>
  );
};
