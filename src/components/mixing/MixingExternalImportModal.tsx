import React from 'react';
import { Upload, Film, FileText, FileAudio, RefreshCw, X } from 'lucide-react';
import { MixingExternalImportModalProps } from './mixing.types';

export const MixingExternalImportModal: React.FC<MixingExternalImportModalProps> = ({
  isOpen,
  onClose,
  videoPath,
  setVideoPath,
  subPath,
  setSubPath,
  audioPaths,
  setAudioPaths,
  isSubmitting,
  onSubmit,
  onSelectFile
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-xl p-6 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-sky-600/20 text-sky-400 rounded-lg">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-neutral-100">Импорт сторонних файлов в сведение</h2>
              <p className="text-xs text-neutral-400">Сведение серии из файлов на диске без обязательной привязки к базе</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-neutral-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3.5 text-xs">
          {/* External Video Selector */}
          <div className="space-y-1">
            <label className="text-neutral-300 font-medium flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-blue-400">
                <Film className="w-3.5 h-3.5" />
                Видеофайл серии (MP4 / MKV / MOV):
              </span>
              <button
                type="button"
                onClick={() => onSelectFile('video')}
                className="text-[11px] text-blue-400 hover:text-blue-300 underline"
              >
                Обзор...
              </button>
            </label>
            <div className="flex gap-2">
              <input 
                type="text"
                value={videoPath}
                onChange={(e) => setVideoPath(e.target.value)}
                placeholder="Путь к видеофайлу серии..."
                className="flex-1 px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-neutral-200 font-mono text-[11px] focus:outline-none focus:border-sky-500"
              />
              <button
                type="button"
                onClick={() => onSelectFile('video')}
                className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs"
              >
                Выбрать
              </button>
            </div>
          </div>

          {/* External Subtitles Selector */}
          <div className="space-y-1">
            <label className="text-neutral-300 font-medium flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-indigo-400">
                <FileText className="w-3.5 h-3.5" />
                Файл субтитров (ASS / SRT):
              </span>
              <button
                type="button"
                onClick={() => onSelectFile('subtitles')}
                className="text-[11px] text-indigo-400 hover:text-indigo-300 underline"
              >
                Обзор...
              </button>
            </label>
            <div className="flex gap-2">
              <input 
                type="text"
                value={subPath}
                onChange={(e) => setSubPath(e.target.value)}
                placeholder="Путь к субтитрам для автотайминга..."
                className="flex-1 px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-neutral-200 font-mono text-[11px] focus:outline-none focus:border-sky-500"
              />
              <button
                type="button"
                onClick={() => onSelectFile('subtitles')}
                className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs"
              >
                Выбрать
              </button>
            </div>
          </div>

          {/* External Audio Tracks Selector */}
          <div className="space-y-1">
            <label className="text-neutral-300 font-medium flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <FileAudio className="w-3.5 h-3.5" />
                Дорожки дабберов (WAV / MP3 / FLAC):
              </span>
              <button
                type="button"
                onClick={() => onSelectFile('audio')}
                className="text-[11px] text-emerald-400 hover:text-emerald-300 underline"
              >
                Добавить файлы...
              </button>
            </label>

            {audioPaths.length === 0 ? (
              <div 
                onClick={() => onSelectFile('audio')}
                className="border-2 border-dashed border-neutral-800 hover:border-emerald-600/60 rounded-xl p-4 text-center cursor-pointer transition text-neutral-500"
              >
                <Upload className="w-5 h-5 mx-auto mb-1 text-neutral-600" />
                <span>Нажмите, чтобы выбрать аудиодорожки дабберов</span>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-36 overflow-y-auto bg-neutral-950 p-2.5 rounded-lg border border-neutral-800">
                {audioPaths.map((ap, aIdx) => (
                  <div key={aIdx} className="flex items-center justify-between text-[11px] font-mono text-neutral-300 bg-neutral-900 px-2.5 py-1 rounded">
                    <span className="truncate max-w-[420px]">{ap}</span>
                    <button
                      type="button"
                      onClick={() => setAudioPaths(audioPaths.filter((_, i) => i !== aIdx))}
                      className="text-neutral-500 hover:text-red-400 ml-2"
                      title="Удалить из списка"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2.5 pt-2 border-t border-neutral-800">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-medium transition"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={isSubmitting || (!videoPath && !subPath && audioPaths.length === 0)}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white rounded-lg text-xs font-medium flex items-center gap-2 transition"
          >
            {isSubmitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            <span>Импортировать в сведение</span>
          </button>
        </div>
      </div>
    </div>
  );
};
