import React from "react";
import {
  Plus,
  X,
  Clock,
  Mic,
  UserPlus,
  MessageSquare,
  ExternalLink,
  Calendar,
  FolderOpen,
  ChevronLeft,
  Loader2,
  Users,
  Settings2,
  Download,
  RefreshCw,
  Table,
  Send
} from "lucide-react";
import { Participant, Project, Episode, ReleaseType } from "../../types";
import { ipcSafe } from "../../lib/ipcSafe";
import { formatDeadline } from "../../lib/templates";
import { sanitizeFolderName } from "../../lib/pathUtils";
import { SubFileItem } from "../MultiSubtitleMergeModal";
import {
  STATUS_LABELS,
  ROLE_STATUS_LABELS,
  DashboardEpisodeWorkflowAndRolesSection
} from "./DashboardEpisodeWorkflowAndRolesSection";

export { STATUS_LABELS, ROLE_STATUS_LABELS, DashboardEpisodeWorkflowAndRolesSection };

export const RELEASE_TYPE_LABELS: Record<ReleaseType, string> = {
  VOICEOVER: 'Закадр',
  RECAST: 'Рекаст',
  REDUB: 'Редаб'
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
            <DashboardEpisodeWorkflowAndRolesSection
              selectedProject={selectedProject}
              currentEpisode={currentEpisode}
              participants={participants}
              onRefresh={onRefresh}
              onNavigate={onNavigate}
              nextEpisodeDate={nextEpisodeDate}
              isUploading={isUploading}
              transcodingProgress={transcodingProgress}
              transcodingTasks={transcodingTasks}
              status={status}
              isHardsubEnabled={isHardsubEnabled}
              setIsHardsubEnabled={setIsHardsubEnabled}
              setIsEpisodeDeadlineModalOpen={setIsEpisodeDeadlineModalOpen}
              setIsYoutubeModalOpen={setIsYoutubeModalOpen}
              setIsTextToSubModalOpen={setIsTextToSubModalOpen}
              setMultiMergeInitialFiles={setMultiMergeInitialFiles}
              setIsMultiSubMergeModalOpen={setIsMultiSubMergeModalOpen}
              setIsAssignModalOpen={setIsAssignModalOpen}
              setExportRole={setExportRole}
              setIsExportModalOpen={setIsExportModalOpen}
              setTrackDeadlineModalState={setTrackDeadlineModalState}
              handleDeleteEpisode={handleDeleteEpisode}
              handleFinishEpisode={handleFinishEpisode}
              handleFileSelect={handleFileSelect}
              handleTranscodeCurrentEpisodeMkv={handleTranscodeCurrentEpisodeMkv}
              openTorrentDownloadModal={openTorrentDownloadModal}
              openSubtitleDownloadModal={openSubtitleDownloadModal}
              handleExtractSubtitlesFromEpisodeRaw={handleExtractSubtitlesFromEpisodeRaw}
              handleGenerateReminderMessage={handleGenerateReminderMessage}
            />
          )}
        </div>
      )}
    </div>
  );
};
