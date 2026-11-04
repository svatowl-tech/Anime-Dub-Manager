import React from 'react';
import { GripHorizontal, Video, VolumeX, Volume2, X } from 'lucide-react';
import { VideoWindowSize, DraggingVideoState } from './timing.types';
import { formatSeconds } from './timing.utils';

export interface TimingFloatingVideoWindowProps {
  isVideoOpen: boolean;
  videoSize: VideoWindowSize;
  videoPos: { x: number; y: number };
  draggingVideo: DraggingVideoState | null;
  currentTime: number;
  isOriginalMuted: boolean;
  originalVolume: number;
  videoUrl: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoDragMovedRef: React.MutableRefObject<boolean>;
  onStartDrag: (state: DraggingVideoState) => void;
  onChangeVideoSize: (size: VideoWindowSize) => void;
  onToggleOriginalMute: () => void;
  onToggleVideoOpen: () => void;
  onUpdateDuration: (durationSec: number) => void;
  onTogglePlay: () => void;
}

export const TimingFloatingVideoWindow: React.FC<TimingFloatingVideoWindowProps> = ({
  isVideoOpen,
  videoSize,
  videoPos,
  draggingVideo,
  currentTime,
  isOriginalMuted,
  originalVolume,
  videoUrl,
  videoRef,
  videoDragMovedRef,
  onStartDrag,
  onChangeVideoSize,
  onToggleOriginalMute,
  onToggleVideoOpen,
  onUpdateDuration,
  onTogglePlay
}) => {
  return (
    <div
      style={{ left: `${videoPos.x}px`, top: `${videoPos.y}px` }}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        e.preventDefault();
        e.stopPropagation();
        videoDragMovedRef.current = false;
        onStartDrag({
          startMouseX: e.clientX,
          startMouseY: e.clientY,
          initialX: videoPos.x,
          initialY: videoPos.y
        });
      }}
      className={`absolute z-50 bg-neutral-950/95 border border-neutral-700/90 rounded-xl shadow-2xl overflow-hidden backdrop-blur-md select-none ${
        draggingVideo ? 'cursor-grabbing ring-2 ring-sky-500/60' : 'cursor-grab transition-[width] duration-150'
      } ${
        !isVideoOpen ? 'hidden' : videoSize === 'S' ? 'w-[260px]' : videoSize === 'M' ? 'w-[380px]' : 'w-[540px]'
      }`}
    >
      {/* Drag Handle Top Bar */}
      <div className="h-7 px-2.5 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between cursor-move select-none">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-200 truncate pointer-events-none">
          <GripHorizontal className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
          <Video className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span className="truncate">Видео серии</span>
          <span className="font-mono tabular-nums text-[10px] text-amber-400 bg-neutral-950 px-1.5 py-0.2 rounded border border-neutral-800">
            {formatSeconds(currentTime)}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {(['S', 'M', 'L'] as const).map(sz => (
            <button
              key={sz}
              onClick={() => onChangeVideoSize(sz)}
              className={`w-5 h-5 rounded text-[10px] font-mono font-bold flex items-center justify-center transition ${
                videoSize === sz
                  ? 'bg-sky-600 text-white'
                  : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white'
              }`}
              title={`Размер видео: ${sz}`}
            >
              {sz}
            </button>
          ))}
          <button
            onClick={onToggleOriginalMute}
            className={`w-5 h-5 rounded flex items-center justify-center transition ${
              isOriginalMuted
                ? 'bg-red-500/20 text-red-400'
                : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'
            }`}
            title={isOriginalMuted ? 'Включить звук оригинального видео' : 'Заглушить звук оригинального видео'}
          >
            {isOriginalMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
          </button>
          <button
            onClick={onToggleVideoOpen}
            className="w-5 h-5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white flex items-center justify-center transition"
            title="Свернуть окно видео в кнопку «Видео» в шапке"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Video Surface */}
      <div className="relative aspect-video bg-black flex items-center justify-center">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            preload="auto"
            playsInline
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              v.volume = Math.max(0, Math.min(1, originalVolume));
              v.muted = isOriginalMuted;
              if (v.duration && Number.isFinite(v.duration) && v.duration > 10) {
                onUpdateDuration(Math.ceil(v.duration));
              }
            }}
            onClick={() => {
              if (!videoDragMovedRef.current) {
                onTogglePlay();
              }
            }}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="p-4 text-center text-xs text-neutral-400 flex flex-col items-center gap-1.5 pointer-events-none">
            <Video className="w-6 h-6 text-neutral-600" />
            <span>Видеофайл серии не привязан</span>
            <span className="text-[10px] text-neutral-500">Перетащите это окно в любое удобное место</span>
          </div>
        )}
      </div>
    </div>
  );
};
