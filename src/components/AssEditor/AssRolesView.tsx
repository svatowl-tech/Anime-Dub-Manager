import React from "react";
import {
  Scissors,
  Upload,
  Save,
  CheckSquare,
  FileText,
  Edit3,
  Download,
  FileUp,
  Languages,
  Trash2,
  Plus,
  MessageSquare,
  Settings2,
  AlertCircle,
  Video,
  Tag,
  User,
} from "lucide-react";
import { Episode, Participant, RoleAssignment } from "../../types";
import { SIGN_KEYWORDS } from "../../constants";

export interface AssRolesViewProps {
  currentEpisode: Episode | null;
  assignments: RoleAssignment[];
  setAssignments: React.Dispatch<React.SetStateAction<RoleAssignment[]>>;
  participants: Participant[];
  actors: string[];
  status: string;
  isSaving: boolean;
  unassignedLinesCount: number;
  checkAll: boolean;
  setCheckAll: (val: boolean) => void;
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
  isSplitting: boolean;
  linkingCharacter: string | null;
  setLinkingCharacter: (val: string | null) => void;
  globalMapping: { characterName: string; dubberId: string; photoUrl?: string; isMain?: boolean }[];
  getCharacterPortrait: (name: string) => string | undefined;
  setInspectingCharacter: (val: string | null) => void;
  setExportRole: (role: 'DABBER' | 'SOUND_ENGINEER') => void;
  setIsExportModalOpen: (val: boolean) => void;
  updateHasUnsavedChanges: (val: boolean) => void;
  handleAnalyzeExisting: () => Promise<RoleAssignment[]>;
  handleStartRecording: () => Promise<void>;
  handleSplitAss: () => Promise<void>;
  handleGenerateStartMessage: () => Promise<void>;
  handleExportMapping: () => void;
  handleImportMapping: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleCheckConsecutiveLines: () => Promise<void>;
  handleExportFullAss: () => Promise<void>;
  handleClearAssignments: () => Promise<void>;
  handleTransliterateNames: () => void;
  handlePolivanovToHepburn: () => void;
  handleExportCharacterSubtitles: (charName: string) => Promise<void>;
  handleLinkAsAlias: (aliasName: string, mainName: string) => Promise<void>;
  handleAddDubberToCharacter: (charName: string) => Promise<void>;
  handleAssignById: (assignmentId: string, dubberId: string) => Promise<void>;
  handleSetSubstitute: (assignmentId: string, substituteId: string) => Promise<void>;
  handleRemoveAssignment: (assignmentId: string, characterName: string) => Promise<void>;
}

export function AssRolesView({
  currentEpisode,
  assignments,
  setAssignments,
  participants,
  actors: _actors,
  status,
  isSaving,
  unassignedLinesCount,
  checkAll,
  setCheckAll,
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
  isSplitting,
  linkingCharacter,
  setLinkingCharacter,
  globalMapping,
  getCharacterPortrait,
  setInspectingCharacter,
  setExportRole,
  setIsExportModalOpen,
  updateHasUnsavedChanges,
  handleAnalyzeExisting,
  handleStartRecording,
  handleSplitAss,
  handleGenerateStartMessage,
  handleExportMapping,
  handleImportMapping,
  handleCheckConsecutiveLines,
  handleExportFullAss,
  handleClearAssignments,
  handleTransliterateNames,
  handlePolivanovToHepburn,
  handleExportCharacterSubtitles,
  handleLinkAsAlias,
  handleAddDubberToCharacter,
  handleAssignById,
  handleSetSubstitute,
  handleRemoveAssignment,
}: AssRolesViewProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1 overflow-y-auto min-h-0 pb-4 pr-2">
      {/* Left Column */}
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
                className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20 cursor-pointer"
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
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors shadow-lg shadow-indigo-500/20 cursor-pointer"
            >
              {isSaving ? "Обработка..." : currentEpisode?.status === "RECORDING" ? "Уже в записи" : "Начать запись (Статус)"}
            </button>

            <div className="h-px bg-neutral-800 my-2" />

            <button
              onClick={handleSplitAss}
              disabled={!currentEpisode?.subPath || assignments.length === 0 || isSplitting}
              className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 cursor-pointer"
              title="Разделить реплики по даберам"
            >
              <Scissors className="w-4 h-4" />
              {isSplitting ? "Разделение..." : "Разделить роли"}
            </button>

            <button
              onClick={handleGenerateStartMessage}
              disabled={assignments.length === 0}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2 cursor-pointer"
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
                className="flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors border border-neutral-700 cursor-pointer"
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
              className="w-full bg-amber-900/20 hover:bg-amber-900/40 text-amber-400 px-4 py-2.5 rounded-lg font-medium transition-colors border border-amber-900/50 flex items-center justify-center gap-2 cursor-pointer"
              title="Проверить, нет ли подряд идущих реплик разных персонажей у одного дабера"
            >
              <Edit3 className="w-4 h-4" />
              Проверить склейки
            </button>

            <button
              onClick={handleExportFullAss}
              title="Экспортировать полный файл субтитров с ролями"
              disabled={!currentEpisode?.subPath || assignments.length === 0}
              className="w-full bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors border border-neutral-700 flex items-center justify-center gap-2 cursor-pointer"
            >
              <FileText className="w-4 h-4" />
              Экспортировать полный ASS
            </button>

            <button
              onClick={() => { setExportRole('DABBER'); setIsExportModalOpen(true); }}
              title="Экспортировать файлы для даберов"
              disabled={!currentEpisode?.subPath || assignments.length === 0}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors border border-indigo-500 flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Экспорт Даберам
            </button>

            <button
              onClick={handleClearAssignments}
              title="Очистить все распределения ролей для этого эпизода"
              disabled={assignments.length === 0}
              className="w-full bg-red-900/20 hover:bg-red-900/40 text-red-400 px-4 py-2.5 rounded-lg font-medium transition-colors border border-red-900/50 flex items-center justify-center gap-2 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              Очистить все роли
            </button>

            <button
              onClick={handleTransliterateNames}
              disabled={assignments.length === 0}
              className="w-full bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors border border-neutral-700 flex items-center justify-center gap-2 cursor-pointer"
              title="Транслитерация имен (Латиница -> Кириллица)"
            >
              <Languages className="w-4 h-4" />
              Транслит (Lat &rarr; Cyr)
            </button>

            <button
              onClick={handlePolivanovToHepburn}
              disabled={assignments.length === 0}
              className="w-full bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors border border-neutral-700 flex items-center justify-center gap-2 cursor-pointer"
              title="Поливанов -> Хэпберн (Кириллица)"
            >
              <Languages className="w-4 h-4 text-amber-400" />
              Поливанов &rarr; Хэпберн
            </button>
          </div>
        </div>
      </div>

      {/* Right Column: Role distribution */}
      <div className="lg:col-span-2">
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl shadow-xl overflow-hidden h-full flex flex-col">
          <div className="p-4 border-b border-neutral-800 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <User className="w-5 h-5 text-indigo-500" />
              <h3 className="font-bold text-white">Распределение ролей</h3>
            </div>
          </div>

          <div className="p-4 flex-1 overflow-y-auto">
            {assignments.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-neutral-500 space-y-3 py-12">
                <Scissors className="w-12 h-12 opacity-20" />
                <p>Загрузите файл для начала работы</p>
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(
                  assignments
                    .filter(a => {
                      if (showSigns) return true;
                      const name = a.characterName.toLowerCase();
                      const signs = ["sign", "signs", "title", "op", "ed", "song", "note", "music", "logo", "staff", "credit", "credits", "надпись", "титры", "инфо", "info"];
                      return !signs.some(s => {
                        if (s === 'op' || s === 'ed') {
                          const regex = new RegExp(`(^|[^a-z])${s}([^a-z]|$)`, 'i');
                          return regex.test(name);
                        }
                        return name.includes(s);
                      }) && !SIGN_KEYWORDS.some(k => name.includes(k.toLowerCase()));
                    })
                    .reduce((acc: Record<string, RoleAssignment[]>, curr: RoleAssignment) => {
                      const dubberId = curr.dubberId || "unassigned";
                      if (!acc[dubberId]) acc[dubberId] = [];
                      acc[dubberId].push(curr);
                      return acc;
                    }, {} as Record<string, RoleAssignment[]>)
                ).map(([dubberId, dubberAssignments]: [string, RoleAssignment[]]) => {
                  const dubber = participants.find(p => p.id === dubberId);
                  const totalLines = dubberAssignments.reduce((sum: number, a: RoleAssignment) => sum + (a.lineCount || 0), 0);

                  return (
                    <div key={dubberId} className="bg-neutral-950 border border-neutral-800 rounded-lg overflow-hidden">
                      <div className="bg-neutral-900/50 px-4 py-2 border-b border-neutral-800 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className={`font-semibold ${dubberId === 'unassigned' ? 'text-amber-500' : 'text-indigo-400'}`}>
                            {dubber?.nickname || (dubberId === 'unassigned' ? "Не распределено" : "Неизвестный")}
                          </span>
                          <span className="text-[10px] bg-neutral-800 text-neutral-400 px-2 py-0.5 rounded-full border border-neutral-700">
                            {totalLines} реплик
                          </span>
                        </div>
                      </div>

                      <div className="p-3 space-y-3">
                        {dubberAssignments.map((assignment: RoleAssignment) => (
                          <div key={assignment.id} className="flex flex-col gap-1.5 p-2 bg-neutral-900/30 rounded border border-neutral-800/50">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {(() => {
                                  const portrait = getCharacterPortrait(assignment.characterName);
                                  return portrait ? (
                                    <div className="relative w-6 h-6 flex-shrink-0">
                                      <img
                                        src={portrait || undefined}
                                        alt=""
                                        className="absolute inset-0 w-6 h-6 rounded-full object-cover border border-neutral-700 z-10"
                                        referrerPolicy="no-referrer"
                                        onError={(e) => {
                                          e.currentTarget.style.display = 'none';
                                          const next = e.currentTarget.nextSibling;
                                          if (next && next instanceof HTMLElement) {
                                            next.classList.remove('hidden');
                                          }
                                        }}
                                      />
                                      <div className="absolute inset-0 w-6 h-6 rounded-full bg-neutral-800 flex items-center justify-center text-[10px] text-neutral-500 border border-neutral-700 hidden">
                                        <User className="w-3 h-3" />
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="w-6 h-6 rounded-full bg-neutral-800 flex items-center justify-center text-[10px] text-neutral-500 border border-neutral-700 flex-shrink-0">
                                      <User className="w-3 h-3" />
                                    </div>
                                  );
                                })()}
                                <span className="text-sm text-neutral-200 font-medium">{assignment.characterName}</span>
                                <span className="text-[10px] text-neutral-500">({assignment.lineCount || 0} реп.)</span>
                                <button
                                  onClick={() => {
                                    const newAssignments = assignments.map(a =>
                                      a.id === assignment.id ? { ...a, isMain: !a.isMain } : a
                                    );
                                    setAssignments(newAssignments);
                                    updateHasUnsavedChanges(true);
                                  }}
                                  className={`text-[10px] px-1.5 py-0.5 rounded transition-colors border cursor-pointer ${
                                    assignment.isMain
                                      ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                                      : 'bg-neutral-800 text-neutral-500 border-neutral-700 hover:text-indigo-400'
                                  }`}
                                >
                                  {assignment.isMain ? 'Главная' : 'Втор.'}
                                </button>
                                <button
                                  onClick={() => setLinkingCharacter(linkingCharacter === assignment.characterName ? null : assignment.characterName)}
                                  className={`text-[10px] px-1 rounded transition-colors cursor-pointer ${
                                    linkingCharacter === assignment.characterName
                                      ? 'bg-amber-500/20 text-amber-400'
                                      : 'text-neutral-600 hover:text-amber-400'
                                  }`}
                                >
                                  Связать
                                </button>
                                <button
                                  onClick={() => setInspectingCharacter(assignment.characterName)}
                                  title="Посмотреть кадры и прослушать голос персонажа"
                                  className="text-[10px] px-1.5 py-0.5 rounded text-indigo-300 hover:text-indigo-200 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 transition-all flex items-center gap-1 cursor-pointer"
                                >
                                  <Video className="w-3 h-3 text-indigo-400" />
                                  <span>Голос и кадр</span>
                                </button>
                                {assignment.characterName.toUpperCase() !== "НАДПИСЬ" && (
                                  <button
                                    onClick={() => handleLinkAsAlias(assignment.characterName, "НАДПИСЬ")}
                                    title="Назначить все реплики этого персонажа как НАДПИСЬ"
                                    className="text-[10px] px-1.5 py-0.5 rounded text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition-all flex items-center gap-1 cursor-pointer"
                                  >
                                    <Tag className="w-3 h-3 text-amber-400" />
                                    <span>Надпись</span>
                                  </button>
                                )}
                                <button
                                  onClick={() => handleExportCharacterSubtitles(assignment.characterName)}
                                  title="Экспортировать субтитры этого персонажа"
                                  className="text-[10px] px-1.5 py-0.5 rounded text-neutral-400 hover:text-indigo-400 hover:bg-neutral-800 transition-all flex items-center gap-1 border border-transparent hover:border-neutral-700 cursor-pointer"
                                >
                                  <Download className="w-3 h-3" />
                                  Экспорт сабов
                                </button>
                              </div>
                              <button
                                onClick={() => handleAddDubberToCharacter(assignment.characterName)}
                                className="text-[10px] text-indigo-500 hover:text-indigo-400 flex items-center gap-0.5 cursor-pointer"
                              >
                                <Plus className="w-2.5 h-2.5" />
                                Даббер
                              </button>
                            </div>

                            {linkingCharacter === assignment.characterName && (
                              <div className="my-2 p-2 bg-neutral-900 border border-amber-500/30 rounded text-[10px]">
                                <p className="text-amber-400 mb-1">Связать с персонажем проекта:</p>
                                <div className="flex flex-wrap gap-1 mb-2">
                                  {globalMapping.map(m => (
                                    <button
                                      key={m.characterName}
                                      onClick={() => handleLinkAsAlias(assignment.characterName, m.characterName)}
                                      className="px-1.5 py-0.5 bg-neutral-800 hover:bg-amber-500/20 text-neutral-300 rounded border border-neutral-700 flex items-center gap-1.5 cursor-pointer"
                                    >
                                      {m.photoUrl ? (
                                        <div className="relative w-4 h-4 shrink-0">
                                          <img
                                            src={m.photoUrl || undefined}
                                            alt=""
                                            className="absolute inset-0 w-4 h-4 rounded-full object-cover border border-neutral-600 z-10"
                                            referrerPolicy="no-referrer"
                                            onError={(e) => {
                                              e.currentTarget.style.display = 'none';
                                              const next = e.currentTarget.nextSibling;
                                              if (next && next instanceof HTMLElement) {
                                                next.classList.remove('hidden');
                                              }
                                            }}
                                          />
                                          <div className="absolute inset-0 w-4 h-4 rounded-full bg-neutral-700 flex items-center justify-center text-[6px] hidden">
                                            <User className="w-2 h-2" />
                                          </div>
                                        </div>
                                      ) : null}
                                      <span>{m.characterName}</span>
                                      {m.dubberId && <span className="text-[8px] text-indigo-400">({participants.find(p => p.id === m.dubberId)?.nickname})</span>}
                                    </button>
                                  ))}
                                </div>

                                <p className="text-neutral-500 mb-1">Или с другим персонажем из субтитров:</p>
                                <div className="flex flex-wrap gap-1">
                                  {Array.from(new Set(assignments.map(a => a.characterName)))
                                    .filter(name => name !== assignment.characterName)
                                    .map((name: string) => (
                                      <button
                                        key={name}
                                        onClick={() => handleLinkAsAlias(assignment.characterName, name)}
                                        className="px-1.5 py-0.5 bg-neutral-800 hover:bg-amber-500/20 text-neutral-300 rounded border border-neutral-700 cursor-pointer"
                                      >
                                        {name}
                                      </button>
                                    ))}
                                </div>
                              </div>
                            )}

                            <div className="flex gap-2">
                              <select
                                value={assignment.dubberId}
                                onChange={(e) => handleAssignById(assignment.id, e.target.value)}
                                className="flex-1 bg-neutral-900 border border-neutral-700 text-white rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
                              >
                                <option value="">-- Выберите дабера --</option>
                                {participants
                                  .filter(user =>
                                    currentEpisode?.project?.assignedDubberIds?.includes(user.id) ||
                                    user.id === assignment.dubberId
                                  )
                                  .map((user) => (
                                    <option key={user.id} value={user.id}>
                                      {user.nickname}
                                    </option>
                                  ))}
                              </select>

                              <select
                                value={assignment.substituteId || ""}
                                onChange={(e) => handleSetSubstitute(assignment.id, e.target.value)}
                                className="w-1/3 bg-neutral-900 border border-neutral-700 text-white rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all"
                              >
                                <option value="">-- Замена --</option>
                                {participants.map((user) => (
                                  <option key={user.id} value={user.id}>
                                    {user.nickname}
                                  </option>
                                ))}
                              </select>

                              <button
                                onClick={() => handleRemoveAssignment(assignment.id, assignment.characterName)}
                                className="p-1 text-neutral-500 hover:text-red-400 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
