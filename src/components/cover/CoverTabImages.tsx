import React from 'react';
import { Upload, Image as ImageIcon, X, RotateCcw } from 'lucide-react';
import { Episode } from '../../types';
import { DEFAULT_COVER_SETTINGS } from '../../lib/cover/coverTypes';

interface CoverTabImagesProps {
  currentEpisode: Episode | null;
  bgImage: HTMLImageElement | null;
  watermarkImage: HTMLImageElement | null;
  videoDuration: number;
  videoTime: number;
  onBgUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onWatermarkUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveWatermark: () => void;
  onVideoTimeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  watermarkX: number;
  setWatermarkX: (val: number) => void;
  watermarkY: number;
  setWatermarkY: (val: number) => void;
  watermarkSize: number;
  setWatermarkSize: (val: number) => void;
  watermarkOpacity: number;
  setWatermarkOpacity: (val: number) => void;
}

export const CoverTabImages: React.FC<CoverTabImagesProps> = ({
  currentEpisode,
  bgImage,
  watermarkImage,
  videoDuration,
  videoTime,
  onBgUpload,
  onWatermarkUpload,
  onRemoveWatermark,
  onVideoTimeChange,
  watermarkX,
  setWatermarkX,
  watermarkY,
  setWatermarkY,
  watermarkSize,
  setWatermarkSize,
  watermarkOpacity,
  setWatermarkOpacity,
}) => {
  const applyWatermarkPositionPreset = (x: number, y: number) => {
    setWatermarkX(x);
    setWatermarkY(y);
  };

  const resetWatermarkSettings = () => {
    setWatermarkX(DEFAULT_COVER_SETTINGS.watermarkX);
    setWatermarkY(DEFAULT_COVER_SETTINGS.watermarkY);
    setWatermarkSize(DEFAULT_COVER_SETTINGS.watermarkSize);
    setWatermarkOpacity(DEFAULT_COVER_SETTINGS.watermarkOpacity);
  };

  return (
    <div className="space-y-4" id="panel_images">
      <h3 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
        <Upload className="w-4 h-4 text-blue-400" />
        Управление медиа-файлами
      </h3>

      <div>
        <label className="block text-xs text-neutral-400 mb-2 font-medium">
          Загрузить фон (скриншот)
        </label>
        <label
          id="upload_bg_label"
          className="w-full h-24 border-2 border-dashed border-neutral-700 bg-neutral-850 hover:bg-neutral-800 hover:border-blue-500 transition-colors flex flex-col items-center justify-center rounded-lg cursor-pointer"
        >
          <input
            id="input_upload_bg"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onBgUpload}
          />
          <ImageIcon className="w-6 h-6 text-neutral-500 mb-1" />
          <span className="text-xs text-neutral-300">Выбрать файл (.jpg, .png)</span>
        </label>
        {bgImage && !currentEpisode?.rawPath && (
          <p className="text-xs text-green-400 mt-2 font-medium">✓ Кастомный фон загружен успешно</p>
        )}

        {currentEpisode?.rawPath && (
          <div className="mt-4 bg-neutral-950 p-3 rounded-lg border border-neutral-800" id="video_frame_section">
            <label className="block text-xs text-neutral-400 flex justify-between font-medium">
              <span>Кадр из видео:</span>
              <span className="text-blue-400 font-mono font-bold">
                {Math.floor(videoTime / 60)}:
                {Math.floor(videoTime % 60)
                  .toString()
                  .padStart(2, '0')}
              </span>
            </label>
            <input
              id="video_time_range"
              type="range"
              min="0"
              max={videoDuration || 1400}
              value={videoTime}
              onChange={onVideoTimeChange}
              className="w-full mt-2 accent-blue-500 cursor-pointer"
            />
            <p className="text-[10px] text-neutral-500 mt-1 leading-tight">
              Перетащите ползунок для авто-извлечения кадра из оригинала серии
            </p>
          </div>
        )}
      </div>

      <div className="pt-2">
        <label className="block text-xs text-neutral-400 mb-2 font-medium">
          Водяной знак студии (копирайт)
        </label>
        <label
          id="upload_watermark_label"
          className="w-full h-16 border-2 border-dashed border-neutral-700 bg-neutral-850 hover:bg-neutral-800 hover:border-pink-500 transition-colors flex flex-col items-center justify-center rounded-lg cursor-pointer"
        >
          <input
            id="input_upload_watermark"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onWatermarkUpload}
          />
          <span className="text-xs text-neutral-300">Загрузить логотип копирайта</span>
        </label>
        {watermarkImage && (
          <div
            className="mt-2 text-xs bg-neutral-950 p-3 rounded-lg border border-neutral-800 space-y-3"
            id="watermark_info"
          >
            <div className="flex items-center justify-between pb-2 border-b border-neutral-900">
              <div className="flex items-center gap-2 truncate">
                <div className="w-7 h-7 rounded bg-neutral-900 border border-neutral-800 flex items-center justify-center overflow-hidden shrink-0">
                  <img
                    src={watermarkImage.src}
                    alt="Watermark preview"
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
                <span className="text-pink-400 font-medium truncate">
                  Лого: {watermarkImage.width}x{watermarkImage.height} px
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={resetWatermarkSettings}
                  title="Сбросить размер и положение по умолчанию"
                  className="text-neutral-400 hover:text-neutral-200 p-1 rounded hover:bg-neutral-900 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  id="btn_remove_watermark"
                  onClick={onRemoveWatermark}
                  title="Удалить водяной знак"
                  className="text-red-400 hover:text-red-300 p-1 rounded hover:bg-neutral-900 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Quick Corner Presets */}
            <div className="space-y-1.5">
              <span className="text-[11px] text-neutral-400 block">Быстрое положение на экране:</span>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => applyWatermarkPositionPreset(3, 6)}
                  className={`px-2 py-1 rounded text-[10px] font-medium border transition ${
                    watermarkX === 3 && watermarkY === 6
                      ? 'bg-pink-600/20 border-pink-500 text-pink-300'
                      : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  ↖ Сверху слева
                </button>
                <button
                  type="button"
                  onClick={() => applyWatermarkPositionPreset(50, 50)}
                  className={`px-2 py-1 rounded text-[10px] font-medium border transition ${
                    watermarkX === 50 && watermarkY === 50
                      ? 'bg-pink-600/20 border-pink-500 text-pink-300'
                      : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  • По центру
                </button>
                <button
                  type="button"
                  onClick={() => applyWatermarkPositionPreset(97, 6)}
                  className={`px-2 py-1 rounded text-[10px] font-medium border transition ${
                    watermarkX === 97 && watermarkY === 6
                      ? 'bg-pink-600/20 border-pink-500 text-pink-300'
                      : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  ↗ Сверху справа
                </button>
                <button
                  type="button"
                  onClick={() => applyWatermarkPositionPreset(3, 94)}
                  className={`px-2 py-1 rounded text-[10px] font-medium border transition ${
                    watermarkX === 3 && watermarkY === 94
                      ? 'bg-pink-600/20 border-pink-500 text-pink-300'
                      : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  ↙ Снизу слева
                </button>
                <button
                  type="button"
                  onClick={() => applyWatermarkPositionPreset(50, 94)}
                  className={`px-2 py-1 rounded text-[10px] font-medium border transition ${
                    watermarkX === 50 && watermarkY === 94
                      ? 'bg-pink-600/20 border-pink-500 text-pink-300'
                      : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  ↓ Снизу центр
                </button>
                <button
                  type="button"
                  onClick={() => applyWatermarkPositionPreset(97, 94)}
                  className={`px-2 py-1 rounded text-[10px] font-medium border transition ${
                    watermarkX === 97 && watermarkY === 94
                      ? 'bg-pink-600/20 border-pink-500 text-pink-300'
                      : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  ↘ Снизу справа
                </button>
              </div>
            </div>

            {/* Position & Size Sliders */}
            <div className="space-y-2.5" id="watermark_adjustments">
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-neutral-400">
                  <span>Размер (ширина)</span>
                  <span className="font-mono text-pink-400 font-bold">{watermarkSize} px</span>
                </div>
                <input
                  id="range_watermark_size"
                  type="range"
                  min="40"
                  max="1200"
                  value={watermarkSize}
                  onChange={(e) => setWatermarkSize(Number(e.target.value))}
                  className="w-full accent-pink-500 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-neutral-400">
                  <span>Положение по горизонтали (X)</span>
                  <span className="font-mono text-pink-400 font-bold">{watermarkX}%</span>
                </div>
                <input
                  id="range_watermark_x"
                  type="range"
                  min="-10"
                  max="110"
                  value={watermarkX}
                  onChange={(e) => setWatermarkX(Number(e.target.value))}
                  className="w-full accent-pink-500 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-neutral-400">
                  <span>Положение по вертикали (Y)</span>
                  <span className="font-mono text-pink-400 font-bold">{watermarkY}%</span>
                </div>
                <input
                  id="range_watermark_y"
                  type="range"
                  min="-10"
                  max="110"
                  value={watermarkY}
                  onChange={(e) => setWatermarkY(Number(e.target.value))}
                  className="w-full accent-pink-500 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-neutral-400">
                  <span>Непрозрачность</span>
                  <span className="font-mono text-pink-400 font-bold">{watermarkOpacity}%</span>
                </div>
                <input
                  id="range_watermark_opacity"
                  type="range"
                  min="10"
                  max="100"
                  value={watermarkOpacity}
                  onChange={(e) => setWatermarkOpacity(Number(e.target.value))}
                  className="w-full accent-pink-500 cursor-pointer"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
