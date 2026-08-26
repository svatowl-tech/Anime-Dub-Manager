import React from 'react';
import { Sparkles } from 'lucide-react';

interface CoverTabEffectsProps {
  strokeEnabled: boolean;
  setStrokeEnabled: (val: boolean) => void;
  strokeWidth: number;
  setStrokeWidth: (val: number) => void;
  strokeColor: string;
  setStrokeColor: (val: string) => void;
  shadowBlur: number;
  setShadowBlur: (val: number) => void;
  shadowOffsetX: number;
  setShadowOffsetX: (val: number) => void;
  shadowOffsetY: number;
  setShadowOffsetY: (val: number) => void;
  shadowColor: string;
  setShadowColor: (val: string) => void;
}

export const CoverTabEffects: React.FC<CoverTabEffectsProps> = ({
  strokeEnabled,
  setStrokeEnabled,
  strokeWidth,
  setStrokeWidth,
  strokeColor,
  setStrokeColor,
  shadowBlur,
  setShadowBlur,
  shadowOffsetX,
  setShadowOffsetX,
  shadowOffsetY,
  setShadowOffsetY,
  shadowColor,
  setShadowColor,
}) => {
  return (
    <div className="space-y-4" id="panel_effects">
      <h3 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-purple-400" />
        Улучшенная стилизация и эффекты
      </h3>

      {/* Text Stroke */}
      <div className="bg-neutral-950 p-3 rounded-lg border border-neutral-800 space-y-3" id="stroke_settings">
        <div className="flex items-center justify-between">
          <label
            htmlFor="checkbox_stroke_enabled"
            className="text-xs text-neutral-300 font-semibold select-none cursor-pointer"
          >
            Включить обводку текста
          </label>
          <input
            id="checkbox_stroke_enabled"
            type="checkbox"
            checked={strokeEnabled}
            onChange={(e) => setStrokeEnabled(e.target.checked)}
            className="w-4 h-4 rounded accent-blue-500 cursor-pointer"
          />
        </div>

        {strokeEnabled && (
          <div className="space-y-2 pt-1 border-t border-neutral-900">
            <div className="flex items-center justify-between text-[11px] text-neutral-400">
              <span>Толщина обводки</span>
              <span className="font-mono font-bold text-blue-400">{strokeWidth}px</span>
            </div>
            <input
              id="range_stroke_width"
              type="range"
              min="1"
              max="30"
              value={strokeWidth}
              onChange={(e) => setStrokeWidth(Number(e.target.value))}
              className="w-full accent-blue-500 cursor-pointer"
            />

            <div className="flex items-center gap-2 mt-2">
              <span className="text-[10px] text-neutral-400 shrink-0">Цвет обводки:</span>
              <input
                id="color_picker_stroke"
                type="color"
                value={strokeColor}
                onChange={(e) => setStrokeColor(e.target.value)}
                className="w-6 h-6 rounded shrink-0 bg-transparent cursor-pointer"
              />
              <input
                id="input_stroke_color_hex"
                type="text"
                value={strokeColor}
                onChange={(e) => setStrokeColor(e.target.value)}
                className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-0.5 text-[10px] text-neutral-300 font-mono"
              />
            </div>
          </div>
        )}
      </div>

      {/* Shadow Settings */}
      <div className="bg-neutral-950 p-3 rounded-lg border border-neutral-800 space-y-3" id="shadow_settings">
        <span className="block text-[11px] text-neutral-400 font-bold uppercase tracking-wider">
          Параметры объемной тени
        </span>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] text-neutral-400">
            <span>Размытие тени (Blur)</span>
            <span className="font-mono text-purple-400 font-bold">{shadowBlur}px</span>
          </div>
          <input
            id="range_shadow_blur"
            type="range"
            min="0"
            max="60"
            value={shadowBlur}
            onChange={(e) => setShadowBlur(Number(e.target.value))}
            className="w-full accent-purple-500 cursor-pointer"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] text-neutral-400">
            <span>Смещение X</span>
            <span className="font-mono text-purple-400 font-bold">{shadowOffsetX}px</span>
          </div>
          <input
            id="range_shadow_offset_x"
            type="range"
            min="-40"
            max="40"
            value={shadowOffsetX}
            onChange={(e) => setShadowOffsetX(Number(e.target.value))}
            className="w-full accent-purple-200 cursor-pointer"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] text-neutral-400">
            <span>Смещение Y</span>
            <span className="font-mono text-purple-400 font-bold">{shadowOffsetY}px</span>
          </div>
          <input
            id="range_shadow_offset_y"
            type="range"
            min="-40"
            max="40"
            value={shadowOffsetY}
            onChange={(e) => setShadowOffsetY(Number(e.target.value))}
            className="w-full accent-purple-200 cursor-pointer"
          />
        </div>

        <div className="flex items-center gap-2 pt-1 border-t border-neutral-900">
          <span className="text-[10px] text-neutral-400 shrink-0">Цвет тени:</span>
          <input
            id="color_picker_shadow"
            type="color"
            value={shadowColor.startsWith('rgba') ? '#000000' : shadowColor}
            onChange={(e) => setShadowColor(e.target.value)}
            className="w-6 h-6 rounded shrink-0 bg-transparent cursor-pointer"
          />
          <input
            id="input_shadow_color_hex"
            type="text"
            value={shadowColor}
            onChange={(e) => setShadowColor(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-0.5 text-[10px] text-neutral-300 font-mono"
          />
        </div>
      </div>
    </div>
  );
};
