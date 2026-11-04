import React from 'react';
import { Bookmark, RefreshCw, Trash2, Check, Download, Upload } from 'lucide-react';
import { PipelinePreset } from '../../types';
import { MixingPresetsModalProps, MixingSavePresetModalProps } from './mixing.types';

export const MixingPresetsModal: React.FC<MixingPresetsModalProps> = ({
  isOpen,
  onClose,
  pipelinePresets,
  isLoadingPresets,
  onApplyPreset,
  onDeletePreset,
  onOpenSavePresetModal,
  onExportToFile,
  onImportFromFile,
  getModuleMeta
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-2xl p-6 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-600/20 text-amber-400 rounded-lg">
              <Bookmark className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-neutral-100">Пресеты всей цепочки сведения</h2>
              <p className="text-xs text-neutral-400">Готовые студийные связки и ваши сохраненные конфигурации конвейера</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-neutral-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {isLoadingPresets ? (
            <div className="text-center py-8 text-neutral-500 flex items-center justify-center gap-2 text-xs">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Загрузка пресетов...</span>
            </div>
          ) : pipelinePresets.length === 0 ? (
            <div className="text-center py-8 text-neutral-500 text-xs">
              Нет доступных пресетов
            </div>
          ) : (
            pipelinePresets.map((preset) => (
              <div
                key={preset.id}
                onClick={() => onApplyPreset(preset)}
                className="p-4 bg-neutral-950/80 hover:bg-neutral-800/80 border border-neutral-800 hover:border-amber-500/60 rounded-xl cursor-pointer transition space-y-2 group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xs font-bold text-neutral-100 group-hover:text-amber-300 transition">
                        {preset.name}
                      </h3>
                      {preset.isBuiltIn ? (
                        <span className="text-[10px] px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded">
                          Встроенный
                        </span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded">
                          Пользовательский
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed">
                      {preset.description || 'Пользовательский пресет конвейера'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {!preset.isBuiltIn && (
                      <button
                        onClick={(e) => onDeletePreset(preset.id, e)}
                        className="p-1.5 text-neutral-500 hover:text-red-400 hover:bg-red-500/10 rounded transition"
                        title="Удалить пресет"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => onApplyPreset(preset)}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Применить</span>
                    </button>
                  </div>
                </div>

                {/* Steps Badge Chain */}
                <div className="flex flex-wrap gap-1.5 pt-1 border-t border-neutral-800/60">
                  {preset.pipeline.map((step, sIdx) => {
                    const m = getModuleMeta(step.moduleId);
                    return (
                      <span 
                        key={sIdx}
                        className="text-[10px] px-2 py-0.5 bg-neutral-900 text-neutral-300 rounded border border-neutral-800 font-mono"
                      >
                        {sIdx + 1}. {m?.title || step.moduleId}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-neutral-800">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onClose();
                onOpenSavePresetModal();
              }}
              className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-medium flex items-center gap-1.5 transition"
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span>Сохранить цепочку в пресет</span>
            </button>
            <button
              onClick={onExportToFile}
              className="px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-medium flex items-center gap-1 transition"
              title="Экспорт пресета конвейера в JSON"
            >
              <Download className="w-3.5 h-3.5" />
              <span>В файл</span>
            </button>
            <button
              onClick={onImportFromFile}
              className="px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-medium flex items-center gap-1 transition"
              title="Импорт пресета конвейера из JSON"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Из файла</span>
            </button>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-medium transition"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};

export const MixingSavePresetModal: React.FC<MixingSavePresetModalProps> = ({
  isOpen,
  onClose,
  name,
  setName,
  desc,
  setDesc,
  onSave
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-600/20 text-amber-400 rounded-lg">
              <Bookmark className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-neutral-100">Сохранить пресет всей цепочки</h2>
              <p className="text-xs text-neutral-400">Сохраняет порядок всех модулей и текущие значения настроек</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-neutral-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <label className="text-neutral-300 font-medium block mb-1">
              Название пресета:
            </label>
            <input 
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Мой студийный конвейер 2026"
              className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-neutral-200 text-xs focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="text-neutral-300 font-medium block mb-1">
              Описание пресета:
            </label>
            <textarea 
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Краткое примечание: для каких сериалов, микрофонов или состава голосов"
              rows={3}
              className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-neutral-200 text-xs focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2.5 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-medium transition"
          >
            Отмена
          </button>
          <button
            onClick={onSave}
            disabled={!name.trim()}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center gap-2 transition"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Сохранить пресет</span>
          </button>
        </div>
      </div>
    </div>
  );
};
