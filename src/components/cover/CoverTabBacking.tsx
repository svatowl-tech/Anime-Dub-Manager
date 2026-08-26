import React from 'react';
import { Palette } from 'lucide-react';
import { DIVIDER_STYLES } from '../../lib/cover/coverTypes';

interface CoverTabBackingProps {
  dividerStyle: string;
  setDividerStyle: (style: string) => void;
  cutTopXPercent: number;
  setCutTopXPercent: (val: number) => void;
  cutBottomXPercent: number;
  setCutBottomXPercent: (val: number) => void;
  dividerColor: string;
  setDividerColor: (color: string) => void;
  cutColor: string;
  setCutColor: (color: string) => void;
  cutOpacity: number;
  setCutOpacity: (op: number) => void;
}

export const CoverTabBacking: React.FC<CoverTabBackingProps> = ({
  dividerStyle,
  setDividerStyle,
  cutTopXPercent,
  setCutTopXPercent,
  cutBottomXPercent,
  setCutBottomXPercent,
  dividerColor,
  setDividerColor,
  cutColor,
  setCutColor,
  cutOpacity,
  setCutOpacity,
}) => {
  return (
    <div className="space-y-4" id="panel_backing">
      <h3 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
        <Palette className="w-4 h-4 text-cyan-400" />
        Параметры среза (подложки)
      </h3>

      <div>
        <label className="block text-xs text-neutral-400 mb-1 font-medium">
          Стиль узора-разделителя
        </label>
        <select
          id="divider_style_select"
          value={dividerStyle}
          onChange={(e) => setDividerStyle(e.target.value)}
          className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-white text-xs outline-none focus:border-blue-500 font-medium"
        >
          {DIVIDER_STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {/* Position & Angle */}
      <div className="bg-neutral-950 p-3 rounded-lg border border-neutral-800 space-y-3" id="backing_angles">
        <span className="block text-[11px] text-neutral-400 font-bold uppercase tracking-wider">
          Угол и Положение подложки
        </span>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] text-neutral-400">
            <span>Верхняя координата (Top-X)</span>
            <span className="font-mono text-cyan-400 font-bold">{cutTopXPercent}%</span>
          </div>
          <input
            id="range_cut_top_x"
            type="range"
            min="-20"
            max="150"
            value={cutTopXPercent}
            onChange={(e) => setCutTopXPercent(Number(e.target.value))}
            className="w-full accent-cyan-500 cursor-pointer"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] text-neutral-400">
            <span>Нижняя координата (Bottom-X)</span>
            <span className="font-mono text-cyan-400 font-bold">{cutBottomXPercent}%</span>
          </div>
          <input
            id="range_cut_bottom_x"
            type="range"
            min="-20"
            max="150"
            value={cutBottomXPercent}
            onChange={(e) => setCutBottomXPercent(Number(e.target.value))}
            className="w-full accent-cyan-500 cursor-pointer"
          />
        </div>

        <p className="text-[10px] text-neutral-500 leading-tight">
          *Сдвиг обеих координат в одну сторону изменит положение подложки, а изменение разницы между ними изменит угол наклона.
        </p>
      </div>

      {/* Backing and Divider Colors */}
      <div className="bg-neutral-950 p-3 rounded-lg border border-neutral-800 space-y-3" id="backing_colors">
        <div className="space-y-1.5">
          <label className="block text-[11px] text-neutral-400 font-bold uppercase">
            Цвет разделителя
          </label>
          <div className="flex gap-2 items-center">
            <input
              id="color_picker_divider"
              type="color"
              value={dividerColor}
              onChange={(e) => setDividerColor(e.target.value)}
              className="w-7 h-7 rounded bg-transparent cursor-pointer"
            />
            <input
              id="input_divider_color_hex"
              type="text"
              value={dividerColor}
              onChange={(e) => setDividerColor(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs text-neutral-300 font-mono"
            />
          </div>
        </div>

        <div className="space-y-1.5 pt-2 border-t border-neutral-900">
          <div className="flex justify-between items-center">
            <label className="block text-[11px] text-neutral-400 font-bold uppercase">
              Цвет подложки
            </label>
            <span className="text-[11px] text-neutral-400 font-bold font-mono text-cyan-400">
              {Math.round(cutOpacity * 100)}%
            </span>
          </div>
          <div className="flex gap-2 items-center">
            <input
              id="color_picker_cut"
              type="color"
              value={cutColor}
              onChange={(e) => setCutColor(e.target.value)}
              className="w-7 h-7 rounded bg-transparent cursor-pointer"
            />
            <input
              id="range_cut_opacity"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={cutOpacity}
              onChange={(e) => setCutOpacity(parseFloat(e.target.value))}
              className="w-full accent-cyan-500 cursor-pointer"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
