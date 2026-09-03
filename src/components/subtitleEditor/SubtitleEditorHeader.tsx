import React from "react";
import { Loader2, Wrench, Clock, Layers, Undo, Redo, RefreshCcw, Eye, EyeOff, AlertCircle, Sparkles } from "lucide-react";

interface SubtitleEditorHeaderProps {
  loading: boolean;
  saving: boolean;
  status: string;
  unassignedCount: number;
  undoDisabled: boolean;
  redoDisabled: boolean;
  autoSave: boolean;
  showSigns: boolean;
  onRefresh: () => void;
  onAutoFix: () => void;
  onOpenHonorificsModal: () => void;
  onShiftTime: () => void;
  onOpenMergeModal: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleAutoSave: () => void;
  onToggleShowSigns: () => void;
}

export const SubtitleEditorHeader: React.FC<SubtitleEditorHeaderProps> = ({
  loading,
  saving,
  status,
  unassignedCount,
  undoDisabled,
  redoDisabled,
  autoSave,
  showSigns,
  onRefresh,
  onAutoFix,
  onOpenHonorificsModal,
  onShiftTime,
  onOpenMergeModal,
  onUndo,
  onRedo,
  onToggleAutoSave,
  onToggleShowSigns,
}) => {
  return (
    <div className="flex items-center justify-between p-3 border-b border-neutral-800 bg-neutral-900 shrink-0">
      <div className="flex items-center gap-4 flex-wrap">
        <span className="text-sm font-semibold text-neutral-300">Реплики</span>
        <button
          onClick={onRefresh}
          disabled={loading || saving}
          title="Обновить список субтитров"
          className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-xs transition-colors border border-neutral-700 flex items-center gap-2 cursor-pointer disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Обновить"}
        </button>
        <button
          onClick={onAutoFix}
          disabled={loading || saving}
          title="Исправить частые ошибки (удалить пустые строки, исправить наложения, удалить двойные пробелы) как в Subtitle Edit"
          className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-xs transition-colors border border-neutral-700 flex items-center gap-2 cursor-pointer disabled:opacity-50"
        >
          <Wrench className="w-3.5 h-3.5 text-blue-400" />
          Авто-Фикс
        </button>
        <button
          onClick={onOpenHonorificsModal}
          disabled={loading || saving}
          title="Удаление японских обращений (-кун, -тян, -сан, -сама, -сэнсэй, -сэмпай...)"
          className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-xs transition-colors border border-neutral-700 flex items-center gap-2 cursor-pointer disabled:opacity-50"
        >
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
          Фильтр обращений
        </button>
        <button
          onClick={onShiftTime}
          disabled={loading || saving}
          title="Сдвиг времени для всех реплик (или только выделенных) как в Subtitle Edit"
          className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-xs transition-colors border border-neutral-700 flex items-center gap-2 cursor-pointer disabled:opacity-50"
        >
          <Clock className="w-3.5 h-3.5 text-purple-400" />
          Сдвиг тайминга
        </button>
        <button
          onClick={onOpenMergeModal}
          disabled={loading || saving}
          title="Мульти-импорт: слияние субтитров из разных файлов (текст, оформление, персонажи)"
          className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-xs transition-colors border border-neutral-700 flex items-center gap-2 cursor-pointer disabled:opacity-50"
        >
          <Layers className="w-3.5 h-3.5 text-emerald-400" />
          Слияние сабов
        </button>
        <span className="text-xs text-neutral-400">{status}</span>
        {unassignedCount > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-red-500/10 border border-red-500/20 rounded-full text-red-400 text-xs font-bold animate-pulse">
            <AlertCircle className="w-3.5 h-3.5" />
            Не размечено: {unassignedCount}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onUndo}
          disabled={undoDisabled}
          className="p-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-30 text-white rounded-lg transition-colors border border-neutral-700 flex items-center justify-center cursor-pointer"
          title="Назад (Ctrl+Z)"
        >
          <Undo className="w-4 h-4" />
        </button>
        <button
          onClick={onRedo}
          disabled={redoDisabled}
          className="p-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-30 text-white rounded-lg transition-colors border border-neutral-700 flex items-center justify-center cursor-pointer"
          title="Вперед (Ctrl+Y)"
        >
          <Redo className="w-4 h-4" />
        </button>
        <button
          onClick={onToggleAutoSave}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border cursor-pointer ${
            autoSave 
              ? "bg-emerald-600/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-600/30" 
              : "bg-neutral-800 text-neutral-400 border-neutral-700 hover:bg-neutral-700 hover:text-white"
          }`}
          title={autoSave ? "Автосохранение включено" : "Автосохранение выключено"}
        >
          <RefreshCcw className={`w-3.5 h-3.5 ${autoSave ? 'animate-[spin_4s_linear_infinite]' : ''}`} />
          {autoSave ? "Авто-Сейв" : "Без Авто-Сейва"}
        </button>
        <button
          onClick={onToggleShowSigns}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border cursor-pointer ${
            showSigns 
              ? "bg-amber-600/20 text-amber-400 border-amber-500/30 hover:bg-amber-600/30" 
              : "bg-neutral-800 text-neutral-400 border-neutral-700 hover:bg-neutral-700 hover:text-white"
          }`}
          title={showSigns ? "Скрыть технические субтитры" : "Показать технические субтитры"}
        >
          {showSigns ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          {showSigns ? "Надписи: ВКЛ" : "Надписи: ВЫКЛ"}
        </button>
      </div>
    </div>
  );
};
