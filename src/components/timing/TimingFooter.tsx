import React from 'react';
import { Play, Pause, RotateCcw, Trash2, ZoomOut, ZoomIn } from 'lucide-react';
import { AudioClip } from './timing.types';
import { formatSeconds } from './timing.utils';

export interface TimingFooterProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  zoomLevel: number;
  activeSelectedClip: { clip: AudioClip; trackId: string } | null;
  onTogglePlay: () => void;
  onSeekToStart: () => void;
  onSetClipVolume: (trackId: string, clipId: string, volumePercent: number) => void;
  onExpandClip: (trackId: string, clipId: string, edge: 'start' | 'end', deltaSec: number) => void;
  onResetClipToOriginal: (trackId: string, clipId: string) => void;
  onDeleteClip: (clipId: string, trackId: string) => void;
  onChangeZoomLevel: (updater: number | ((prev: number) => number)) => void;
}

export const TimingFooter: React.FC<TimingFooterProps> = ({
  isPlaying,
  currentTime,
  duration,
  zoomLevel,
  activeSelectedClip,
  onTogglePlay,
  onSeekToStart,
  onSetClipVolume,
  onExpandClip,
  onResetClipToOriginal,
  onDeleteClip,
  onChangeZoomLevel
}) => {
  return (
    <footer className="bg-neutral-900 border-t border-neutral-800 p-2.5 px-4 shrink-0 flex items-center justify-between gap-4">
      {/* Playback Controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={onTogglePlay}
          className="w-8 h-8 bg-amber-600 hover:bg-amber-500 text-white rounded-lg flex items-center justify-center shadow transition"
        >
          {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
        </button>
        <button
          onClick={onSeekToStart}
          className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition"
          title="В начало (00:00)"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <div className="font-mono tabular-nums text-xs text-neutral-200 bg-neutral-950 px-3 py-1.5 rounded-lg border border-neutral-800">
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
              onChange={(e) => onSetClipVolume(activeSelectedClip.trackId, activeSelectedClip.clip.id, Number(e.target.value))}
              className="w-20 accent-indigo-500 h-1.5 bg-neutral-800 rounded cursor-pointer"
            />
            <span className="font-mono text-xs text-amber-300 font-bold w-9 text-right">
              {activeSelectedClip.clip.volumePercent ?? 100}%
            </span>
          </div>

          <div className="flex items-center gap-1 border-l border-neutral-800 pl-2.5">
            <span className="text-[10px] text-neutral-400 mr-0.5">Границы:</span>
            <button
              onClick={() => onExpandClip(activeSelectedClip.trackId, activeSelectedClip.clip.id, 'start', 0.5)}
              className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 rounded text-[10px] border border-neutral-700 transition"
              title="Раскрыть начало фразы на +0.5 сек из тишины"
            >
              ◀ +0.5с
            </button>
            <button
              onClick={() => onExpandClip(activeSelectedClip.trackId, activeSelectedClip.clip.id, 'end', 0.5)}
              className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 rounded text-[10px] border border-neutral-700 transition"
              title="Раскрыть хвост фразы на +0.5 сек из тишины"
            >
              +0.5с ▶
            </button>
            <button
              onClick={() => onExpandClip(activeSelectedClip.trackId, activeSelectedClip.clip.id, 'end', 1.0)}
              className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 rounded text-[10px] border border-neutral-700 transition"
              title="Раскрыть хвост фразы на +1.0 сек из тишины"
            >
              +1.0с ▶
            </button>
            <button
              onClick={() => onResetClipToOriginal(activeSelectedClip.trackId, activeSelectedClip.clip.id)}
              className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white rounded text-[10px] border border-neutral-700 transition"
              title="Сбросить границы клипа к исходной детекции"
            >
              Сброс
            </button>
            <button
              onClick={() => onDeleteClip(activeSelectedClip.clip.id, activeSelectedClip.trackId)}
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
          onClick={() => onChangeZoomLevel(prev => Math.max(10, prev - 10))}
          className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <input
          type="range"
          min="10"
          max="120"
          value={zoomLevel}
          onChange={(e) => onChangeZoomLevel(Number(e.target.value))}
          className="w-24 accent-amber-500 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
        />
        <button
          onClick={() => onChangeZoomLevel(prev => Math.min(120, prev + 10))}
          className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
      </div>
    </footer>
  );
};
