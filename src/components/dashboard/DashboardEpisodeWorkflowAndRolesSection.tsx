import React from "react";
import {
  X,
  CheckCircle2,
  Clock,
  AlertCircle,
  Mic,
  UserPlus,
  MessageSquare,
  Calendar,
  FileText,
  Database,
  Loader2,
  FileVideo,
  Activity,
  Users,
  Globe,
  Languages,
  RefreshCw,
  Youtube,
  Layers,
  Film
} from "lucide-react";
import { Participant, Project, Episode, EpisodeStatus } from "../../types";
import { ipcSafe } from "../../lib/ipcSafe";
import { formatDeadline, formatFullDeadline } from "../../lib/templates";
import { SubFileItem } from "../MultiSubtitleMergeModal";

export const STATUS_LABELS: Record<EpisodeStatus, string> = {
  UPLOAD: 'Загрузка ресурсов',
  ROLES: 'Распределение ролей',
  RECORDING: 'Запись звука',
  QA: 'Проверка качества',
  FIXES: 'Правки',
  SOUND_ENGINEERING: 'Звукорежиссура',
  FINISHED: 'Завершено'
};

export const ROLE_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Ожидает',
  RECORDED: 'Записано',
  APPROVED: 'Одобрено',
  REJECTED: 'Отклонено',
  FIXES_NEEDED: 'Нужны правки'
};

export interface DashboardEpisodeWorkflowAndRolesSectionProps {
  selectedProject: Project | undefined;
  currentEpisode: Episode;
  participants: Participant[];
  onRefresh: () => void;
  onNavigate?: (tab: string) => void;
  nextEpisodeDate: string | null;
  isUploading: boolean;
  transcodingProgress: number | null;
  transcodingTasks: Record<string, { id: string; progress: number; eta: number | null; title?: string; episodeId?: string }>;
  status: string;
  isHardsubEnabled: boolean;
  setIsHardsubEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setIsEpisodeDeadlineModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsYoutubeModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsTextToSubModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setMultiMergeInitialFiles: React.Dispatch<React.SetStateAction<SubFileItem[]>>;
  setIsMultiSubMergeModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsAssignModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setExportRole: React.Dispatch<React.SetStateAction<"DABBER" | "SOUND_ENGINEER">>;
  setIsExportModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setTrackDeadlineModalState: React.Dispatch<React.SetStateAction<{
    isOpen: boolean;
    dubberId?: string;
    dubber?: Participant;
    characters: string[];
    assignmentIds: string[];
    currentDeadline?: string;
  }>>;
  handleDeleteEpisode: () => void;
  handleFinishEpisode: () => void;
  handleFileSelect: (type: "RAW" | "SUB") => void;
  handleTranscodeCurrentEpisodeMkv: () => void;
  openTorrentDownloadModal: () => void;
  openSubtitleDownloadModal: () => void;
  handleExtractSubtitlesFromEpisodeRaw: () => void;
  handleGenerateReminderMessage: () => void;
}

export const DashboardEpisodeWorkflowAndRolesSection: React.FC<DashboardEpisodeWorkflowAndRolesSectionProps> = ({
  selectedProject,
  currentEpisode,
  participants,
  onRefresh,
  onNavigate,
  nextEpisodeDate,
  isUploading,
  transcodingProgress,
  transcodingTasks,
  status,
  isHardsubEnabled,
  setIsHardsubEnabled,
  setIsEpisodeDeadlineModalOpen,
  setIsYoutubeModalOpen,
  setIsTextToSubModalOpen,
  setMultiMergeInitialFiles,
  setIsMultiSubMergeModalOpen,
  setIsAssignModalOpen,
  setExportRole,
  setIsExportModalOpen,
  setTrackDeadlineModalState,
  handleDeleteEpisode,
  handleFinishEpisode,
  handleFileSelect,
  handleTranscodeCurrentEpisodeMkv,
  openTorrentDownloadModal,
  openSubtitleDownloadModal,
  handleExtractSubtitlesFromEpisodeRaw,
  handleGenerateReminderMessage
}) => {
  return (
    <div className="space-y-8">
      {/* Episode Status Header */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-white mb-1">
              Серия {currentEpisode.number}
              {currentEpisode.title && (
                <span className="text-lg font-medium text-neutral-400 ml-3 font-sans">
                  — {currentEpisode.title}
                </span>
              )}
            </h2>
            <button 
              onClick={handleDeleteEpisode}
              className="p-1 text-neutral-500 hover:text-red-400 transition-colors"
              title="Удалить серию"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex gap-2">
              {currentEpisode.yandexUrl && (
                <a 
                  href={currentEpisode.yandexUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2 py-1 bg-yellow-500/20 text-yellow-500 border border-yellow-500/30 hover:bg-yellow-500/30 rounded text-xs transition-colors flex items-center gap-1 font-bold"
                  title="Ссылка на материалы на Яндексе"
                >
                  <Database className="w-3.5 h-3.5" />
                  Яндекс Диск
                </a>
              )}
              <button onClick={() => { setExportRole('DABBER'); setIsExportModalOpen(true); }} className="px-2 py-1 bg-green-600 hover:bg-green-500 text-white rounded text-xs transition-colors">Экспорт Даберам</button>
              <button onClick={() => { setExportRole('SOUND_ENGINEER'); setIsExportModalOpen(true); }} className="px-2 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded text-xs transition-colors">Экспорт Звукарю</button>
              <button 
                onClick={() => setIsEpisodeDeadlineModalOpen(true)}
                className="px-2.5 py-1 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 rounded text-xs transition-colors flex items-center gap-1.5 font-bold cursor-pointer"
                title="Настроить дедлайн серии и правок вручную"
              >
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                Дедлайн серии
              </button>
              <button 
                onClick={handleFinishEpisode}
                disabled={currentEpisode.status === 'FINISHED'}
                className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 text-white rounded text-xs font-bold transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Завершить серию
              </button>
            </div>
          </div>
          <div className="flex items-center gap-4 text-neutral-400 text-sm">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              <span>Статус: <span className="text-blue-400 font-medium">{STATUS_LABELS[currentEpisode.status]}</span></span>
            </div>
            <div className="flex items-center gap-2">
              <Mic className="w-4 h-4" />
              <span>Звукореж: <span className="text-purple-400 font-medium">{participants.find(p => p.id === selectedProject?.soundEngineerId)?.nickname || 'Не назначен'}</span></span>
            </div>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              <span>Даберы: <span className="text-emerald-400 font-medium">{Array.isArray(selectedProject?.assignedDubberIds) && selectedProject.assignedDubberIds.length > 0 ? selectedProject.assignedDubberIds.map(id => participants.find(p => p.id === id)?.nickname).filter(Boolean).join(', ') : 'Не назначены'}</span></span>
            </div>
            <button
              type="button"
              onClick={() => setIsEpisodeDeadlineModalOpen(true)}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-neutral-950/60 hover:bg-neutral-800 border border-neutral-800 hover:border-red-500/40 text-neutral-300 transition-all cursor-pointer group text-left"
              title="Нажмите, чтобы вручную настроить дедлайн серии и правок"
            >
              <Calendar className="w-4 h-4 text-red-400 group-hover:scale-110 transition-transform" />
              <span>Дедлайн: <span className="text-red-400 font-medium underline decoration-red-500/30 underline-offset-2">{formatFullDeadline(currentEpisode.deadline, currentEpisode.fixesDeadline)}</span></span>
              <Clock className="w-3 h-3 text-neutral-500 group-hover:text-red-400 transition-colors ml-0.5" />
            </button>
            {currentEpisode.airingDate && (
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-500" />
                <span>Эфир: <span className="text-emerald-400 font-medium">{currentEpisode.airingDate}</span></span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              <span>Дата след. серии: <span className="text-orange-400 font-medium">{nextEpisodeDate || 'Не определена'}</span></span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-sm text-neutral-400">Ориг. название</div>
            <div className="text-white font-medium">{selectedProject?.originalTitle || 'Не задано'}</div>
          </div>
          {/* Workflow Stepper */}
          <div className="flex items-center gap-1">
            {(Object.keys(STATUS_LABELS) as EpisodeStatus[]).map((epStatus, idx) => (
              <React.Fragment key={epStatus}>
                <div 
                  className={`w-3 h-3 rounded-full ${
                    currentEpisode.status === epStatus ? 'bg-blue-500 ring-4 ring-blue-500/20' : 
                    idx < Object.keys(STATUS_LABELS).indexOf(currentEpisode.status) ? 'bg-green-500' : 'bg-neutral-800'
                  }`}
                  title={STATUS_LABELS[epStatus]}
                />
                {idx < Object.keys(STATUS_LABELS).length - 1 && (
                  <div className={`w-4 h-px ${idx < Object.keys(STATUS_LABELS).indexOf(currentEpisode.status) ? 'bg-green-500' : 'bg-neutral-800'}`} />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* File Upload Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <FileVideo className="w-5 h-5 text-blue-400" />
              Видео файл (RAW)
              <button 
                onClick={() => setIsYoutubeModalOpen(true)}
                className="ml-2 text-red-500 hover:text-red-400 transition-colors p-1 bg-red-500/10 hover:bg-red-500/20 rounded-md"
                title="Скачать с YouTube"
              >
                <Youtube className="w-4 h-4" />
              </button>
            </h3>
            {currentEpisode.rawPath ? (
              <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-green-500 bg-green-500/10 px-2 py-1 rounded-full border border-green-500/20">
                <CheckCircle2 className="w-3 h-3" />
                Загружено {currentEpisode.isHardsub && '(Хардсаб)'}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-500 bg-amber-500/10 px-2 py-1 rounded-full border border-amber-500/20">
                <AlertCircle className="w-3 h-3" />
                Ожидание
              </span>
            )}
          </div>
          <label className={`flex items-center justify-center gap-2 w-full ${currentEpisode.rawPath ? 'bg-green-500/5 border-green-500/20' : 'bg-neutral-950 border-neutral-800'} border border-dashed hover:border-blue-500/50 text-neutral-400 hover:text-blue-400 px-4 py-4 rounded-lg cursor-pointer transition-all group`} onClick={() => handleFileSelect('RAW')}>
            {isUploading ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                {transcodingProgress !== null && (
                  <span className="text-xs">{transcodingProgress}%</span>
                )}
              </div>
            ) : (
              <FileVideo className="w-5 h-5 group-hover:scale-110 transition-transform" />
            )}
            <span className="text-sm font-medium">{isUploading ? (status || 'Обработка...') : 'Выбрать видео'}</span>
          </label>
          <p className="text-xs text-amber-500/70 mt-2">
            * Внимание: формат .mkv не поддерживается для воспроизведения в браузере. Используйте .mp4 или .webm
          </p>

          {currentEpisode && Object.values(transcodingTasks).find(t => t.episodeId === currentEpisode.id) && (
            <div className="mt-3 p-3 bg-indigo-950/40 border border-indigo-500/30 rounded-xl space-y-2">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-indigo-300 font-medium">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                  <span>Конвертация MKV в MP4</span>
                </div>
                <span className="font-bold text-indigo-400 font-mono text-sm">
                  {Object.values(transcodingTasks).find(t => t.episodeId === currentEpisode.id)?.progress || 0}%
                </span>
              </div>
              <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-indigo-500/20">
                <div 
                  className="bg-indigo-500 h-full transition-all duration-300 rounded-full"
                  style={{ width: `${Object.values(transcodingTasks).find(t => t.episodeId === currentEpisode.id)?.progress || 0}%` }}
                />
              </div>
              <div className="flex justify-between items-center text-[10px] text-indigo-300/70">
                <span>Фоновый процесс</span>
                <span>
                  {Object.values(transcodingTasks).find(t => t.episodeId === currentEpisode.id)?.eta 
                    ? `Осталось: ~${Object.values(transcodingTasks).find(t => t.episodeId === currentEpisode.id)?.eta}с` 
                    : 'Идет расчет времени...'}
                </span>
              </div>
            </div>
          )}

          {currentEpisode.rawPath && currentEpisode.rawPath.toLowerCase().endsWith('.mkv') && !Object.values(transcodingTasks).some(t => t.episodeId === currentEpisode.id) && (
            <button
              onClick={handleTranscodeCurrentEpisodeMkv}
              type="button"
              className="mt-3 w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-indigo-600/15 hover:bg-indigo-600/25 text-indigo-400 hover:text-indigo-300 border border-indigo-500/20 hover:border-indigo-500/40 text-xs font-bold transition-all cursor-pointer font-sans"
            >
              <RefreshCw className="w-3.5 h-3.5 text-indigo-400" />
              Конвертировать MKV в MP4 (HTML5)
            </button>
          )}
          <div className="mt-4 flex items-center gap-2">
            <input
              type="checkbox"
              id="hardsub-checkbox"
              checked={isHardsubEnabled}
              onChange={async (e) => {
                const checked = e.target.checked;
                setIsHardsubEnabled(checked);
                if (currentEpisode) {
                  await ipcSafe.invoke('save-episode', { ...currentEpisode, isHardsub: checked });
                  onRefresh();
                }
              }}
              className="w-4 h-4 rounded border-neutral-700 bg-neutral-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-neutral-900"
            />
            <label htmlFor="hardsub-checkbox" className="text-sm text-neutral-300 cursor-pointer select-none">
              Хардсаб (видео уже с вшитыми субтитрами)
            </label>
          </div>

          <button
            onClick={openTorrentDownloadModal}
            type="button"
            className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 hover:text-indigo-300 border border-indigo-500/20 hover:border-indigo-500/40 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer"
          >
            <Globe className="w-4 h-4 text-indigo-400" />
            Скачать RAW с торрента
          </button>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-400" />
              Файл субтитров (.ass)
            </h3>
            {currentEpisode.subPath ? (
              <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-green-500 bg-green-500/10 px-2 py-1 rounded-full border border-green-500/20">
                <CheckCircle2 className="w-3 h-3" />
                Загружено
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-500 bg-amber-500/10 px-2 py-1 rounded-full border border-amber-500/20">
                <AlertCircle className="w-3 h-3" />
                Ожидание
              </span>
            )}
          </div>
          <label 
            id="step-upload-sub"
            className={`flex items-center justify-center gap-2 w-full ${currentEpisode.subPath ? 'bg-green-500/5 border-green-500/20' : 'bg-neutral-950 border-neutral-800'} border border-dashed hover:border-indigo-500/50 text-neutral-400 hover:text-indigo-400 px-4 py-4 rounded-lg cursor-pointer transition-all group`} 
            onClick={() => handleFileSelect('SUB')}
          >
            {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5 group-hover:scale-110 transition-transform" />}
            <span className="text-sm font-medium">{isUploading ? 'Загрузка...' : 'Выбрать субтитры'}</span>
          </label>
          <button
            onClick={openSubtitleDownloadModal}
            type="button"
            className="mt-3 w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 hover:text-emerald-300 border border-emerald-500/10 hover:border-emerald-500/30 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer font-sans"
          >
            <Languages className="w-4 h-4 text-emerald-400" />
            Скачать субтитры онлайн
          </button>
          <button
            onClick={() => setIsTextToSubModalOpen(true)}
            type="button"
            className="mt-2 w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 hover:text-blue-300 border border-blue-500/10 hover:border-blue-500/30 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer font-sans"
          >
            <FileText className="w-4 h-4 text-blue-400" />
            Сгенерировать из текста
          </button>
          {currentEpisode?.rawPath && currentEpisode.rawPath.toLowerCase().endsWith('.mkv') && (
            <button
              onClick={handleExtractSubtitlesFromEpisodeRaw}
              type="button"
              className="mt-2 w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-purple-600/10 hover:bg-purple-600/20 text-purple-400 hover:text-purple-300 border border-purple-500/10 hover:border-purple-500/30 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer font-sans"
            >
              <Film className="w-4 h-4 text-purple-400" />
              Извлечь сабы из MKV серии
            </button>
          )}
          <button
            onClick={() => {
              setMultiMergeInitialFiles([]);
              setIsMultiSubMergeModalOpen(true);
            }}
            type="button"
            className="mt-2 w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 hover:text-indigo-300 border border-indigo-500/10 hover:border-indigo-500/30 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer font-sans"
          >
            <Layers className="w-4 h-4 text-indigo-400" />
            Мульти-импорт / Слить сабы
          </button>
        </div>
      </div>

      {/* Assignments Table */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Распределение ролей</h3>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsEpisodeDeadlineModalOpen(true)}
              className="flex items-center gap-1.5 text-sm text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
              title="Настроить дедлайн серии и синхронизировать с дабберами"
            >
              <Clock className="w-4 h-4" />
              Дедлайн серии
            </button>
            <button 
              onClick={handleGenerateReminderMessage}
              className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              <MessageSquare className="w-4 h-4" />
              Напомнить о сдаче
            </button>
            <button 
              onClick={() => setIsAssignModalOpen(true)}
              className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              Назначить роль
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-neutral-950/50 text-neutral-400 text-xs uppercase tracking-wider">
                <th className="px-6 py-4 font-semibold">Даббер</th>
                <th className="px-6 py-4 font-semibold">Персонажи</th>
                <th className="px-6 py-4 font-semibold">Статус</th>
                <th className="px-6 py-4 font-semibold">Срок сдачи дорожки</th>
                <th className="px-6 py-4 font-semibold text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {(() => {
                const grouped: Record<string, any> = {};
                currentEpisode?.assignments?.forEach(as => {
                  const dubberId = as.substituteId || as.dubberId || as.characterName;
                  if (!grouped[dubberId]) {
                    grouped[dubberId] = {
                      dubberId: as.substituteId || as.dubberId,
                      dubber: as.substitute || as.dubber,
                      characters: [as.characterName],
                      statuses: [as.status],
                      lineCount: as.lineCount || 0,
                      assignmentIds: [as.id],
                      deadlines: as.deadline ? [as.deadline] : []
                    };
                  } else {
                    if (!grouped[dubberId].characters.includes(as.characterName)) {
                      grouped[dubberId].characters.push(as.characterName);
                    }
                    grouped[dubberId].statuses.push(as.status);
                    grouped[dubberId].lineCount += (as.lineCount || 0);
                    grouped[dubberId].assignmentIds.push(as.id);
                    if (as.deadline && !grouped[dubberId].deadlines.includes(as.deadline)) {
                      grouped[dubberId].deadlines.push(as.deadline);
                    }
                  }
                });

                return Object.entries(grouped).map(([dubberId, data], idx) => {
                  // Determine overall status for the dubber
                  const allApproved = data.statuses.every((s: string) => s === 'APPROVED');
                  const anyFixes = data.statuses.some((s: string) => s === 'FIXES_NEEDED' || s === 'REJECTED');
                  const displayStatus = allApproved ? 'APPROVED' : anyFixes ? 'FIXES_NEEDED' : data.statuses[0];
                  const customDeadline = data.deadlines?.[0];
                  const hasCustom = Boolean(customDeadline);
                  const effectiveDeadline = customDeadline || currentEpisode.deadline;

                  return (
                    <tr key={(dubberId || 'dubber') + idx} className="hover:bg-neutral-800/30 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-blue-600/20 flex items-center justify-center text-xs text-blue-400 border border-blue-500/20 font-bold">
                            {data.dubber?.nickname?.charAt(0) || '?'}
                          </div>
                          <span className="text-white font-medium">{data.dubber?.nickname || '...'}</span>
                          <span className="text-[10px] text-neutral-500 ml-2">({data.lineCount} реп.)</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-neutral-400 text-sm">
                        {data.characters.join(', ')}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold border ${
                          displayStatus === 'APPROVED' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                          displayStatus === 'FIXES_NEEDED' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' :
                          'bg-neutral-800 text-neutral-400 border-neutral-700'
                        }`}>
                          {ROLE_STATUS_LABELS[displayStatus] || displayStatus || 'Ожидает'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <button
                          type="button"
                          onClick={() => setTrackDeadlineModalState({
                            isOpen: true,
                            dubberId: data.dubberId,
                            dubber: data.dubber,
                            characters: data.characters,
                            assignmentIds: data.assignmentIds,
                            currentDeadline: customDeadline
                          })}
                          className={`flex items-center gap-2 px-2.5 py-1 rounded-lg border text-xs transition-all cursor-pointer text-left group/btn ${
                            hasCustom 
                              ? 'bg-amber-500/10 border-amber-500/30 hover:border-amber-500/60 text-amber-300' 
                              : 'bg-neutral-950/60 border-neutral-800 hover:border-neutral-700 text-neutral-300'
                          }`}
                          title="Нажмите, чтобы настроить индивидуальное время сдачи дорожки даббера"
                        >
                          <Clock className={`w-3.5 h-3.5 shrink-0 ${hasCustom ? 'text-amber-400' : 'text-neutral-500 group-hover/btn:text-amber-400'}`} />
                          <div className="flex flex-col min-w-0">
                            <span className="font-medium truncate">
                              {effectiveDeadline ? formatDeadline(effectiveDeadline) : 'Не установлен'}
                            </span>
                            <span className={`text-[10px] ${hasCustom ? 'text-amber-400/80 font-bold' : 'text-neutral-500'}`}>
                              {hasCustom ? 'Индивидуально' : currentEpisode.deadline ? 'По серии' : 'Нажмите для настройки'}
                            </span>
                          </div>
                        </button>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button 
                            onClick={() => setTrackDeadlineModalState({
                              isOpen: true,
                              dubberId: data.dubberId,
                              dubber: data.dubber,
                              characters: data.characters,
                              assignmentIds: data.assignmentIds,
                              currentDeadline: customDeadline
                            })}
                            className="text-neutral-500 hover:text-amber-400 transition-colors p-2 hover:bg-amber-500/10 rounded-lg cursor-pointer"
                            title="Подстроить время сдачи дорожки"
                          >
                            <Clock className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => onNavigate?.('QA')}
                            className="text-neutral-500 hover:text-blue-400 transition-colors p-2 hover:bg-blue-500/10 rounded-lg cursor-pointer"
                            title="Проверить в QA"
                          >
                            <Activity className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                });
              })()}
              {(!currentEpisode?.assignments || currentEpisode.assignments?.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-neutral-500 italic">
                    Роли еще не распределены. Используйте утилиту ASS или назначьте вручную.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
