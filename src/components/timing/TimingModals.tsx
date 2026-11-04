import React from 'react';
import {
  RotateCcw,
  Scissors,
  X,
  Loader2,
  Sparkles,
  CheckCircle2,
  Download,
  FolderOpen
} from 'lucide-react';
import { OriginalStemsState } from './timing.types';
import { STEM_SEPARATION_MODELS } from './timing.constants';

export interface TimingResetConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const TimingResetConfirmModal: React.FC<TimingResetConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl max-w-md w-full p-5 shadow-2xl flex flex-col gap-4 text-neutral-100">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-rose-950/80 border border-rose-700/60 flex items-center justify-center text-rose-400 shrink-0 shadow-sm">
            <RotateCcw className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-white">Сбросить тайминг серии и начать сначала?</h3>
            <p className="text-xs text-neutral-300 mt-1.5 leading-relaxed">
              Файл сохранённого состояния в папке серии <strong className="text-amber-300 font-mono">«Тайминг/timing_state.json»</strong> будет удалён. Вкладка будет перезагружена с исходными мастер-дорожками, чтобы вы могли выполнить разметку и удаление тишины заново с чистого листа.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-neutral-800">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 transition"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg flex items-center gap-1.5 transition shadow"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Сбросить и начать сначала</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export interface TimingStemsModalProps {
  isOpen: boolean;
  originalStems: OriginalStemsState;
  selectedStemModel: string;
  onClose: () => void;
  onSelectStemModel: (modelId: string) => void;
  onToggleShowStems: (show: boolean) => void;
  onExportStemsToFolder: (format: 'wav' | 'flac') => void;
  onImportOriginalStem: (type: 'vocals' | 'instrumental') => void;
  onSeparateOriginalStems: (modelId: string) => void;
}

export const TimingStemsModal: React.FC<TimingStemsModalProps> = ({
  isOpen,
  originalStems,
  selectedStemModel,
  onClose,
  onSelectStemModel,
  onToggleShowStems,
  onExportStemsToFolder,
  onImportOriginalStem,
  onSeparateOriginalStems
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-neutral-900 border border-neutral-700/80 rounded-2xl max-w-xl w-full p-6 shadow-2xl flex flex-col gap-5 text-neutral-100 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-neutral-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-950/80 border border-sky-600/50 flex items-center justify-center text-sky-400 shrink-0 shadow-inner">
              <Scissors className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Разделение оригинала (AI Stems)</span>
                <span className="px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-300 border border-sky-500/30 text-[10px] font-mono">
                  Vocals + M&E
                </span>
              </h3>
              <p className="text-xs text-neutral-400 mt-0.5 leading-relaxed">
                Нейросетевое разделение аудиопотока оригинального видео на чистые реплики (Голоса) и инструментал (Фон M&E).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Active Separation Progress Banner */}
        {originalStems.isSeparating && (
          <div className="p-4 rounded-xl bg-sky-950/40 border border-sky-600/50 flex flex-col gap-2.5 animate-pulse">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-sky-300 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
                <span>{originalStems.separationStatus || 'Разделение аудио нейросетью...'}</span>
              </span>
              <span className="font-mono text-sky-300 font-bold">
                {originalStems.separationProgress || 0}%
              </span>
            </div>
            <div className="w-full h-2 bg-neutral-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-sky-500 to-indigo-500 transition-all duration-300 rounded-full"
                style={{ width: `${originalStems.separationProgress || 5}%` }}
              />
            </div>
            <span className="text-[11px] text-neutral-400">
              Пожалуйста, подождите. Модель извлекает чистую речь и инструментальный фон.
            </span>
          </div>
        )}

        {/* Model Selection */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Выберите модель разделения аудио:</span>
          </label>

          <div className="grid grid-cols-1 gap-2">
            {STEM_SEPARATION_MODELS.map(m => (
              <label
                key={m.id}
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition select-none ${
                  selectedStemModel === m.id
                    ? 'bg-sky-950/60 border-sky-500/70 text-white shadow-sm'
                    : 'bg-neutral-800/60 border-neutral-700/60 hover:bg-neutral-800 text-neutral-300'
                }`}
              >
                <input
                  type="radio"
                  name="stemModel"
                  value={m.id}
                  checked={selectedStemModel === m.id}
                  onChange={() => onSelectStemModel(m.id)}
                  disabled={originalStems.isSeparating}
                  className="mt-1 accent-sky-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">{m.title}</span>
                    <span className="px-1.5 py-0.2 rounded bg-neutral-700/60 text-neutral-300 text-[10px] font-mono">
                      {m.badge}
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-400 mt-0.5 leading-snug">
                    {m.desc}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Current Stems Status & Toggle */}
        {originalStems.hasStems && (
          <div className="p-3.5 rounded-xl bg-neutral-800/80 border border-neutral-700/80 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Стемы оригинала сформированы ({originalStems.modelId})</span>
              </span>
              <label className="flex items-center gap-2 cursor-pointer text-xs text-neutral-300 select-none">
                <input
                  type="checkbox"
                  checked={originalStems.hasStems}
                  onChange={(e) => onToggleShowStems(e.target.checked)}
                  className="accent-sky-500 rounded"
                />
                <span>Показывать 2 дорожки на таймлайне</span>
              </label>
            </div>

            <div className="text-[11px] text-neutral-400 font-mono space-y-1">
              <div className="truncate">🎙️ Vocals: {originalStems.vocalsPath || 'Готово'}</div>
              <div className="truncate">🎵 M&E: {originalStems.instrumentalPath || 'Готово'}</div>
            </div>

            <div className="flex items-center gap-2 pt-1 border-t border-neutral-700/60">
              <span className="text-[11px] text-neutral-400">Экспорт стемов:</span>
              <button
                type="button"
                onClick={() => onExportStemsToFolder('wav')}
                className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-neutral-700 hover:bg-neutral-600 text-neutral-200 flex items-center gap-1 transition"
              >
                <Download className="w-3 h-3 text-sky-400" />
                <span>В папку (.wav)</span>
              </button>
              <button
                type="button"
                onClick={() => onExportStemsToFolder('flac')}
                className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-neutral-700 hover:bg-neutral-600 text-neutral-200 flex items-center gap-1 transition"
              >
                <Download className="w-3 h-3 text-emerald-400" />
                <span>В папку (.flac)</span>
              </button>
            </div>
          </div>
        )}

        {/* Manual Import External Stems */}
        <div className="p-3.5 rounded-xl bg-neutral-800/40 border border-neutral-700/50 flex flex-col gap-2">
          <span className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
            <FolderOpen className="w-3.5 h-3.5 text-sky-400" />
            <span>Импортировать готовые файлы стемов вручную:</span>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onImportOriginalStem('vocals')}
              className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 flex items-center justify-center gap-1.5 transition"
            >
              <Download className="w-3.5 h-3.5 text-sky-400" />
              <span>Импорт Голосов (Vocals)...</span>
            </button>
            <button
              type="button"
              onClick={() => onImportOriginalStem('instrumental')}
              className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 flex items-center justify-center gap-1.5 transition"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
              <span>Импорт Фона (M&E)...</span>
            </button>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-neutral-800">
          <span className="text-[11px] text-neutral-400">
            Стемы автоматически передаются во вкладку «Сведение» и «Экспорт ЗР».
          </span>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 transition"
            >
              Закрыть
            </button>
            <button
              type="button"
              onClick={() => onSeparateOriginalStems(selectedStemModel)}
              disabled={originalStems.isSeparating}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-lg flex items-center gap-1.5 transition shadow disabled:opacity-50"
            >
              {originalStems.isSeparating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Разделение...</span>
                </>
              ) : (
                <>
                  <Scissors className="w-3.5 h-3.5" />
                  <span>Разделить нейросетью</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
