import React from 'react';
import { Type, Info, Check } from 'lucide-react';
import { FONTS } from '../../lib/cover/coverTypes';

interface CoverTabTextProps {
  fontFamily: string;
  setFontFamily: (font: string) => void;
  fontBold: boolean;
  setFontBold: (bold: boolean) => void;
  fontItalic: boolean;
  setFontItalic: (italic: boolean) => void;
  textTransform: 'none' | 'uppercase';
  setTextTransform: (tt: 'none' | 'uppercase') => void;
  episodeNumber: string;
  setEpisodeNumber: (ep: string) => void;
  episodeSize: number;
  setEpisodeSize: (size: number) => void;
  episodeColor: string;
  setEpisodeColor: (color: string) => void;
  title: string;
  setTitle: (t: string) => void;
  titleSize: number;
  setTitleSize: (size: number) => void;
  titleColor: string;
  setTitleColor: (color: string) => void;
  textX: number;
  setTextX: (x: number) => void;
  textY: number;
  setTextY: (y: number) => void;
  lineSpacing: number;
  setLineSpacing: (s: number) => void;
  hasCustomLogo: boolean;
  hideTitleWhenLogoPresent: boolean;
  setHideTitleWhenLogoPresent: (hide: boolean) => void;
}

export const CoverTabText: React.FC<CoverTabTextProps> = ({
  fontFamily,
  setFontFamily,
  fontBold,
  setFontBold,
  fontItalic,
  setFontItalic,
  textTransform,
  setTextTransform,
  episodeNumber,
  setEpisodeNumber,
  episodeSize,
  setEpisodeSize,
  episodeColor,
  setEpisodeColor,
  title,
  setTitle,
  titleSize,
  setTitleSize,
  titleColor,
  setTitleColor,
  textX,
  setTextX,
  textY,
  setTextY,
  lineSpacing,
  setLineSpacing,
  hasCustomLogo,
  hideTitleWhenLogoPresent,
  setHideTitleWhenLogoPresent,
}) => {
  return (
    <div className="space-y-4" id="panel_text">
      <h3 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
        <Type className="w-4 h-4 text-pink-400" />
        Конфигурация типографики
      </h3>

      {/* Font Family */}
      <div>
        <label className="block text-xs text-neutral-400 mb-1 font-medium">Семейство шрифтов</label>
        <select
          id="font_family_select"
          value={fontFamily}
          onChange={(e) => setFontFamily(e.target.value)}
          className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-blue-500 font-medium"
        >
          {FONTS.map((font) => (
            <option key={font} value={font} style={{ fontFamily: font }}>
              {font}
            </option>
          ))}
        </select>
      </div>

      {/* Font Style Modifiers */}
      <div className="bg-neutral-950 p-3 rounded-lg border border-neutral-800 space-y-2" id="text_style_modifiers">
        <span className="block text-[11px] text-neutral-400 font-bold uppercase tracking-wider mb-1">
          Стили начертания
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            id="btn_font_bold"
            onClick={() => setFontBold(!fontBold)}
            className={`px-3 py-1.5 rounded text-xs font-bold border transition-colors flex-1 ${
              fontBold
                ? 'bg-pink-600 text-white border-pink-500'
                : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-neutral-200'
            }`}
          >
            B (Жирный)
          </button>
          <button
            type="button"
            id="btn_font_italic"
            onClick={() => setFontItalic(!fontItalic)}
            className={`px-3 py-1.5 rounded text-xs italic font-bold border transition-colors flex-1 ${
              fontItalic
                ? 'bg-pink-600 text-white border-pink-500'
                : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-neutral-200'
            }`}
          >
            I (Курсив)
          </button>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            id="btn_text_transform_upper"
            onClick={() => setTextTransform(textTransform === 'uppercase' ? 'none' : 'uppercase')}
            className={`px-3 py-1.5 rounded text-[11px] font-bold uppercase border transition-colors flex-1 ${
              textTransform === 'uppercase'
                ? 'bg-pink-600 text-white border-pink-500'
                : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-neutral-200'
            }`}
          >
            TT (ВСЕ ЗАГЛАВНЫЕ)
          </button>
        </div>
      </div>

      {/* Episode Field Group */}
      <div className="bg-neutral-950 p-3 rounded-lg border border-neutral-800 space-y-2" id="episode_field_group">
        <div className="flex justify-between items-center text-xs text-neutral-400">
          <span className="font-medium">Номер / Текст серии</span>
          <span className="font-mono text-pink-400 font-bold">{episodeSize}px</span>
        </div>
        <input
          id="input_episode_number"
          type="text"
          value={episodeNumber}
          onChange={(e) => setEpisodeNumber(e.target.value)}
          className="w-full bg-neutral-900 border border-neutral-800 rounded px-3 py-1.5 text-white text-xs outline-none focus:border-blue-500"
        />
        <input
          id="range_episode_size"
          type="range"
          min="30"
          max="180"
          value={episodeSize}
          onChange={(e) => setEpisodeSize(Number(e.target.value))}
          className="w-full accent-pink-500 cursor-pointer"
        />
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[10px] text-neutral-400 shrink-0">Цвет:</span>
          <input
            id="color_picker_episode"
            type="color"
            value={episodeColor}
            onChange={(e) => setEpisodeColor(e.target.value)}
            className="w-6 h-6 rounded shrink-0 bg-transparent cursor-pointer"
          />
          <input
            id="input_episode_color_hex"
            type="text"
            value={episodeColor}
            onChange={(e) => setEpisodeColor(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-0.5 text-[10px] text-neutral-300 font-mono"
          />
        </div>
      </div>

      {/* Title Field Group */}
      <div className="bg-neutral-950 p-3 rounded-lg border border-neutral-800 space-y-2" id="title_field_group">
        <div className="flex justify-between items-center text-xs text-neutral-400">
          <span className="font-medium">Название тайтла (Мультистрок)</span>
          <span className="font-mono text-pink-400 font-bold">{titleSize}px</span>
        </div>

        {hasCustomLogo && (
          <div className="bg-emerald-950/60 border border-emerald-800/60 rounded-lg p-2.5 space-y-2 text-[11px]">
            <div className="flex items-start gap-2 text-emerald-300">
              <Info className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
              <span>
                <b>Активен кастомный логотип:</b> {hideTitleWhenLogoPresent ? 'текстовое название скрыто с обложки.' : 'отображается вместе с логотипом.'}
              </span>
            </div>
            <label className="flex items-center gap-2 text-emerald-200 cursor-pointer select-none pt-1 border-t border-emerald-800/40">
              <input
                type="checkbox"
                checked={hideTitleWhenLogoPresent}
                onChange={(e) => setHideTitleWhenLogoPresent(e.target.checked)}
                className="w-3.5 h-3.5 accent-emerald-500 rounded cursor-pointer"
              />
              <span>Автоматически скрывать текстовый заголовок</span>
            </label>
          </div>
        )}

        <textarea
          id="textarea_title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          rows={3}
          placeholder="Введите название тайтла... Нажимайте Enter для новой строки"
          className="w-full bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-white text-xs outline-none focus:border-blue-500 resize-none leading-normal font-medium"
        />
        <input
          id="range_title_size"
          type="range"
          min="40"
          max="300"
          value={titleSize}
          onChange={(e) => setTitleSize(Number(e.target.value))}
          className="w-full accent-pink-500 cursor-pointer"
        />
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[10px] text-neutral-400 shrink-0">Цвет:</span>
          <input
            id="color_picker_title"
            type="color"
            value={titleColor}
            onChange={(e) => setTitleColor(e.target.value)}
            className="w-6 h-6 rounded shrink-0 bg-transparent cursor-pointer"
          />
          <input
            id="input_title_color_hex"
            type="text"
            value={titleColor}
            onChange={(e) => setTitleColor(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-0.5 text-[10px] text-neutral-300 font-mono"
          />
        </div>
      </div>

      {/* Text Positioning and Line Spacing */}
      <div className="bg-neutral-950 p-3 rounded-lg border border-neutral-800 space-y-3" id="text_positioning_group">
        <span className="block text-[11px] text-neutral-400 font-bold uppercase tracking-wider">
          Положение текста и переносы
        </span>

        {/* X Offset */}
        <div className="space-y-1">
          <div className="flex justify-between items-center text-xs text-neutral-400">
            <span>Смещение по X</span>
            <span className="font-mono text-pink-400 font-bold">{textX}px</span>
          </div>
          <input
            id="range_text_x"
            type="range"
            min="0"
            max="1920"
            value={textX}
            onChange={(e) => setTextX(Number(e.target.value))}
            className="w-full accent-pink-500 cursor-pointer"
          />
        </div>

        {/* Y Offset */}
        <div className="space-y-1">
          <div className="flex justify-between items-center text-xs text-neutral-400">
            <span>Смещение по Y</span>
            <span className="font-mono text-pink-400 font-bold">{textY}px</span>
          </div>
          <input
            id="range_text_y"
            type="range"
            min="0"
            max="1080"
            value={textY}
            onChange={(e) => setTextY(Number(e.target.value))}
            className="w-full accent-pink-500 cursor-pointer"
          />
        </div>

        {/* Line Spacing */}
        <div className="space-y-1">
          <div className="flex justify-between items-center text-xs text-neutral-400">
            <span>Межстрочный интервал</span>
            <span className="font-mono text-pink-400 font-bold">{lineSpacing}x</span>
          </div>
          <input
            id="range_text_line_spacing"
            type="range"
            min="0.5"
            max="2.5"
            step="0.05"
            value={lineSpacing}
            onChange={(e) => setLineSpacing(Number(e.target.value))}
            className="w-full accent-pink-500 cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
};
