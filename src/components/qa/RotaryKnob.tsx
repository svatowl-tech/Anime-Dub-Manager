import React, { useRef, useState, useCallback } from 'react';
import { Volume2, VolumeX } from 'lucide-react';

export interface RotaryKnobProps {
  value: number; // 0..1
  onChange: (newValue: number) => void;
  defaultValue?: number;
  label: string;
  sublabel?: string;
  accentColor?: 'blue' | 'neutral' | 'emerald' | 'amber';
  isMuted?: boolean;
  onToggleMute?: () => void;
  gainBadge?: string | null;
  gainTitle?: string;
  fixesCount?: number;
  onSelectTrack?: () => void;
}

export const RotaryKnob: React.FC<RotaryKnobProps> = ({
  value,
  onChange,
  defaultValue = 0.8,
  label,
  sublabel,
  accentColor = 'blue',
  isMuted = false,
  onToggleMute,
  gainBadge,
  gainTitle,
  fixesCount = 0,
  onSelectTrack
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef<number>(0);
  const startXRef = useRef<number>(0);
  const startValRef = useRef<number>(value);

  const clampedValue = isMuted ? 0 : Math.max(0, Math.min(1, value));
  // Angle from -135deg to +135deg (total 270deg sweep)
  const minAngle = -135;
  const maxAngle = 135;
  const currentAngle = minAngle + clampedValue * (maxAngle - minAngle);

  // SVG arc helper (center 22, 22, radius 17)
  const cx = 22;
  const cy = 22;
  const r = 16.5;

  const polarToCartesian = (centerX: number, centerY: number, radius: number, angleInDegrees: number) => {
    const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
    return {
      x: centerX + radius * Math.cos(angleInRadians),
      y: centerY + radius * Math.sin(angleInRadians)
    };
  };

  const describeArc = (x: number, y: number, radius: number, startAngle: number, endAngle: number) => {
    if (Math.abs(endAngle - startAngle) < 0.1) return '';
    const start = polarToCartesian(x, y, radius, endAngle);
    const end = polarToCartesian(x, y, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
    return ['M', start.x, start.y, 'A', radius, radius, 0, largeArcFlag, 0, end.x, end.y].join(' ');
  };

  const trackArc = describeArc(cx, cy, r, minAngle, maxAngle);
  const activeArc = clampedValue > 0.005 ? describeArc(cx, cy, r, minAngle, currentAngle) : '';

  const pointerPos = polarToCartesian(cx, cy, 10.5, currentAngle);
  const pointerInner = polarToCartesian(cx, cy, 5, currentAngle);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
      startYRef.current = e.clientY;
      startXRef.current = e.clientX;
      startValRef.current = value;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const dy = startYRef.current - moveEvent.clientY;
        const dx = moveEvent.clientX - startXRef.current;
        const delta = (dy + dx * 0.5) / 110; // 110px for full sweep
        const next = Math.max(0, Math.min(1, Math.round((startValRef.current + delta) * 100) / 100));
        onChange(next);
      };

      const handlePointerUp = () => {
        setIsDragging(false);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    },
    [value, onChange]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const step = e.shiftKey ? 0.01 : 0.05;
      const delta = e.deltaY < 0 ? step : -step;
      const next = Math.max(0, Math.min(1, Math.round((value + delta) * 100) / 100));
      onChange(next);
    },
    [value, onChange]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onChange(defaultValue);
    },
    [defaultValue, onChange]
  );

  const strokeColor =
    isMuted || clampedValue === 0
      ? '#525252'
      : accentColor === 'emerald'
      ? '#10b981'
      : accentColor === 'amber'
      ? '#f59e0b'
      : accentColor === 'neutral'
      ? '#a3a3a3'
      : '#3b82f6';

  return (
    <div
      className={`group relative flex flex-col items-center px-2 py-1.5 rounded-lg border transition-all select-none w-[86px] shrink-0 ${
        isDragging
          ? 'bg-neutral-800/90 border-blue-500/60 shadow-md shadow-blue-500/10'
          : isMuted
          ? 'bg-neutral-900/50 border-neutral-800/60 opacity-65 hover:opacity-95'
          : 'bg-neutral-900/80 border-neutral-800/90 hover:border-neutral-700 hover:bg-neutral-850/90'
      }`}
    >
      {/* Top badges: Mute button & Fixes badge / Auto-Gain */}
      <div className="w-full flex items-center justify-between gap-1 mb-0.5 min-h-[14px]">
        {onToggleMute ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleMute();
            }}
            className={`p-0.5 rounded transition-colors ${
              isMuted
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                : 'text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800'
            }`}
            title={isMuted ? 'Включить звук дорожки' : 'Заглушить дорожку (Mute)'}
          >
            {isMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
          </button>
        ) : (
          <span className="w-3 h-3" />
        )}

        {gainBadge ? (
          <span
            className="text-[9px] font-mono leading-none px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 truncate"
            title={gainTitle}
          >
            {gainBadge}
          </span>
        ) : fixesCount > 0 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectTrack?.();
            }}
            className="text-[9px] font-mono leading-none px-1 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 transition-colors"
            title={`Выписано фиксов: ${fixesCount}. Нажмите, чтобы открыть дорожку`}
          >
            {fixesCount} ф.
          </button>
        ) : null}
      </div>

      {/* Rotary SVG Knob */}
      <div
        onPointerDown={handlePointerDown}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        className="relative cursor-ns-resize flex items-center justify-center"
        title="Тяните вверх/вниз или крутите колесико мыши для регулировки громкости. Двойной клик — сброс."
      >
        <svg width="44" height="40" viewBox="0 0 44 42" className="overflow-visible">
          {/* Background track arc */}
          <path
            d={trackArc}
            fill="none"
            stroke="#262626"
            strokeWidth="3.2"
            strokeLinecap="round"
          />
          {/* Active level arc */}
          {activeArc && (
            <path
              d={activeArc}
              fill="none"
              stroke={strokeColor}
              strokeWidth="3.2"
              strokeLinecap="round"
            />
          )}
          {/* Inner rotor cap */}
          <circle
            cx={cx}
            cy={cy}
            r="12"
            fill="#171717"
            stroke={isDragging ? strokeColor : '#303030'}
            strokeWidth="1.2"
          />
          {/* Rotor indicator line */}
          <line
            x1={pointerInner.x}
            y1={pointerInner.y}
            x2={pointerPos.x}
            y2={pointerPos.y}
            stroke={isMuted ? '#ef4444' : '#f5f5f5'}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>

        {/* Value percentage readout at bottom of arc */}
        <span
          className={`absolute -bottom-0.5 text-[9px] font-mono font-semibold leading-none tracking-tighter ${
            isMuted ? 'text-red-400' : isDragging ? 'text-blue-300' : 'text-neutral-400'
          }`}
        >
          {isMuted ? 'MUTE' : `${Math.round(clampedValue * 100)}%`}
        </span>
      </div>

      {/* Compact Labels (Dubber & Role) */}
      <div
        onClick={onSelectTrack}
        className={`w-full text-center mt-1 ${onSelectTrack ? 'cursor-pointer hover:opacity-80' : ''}`}
        title={`${label}${sublabel ? ` (${sublabel})` : ''}`}
      >
        <div className="text-[11px] font-semibold text-neutral-100 truncate leading-tight">
          {label}
        </div>
        {sublabel && (
          <div className="text-[9px] text-neutral-500 truncate leading-tight mt-0.5">
            {sublabel}
          </div>
        )}
      </div>
    </div>
  );
};
