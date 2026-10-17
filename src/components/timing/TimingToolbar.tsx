import React from 'react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Scissors, 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  Wand2, 
  Download, 
  Undo2, 
  Redo2, 
  Trash2,
  Sliders,
  CheckCircle2,
  Layers
} from 'lucide-react';
import { formatSeconds } from '../../services/timing/SubtitleAlignmentService';

interface TimingToolbarProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  zoomPixelsPerSec: number;
  canUndo: boolean;
  canRedo: boolean;
  hasSelectedClip: boolean;
  onTogglePlay: () => void;
  onRewind: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSplit: () => void;
  onDelete: () => void;
  onOpenSmartPause: () => void;
  onExportPassport: () => void;
  onExportAudio: () => void;
  onSwitchToOldVersion?: () => void;
}

export const TimingToolbar: React.FC<TimingToolbarProps> = ({
  isPlaying,
  currentTime,
  duration,
  zoomPixelsPerSec,
  canUndo,
  canRedo,
  hasSelectedClip,
  onTogglePlay,
  onRewind,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onUndo,
  onRedo,
  onSplit,
  onDelete,
  onOpenSmartPause,
  onExportPassport,
  onExportAudio,
  onSwitchToOldVersion
}) => {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-neutral-900 border-b border-neutral-800 text-neutral-200 select-none">
      {/* Left section: Playback Transport */}
      <div className="flex items-center gap-2">
        <button
          onClick={onTogglePlay}
          className={`flex items-center justify-center w-9 h-9 rounded-md transition-colors ${
            isPlaying 
              ? 'bg-amber-600 hover:bg-amber-500 text-white' 
              : 'bg-indigo-600 hover:bg-indigo-500 text-white'
          }`}
          title={isPlaying ? 'Пауза (Space)' : 'Воспроизведение (Space)'}
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>

        <button
          onClick={onRewind}
          className="flex items-center justify-center w-8 h-8 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
          title="В начало (Home)"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        {/* Time display */}
        <div className="flex items-center gap-1.5 px-3 py-1 bg-neutral-950 border border-neutral-800 rounded-md font-mono text-sm tracking-wide tabular-nums">
          <span className="text-indigo-400 font-semibold">{formatSeconds(currentTime)}</span>
          <span className="text-neutral-600">/</span>
          <span className="text-neutral-400">{formatSeconds(duration)}</span>
        </div>
      </div>

      {/* Middle section: Edit tools & History */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={onSplit}
          disabled={!hasSelectedClip}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            hasSelectedClip
              ? 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700'
              : 'bg-neutral-900 text-neutral-600 border border-neutral-800 cursor-not-allowed'
          }`}
          title="Разрезать клип по курсору (Клавиша S)"
        >
          <Scissors className="w-3.5 h-3.5" />
          <span>Разрезать (S)</span>
        </button>

        <button
          onClick={onDelete}
          disabled={!hasSelectedClip}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
            hasSelectedClip
              ? 'bg-neutral-800 hover:bg-rose-950/40 text-rose-400 border border-neutral-700 hover:border-rose-800/50'
              : 'bg-neutral-900 text-neutral-600 border border-neutral-800 cursor-not-allowed'
          }`}
          title="Удалить клип (Delete)"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-5 bg-neutral-800 mx-1" />

        <button
          onClick={onUndo}
          disabled={!canUndo}
          className={`p-1.5 rounded-md transition-colors ${
            canUndo
              ? 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'
              : 'bg-neutral-900 text-neutral-600 cursor-not-allowed'
          }`}
          title="Отменить действие (Ctrl+Z)"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onRedo}
          disabled={!canRedo}
          className={`p-1.5 rounded-md transition-colors ${
            canRedo
              ? 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'
              : 'bg-neutral-900 text-neutral-600 cursor-not-allowed'
          }`}
          title="Повторить действие (Ctrl+Y)"
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Right section: Zoom & Smart Actions */}
      <div className="flex items-center gap-2">
        {/* Zoom controls */}
        <div className="flex items-center gap-1 bg-neutral-950 border border-neutral-800 rounded-md p-0.5">
          <button
            onClick={onZoomOut}
            className="p-1 hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 rounded transition-colors"
            title="Уменьшить масштаб (-)"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="px-1.5 text-[11px] font-mono tabular-nums text-neutral-400 min-w-[42px] text-center">
            {Math.round(zoomPixelsPerSec)} px/s
          </span>
          <button
            onClick={onZoomIn}
            className="p-1 hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 rounded transition-colors"
            title="Увеличить масштаб (+)"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onZoomFit}
            className="p-1 hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 rounded transition-colors"
            title="Вписать всё в экран"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Smart Auto-Timing button */}
        <button
          onClick={onOpenSmartPause}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-md text-xs font-semibold shadow-sm transition-all"
          title="Автоматическая подгонка дорожек под субтитры с компенсацией пауз"
        >
          <Wand2 className="w-3.5 h-3.5" />
          <span>Авто-тайминг пауз</span>
        </button>

        {/* Export dropdown / buttons */}
        <button
          onClick={onExportPassport}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 rounded-md text-xs font-medium transition-colors"
          title="Сохранить паспорт тайминга"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Паспорт</span>
        </button>

        <button
          onClick={onExportAudio}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-700 hover:bg-indigo-600 text-white rounded-md text-xs font-medium transition-colors"
          title="Экспорт сведенного аудио"
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Экспорт</span>
        </button>

        {onSwitchToOldVersion && (
          <button
            onClick={onSwitchToOldVersion}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-950/80 hover:bg-amber-900/90 text-amber-200 border border-amber-700/60 rounded-md text-xs font-semibold transition-colors"
            title="Переключиться на классический/старый тайминг субтитров (ASS)"
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
            <span>Старый тайминг (ASS)</span>
          </button>
        )}
      </div>
    </div>
  );
};
