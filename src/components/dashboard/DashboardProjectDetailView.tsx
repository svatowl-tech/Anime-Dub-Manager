import React from "react";
import {
  Plus,
  X,
  CheckCircle2,
  Clock,
  AlertCircle,
  Mic,
  UserPlus,
  MessageSquare,
  ExternalLink,
  Calendar,
  FileText,
  Database,
  FolderOpen,
  ChevronLeft,
  Loader2,
  FileVideo,
  Activity,
  Users,
  Settings2,
  Globe,
  Download,
  Languages,
  RefreshCw,
  Table,
  Youtube,
  Layers,
  Send,
  Film
} from "lucide-react";
import { Participant, Project, Episode, EpisodeStatus, ReleaseType } from "../../types";
import { ipcSafe } from "../../lib/ipcSafe";
import { formatDeadline, formatFullDeadline } from "../../lib/templates";
import { sanitizeFolderName } from "../../lib/pathUtils";
import { SubFileItem } from "../MultiSubtitleMergeModal";

const STATUS_LABELS: Record<EpisodeStatus, string> = {
  UPLOAD: 'Загрузка ресурсов',
  ROLES: 'Распределение ролей',
  RECORDING: 'Запись звука',
  QA: 'Проверка качества',
  FIXES: 'Правки',
  SOUND_ENGINEERING: 'Звукорежиссура',
  FINISHED: 'Завершено'
};

const RELEASE_TYPE_LABELS: Record<ReleaseType, string> = {
  VOICEOVER: 'Закадр',
  RECAST: 'Рекаст',
  REDUB: 'Редаб'
};

const ROLE_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Ожидает',
  RECORDED: 'Записано',
  APPROVED: 'Одобрено',
  REJECTED: 'Отклонено',
  FIXES_NEEDED: 'Нужны правки'
};


export const DashboardProjectDetailView: React.FC<{
  projects: Project[];
  selectedProjectId: string | null;
  selectedProject: Project | undefined;
  currentEpisode: Episode | null;
  participants: Participant[];
  onProjectSelect: (id: string) => void;
  onEpisodeSelect: (num: number) => void;
  onRefresh: () => void;
  onNavigate?: (tab: string) => void;
  newEpisodeAvailable: number | null;
  nextEpisodeDate: string | null;
  isUpdatingProjectData: boolean;
  isUploading: boolean;
  transcodingProgress: number | null;
  transcodingTasks: Record<string, { id: string; progress: number; eta: number | null; title?: string; episodeId?: string }>;
  status: string;
  isHardsubEnabled: boolean;
  setIsHardsubEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setIsAssignDubbersModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsAssignSoundEngineerModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsRolesGridModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsTelegramClientModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsCharacterManagementModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsNewEpisodeModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsProjectSettingsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsNotificationTemplatesModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsProjectDeadlineModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
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
  setTorrentQuery: React.Dispatch<React.SetStateAction<string>>;
  setDownloadStep: React.Dispatch<React.SetStateAction<"search" | "getting_meta" | "select_files" | "downloading" | "direct_downloading">>;
  setIsTorrentModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleDeleteProject: () => void;
  handleUpdateProjectData: () => void;
  handleDeleteEpisode: () => void;
  handleFinishEpisode: () => void;
  handleFileSelect: (type: "RAW" | "SUB") => void;
  handleTranscodeCurrentEpisodeMkv: () => void;
  openTorrentDownloadModal: () => void;
  openSubtitleDownloadModal: () => void;
  handleExtractSubtitlesFromEpisodeRaw: () => void;
  handleGenerateReminderMessage: () => void;
}> = (props) => {
  const {
    projects,
    selectedProjectId,
    selectedProject,
    currentEpisode,
    participants,
    onProjectSelect,
    onEpisodeSelect,
    onRefresh,
    onNavigate,
    newEpisodeAvailable,
    nextEpisodeDate,
    isUpdatingProjectData,
    isUploading,
    transcodingProgress,
    transcodingTasks,
    status,
    isHardsubEnabled,
    setIsHardsubEnabled,
    setIsAssignDubbersModalOpen,
    setIsAssignSoundEngineerModalOpen,
    setIsRolesGridModalOpen,
    setIsTelegramClientModalOpen,
    setIsCharacterManagementModalOpen,
    setIsNewEpisodeModalOpen,
    setIsProjectSettingsModalOpen,
    setIsNotificationTemplatesModalOpen,
    setIsProjectDeadlineModalOpen,
    setIsEpisodeDeadlineModalOpen,
    setIsYoutubeModalOpen,
    setIsTextToSubModalOpen,
    setMultiMergeInitialFiles,
    setIsMultiSubMergeModalOpen,
    setIsAssignModalOpen,
    setExportRole,
    setIsExportModalOpen,
    setTrackDeadlineModalState,
    setTorrentQuery,
    setDownloadStep,
    setIsTorrentModalOpen,
    handleDeleteProject,
    handleUpdateProjectData,
    handleDeleteEpisode,
    handleFinishEpisode,
    handleFileSelect,
    handleTranscodeCurrentEpisodeMkv,
    openTorrentDownloadModal,
    openSubtitleDownloadModal,
    handleExtractSubtitlesFromEpisodeRaw,
    handleGenerateReminderMessage
  } = props;

  return (
        <div className="space-y-8">
          {/* Top Control Bar for selected project detail view */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-neutral-850 text-left">
            <button
              onClick={() => onProjectSelect('')}
              className="flex items-center gap-2 text-neutral-400 hover:text-white font-bold text-xs bg-neutral-900 border border-neutral-800 hover:border-neutral-700 px-4 py-2.5 rounded-xl transition-all cursor-pointer shrink-0"
              title="Вернуться к списку проектов"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Все проекты</span>
            </button>

            <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto justify-end">
              <select 
                value={selectedProjectId || ''} 
                onChange={(e) => onProjectSelect(e.target.value)}
                className="bg-neutral-900 border border-neutral-800 text-white text-xs rounded-xl pl-4 pr-10 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 appearance-none min-w-[180px]"
              >
                {projects
                  ?.filter(p => p.status !== 'COMPLETED')
                  .map(p => (
                    <option key={p.id} value={p.id}>{p.emoji || '❤️'} {p.title}</option>
                  ))}
              </select>
              
              <button 
                onClick={() => setIsAssignDubbersModalOpen(true)}
                className="p-2.5 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-xl text-neutral-400 hover:text-white transition-colors cursor-pointer"
                title="Назначить даберов на этот проект"
              >
                <UserPlus className="w-4.5 h-4.5" />
              </button>
              <button 
                onClick={() => setIsAssignSoundEngineerModalOpen(true)}
                className="p-2.5 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-xl text-neutral-400 hover:text-white transition-colors cursor-pointer"
                title="Назначить звукорежиссера"
              >
                <Mic className="w-4.5 h-4.5" />
              </button>
              <button 
                onClick={() => setIsRolesGridModalOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 hover:text-indigo-300 rounded-xl text-xs font-bold transition-colors border border-indigo-500/10 cursor-pointer"
                title="Открыть сетку ролей проекта"
              >
                <Table className="w-4 h-4" />
                Сетка ролей
              </button>
              <button 
                onClick={() => setIsTelegramClientModalOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-2.5 bg-sky-950/50 hover:bg-sky-900/60 text-sky-300 hover:text-sky-200 rounded-xl text-xs font-bold transition-all border border-sky-800/50 cursor-pointer shadow-sm"
                title="Открыть Telegram MTProto User Client (Вариант 2)"
              >
                <Send className="w-4 h-4 text-sky-400" />
                <span>Telegram Client</span>
              </button>
              <button 
                onClick={() => setIsCharacterManagementModalOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-xl text-neutral-300 hover:text-white text-xs font-bold transition-colors cursor-pointer"
                title="Управление персонажами"
              >
                <Users className="w-4 h-4" />
                Персонажи
              </button>
              <button 
                onClick={() => setIsNewEpisodeModalOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md shadow-blue-600/10"
                title="Добавить новую серию в проект"
              >
                <Plus className="w-4 h-4" />
                Добавить серию
              </button>
              <button 
                onClick={() => setIsProjectSettingsModalOpen(true)}
                className="p-2.5 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-xl text-neutral-400 hover:text-white transition-colors cursor-pointer"
                title="Настройки проекта"
              >
                <Settings2 className="w-4.5 h-4.5" />
              </button>
              <button 
                onClick={handleDeleteProject}
                className="p-2.5 bg-red-950/20 border border-red-900/30 hover:bg-red-900/40 rounded-xl text-red-400 hover:text-red-300 transition-colors cursor-pointer"
                title="Удалить проект"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
          </div>

          {selectedProject && (
        <div className="space-y-8">
          {newEpisodeAvailable && (
            <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4 flex items-center justify-between text-indigo-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-500/20 rounded-lg shrink-0">
                  <Download className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <div className="font-bold text-indigo-300">Доступна новая серия!</div>
                  <div className="text-sm opacity-80">На трекере найдена {newEpisodeAvailable} серия (у вас максимум {selectedProject.episodes?.reduce((max, ep) => Math.max(max, ep.number), 0) || 0})</div>
                </div>
              </div>
              <button 
                onClick={() => {
                    setTorrentQuery(`${selectedProject.originalTitle} ${newEpisodeAvailable}`);
                    setDownloadStep('search');
                    setIsTorrentModalOpen(true);
                }}
                className="px-4 py-2 bg-indigo-500 hover:bg-indigo-400 text-white rounded-xl shadow-lg shadow-indigo-500/20 text-sm font-semibold transition-colors cursor-pointer"
              >
                Скачать
              </button>
            </div>
          )}
          {/* Project Info Section */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-xl flex flex-col md:flex-row">
            {selectedProject.posterUrl && (
              <div className="w-full md:w-48 h-72 md:h-auto flex-shrink-0 relative">
                <img 
                  src={selectedProject.posterUrl} 
                  alt={selectedProject.title} 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const parent = e.currentTarget.parentElement;
                    if (parent) {
                      const fallback = document.createElement('div');
                      fallback.className = "w-full h-full min-h-[18rem] bg-gradient-to-br from-neutral-800 to-neutral-900 flex flex-col items-center justify-center text-neutral-400 font-bold p-4 text-center gap-2";
                      fallback.innerHTML = `<span class="text-3xl">🎬</span><span class="text-xs">Постер временно недоступен</span>`;
                      parent.appendChild(fallback);
                    }
                  }}
                />
              </div>
            )}
            <div className="p-6 flex-1 space-y-4 text-left">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-bold text-white mb-1">{selectedProject.emoji || '❤️'} {selectedProject.title}</h1>
                  <div className="text-neutral-500 font-medium italic">{selectedProject.originalTitle}</div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      const projectTitle = sanitizeFolderName(selectedProject.title || 'Project');
                      ipcSafe.invoke('open-path', projectTitle);
                    }}
                    className="px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-full text-xs font-bold border border-neutral-700 flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 duration-100 font-sans"
                    title="Открыть рабочую папку проекта"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    Папка проекта
                  </button>
                  <button
                    onClick={() => setIsNotificationTemplatesModalOpen(true)}
                    className="px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-full text-xs font-bold border border-neutral-700 flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 duration-100 font-sans"
                    title="Настроить шаблоны уведомлений в Telegram"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Шаблоны уведомлений
                  </button>
                  <button
                    onClick={() => setIsProjectDeadlineModalOpen(true)}
                    className="px-3 py-1 bg-indigo-950/40 hover:bg-indigo-900/40 text-indigo-300 hover:text-white rounded-full text-xs font-bold border border-indigo-700/50 flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 duration-100 font-sans"
                    title="Настроить общий дедлайн релиза / проекта вручную"
                  >
                    <Calendar className="w-3.5 h-3.5 text-indigo-400" />
                    {selectedProject.deadline ? `Дедлайн: ${formatDeadline(selectedProject.deadline)}` : 'Задать дедлайн проекта'}
                  </button>
                  <button
                    onClick={handleUpdateProjectData}
                    disabled={isUpdatingProjectData}
                    className="px-3 py-1 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-neutral-300 rounded-full text-xs font-bold border border-neutral-700 flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 duration-100 font-sans"
                    title="Подтянуть и обновить всю информацию о проекте из Anime365"
                  >
                    {isUpdatingProjectData ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    Обновить данные
                  </button>
                  <div className="px-3 py-1 bg-blue-500/10 text-blue-400 rounded-full text-xs font-bold border border-blue-500/20">
                    {RELEASE_TYPE_LABELS[selectedProject.releaseType || 'VOICEOVER']}
                  </div>
                  {selectedProject.isOngoing && (
                    <div className="px-3 py-1 bg-green-500/10 text-green-400 rounded-full text-xs font-bold border border-green-500/20 flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      Онгоинг
                    </div>
                  )}
                </div>
              </div>
              
              {selectedProject.synopsis && (
                <div className="text-neutral-400 text-sm leading-relaxed">
                  {selectedProject.synopsis}
                </div>
              )}
              
              {selectedProject.links && (() => {
                try {
                  const parsedLinks = JSON.parse(selectedProject.links);
                  const validLinks = Object.entries(parsedLinks).filter(([k, v]) => v && typeof v === 'string' && (k === 'shikimori' || k === 'anime365' || k === 'mal' || k === 'animedb' || k === 'kodik' || k === 'vk' || k === 'tg'));
                  if (validLinks.length > 0) {
                    return (
                      <div className="flex flex-wrap gap-2 pt-1 pb-1">
                        {validLinks.map(([key, url]) => (
                          <a 
                            key={key} 
                            href={url as string} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="px-2.5 py-1 bg-neutral-900 border border-neutral-700 hover:border-neutral-500 hover:bg-neutral-800 text-neutral-300 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
                          >
                            <ExternalLink className="w-3 h-3" />
                            {key}
                          </a>
                        ))}
                      </div>
                    );
                  }
                } catch(e) {}
                return null;
              })()}
              
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 pt-2">
                <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-800">
                  <div className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider mb-1">Серий (Вышло / Всего)</div>
                  <div className="text-lg font-bold text-white">
                    <span className="text-emerald-400">{selectedProject.airedEpisodes || selectedProject.episodes?.length || 0}</span>
                    <span className="text-neutral-600 mx-1">/</span>
                    <span>{selectedProject.totalEpisodes || '?'}</span>
                  </div>
                </div>
                <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-800">
                  <div className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider mb-1">След. серия</div>
                  <div className="text-lg font-bold text-blue-400">{nextEpisodeDate || 'Неизвестно'}</div>
                </div>
                <div 
                  onClick={() => setIsProjectDeadlineModalOpen(true)}
                  className="bg-neutral-950 p-3 rounded-xl border border-neutral-800 hover:border-indigo-500/50 hover:bg-indigo-950/20 transition-all cursor-pointer group"
                  title="Нажмите, чтобы настроить общий дедлайн проекта вручную"
                >
                  <div className="flex items-center justify-between text-[10px] text-neutral-500 group-hover:text-indigo-300 uppercase font-bold tracking-wider mb-1">
                    <span>Общий дедлайн</span>
                    <Clock className="w-3 h-3 text-neutral-500 group-hover:text-indigo-400 transition-colors" />
                  </div>
                  <div className="text-sm font-bold text-indigo-400 group-hover:text-indigo-300 truncate">
                    {selectedProject.deadline ? formatDeadline(selectedProject.deadline) : 'Не установлен'}
                  </div>
                </div>
                <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-800">
                  <div className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider mb-1">Звукорежиссер</div>
                  <div className="text-lg font-bold text-purple-400 truncate">
                    {participants.find(p => p.id === selectedProject.soundEngineerId)?.nickname || '—'}
                  </div>
                </div>
                <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-800">
                  <div className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider mb-1">Даберы</div>
                  <div className="text-lg font-bold text-emerald-400">
                    {selectedProject.assignedDubberIds?.length || 0}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Episode Selector */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {selectedProject?.episodes?.map((ep, idx) => (
              <button
                key={ep.id || ('ep-' + idx)}
                onClick={() => onEpisodeSelect(ep.number)}
                className={`flex-shrink-0 px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 border ${
                  currentEpisode?.id === ep.id 
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20 border-blue-400' 
                    : ep.status === 'FINISHED' ? 'bg-green-900/20 text-green-400 border-green-900/50 hover:bg-green-900/30' :
                      ep.status === 'FIXES' ? 'bg-red-900/20 text-red-400 border-red-900/50 hover:bg-red-900/30' :
                      'bg-neutral-900 text-neutral-400 border-transparent hover:bg-neutral-800'
                }`}
              >
                Серия {ep.number}
                <div className="flex gap-0.5">
                  {ep.rawPath && <div className="w-1.5 h-1.5 rounded-full bg-blue-400" title="Видео загружено" />}
                  {ep.subPath && <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" title="Субтитры загружены" />}
                </div>
              </button>
            ))}
          </div>

          {(!selectedProject?.episodes || selectedProject.episodes.length === 0) && (
            <div className="bg-neutral-900/60 border border-neutral-800 border-dashed rounded-2xl p-10 text-center flex flex-col items-center justify-center space-y-4 shadow-inner">
              <div className="w-14 h-14 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                <Plus className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-white">В проекте пока нет ни одной серии</h3>
                <p className="text-xs text-neutral-400 max-w-sm">
                  Добавьте серию, чтобы прикрепить видео, субтитры, распределить роли и начать озвучку.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsNewEpisodeModalOpen(true)}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-blue-600/25 flex items-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Добавить первую серию
              </button>
            </div>
          )}

          {currentEpisode && (
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
                    {(Object.keys(STATUS_LABELS) as EpisodeStatus[]).map((status, idx) => (
                      <React.Fragment key={status}>
                        <div 
                          className={`w-3 h-3 rounded-full ${
                            currentEpisode.status === status ? 'bg-blue-500 ring-4 ring-blue-500/20' : 
                            idx < Object.keys(STATUS_LABELS).indexOf(currentEpisode.status) ? 'bg-green-500' : 'bg-neutral-800'
                          }`}
                          title={STATUS_LABELS[status]}
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
          )}
        </div>
      )}
        </div>
  );
};
