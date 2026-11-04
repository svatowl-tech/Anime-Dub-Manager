import React from "react";
import {
  Play, 
  Pause, 
  Volume2, 
  VolumeX, 
  CheckCircle2, 
  Film, 
  Music, 
  Save, 
  Headphones, 
  AlertCircle, 
  Loader2, 
  Zap 
} from "lucide-react";
import { Episode, MixingManifest, MixingFileItem } from "../../types";
import { formatFileSize, formatTime } from "./mixingParamSpecs";

export interface MixingAudioInspectorProps {
  manifest: MixingManifest | null;
  currentEpisode?: Episode | null;
  videoViewMode: "source" | "final";
  setVideoViewMode: React.Dispatch<React.SetStateAction<"source" | "final">>;
  selectedAudioTrack: any;
  selectFinalVideoForPlayback: (videoItem?: MixingFileItem, customLabel?: string, stepId?: string) => void;
  selectOriginalAudioTrack: () => void;
  videoSrc: string | null;
  setVideoSrc: React.Dispatch<React.SetStateAction<string | null>>;
  isPlaying: boolean;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isVideoMuted: boolean;
  setIsVideoMuted: React.Dispatch<React.SetStateAction<boolean>>;
  handleVideoTimeUpdate: () => void;
  handleVideoLoadedMetadata: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
  handleVideoError: (e: React.SyntheticEvent<HTMLVideoElement, Event>) => void;
  videoPlaybackError: string | null;
  setVideoPlaybackError: React.Dispatch<React.SetStateAction<string | null>>;
  handleCreateVideoProxy: () => void;
  isCreatingProxy: boolean;
  proxyProgress: number;
  formatMediaUrl: (filePath: string) => string;
  handleSelectExternalFile: (type: "video" | "subtitles" | "audio") => void;
  togglePlay: () => void;
  audioPlaybackError: string | null;
  duration: number;
  currentTime: number;
  handleSeek: (time: number) => void;
  videoVolume: number;
  setVideoVolume: React.Dispatch<React.SetStateAction<number>>;
  isTrackMuted: boolean;
  setIsTrackMuted: React.Dispatch<React.SetStateAction<boolean>>;
  trackVolume: number;
  setTrackVolume: React.Dispatch<React.SetStateAction<number>>;
  sanitizeTempPath: (rawPath: string) => string;
  handleSaveFinalVideo: () => void;
}

export const MixingAudioInspector: React.FC<MixingAudioInspectorProps> = ({
  manifest,
  currentEpisode,
  videoViewMode,
  setVideoViewMode,
  selectedAudioTrack,
  selectFinalVideoForPlayback,
  selectOriginalAudioTrack,
  videoSrc,
  setVideoSrc,
  isPlaying,
  setIsPlaying,
  videoRef,
  isVideoMuted,
  setIsVideoMuted,
  handleVideoTimeUpdate,
  handleVideoLoadedMetadata,
  handleVideoError,
  videoPlaybackError,
  setVideoPlaybackError,
  handleCreateVideoProxy,
  isCreatingProxy,
  proxyProgress,
  formatMediaUrl,
  handleSelectExternalFile,
  togglePlay,
  audioPlaybackError,
  duration,
  currentTime,
  handleSeek,
  videoVolume,
  setVideoVolume,
  isTrackMuted,
  setIsTrackMuted,
  trackVolume,
  setTrackVolume,
  sanitizeTempPath,
  handleSaveFinalVideo,
}) => {
  return (
    <div className="w-1/2 flex flex-col bg-neutral-950 p-5 space-y-4 overflow-y-auto">
      {/* Mode Switcher Bar: Final Mixed Video vs Source Video + Track Inspection */}
      {manifest?.finalVideo && (
        <div className="bg-neutral-900/90 border border-neutral-800 p-1.5 rounded-xl flex items-center gap-1.5 text-xs">
          <button
            onClick={() => selectFinalVideoForPlayback(manifest.finalVideo)}
            className={`flex-1 py-1.5 px-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition ${
              videoViewMode === "final" || selectedAudioTrack?.isFinalVideo
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/70"
            }`}
            title="Смотреть и слушать готовое сведенное видео со встроенным финальным звуком"
          >
            <Film className="w-3.5 h-3.5" />
            <span>✨ Готовое сведенное видео [СВЕДЕНО]</span>
          </button>
          <button
            onClick={() => {
              setVideoViewMode("source");
              if (selectedAudioTrack?.isFinalVideo) {
                selectOriginalAudioTrack();
              }
            }}
            className={`flex-1 py-1.5 px-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition ${
              videoViewMode === "source" && !selectedAudioTrack?.isFinalVideo
                ? "bg-purple-600 text-white shadow-sm"
                : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/70"
            }`}
            title="Режим прослушивания отдельных дорожек и модулей поверх исходного видеоряда"
          >
            <Headphones className="w-3.5 h-3.5" />
            <span>🎧 Прослушивание дорожек / модулей</span>
          </button>
        </div>
      )}

      {/* Video Player Display */}
      <div className="aspect-video bg-black rounded-xl overflow-hidden border border-neutral-800 relative group flex items-center justify-center shadow-lg">
        {/* Active Video Stream Badge */}
        {videoSrc && (
          <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1.5 pointer-events-none">
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase backdrop-blur-md border ${
                videoViewMode === "final"
                  ? "bg-emerald-950/80 text-emerald-300 border-emerald-500/40"
                  : "bg-neutral-900/80 text-neutral-300 border-neutral-700/60"
              }`}
            >
              {videoViewMode === "final"
                ? "🎬 Сведенный мастер (MP4)"
                : "📹 Исходный видеоряд"}
            </span>
            {isPlaying && (
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-600/80 text-white backdrop-blur-md animate-pulse">
                ▶ Играет
              </span>
            )}
          </div>
        )}

        {videoSrc ? (
          <video
            ref={videoRef}
            src={videoSrc}
            className="w-full h-full object-contain"
            muted={isVideoMuted}
            onTimeUpdate={handleVideoTimeUpdate}
            onLoadedMetadata={handleVideoLoadedMetadata}
            onEnded={() => setIsPlaying(false)}
            onError={handleVideoError}
          />
        ) : (
          <div className="text-center p-6 text-neutral-500 space-y-2">
            <Film className="w-10 h-10 mx-auto text-neutral-700" />
            <p className="text-xs">
              Видеоряд серии еще не импортирован (аудиоплеер дорожек работает автономно)
            </p>
          </div>
        )}

        {/* Video Playback Compatibility Error Overlay */}
        {videoPlaybackError && (
          <div className="absolute inset-0 bg-neutral-950/90 backdrop-blur-sm p-4 flex flex-col items-center justify-center text-center space-y-3 z-20">
            <AlertCircle className="w-9 h-9 text-amber-400 shrink-0" />
            <div className="max-w-md space-y-1">
              <h4 className="text-sm font-semibold text-amber-200">
                Несовместимость воспроизведения видео
              </h4>
              <p className="text-xs text-neutral-300 leading-relaxed">
                {videoPlaybackError}
              </p>
              <p className="text-[11px] text-emerald-400 pt-1">
                🎧 Вы можете продолжать прослушивать любые аудиодорожки и модули —
                аудиоплеер работает независимо от видео!
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              {manifest?.finalVideo?.path && (
                <button
                  onClick={() => selectFinalVideoForPlayback(manifest.finalVideo)}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition shadow flex items-center gap-1.5"
                >
                  <Film className="w-3.5 h-3.5" />
                  <span>🎬 Включить готовое MP4-видео</span>
                </button>
              )}
              {(manifest?.sourceFiles?.video?.path || currentEpisode?.rawPath) && (
                <button
                  onClick={handleCreateVideoProxy}
                  disabled={isCreatingProxy}
                  className="px-3 py-1.5 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white text-xs font-semibold rounded-lg transition shadow flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isCreatingProxy ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Создание MP4-прокси... {proxyProgress}%</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-3.5 h-3.5" />
                      <span>⚡ Создать быстрый MP4-прокси (H.264/AAC)</span>
                    </>
                  )}
                </button>
              )}
              {(manifest?.sourceFiles?.video?.path || currentEpisode?.rawPath) && (
                <button
                  onClick={() => {
                    const srcPath =
                      manifest?.sourceFiles?.video?.path || currentEpisode?.rawPath;
                    if (srcPath) {
                      setVideoViewMode("source");
                      setVideoSrc(formatMediaUrl(srcPath));
                      setVideoPlaybackError(null);
                    }
                  }}
                  className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium rounded-lg transition border border-neutral-700"
                >
                  📻 Попробовать исходник
                </button>
              )}
              <button
                onClick={() => handleSelectExternalFile("video")}
                className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium rounded-lg transition border border-neutral-700"
              >
                📂 Выбрать другой файл...
              </button>
              <button
                onClick={() => setVideoPlaybackError(null)}
                className="px-2.5 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-neutral-400 text-xs rounded-lg transition"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Floating Quick Play Overlay */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
          <button
            onClick={togglePlay}
            className="p-4 bg-purple-600/90 hover:bg-purple-500 rounded-full text-white shadow-xl pointer-events-auto transition transform hover:scale-105"
          >
            {isPlaying ? (
              <Pause className="w-6 h-6" />
            ) : (
              <Play className="w-6 h-6 fill-current ml-0.5" />
            )}
          </button>
        </div>
      </div>

      {/* Currently Inspected Track Banner & Quick Switcher */}
      <div className="bg-neutral-900 border border-neutral-800 p-3 rounded-xl flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5 truncate">
          <div
            className={`p-1.5 rounded-lg shrink-0 ${
              selectedAudioTrack?.isFinalVideo
                ? "bg-emerald-500/20 text-emerald-300"
                : selectedAudioTrack?.isModuleMix
                ? "bg-amber-500/20 text-amber-300"
                : "bg-purple-600/20 text-purple-400"
            }`}
          >
            {selectedAudioTrack?.isFinalVideo ? (
              <Film className="w-4 h-4" />
            ) : selectedAudioTrack?.isModuleMix ? (
              <Volume2 className="w-4 h-4" />
            ) : (
              <Headphones className="w-4 h-4" />
            )}
          </div>
          <div className="truncate">
            <span className="text-neutral-400 text-[11px] block">
              {selectedAudioTrack?.isFinalVideo
                ? "Воспроизводится финальное сведенное видео:"
                : selectedAudioTrack?.isModuleMix
                ? "Прослушивается совместный микс модуля:"
                : "Прослушиваемый источник:"}
            </span>
            <span
              className="font-semibold text-neutral-100 truncate block"
              title={selectedAudioTrack?.name}
            >
              {selectedAudioTrack
                ? selectedAudioTrack.name
                : "Исходный звук видеоряда"}
            </span>
            {audioPlaybackError && (
              <span className="text-[10px] text-red-400 block truncate">
                {audioPlaybackError}
              </span>
            )}
          </div>
        </div>

        {/* Source Switcher: Original vs Final vs Module */}
        <div className="flex items-center gap-1.5 shrink-0">
          {manifest?.finalVideo && (
            <button
              onClick={() => selectFinalVideoForPlayback(manifest.finalVideo)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition border ${
                selectedAudioTrack?.isFinalVideo || videoViewMode === "final"
                  ? "bg-emerald-600 text-white border-emerald-500 font-bold shadow-sm"
                  : "bg-neutral-800/80 hover:bg-neutral-700/80 text-emerald-300 border-emerald-800/60"
              }`}
              title="Переключить плеер на готовое сведенное видео [СВЕДЕНО]"
            >
              🎬 Сведено
            </button>
          )}
          <button
            onClick={selectOriginalAudioTrack}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition border ${
              selectedAudioTrack?.id === "original_audio_source"
                ? "bg-amber-600 text-white border-amber-500 font-bold shadow-sm"
                : "bg-neutral-800/80 hover:bg-neutral-700/80 text-neutral-300 border-neutral-700/60"
            }`}
            title="Переключить плеер на оригинальную японскую дорожку серии"
          >
            📻 Оригинал
          </button>
          <span
            className={`px-2 py-1 rounded text-[10px] font-medium border ${
              selectedAudioTrack?.isFinalVideo
                ? "bg-emerald-900/60 text-emerald-200 border-emerald-700 font-bold"
                : selectedAudioTrack?.isModuleMix
                ? "bg-purple-900/60 text-purple-200 border-purple-700 font-bold"
                : selectedAudioTrack &&
                  selectedAudioTrack.id !== "original_audio_source"
                ? "bg-purple-900/40 text-purple-300 border border-purple-800/50"
                : "bg-neutral-800 text-neutral-400 border-neutral-700"
            }`}
          >
            {selectedAudioTrack ? selectedAudioTrack.label : "Оригинал"}
          </span>
        </div>
      </div>

      {/* Timeline & Controls */}
      <div className="bg-neutral-900 border border-neutral-800 p-4 rounded-xl space-y-3.5">
        {/* Scrubber slider */}
        <div className="space-y-1.5">
          <input
            type="range"
            min="0"
            max={duration > 0 ? duration : 100}
            step="0.05"
            value={Math.min(currentTime, duration > 0 ? duration : 100)}
            onChange={(e) => handleSeek(parseFloat(e.target.value))}
            className="w-full accent-purple-500 cursor-pointer"
          />
          <div className="flex justify-between text-[11px] font-mono text-neutral-400">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Playback Controls & Mode Toggle */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2">
            <button
              onClick={togglePlay}
              className="p-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition shadow"
              title={isPlaying ? "Пауза" : "Воспроизведение"}
            >
              {isPlaying ? (
                <Pause className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4 fill-current ml-0.5" />
              )}
            </button>

            <button
              onClick={() => handleSeek(Math.max(0, currentTime - 5))}
              className="px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-xs transition"
              title="Назад на 5 секунд"
            >
              -5с
            </button>

            <button
              onClick={() =>
                handleSeek(
                  Math.min(duration || currentTime + 5, currentTime + 5)
                )
              }
              className="px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-xs transition"
              title="Вперед на 5 секунд"
            >
              +5с
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsVideoMuted(!isVideoMuted)}
              className={`text-[11px] px-2.5 py-1 rounded-lg border flex items-center gap-1.5 transition ${
                isVideoMuted
                  ? "bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200"
                  : "bg-blue-950/60 border-blue-600/40 text-blue-300 font-semibold"
              }`}
              title={
                isVideoMuted
                  ? "Включить звук видеопотока"
                  : "Заглушить звук видеопотока"
              }
            >
              {isVideoMuted ? (
                <VolumeX className="w-3.5 h-3.5 text-neutral-500" />
              ) : (
                <Volume2 className="w-3.5 h-3.5 text-blue-400" />
              )}
              <span>
                {isVideoMuted
                  ? "Звук видео: Выкл"
                  : `${
                      videoViewMode === "final"
                        ? "Мастер-звук видео"
                        : "Звук видео"
                    }: ${Math.round(videoVolume * 100)}%`}
              </span>
            </button>
          </div>
        </div>

        {/* Audio Volume Controls */}
        <div className="pt-2 border-t border-neutral-800 space-y-3">
          {videoViewMode !== "final" && !selectedAudioTrack?.isFinalVideo && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-400 flex items-center gap-1.5">
                  <Music className="w-3.5 h-3.5 text-purple-400" />
                  Громкость прослушиваемой дорожки / модуля:
                </span>
                <button
                  onClick={() => setIsTrackMuted(!isTrackMuted)}
                  className="text-neutral-400 hover:text-neutral-200 flex items-center gap-1 text-[11px]"
                  title={
                    isTrackMuted
                      ? "Включить звук дорожки"
                      : "Заглушить звук дорожки"
                  }
                >
                  {isTrackMuted ? (
                    <VolumeX className="w-3.5 h-3.5 text-red-400" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5 text-purple-400" />
                  )}
                  <span>
                    {isTrackMuted ? "Выкл" : `${Math.round(trackVolume * 100)}%`}
                  </span>
                </button>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                disabled={isTrackMuted}
                value={isTrackMuted ? 0 : trackVolume}
                onChange={(e) => setTrackVolume(parseFloat(e.target.value))}
                className="w-full accent-purple-500 cursor-pointer"
              />
            </div>
          )}

          {!isVideoMuted && (
            <div className="space-y-1.5 bg-neutral-900/40 p-2 rounded-lg border border-neutral-800/60">
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-400 flex items-center gap-1.5">
                  <Film className="w-3.5 h-3.5 text-blue-400" />
                  {videoViewMode === "final"
                    ? "Громкость сведенного видео:"
                    : "Громкость фонового звука из видео:"}
                </span>
                <span className="text-[11px] text-blue-300 font-mono">
                  {Math.round(videoVolume * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={videoVolume}
                onChange={(e) => setVideoVolume(parseFloat(e.target.value))}
                className="w-full accent-blue-500 cursor-pointer"
              />
            </div>
          )}
        </div>
      </div>

      {/* Final Video Export Card */}
      {manifest?.finalVideo && (
        <div className="bg-emerald-950/30 border border-emerald-800/60 p-4 rounded-xl flex items-center justify-between gap-3 shadow-sm">
          <div className="truncate">
            <div className="text-emerald-400 text-xs font-semibold flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Готовая сведенная серия (Final Release):</span>
            </div>
            <div
              className="text-xs text-neutral-200 font-mono truncate mt-0.5"
              title={sanitizeTempPath(manifest.finalVideo.name)}
            >
              {sanitizeTempPath(manifest.finalVideo.name)}
            </div>
            <div className="text-[11px] text-neutral-400 mt-0.5">
              Размер: {formatFileSize(manifest.finalVideo.size)}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => selectFinalVideoForPlayback(manifest.finalVideo)}
              className="px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow"
              title="Запустить предпросмотр готового сведенного видео в плеере"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Смотреть</span>
            </button>
            <button
              onClick={handleSaveFinalVideo}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow"
            >
              <Save className="w-4 h-4" />
              <span>Сохранить видео</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
