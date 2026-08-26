import React, { useRef } from 'react';
import { Sparkles } from 'lucide-react';

interface VisualCropEditorProps {
  screenshotUrl: string | null;
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  onChange: (rect: { x: number; y: number; w: number; h: number }) => void;
  disabled?: boolean;
}

type InteractionState = 
  | 'idle' 
  | 'moving' 
  | 'resizing-tl' 
  | 'resizing-t' 
  | 'resizing-tr' 
  | 'resizing-r' 
  | 'resizing-br' 
  | 'resizing-b' 
  | 'resizing-bl' 
  | 'resizing-l';

export default function VisualCropEditor({
  screenshotUrl,
  cropX,
  cropY,
  cropW,
  cropH,
  onChange,
  disabled = false
}: VisualCropEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{
    type: InteractionState;
    startX: number;
    startY: number;
    startCropX: number;
    startCropY: number;
    startCropW: number;
    startCropH: number;
  } | null>(null);

  const displayUrl = screenshotUrl || "https://images.unsplash.com/photo-1578632767115-351597cf2477?q=80&w=1200&auto=format&fit=crop";

  const handleMouseDown = (e: React.MouseEvent, type: InteractionState) => {
    if (disabled) return;
    e.stopPropagation();
    e.preventDefault();

    dragStart.current = {
      type,
      startX: e.clientX,
      startY: e.clientY,
      startCropX: cropX,
      startCropY: cropY,
      startCropW: cropW,
      startCropH: cropH
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!dragStart.current || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dxPercent = ((e.clientX - dragStart.current.startX) / rect.width) * 100;
    const dyPercent = ((e.clientY - dragStart.current.startY) / rect.height) * 100;

    const { type, startCropX, startCropY, startCropW, startCropH } = dragStart.current;

    let nextX = startCropX;
    let nextY = startCropY;
    let nextW = startCropW;
    let nextH = startCropH;

    if (type === 'moving') {
      nextX = Math.max(0, Math.min(100 - startCropW, startCropX + dxPercent));
      nextY = Math.max(0, Math.min(100 - startCropH, startCropY + dyPercent));
    } else {
      // Horizontal resize changes
      if (type.includes('-l') || type === 'resizing-l') {
        const potentialX = Math.max(0, Math.min(startCropX + startCropW - 5, startCropX + dxPercent));
        nextW = startCropW - (potentialX - startCropX);
        nextX = potentialX;
      }
      if (type.includes('-r') || type === 'resizing-r') {
        nextW = Math.max(5, Math.min(100 - startCropX, startCropW + dxPercent));
      }

      // Vertical resize changes
      if (type.includes('-t') || type === 'resizing-t') {
        const potentialY = Math.max(0, Math.min(startCropY + startCropH - 5, startCropY + dyPercent));
        nextH = startCropH - (potentialY - startCropY);
        nextY = potentialY;
      }
      if (type.includes('-b') || type === 'resizing-b') {
        nextH = Math.max(5, Math.min(100 - startCropY, startCropH + dyPercent));
      }
    }

    onChange({
      x: Math.round(nextX),
      y: Math.round(nextY),
      w: Math.round(nextW),
      h: Math.round(nextH)
    });
  };

  const handleMouseUp = () => {
    dragStart.current = null;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  // Safe constraints for overlay mapping
  const x = Math.max(0, Math.min(100, cropX));
  const y = Math.max(0, Math.min(100, cropY));
  const w = Math.max(1, Math.min(100 - x, cropW));
  const h = Math.max(1, Math.min(100 - y, cropH));

  return (
    <div className="flex flex-col gap-2">
      <div 
        ref={containerRef}
        className="relative w-full aspect-video bg-neutral-950 rounded-xl border border-neutral-800 shadow-2xl overflow-hidden select-none"
      >
        {/* Background screenshot */}
        <img 
          src={displayUrl} 
          alt="OCR Video Frame"
          referrerPolicy="no-referrer"
          className="w-full h-full object-contain pointer-events-none"
        />

        {/* DIM MASKS */}
        {/* Top Mask */}
        <div 
          className="absolute top-0 left-0 right-0 bg-black/75 pointer-events-none transition-all duration-100"
          style={{ height: `${y}%` }}
        />
        {/* Bottom Mask */}
        <div 
          className="absolute bottom-0 left-0 right-0 bg-black/75 pointer-events-none transition-all duration-100"
          style={{ height: `${100 - (y + h)}%` }}
        />
        {/* Left Mask */}
        <div 
          className="absolute bg-black/75 pointer-events-none transition-all duration-100"
          style={{ 
            top: `${y}%`, 
            bottom: `${100 - (y + h)}%`, 
            left: 0, 
            width: `${x}%` 
          }}
        />
        {/* Right Mask */}
        <div 
          className="absolute bg-black/75 pointer-events-none transition-all duration-100"
          style={{ 
            top: `${y}%`, 
            bottom: `${100 - (y + h)}%`, 
            right: 0, 
            width: `${100 - (x + w)}%` 
          }}
        />

        {/* CROP BOX OVERLAY */}
        <div 
          className="absolute border-2 border-emerald-500 bg-emerald-500/10 cursor-move shadow-[0_0_15px_rgba(16,185,129,0.3)] transition-all duration-100 group"
          style={{
            left: `${x}%`,
            top: `${y}%`,
            width: `${w}%`,
            height: `${h}%`,
          }}
          onMouseDown={(e) => handleMouseDown(e, 'moving')}
        >
          {/* Label in the center/top */}
          <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-emerald-600 text-[10px] text-white font-extrabold px-2 py-0.5 rounded-md uppercase tracking-wider shadow-md pointer-events-none font-sans whitespace-nowrap flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-amber-300 fill-amber-300" />
            Зона распознавания: {w}% x {h}%
          </div>

          {/* DRAG HANDLES */}
          {/* Top-Left */}
          <div 
            className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 bg-white border-2 border-emerald-600 rounded-full cursor-nwse-resize hover:scale-125 transition-transform z-20"
            onMouseDown={(e) => handleMouseDown(e, 'resizing-tl')}
          />
          {/* Top-Center */}
          <div 
            className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-4 h-2 bg-emerald-400 border border-emerald-600 rounded cursor-ns-resize hover:scale-125 transition-transform z-20"
            onMouseDown={(e) => handleMouseDown(e, 'resizing-t')}
          />
          {/* Top-Right */}
          <div 
            className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-white border-2 border-emerald-600 rounded-full cursor-nesw-resize hover:scale-125 transition-transform z-20"
            onMouseDown={(e) => handleMouseDown(e, 'resizing-tr')}
          />
          {/* Right-Center */}
          <div 
            className="absolute top-1/2 -translate-y-1/2 -right-1 w-2 h-4 bg-emerald-400 border border-emerald-600 rounded cursor-ew-resize hover:scale-125 transition-transform z-20"
            onMouseDown={(e) => handleMouseDown(e, 'resizing-r')}
          />
          {/* Bottom-Right */}
          <div 
            className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-white border-2 border-emerald-600 rounded-full cursor-nwse-resize hover:scale-125 transition-transform z-20"
            onMouseDown={(e) => handleMouseDown(e, 'resizing-br')}
          />
          {/* Bottom-Center */}
          <div 
            className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-4 h-2 bg-emerald-400 border border-emerald-600 rounded cursor-ns-resize hover:scale-125 transition-transform z-20"
            onMouseDown={(e) => handleMouseDown(e, 'resizing-b')}
          />
          {/* Bottom-Left */}
          <div 
            className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 bg-white border-2 border-emerald-600 rounded-full cursor-nesw-resize hover:scale-125 transition-transform z-20"
            onMouseDown={(e) => handleMouseDown(e, 'resizing-bl')}
          />
          {/* Left-Center */}
          <div 
            className="absolute top-1/2 -translate-y-1/2 -left-1.5 w-2 h-4 bg-emerald-400 border border-emerald-600 rounded cursor-ew-resize hover:scale-125 transition-transform z-20"
            onMouseDown={(e) => handleMouseDown(e, 'resizing-l')}
          />
        </div>
      </div>
      <div className="flex items-center justify-between text-[11px] text-neutral-400 font-mono bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1.5 mt-1">
        <span>Смещение X: <b className="text-emerald-400 font-bold">{x}%</b></span>
        <span>Смещение Y: <b className="text-emerald-400 font-bold">{y}%</b></span>
        <span>Ширина: <b className="text-emerald-400 font-bold">{w}%</b></span>
        <span>Высота: <b className="text-emerald-400 font-bold">{h}%</b></span>
      </div>
    </div>
  );
}
