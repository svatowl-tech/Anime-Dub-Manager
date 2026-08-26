import React from "react";
import { Upload, Save, CheckSquare, Scissors, MessageSquare, Settings2, Download, FileUp, FileText, Trash2, Languages, Edit3, AlertCircle } from "lucide-react";
import { Episode, RoleAssignment, Participant } from "../../types";

interface AssEditorSidebarProps {
  currentEpisode: Episode | null;
  assignments: RoleAssignment[];
  participants: Participant[];
  status: string;
  checkAll: boolean;
  setCheckAll: (val: boolean) => void;
  isSaving: boolean;
  isSplitting: boolean;
  distributeGroups: boolean;
  setDistributeGroups: (val: boolean) => void;
  distributeMultipleRoles: boolean;
  setDistributeMultipleRoles: (val: boolean) => void;
  saveSignsInAss: boolean;
  setSaveSignsInAss: (val: boolean) => void;
  showSigns: boolean;
  setShowSigns: (val: boolean) => void;
  outputFormat: "ass" | "srt";
  setOutputFormat: (val: "ass" | "srt") => void;
  unassignedLinesCount: number;
  handleAnalyzeExisting: () => void;
  handleStartRecording: () => void;
  handleSplitAss: () => void;
  handleGenerateStartMessage: () => void;
  handleExportMapping: () => void;
  handleImportMapping: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleCheckConsecutiveLines: () => void;
  handleExportFullAss: () => void;
  setExportRole: (role: 'DABBER' | 'SOUND_ENGINEER') => void;
  setIsExportModalOpen: (val: boolean) => void;
  handleClearAssignments: () => void;
  handleTransliterateNames: () => void;
  handlePolivanovToHepburn: () => void;
}

export default function AssEditorSidebar({
  currentEpisode,
  assignments,
  status,
  checkAll,
  setCheckAll,
  isSaving,
  isSplitting,
  distributeGroups,
  setDistributeGroups,
  distributeMultipleRoles,
  setDistributeMultipleRoles,
  saveSignsInAss,
  setSaveSignsInAss,
  showSigns,
  setShowSigns,
  outputFormat,
  setOutputFormat,
  unassignedLinesCount,
  handleAnalyzeExisting,
  handleStartRecording,
  handleSplitAss,
  handleGenerateStartMessage,
  handleExportMapping,
  handleImportMapping,
  handleCheckConsecutiveLines,
  handleExportFullAss,
  setExportRole,
  setIsExportModalOpen,
  handleClearAssignments,
  handleTransliterateNames,
  handlePolivanovToHepburn
}: AssEditorSidebarProps) {
  return (
    <div className="lg:col-span-1 space-y-6">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Upload className="w-5 h-5 text-indigo-400" />
          Загрузка файла
        </h2>

        {currentEpisode?.subPath && (
          <div className="space-y-3">
            <button
              onClick={() => handleAnalyzeExisting()}
              title="Проанализировать загруженный файл субтитров"
              className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
            >
              <Scissors className="w-4 h-4" />
              Анализировать загруженные субтитры
            </button>
            
            {unassignedLinesCount > 0 && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-red-400">Обнаружены неразмеченные реплики</p>
                  <p className="text-xs text-red-400/70 mt-1">
                    В файле {unassignedLinesCount} реплик с пустым полем персонажа. Перейдите во вкладку "Разметка реплик", чтобы исправить это.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {status && (
          <p className="mt-4 text-sm text-neutral-400">{status}</p>
        )}
      </div>

      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Save className="w-5 h-5 text-purple-400" />
          Действия
        </h2>

        <div className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer group">
            <div className="relative flex items-center justify-center w-5 h-5 border border-neutral-600 rounded bg-neutral-950 group-hover:border-indigo-500 transition-colors">
              <input
                type="checkbox"
                className="absolute opacity-0 cursor-pointer"
                checked={checkAll}
                onChange={(e) => setCheckAll(e.target.checked)}
              />
              {checkAll && (
                <CheckSquare className="w-5 h-5 text-indigo-500 absolute" />
              )}
            </div>
            <span className="text-sm text-neutral-300 group-hover:text-white transition-colors">
              Выбрать все (Генерировать для всех)
            </span>
          </label>

          <button
            onClick={handleStartRecording}
            title="Перевести эпизод в статус 'ЗАПИСЬ'"
            disabled={
              !currentEpisode ||
              assignments.length === 0 ||
              isSaving ||
              currentEpisode.status === "RECORDING"
            }
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors shadow-lg shadow-indigo-500/20"
          >
            {isSaving ? "Обработка..." : currentEpisode?.status === "RECORDING" ? "Уже в записи" : "Начать запись (Статус)"}
          </button>

          <div className="h-px bg-neutral-800 my-2" />

          <button
            onClick={handleSplitAss}
            disabled={!currentEpisode?.subPath || assignments.length === 0 || isSplitting}
            className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2"
            title="Разделить реплики по даберам"
          >
            <Scissors className="w-4 h-4" />
            {isSplitting ? "Разделение..." : "Разделить роли"}
          </button>

          <button
            onClick={handleGenerateStartMessage}
            disabled={assignments.length === 0}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2"
            title="Сгенерировать сообщение для начала работы над серией"
          >
            <MessageSquare className="w-4 h-4" />
            Сообщение старт серии
          </button>

          <div className="h-px bg-neutral-800 my-2" />

          <div className="p-4 bg-neutral-950 border border-neutral-800 rounded-lg space-y-3">
            <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider flex items-center gap-2">
              <Settings2 className="w-3 h-3" />
              Настройки разделения
            </h3>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={distributeGroups}
                  onChange={(e) => setDistributeGroups(e.target.checked)}
                  className="w-3.5 h-3.5 bg-neutral-900 border-neutral-700 rounded text-indigo-500 focus:ring-0"
                />
                <span className="text-[11px] text-neutral-400 group-hover:text-neutral-200">Распределять 'гуры/все'</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={distributeMultipleRoles}
                  onChange={(e) => setDistributeMultipleRoles(e.target.checked)}
                  className="w-3.5 h-3.5 bg-neutral-900 border-neutral-700 rounded text-indigo-500 focus:ring-0"
                />
                <span className="text-[11px] text-neutral-400 group-hover:text-neutral-200">Множественные роли</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={saveSignsInAss}
                  onChange={(e) => setSaveSignsInAss(e.target.checked)}
                  className="w-3.5 h-3.5 bg-neutral-900 border-neutral-700 rounded text-indigo-500 focus:ring-0"
                />
                <span className="text-[11px] text-neutral-400 group-hover:text-neutral-200">Сохранять надписи в .ass</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={showSigns}
                  onChange={(e) => setShowSigns(e.target.checked)}
                  className="w-3.5 h-3.5 bg-neutral-900 border-neutral-700 rounded text-indigo-500 focus:ring-0"
                />
                <span className="text-[11px] text-neutral-400 group-hover:text-neutral-200">Показывать надписи</span>
              </label>
              <div className="flex gap-3 pt-1">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="outputFormat"
                    value="ass"
                    checked={outputFormat === "ass"}
                    onChange={() => setOutputFormat("ass")}
                    className="w-3 h-3 text-indigo-500 bg-neutral-900 border-neutral-700"
                  />
                  <span className="text-[11px] text-white">.ass</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="outputFormat"
                    value="srt"
                    checked={outputFormat === "srt"}
                    onChange={() => setOutputFormat("srt")}
                    className="w-3 h-3 text-indigo-500 bg-neutral-900 border-neutral-700"
                  />
                  <span className="text-[11px] text-white">.srt</span>
                </label>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleExportMapping}
              title="Экспортировать распределение ролей в JSON"
              className="flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors border border-neutral-700"
            >
              <Download className="w-4 h-4" />
              Экспорт
            </button>
            <label 
              title="Импортировать распределение ролей из JSON"
              className="flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors border border-neutral-700 cursor-pointer"
            >
              <FileUp className="w-4 h-4" />
              Импорт
              <input type="file" accept=".json" className="hidden" onChange={handleImportMapping} />
            </label>
          </div>

          <button
            onClick={handleCheckConsecutiveLines}
            disabled={!currentEpisode?.subPath || assignments.length === 0}
            className="w-full bg-amber-900/20 hover:bg-amber-900/40 text-amber-400 px-4 py-2.5 rounded-lg font-medium transition-colors border border-amber-900/50 flex items-center justify-center gap-2"
            title="Проверить, нет ли подряд идущих реплик разных персонажей у одного дабера"
          >
            <Edit3 className="w-4 h-4" />
            Проверить склейки
          </button>

          <button
            onClick={handleExportFullAss}
            title="Экспортировать полный файл субтитров с ролями"
            disabled={!currentEpisode?.subPath || assignments.length === 0}
            className="w-full bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors border border-neutral-700 flex items-center justify-center gap-2"
          >
            <FileText className="w-4 h-4" />
            Экспортировать полный ASS
          </button>

          <button
            onClick={() => { setExportRole('DABBER'); setIsExportModalOpen(true); }}
            title="Экспортировать файлы для даберов"
            disabled={!currentEpisode?.subPath || assignments.length === 0}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors border border-indigo-500 flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
          >
            <Download className="w-4 h-4" />
            Экспорт Даберам
          </button>

          <button
            onClick={handleClearAssignments}
            title="Очистить все распределения ролей для этого эпизода"
            disabled={assignments.length === 0}
            className="w-full bg-red-900/20 hover:bg-red-900/40 text-red-400 px-4 py-2.5 rounded-lg font-medium transition-colors border border-red-900/50 flex items-center justify-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Очистить все роли
          </button>

          <button
            onClick={handleTransliterateNames}
            disabled={assignments.length === 0}
            className="w-full bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors border border-neutral-700 flex items-center justify-center gap-2"
            title="Транслитерация имен (Латиница -> Кириллица)"
          >
            <Languages className="w-4 h-4" />
            Транслит (Lat &rarr; Cyr)
          </button>

          <button
            onClick={handlePolivanovToHepburn}
            disabled={assignments.length === 0}
            className="w-full bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors border border-neutral-700 flex items-center justify-center gap-2"
            title="Поливанов -> Хэпберн (Кириллица)"
          >
            <Languages className="w-4 h-4 text-amber-400" />
            Поливанов &rarr; Хэпберн
          </button>
        </div>
      </div>
    </div>
  );
}
