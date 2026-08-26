import React, { useState } from 'react';
import { Camera, Image as ImageIcon, Sparkles, Copy, Download, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { CharacterDialogueLine } from '../../lib/characterPreview/characterPreviewTypes';
import { formatSecondsToTime } from '../../lib/characterPreview/timeUtils';
import { toast } from 'sonner';

interface CharacterSnapshotViewerProps {
  currentLine: CharacterDialogueLine | null;
  snapshotUrl: string | null;
  isLoadingFrame: boolean;
  onScrubTime: (timeSec: number) => void;
  currentTimeSec: number;
  onPrevLine: () => void;
  onNextLine: () => void;
  hasPrevLine: boolean;
  hasNextLine: boolean;
  onSetAsPortrait: (dataUrl: string) => void;
}

export default function CharacterSnapshotViewer({
  currentLine,
  snapshotUrl,
  isLoadingFrame,
  onScrubTime,
  currentTimeSec,
  onPrevLine,
  onNextLine,
  hasPrevLine,
  hasNextLine,
  onSetAsPortrait,
}: CharacterSnapshotViewerProps) {
  const [copied, setCopied] = useState(false);

  const handleCopySnapshot = async () => {
    if (!snapshotUrl) return;
    try {
      const res = await fetch(snapshotUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob })
      ]);
      setCopied(true);
      toast.success('Кадр скопирован в буфер обмена');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error(err);
      toast.error('Не удалось скопировать кадр');
    }
  };

  const handleDownloadSnapshot = () => {
    if (!snapshotUrl || !currentLine) return;
    const a = document.createElement('a');
    a.href = snapshotUrl;
    a.download = `character_${currentLine.name}_${formatSecondsToTime(currentTimeSec)}.jpg`;
    a.click();
    toast.success('Кадр скачан');
  };

  const handleSetPortraitClick = () => {
    if (!snapshotUrl) return;
    onSetAsPortrait(snapshotUrl);
  };

  const minTime = currentLine ? Math.max(0, currentLine.startSec - 0.2) : 0;
  const maxTime = currentLine ? currentLine.endSec + 0.2 : 1;

  return (
    <div className="flex flex-col bg-neutral-950/70 border border-neutral-800 rounded-xl overflow-hidden shadow-lg">
      {/* Frame Top Bar */}
      <div className="px-3 py-2 border-b border-neutral-800 bg-neutral-900/60 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-semibold text-neutral-200">
            Кадр из серии
          </span>
          {currentLine && (
            <span className="text-[10px] text-neutral-400 font-mono">
              @ {formatSecondsToTime(currentTimeSec)}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCopySnapshot}
            disabled={!snapshotUrl}
            title="Скопировать кадр в буфер"
            className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-neutral-300 text-[11px] rounded flex items-center gap-1 transition-colors"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>Копия</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadSnapshot}
            disabled={!snapshotUrl}
            title="Скачать кадр в файл"
            className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-neutral-300 text-[11px] rounded flex items-center gap-1 transition-colors"
          >
            <Download className="w-3 h-3" />
            <span>PNG</span>
          </button>

          <button
            type="button"
            onClick={handleSetPortraitClick}
            disabled={!snapshotUrl}
            title="Установить этот кадр как аватарку персонажа"
            className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[11px] font-medium rounded flex items-center gap-1 transition-colors shadow-sm"
          >
            <Sparkles className="w-3 h-3 text-amber-300" />
            <span>Как аватар</span>
          </button>
        </div>
      </div>

      {/* Frame Visual Display Area */}
      <div className="relative aspect-video w-full bg-neutral-950 flex items-center justify-center overflow-hidden group">
        {snapshotUrl ? (
          <img
            src={snapshotUrl}
            alt="Кадр персонажа"
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-neutral-600 p-6 text-center">
            <ImageIcon className="w-10 h-10 mb-2 opacity-40" />
            <p className="text-xs">
              {isLoadingFrame ? 'Загрузка кадра...' : 'Видео или кадр недоступен'}
            </p>
          </div>
        )}

        {/* Overlay Dialogue Caption */}
        {currentLine && currentLine.cleanText && (
          <div className="absolute bottom-3 inset-x-3 bg-neutral-950/85 backdrop-blur-sm border border-neutral-800/80 rounded-lg p-2.5 shadow-xl text-center pointer-events-none">
            <p className="text-xs text-neutral-200 font-medium leading-relaxed">
              "{currentLine.cleanText}"
            </p>
          </div>
        )}

        {/* Quick Prev / Next Overlaid Arrows */}
        <button
          type="button"
          onClick={onPrevLine}
          disabled={!hasPrevLine}
          title="Предыдущая реплика"
          className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-neutral-900/80 hover:bg-neutral-800 disabled:opacity-0 text-white backdrop-blur transition-all border border-neutral-700 shadow-md"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onNextLine}
          disabled={!hasNextLine}
          title="Следующая реплика"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-neutral-900/80 hover:bg-neutral-800 disabled:opacity-0 text-white backdrop-blur transition-all border border-neutral-700 shadow-md"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Frame Timeline Scrubber within current line */}
      {currentLine && (
        <div className="p-3 border-t border-neutral-800 bg-neutral-900/40 space-y-1.5 shrink-0">
          <div className="flex items-center justify-between text-[11px] text-neutral-400">
            <span className="font-mono">{formatSecondsToTime(currentLine.startSec)}</span>
            <span className="text-[10px] text-neutral-500">
              Тайминг кадра: <span className="text-indigo-400 font-mono">{formatSecondsToTime(currentTimeSec)}</span>
            </span>
            <span className="font-mono">{formatSecondsToTime(currentLine.endSec)}</span>
          </div>

          <input
            type="range"
            min={minTime}
            max={maxTime}
            step={0.05}
            value={currentTimeSec}
            onChange={(e) => onScrubTime(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition-all"
          />
        </div>
      )}
    </div>
  );
}
