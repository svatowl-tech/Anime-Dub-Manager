import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  X, Check, Crop, RotateCcw, Sparkles, User, ZoomIn, 
  Maximize2, Square, RectangleVertical, HelpCircle 
} from 'lucide-react';

interface CharacterAvatarCropModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string | null;
  characterName: string;
  onConfirm: (croppedDataUrl: string) => void;
}

type DragType = 
  | 'move' 
  | 'handle-tl' 
  | 'handle-tr' 
  | 'handle-bl' 
  | 'handle-br' 
  | 'handle-t' 
  | 'handle-b' 
  | 'handle-l' 
  | 'handle-r';

export default function CharacterAvatarCropModal({
  isOpen,
  onClose,
  imageUrl,
  characterName,
  onConfirm,
}: CharacterAvatarCropModalProps) {
  // Crop coordinates in percentage of container (0 to 100)
  const [crop, setCrop] = useState({ x: 30, y: 15, w: 40, h: 70 });
  const [aspectRatio, setAspectRatio] = useState<'1:1' | 'free'>('1:1');
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const isDraggingRef = useRef(false);
  const dragTypeRef = useRef<DragType>('move');
  const dragStartRef = useRef<{ clientX: number; clientY: number; crop: typeof crop }>({
    clientX: 0,
    clientY: 0,
    crop: { x: 30, y: 15, w: 40, h: 70 }
  });

  // Reset initial crop on open
  useEffect(() => {
    if (isOpen) {
      // Default to a centered portrait/square area
      setCrop({ x: 35, y: 10, w: 30, h: 53.33 }); // ~1:1 on 16:9 frame
      setAspectRatio('1:1');
    }
  }, [isOpen]);

  // Generate live preview on canvas
  const updatePreview = useCallback(() => {
    if (!imageRef.current || !imageUrl) return;
    const img = imageRef.current;
    if (!img.naturalWidth || !img.naturalHeight) return;

    try {
      const canvas = document.createElement('canvas');
      const targetSize = 256;
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const sx = (crop.x / 100) * img.naturalWidth;
      const sy = (crop.y / 100) * img.naturalHeight;
      const sw = (crop.w / 100) * img.naturalWidth;
      const sh = (crop.h / 100) * img.naturalHeight;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetSize, targetSize);

      setPreviewDataUrl(canvas.toDataURL('image/jpeg', 0.92));
    } catch (e) {
      // ignore security / cross-origin preview if any
    }
  }, [crop, imageUrl]);

  useEffect(() => {
    if (isOpen && imageUrl) {
      const timer = setTimeout(updatePreview, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, imageUrl, crop, updatePreview]);

  // Drag & Resize Handlers
  const handleMouseDown = (e: React.MouseEvent, type: DragType) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingRef.current = true;
    dragTypeRef.current = type;
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      crop: { ...crop }
    };

    const handleMouseMove = (moveEv: MouseEvent) => {
      if (!isDraggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const dxPct = ((moveEv.clientX - dragStartRef.current.clientX) / rect.width) * 100;
      const dyPct = ((moveEv.clientY - dragStartRef.current.clientY) / rect.height) * 100;

      const start = dragStartRef.current.crop;
      const type = dragTypeRef.current;

      let nextX = start.x;
      let nextY = start.y;
      let nextW = start.w;
      let nextH = start.h;

      if (type === 'move') {
        nextX = Math.max(0, Math.min(100 - start.w, start.x + dxPct));
        nextY = Math.max(0, Math.min(100 - start.h, start.y + dyPct));
      } else {
        // Handle resizing
        const containerAspect = rect.width / rect.height; // e.g. 16/9 = 1.777

        if (aspectRatio === '1:1') {
          // Keep visual 1:1 on screen: visualWidth = visualHeight
          // widthPixels = (w / 100) * rect.width
          // heightPixels = (h / 100) * rect.height
          // For widthPixels == heightPixels => w = h * (rect.height / rect.width) = h / containerAspect
          if (type === 'handle-br' || type === 'handle-r' || type === 'handle-b') {
            const rawW = Math.max(8, Math.min(100 - start.x, start.w + dxPct));
            const rawH = rawW * containerAspect;
            if (start.y + rawH <= 100) {
              nextW = rawW;
              nextH = rawH;
            } else {
              nextH = 100 - start.y;
              nextW = nextH / containerAspect;
            }
          } else if (type === 'handle-tl') {
            const rawW = Math.max(8, Math.min(start.x + start.w, start.w - dxPct));
            const rawH = rawW * containerAspect;
            const testX = start.x + (start.w - rawW);
            const testY = start.y + (start.h - rawH);
            if (testX >= 0 && testY >= 0) {
              nextW = rawW;
              nextH = rawH;
              nextX = testX;
              nextY = testY;
            }
          } else if (type === 'handle-tr') {
            const rawW = Math.max(8, Math.min(100 - start.x, start.w + dxPct));
            const rawH = rawW * containerAspect;
            const testY = start.y + (start.h - rawH);
            if (testY >= 0) {
              nextW = rawW;
              nextH = rawH;
              nextY = testY;
            }
          } else if (type === 'handle-bl') {
            const rawW = Math.max(8, Math.min(start.x + start.w, start.w - dxPct));
            const rawH = rawW * containerAspect;
            const testX = start.x + (start.w - rawW);
            if (testX >= 0 && start.y + rawH <= 100) {
              nextW = rawW;
              nextH = rawH;
              nextX = testX;
            }
          }
        } else {
          // Free aspect ratio
          if (type.includes('r')) nextW = Math.max(8, Math.min(100 - start.x, start.w + dxPct));
          if (type.includes('b')) nextH = Math.max(8, Math.min(100 - start.y, start.h + dyPct));
          if (type.includes('l')) {
            const potentialX = Math.max(0, Math.min(start.x + start.w - 8, start.x + dxPct));
            nextW = start.w - (potentialX - start.x);
            nextX = potentialX;
          }
          if (type.includes('t')) {
            const potentialY = Math.max(0, Math.min(start.y + start.h - 8, start.y + dyPct));
            nextH = start.h - (potentialY - start.y);
            nextY = potentialY;
          }
        }
      }

      setCrop({
        x: Math.round(nextX * 10) / 10,
        y: Math.round(nextY * 10) / 10,
        w: Math.round(nextW * 10) / 10,
        h: Math.round(nextH * 10) / 10,
      });
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleApplyPreset = (preset: 'face' | 'bust' | 'full') => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 9;

    if (preset === 'face') {
      const w = 24;
      const h = w * aspect;
      setCrop({ x: 38, y: 15, w, h: Math.min(h, 75) });
      setAspectRatio('1:1');
    } else if (preset === 'bust') {
      const w = 38;
      const h = w * aspect;
      setCrop({ x: 31, y: 10, w, h: Math.min(h, 85) });
      setAspectRatio('1:1');
    } else {
      setCrop({ x: 5, y: 5, w: 90, h: 90 });
      setAspectRatio('free');
    }
  };

  const handleSaveCroppedAvatar = () => {
    if (!imageRef.current || !imageUrl) return;
    const img = imageRef.current;

    try {
      const canvas = document.createElement('canvas');
      const targetSize = 256;
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const sx = (crop.x / 100) * img.naturalWidth;
      const sy = (crop.y / 100) * img.naturalHeight;
      const sw = (crop.w / 100) * img.naturalWidth;
      const sh = (crop.h / 100) * img.naturalHeight;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetSize, targetSize);

      const croppedUrl = canvas.toDataURL('image/jpeg', 0.92);
      onConfirm(croppedUrl);
      onClose();
    } catch (e) {
      console.error('Failed to crop avatar:', e);
      // Fallback: send full image
      onConfirm(imageUrl);
      onClose();
    }
  };

  if (!isOpen || !imageUrl) return null;

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-[80] p-4 animate-in fade-in duration-200">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/60 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-indigo-500/20 text-indigo-400 rounded-lg border border-indigo-500/30">
              <Crop className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>Выбор области кадра для аватарки:</span>
                <span className="text-indigo-400 font-semibold">{characterName}</span>
              </h3>
              <p className="text-[11px] text-neutral-400">
                Перемещайте и масштабируйте рамку для выделения лица или силуэта персонажа
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0">
          {/* Main Visual Crop Box (Left, 8 cols) */}
          <div className="lg:col-span-8 flex flex-col gap-3">
            <div 
              ref={containerRef}
              className="relative w-full aspect-video bg-neutral-950 rounded-xl border border-neutral-800 shadow-2xl overflow-hidden select-none cursor-crosshair group"
            >
              <img
                ref={imageRef}
                src={imageUrl}
                alt="Кадр серии"
                crossOrigin="anonymous"
                className="w-full h-full object-contain pointer-events-none"
                onLoad={updatePreview}
              />

              {/* Dimmed Masks */}
              <div 
                className="absolute top-0 left-0 right-0 bg-black/70 pointer-events-none transition-all"
                style={{ height: `${crop.y}%` }}
              />
              <div 
                className="absolute bottom-0 left-0 right-0 bg-black/70 pointer-events-none transition-all"
                style={{ height: `${Math.max(0, 100 - (crop.y + crop.h))}%` }}
              />
              <div 
                className="absolute bg-black/70 pointer-events-none transition-all"
                style={{ 
                  top: `${crop.y}%`, 
                  bottom: `${Math.max(0, 100 - (crop.y + crop.h))}%`, 
                  left: 0, 
                  width: `${crop.x}%` 
                }}
              />
              <div 
                className="absolute bg-black/70 pointer-events-none transition-all"
                style={{ 
                  top: `${crop.y}%`, 
                  bottom: `${Math.max(0, 100 - (crop.y + crop.h))}%`, 
                  right: 0, 
                  width: `${Math.max(0, 100 - (crop.x + crop.w))}%` 
                }}
              />

              {/* Active Draggable Crop Box */}
              <div
                onMouseDown={(e) => handleMouseDown(e, 'move')}
                className="absolute border-2 border-indigo-400 bg-indigo-500/10 cursor-move shadow-[0_0_15px_rgba(99,102,241,0.5)] transition-shadow"
                style={{
                  left: `${crop.x}%`,
                  top: `${crop.y}%`,
                  width: `${crop.w}%`,
                  height: `${crop.h}%`,
                }}
              >
                {/* Rule of Thirds Grid Lines */}
                <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-40">
                  <div className="border-r border-b border-indigo-300/40" />
                  <div className="border-r border-b border-indigo-300/40" />
                  <div className="border-b border-indigo-300/40" />
                  <div className="border-r border-b border-indigo-300/40" />
                  <div className="border-r border-b border-indigo-300/40" />
                  <div className="border-b border-indigo-300/40" />
                  <div className="border-r border-indigo-300/40" />
                  <div className="border-r border-indigo-300/40" />
                  <div />
                </div>

                {/* Resize Corners */}
                <div
                  onMouseDown={(e) => handleMouseDown(e, 'handle-tl')}
                  className="w-3.5 h-3.5 bg-indigo-500 border-2 border-white rounded-full absolute -top-1.5 -left-1.5 cursor-nwse-resize z-20 shadow-md hover:scale-125 transition-transform"
                />
                <div
                  onMouseDown={(e) => handleMouseDown(e, 'handle-tr')}
                  className="w-3.5 h-3.5 bg-indigo-500 border-2 border-white rounded-full absolute -top-1.5 -right-1.5 cursor-nesw-resize z-20 shadow-md hover:scale-125 transition-transform"
                />
                <div
                  onMouseDown={(e) => handleMouseDown(e, 'handle-bl')}
                  className="w-3.5 h-3.5 bg-indigo-500 border-2 border-white rounded-full absolute -bottom-1.5 -left-1.5 cursor-nesw-resize z-20 shadow-md hover:scale-125 transition-transform"
                />
                <div
                  onMouseDown={(e) => handleMouseDown(e, 'handle-br')}
                  className="w-3.5 h-3.5 bg-indigo-500 border-2 border-white rounded-full absolute -bottom-1.5 -right-1.5 cursor-nwse-resize z-20 shadow-md hover:scale-125 transition-transform"
                />

                {/* Center Badge */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="text-[10px] bg-neutral-950/80 px-2 py-0.5 rounded text-indigo-200 border border-indigo-500/30 font-medium">
                    {Math.round(crop.w)}% &times; {Math.round(crop.h)}%
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Presets Toolbar */}
            <div className="flex items-center justify-between gap-2 p-2 bg-neutral-950/60 border border-neutral-800 rounded-xl text-xs">
              <div className="flex items-center gap-1.5 text-neutral-400">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[11px] font-medium">Шаблоны:</span>
                <button
                  type="button"
                  onClick={() => handleApplyPreset('face')}
                  className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded text-[11px] transition-colors"
                >
                  Лицо (крупно)
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyPreset('bust')}
                  className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded text-[11px] transition-colors"
                >
                  Портрет (по пояс)
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyPreset('full')}
                  className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded text-[11px] transition-colors"
                >
                  Весь кадр
                </button>
              </div>

              <div className="flex items-center gap-1 bg-neutral-900 p-0.5 rounded-lg border border-neutral-800">
                <button
                  type="button"
                  onClick={() => setAspectRatio('1:1')}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium flex items-center gap-1 transition-colors ${
                    aspectRatio === '1:1'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  <Square className="w-3 h-3" />
                  <span>1:1</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAspectRatio('free')}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium flex items-center gap-1 transition-colors ${
                    aspectRatio === 'free'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  <Maximize2 className="w-3 h-3" />
                  <span>Свободный</span>
                </button>
              </div>
            </div>
          </div>

          {/* Live Preview Panel (Right, 4 cols) */}
          <div className="lg:col-span-4 flex flex-col justify-between bg-neutral-950/70 border border-neutral-800 rounded-xl p-4 space-y-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
                <span className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
                  <User className="w-4 h-4 text-indigo-400" />
                  Предпросмотр аватара
                </span>
                <span className="text-[10px] text-neutral-500 font-mono">256 &times; 256</span>
              </div>

              {/* Circular Avatar Preview (as seen in roles grid and editor) */}
              <div className="flex flex-col items-center justify-center p-4 bg-neutral-900/60 rounded-xl border border-neutral-800/80 gap-3">
                <div className="relative w-28 h-28 rounded-full border-2 border-indigo-500/80 shadow-2xl overflow-hidden bg-neutral-950 ring-4 ring-indigo-500/20">
                  {previewDataUrl ? (
                    <img
                      src={previewDataUrl}
                      alt="Avatar Preview"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-neutral-600">
                      <User className="w-10 h-10" />
                    </div>
                  )}
                </div>

                <div className="text-center">
                  <div className="text-xs font-bold text-white truncate max-w-[180px]">
                    {characterName}
                  </div>
                  <div className="text-[10px] text-indigo-400 font-medium">
                    Основной аватар персонажа
                  </div>
                </div>
              </div>

              {/* Smaller in-context previews */}
              <div className="space-y-2">
                <span className="text-[10px] text-neutral-500 font-semibold uppercase tracking-wider block">
                  Как будет отображаться в списках:
                </span>
                <div className="flex items-center gap-3 p-2 bg-neutral-900/40 rounded-lg border border-neutral-800/60">
                  <div className="w-10 h-10 rounded-full border border-neutral-700 overflow-hidden bg-neutral-950 shrink-0">
                    {previewDataUrl && (
                      <img src={previewDataUrl} alt="" className="w-full h-full object-cover" />
                    )}
                  </div>
                  <div className="w-6 h-6 rounded-full border border-neutral-700 overflow-hidden bg-neutral-950 shrink-0">
                    {previewDataUrl && (
                      <img src={previewDataUrl} alt="" className="w-full h-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 text-xs text-neutral-300 truncate font-medium">
                    {characterName}
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Bottom Actions */}
            <div className="space-y-2 pt-2 border-t border-neutral-800">
              <button
                type="button"
                onClick={handleSaveCroppedAvatar}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Сохранить аватар персонажа</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="w-full py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-xl text-xs font-medium transition-colors"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
