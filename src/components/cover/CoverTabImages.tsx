import React from 'react';
import { Upload, Image as ImageIcon, X } from 'lucide-react';
import { Episode } from '../../types';

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
}) => {
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
            className="mt-2 flex items-center justify-between text-xs bg-neutral-950 p-2 rounded border border-neutral-800"
            id="watermark_info"
          >
            <span className="text-neutral-400 truncate">
              Лого: {watermarkImage.width}x{watermarkImage.height} px
            </span>
            <button
              id="btn_remove_watermark"
              onClick={onRemoveWatermark}
              title="Удалить"
              className="text-red-400 hover:text-red-300 p-1 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
