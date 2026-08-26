import React from 'react';
import { LayoutTemplate, Upload, X, Info } from 'lucide-react';

interface CoverTabLogoProps {
  customTitleLogo: HTMLImageElement | null;
  onLogoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveLogo: () => void;
  logoX: number;
  setLogoX: (val: number) => void;
  logoY: number;
  setLogoY: (val: number) => void;
  logoWidth: number;
  setLogoWidth: (val: number) => void;
  logoRotation: number;
  setLogoRotation: (val: number) => void;
  hideTitleWhenLogoPresent: boolean;
  setHideTitleWhenLogoPresent: (val: boolean) => void;
}

export const CoverTabLogo: React.FC<CoverTabLogoProps> = ({
  customTitleLogo,
  onLogoUpload,
  onRemoveLogo,
  logoX,
  setLogoX,
  logoY,
  setLogoY,
  logoWidth,
  setLogoWidth,
  logoRotation,
  setLogoRotation,
  hideTitleWhenLogoPresent,
  setHideTitleWhenLogoPresent,
}) => {
  return (
    <div className="space-y-4" id="panel_logo">
      <h3 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
        <LayoutTemplate className="w-4 h-4 text-emerald-400" />
        Логотип / Кастомное название
      </h3>

      <div className="space-y-3">
        <label className="block text-xs text-neutral-400 font-medium">
          Загрузить лого-название в PNG (на прозрачном фоне)
        </label>
        <label
          id="upload_logo_label"
          className="w-full h-20 border-2 border-dashed border-neutral-700 bg-neutral-850 hover:bg-neutral-800 hover:border-emerald-500 transition-colors flex flex-col items-center justify-center rounded-lg cursor-pointer"
        >
          <input
            id="input_upload_logo"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onLogoUpload}
          />
          <Upload className="w-5 h-5 text-neutral-500 mb-1" />
          <span className="text-xs text-neutral-300">Выбрать PNG логотип</span>
        </label>

        {customTitleLogo && (
          <div
            className="mt-2 text-xs bg-neutral-950 p-3.5 rounded-lg border border-neutral-800 space-y-3.5"
            id="logo_loaded_controls"
          >
            <div
              className="flex items-center justify-between text-neutral-300 pb-2.5 border-b border-neutral-900"
              id="logo_summary"
            >
              <div className="flex items-center gap-2 truncate">
                <div className="w-7 h-7 rounded bg-neutral-900 border border-neutral-850 flex items-center justify-center overflow-hidden shrink-0">
                  <img
                    src={customTitleLogo.src}
                    alt="Logo preview"
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
                <span className="font-medium truncate text-emerald-400">
                  ✓ {customTitleLogo.width}x{customTitleLogo.height}px
                </span>
              </div>
              <button
                type="button"
                id="btn_remove_logo"
                onClick={onRemoveLogo}
                title="Удалить логотип"
                className="text-red-400 hover:text-red-300 p-1 rounded hover:bg-neutral-900 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Auto-hide Title Setting */}
            <div className="bg-neutral-900/80 p-2.5 rounded-lg border border-neutral-800 space-y-1.5">
              <label className="flex items-center gap-2 text-neutral-200 text-[11px] font-medium cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hideTitleWhenLogoPresent}
                  onChange={(e) => setHideTitleWhenLogoPresent(e.target.checked)}
                  className="w-3.5 h-3.5 accent-emerald-500 rounded cursor-pointer"
                />
                <span>Скрывать текст тайтла при активном логотипе</span>
              </label>
              <p className="text-[10px] text-neutral-400 pl-5 leading-tight">
                Автоматически убирает текстовый заголовок с обложки во избежание дублирования с картинкой логотипа.
              </p>
            </div>

            {/* Logo Dimensions and Rotation */}
            <div className="space-y-3" id="logo_adjustments">
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-neutral-400">
                  <span>Положение X</span>
                  <span className="font-mono text-emerald-400 font-bold">{logoX}%</span>
                </div>
                <input
                  id="range_logo_x"
                  type="range"
                  min="-20"
                  max="120"
                  value={logoX}
                  onChange={(e) => setLogoX(Number(e.target.value))}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-neutral-400">
                  <span>Положение Y</span>
                  <span className="font-mono text-emerald-400 font-bold">{logoY}%</span>
                </div>
                <input
                  id="range_logo_y"
                  type="range"
                  min="-30"
                  max="130"
                  value={logoY}
                  onChange={(e) => setLogoY(Number(e.target.value))}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-neutral-400">
                  <span>Ширина (px)</span>
                  <span className="font-mono text-emerald-400 font-bold">{logoWidth}px</span>
                </div>
                <input
                  id="range_logo_width"
                  type="range"
                  min="100"
                  max="1500"
                  value={logoWidth}
                  onChange={(e) => setLogoWidth(Number(e.target.value))}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-neutral-400">
                  <span>Угол поворота</span>
                  <span className="font-mono text-emerald-400 font-bold">{logoRotation}°</span>
                </div>
                <input
                  id="range_logo_rotation"
                  type="range"
                  min="-180"
                  max="180"
                  value={logoRotation}
                  onChange={(e) => setLogoRotation(Number(e.target.value))}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
