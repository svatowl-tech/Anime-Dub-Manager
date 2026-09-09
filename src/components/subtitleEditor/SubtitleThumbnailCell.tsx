import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Camera, Play, Loader2 } from 'lucide-react';
import { useSubtitleFrame } from './subtitleFrameService';
import { CharacterColorInfo } from './characterColors';
import { parseAssTimeToSeconds } from './utils';

interface SubtitleThumbnailCellProps {
  videoPath?: string;
  timeStr: string;
  characterName: string;
  lineText: string;
  charColor: CharacterColorInfo;
  onPlay: (time: string) => void;
  showScreenshots: boolean;
}

export const SubtitleThumbnailCell: React.FC<SubtitleThumbnailCellProps> = React.memo(({
  videoPath,
  timeStr,
  characterName,
  lineText,
  charColor,
  onPlay,
  showScreenshots,
}) => {
  const timeSec = useMemo(() => parseAssTimeToSeconds(timeStr), [timeStr]);
  const [isHovered, setIsHovered] = useState(false);
  const [popoverCoords, setPopoverCoords] = useState<{ top: number; left: number; placeAbove: boolean } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { frameUrl, loading, requestPriority } = useSubtitleFrame(
    videoPath,
    timeSec,
    showScreenshots || isHovered
  );

  const handleMouseEnter = () => {
    setIsHovered(true);
    requestPriority();

    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const placeAbove = rect.bottom + 220 > window.innerHeight;
      setPopoverCoords({
        left: Math.max(10, Math.min(window.innerWidth - 300, rect.left - 10)),
        top: placeAbove ? rect.top - 190 : rect.bottom + 6,
        placeAbove,
      });
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setPopoverCoords(null);
  };

  if (!showScreenshots) return null;

  return (
    <div
      ref={containerRef}
      className="relative shrink-0 flex items-center justify-center select-none"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Thumbnail Box */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          onPlay(timeStr);
        }}
        className="w-[76px] h-[43px] rounded bg-neutral-900 border overflow-hidden relative group/thumb cursor-pointer shadow-sm transition-all hover:scale-105 hover:shadow-md hover:z-20"
        style={{
          borderColor: charColor.borderRgba,
        }}
        title={`Кадр на ${timeStr}. Кликните для воспроизведения`}
      >
        {frameUrl ? (
          <img
            src={frameUrl}
            alt={`Кадр ${timeStr}`}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : loading ? (
          <div className="w-full h-full flex flex-col items-center justify-center bg-neutral-900/90 text-neutral-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
            <span className="text-[8px] font-mono mt-0.5 text-neutral-400">{timeStr.split('.')[0]}</span>
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-neutral-900 text-neutral-600 gap-0.5">
            <Camera className="w-3.5 h-3.5 opacity-60 text-neutral-400" />
            <span className="text-[8px] font-mono text-neutral-400">{timeStr.split('.')[0]}</span>
          </div>
        )}

        {/* Play Overlay on Hover */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center transition-opacity">
          <Play className="w-4 h-4 text-white fill-white drop-shadow" />
        </div>

        {/* Mini Character Color Indicator Corner */}
        <div
          className="absolute top-0 right-0 w-2.5 h-2.5 rounded-bl"
          style={{ backgroundColor: charColor.borderSolid }}
        />
      </div>

      {/* Floating Zoom Card / Tooltip on Hover */}
      {isHovered && popoverCoords && (
        <div
          style={{
            position: 'fixed',
            top: popoverCoords.top,
            left: popoverCoords.left,
            zIndex: 9999,
          }}
          className="w-[280px] bg-neutral-950/95 border border-neutral-700/80 rounded-xl p-2.5 shadow-2xl backdrop-blur-md pointer-events-none animate-in fade-in zoom-in-95 duration-100"
        >
          {/* Large Image Frame */}
          <div className="w-full aspect-video bg-black rounded-lg overflow-hidden relative border border-neutral-800 flex items-center justify-center mb-2">
            {frameUrl ? (
              <img
                src={frameUrl}
                alt={`Увеличенный кадр ${timeStr}`}
                className="w-full h-full object-contain"
              />
            ) : loading ? (
              <div className="flex flex-col items-center gap-1.5 text-neutral-400">
                <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
                <span className="text-[11px]">Загрузка кадра...</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1 text-neutral-500">
                <Camera className="w-6 h-6 opacity-40" />
                <span className="text-[10px]">Кадр недоступен</span>
              </div>
            )}

            {/* Time Stamp Badge */}
            <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-mono font-bold text-amber-300 border border-white/10 shadow-sm backdrop-blur-xs">
              ⏱ {timeStr}
            </div>
          </div>

          {/* Character and Text Preview */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full shrink-0 shadow-sm"
                style={{ backgroundColor: charColor.borderSolid }}
              />
              <span
                className="text-xs font-bold truncate"
                style={{ color: charColor.textHex }}
              >
                {characterName?.trim() || 'Без имени'}
              </span>
            </div>
            {lineText && (
              <p className="text-[11px] text-neutral-300 line-clamp-2 italic font-normal leading-tight">
                «{lineText}»
              </p>
            )}
            <div className="text-[9px] text-neutral-500 pt-0.5 border-t border-neutral-800/80 flex items-center justify-between">
              <span>Кликните для перехода в видео</span>
              <span className="text-indigo-400 font-mono">16:9 HD</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
