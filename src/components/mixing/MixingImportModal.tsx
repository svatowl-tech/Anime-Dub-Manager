import React from 'react';
import { Download, Clock, Activity, Folder, RefreshCw, X } from 'lucide-react';
import { ipcSafe } from '../../lib/ipcSafe';
import { MixingImportModalProps } from './mixing.types';

export const MixingImportModal: React.FC<MixingImportModalProps> = ({
  isOpen,
  onClose,
  importSource,
  setImportSource,
  importAutoTiming,
  setImportAutoTiming,
  importAutoFixes,
  setImportAutoFixes,
  importSubtitles,
  setImportSubtitles,
  customTargetDir,
  setCustomTargetDir,
  workingDir,
  isImporting,
  importProgress,
  importStatusMessage,
  onStartImport
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-600/20 text-blue-400 rounded-lg">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-neutral-100">Импорт файлов звукорежиссера</h2>
              <p className="text-xs text-neutral-400">Экспорт по методике QA-проверки прямо в папку сведения</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-neutral-400 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3 text-xs">
          {/* Source Selector */}
          <div>
            <label className="text-neutral-300 font-medium block mb-1">
              Источник материалов для сведения:
            </label>
            <div className="grid grid-cols-2 gap-2 p-1 bg-neutral-950 rounded-xl border border-neutral-800">
              <button
                type="button"
                onClick={() => {
                  setImportSource('timing');
                  setImportAutoTiming(false);
                }}
                className={`py-2 px-3 rounded-lg font-medium flex items-center justify-center gap-2 transition ${
                  importSource === 'timing' 
                    ? 'bg-amber-600/20 text-amber-300 border border-amber-500/40' 
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>Из Тайминга видео</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setImportSource('qa');
                  setImportAutoTiming(true);
                }}
                className={`py-2 px-3 rounded-lg font-medium flex items-center justify-center gap-2 transition ${
                  importSource === 'qa' 
                    ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40' 
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <Activity className="w-3.5 h-3.5 text-blue-400" />
                <span>Из QA-проверки</span>
              </button>
            </div>
          </div>

          {/* Target Directory */}
          <div>
            <label className="text-neutral-300 font-medium block mb-1">
              Целевая папка сведения:
            </label>
            <div className="flex gap-2">
              <input 
                type="text"
                value={customTargetDir}
                onChange={(e) => setCustomTargetDir(e.target.value)}
                placeholder={workingDir || "По умолчанию: папка Сведения в папке серии"}
                className="flex-1 px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-neutral-200 font-mono text-xs focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    const selected = await ipcSafe.invoke('select-directory');
                    if (selected) {
                      setCustomTargetDir(selected);
                    }
                  } catch (err) {}
                }}
                className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs transition-colors shrink-0 flex items-center gap-1.5"
                title="Выбрать папку на диске"
              >
                <Folder className="w-3.5 h-3.5" />
                <span>Обзор...</span>
              </button>
            </div>
            {workingDir && !customTargetDir && (
              <p className="text-[10px] text-neutral-400 mt-1 font-mono truncate">
                Папка по умолчанию: {workingDir}
              </p>
            )}
          </div>

          {/* Options Toggles */}
          <div className="p-3 bg-neutral-950 rounded-lg border border-neutral-800 space-y-2.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input 
                type="checkbox"
                checked={importAutoTiming}
                onChange={(e) => setImportAutoTiming(e.target.checked)}
                className="rounded accent-blue-500"
              />
              <span>Включить автоматический автотайминг поверх импорта</span>
            </label>
            <p className="text-[10px] text-neutral-500 ml-5 -mt-1">
              {importSource === 'timing' 
                ? 'При импорте из Тайминга рекомендуется оставить выключенным, чтобы сохранить ручные правки.' 
                : 'Автоматически подогнать фразы к таймингам субтитров ASS.'}
            </p>

            <label className="flex items-center gap-2 cursor-pointer pt-1">
              <input 
                type="checkbox"
                checked={importAutoFixes}
                onChange={(e) => setImportAutoFixes(e.target.checked)}
                className="rounded accent-blue-500"
              />
              <span>Бесшовное вшитие фиксов и очистка хвостов реплик</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input 
                type="checkbox"
                checked={importSubtitles}
                onChange={(e) => setImportSubtitles(e.target.checked)}
                className="rounded accent-blue-500"
              />
              <span>Экспорт размеченных субтитров с ролями для звукорежиссера</span>
            </label>
          </div>

          {/* Progress message */}
          {isImporting && (
            <div className="space-y-1.5 pt-2">
              <div className="w-full bg-neutral-800 h-2 rounded-full overflow-hidden">
                <div 
                  className="bg-blue-500 h-full transition-all duration-300"
                  style={{ width: `${importProgress || 15}%` }}
                />
              </div>
              <p className="text-[11px] text-blue-400 font-mono text-center">
                {importStatusMessage || 'Импорт материалов...'}
              </p>
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div className="flex justify-end gap-2.5 pt-2">
          <button
            onClick={onClose}
            disabled={isImporting}
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-medium transition"
          >
            Отмена
          </button>
          <button
            onClick={onStartImport}
            disabled={isImporting}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium flex items-center gap-2 transition"
          >
            {isImporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            <span>Начать импорт</span>
          </button>
        </div>
      </div>
    </div>
  );
};
