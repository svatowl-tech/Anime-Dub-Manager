import React from "react";
import {
  X,
  AlertCircle,
  MessageSquare,
  FileText,
  Loader2,
  Globe,
  Download,
  Languages,
  Zap,
  Copy,
  Check
} from "lucide-react";
import { toast } from "sonner";
import { safeCopyToClipboard } from "../../lib/clipboard";
import { TelegramClientPanel } from "../TelegramClientPanel";
import { Participant, Project, Episode } from "../../types";
import { ipcSafe } from "../../lib/ipcSafe";
import { ExportModal } from "../ExportModal";
import { ConfirmModal } from "../ui/ConfirmModal";
import CreateProjectModal from "./CreateProjectModal";
import ProjectSettingsModal from "./ProjectSettingsModal";
import ProjectDeadlineModal from "./ProjectDeadlineModal";
import EpisodeDeadlineModal from "./EpisodeDeadlineModal";
import TrackDeadlineModal from "./TrackDeadlineModal";
import CreateEpisodeModal from "./CreateEpisodeModal";
import CharacterManagementModal from "./CharacterManagementModal";
import AssignDubbersModal from "./AssignDubbersModal";
import AssignSoundEngineerModal from "./AssignSoundEngineerModal";
import { NotificationTemplatesModal } from "./NotificationTemplatesModal";
import RolesGridModal from "./RolesGridModal";
import YoutubeDownloadModal from "./YoutubeDownloadModal";
import { TextToSubtitlesModal } from "../TextToSubtitlesModal";
import MultiSubtitleMergeModal, { SubFileItem } from "../MultiSubtitleMergeModal";
import MkvImportModal from "../mkv/MkvImportModal";
import TorrentMkvDetectedModal from "../mkv/TorrentMkvDetectedModal";
import { MkvTrackInfo } from "../../lib/mkvSubtitleExtractor";
import { extractEpisodeNumber } from "../../lib/episodeNumberExtractor";

export const DashboardModalsAndTorrent: React.FC<any> = (props) => {
  const {
    projects,
    selectedProject,
    currentEpisode,
    participants,
    onEpisodeSelect,
    onRefresh,
    isNewProjectModalOpen,
    setIsNewProjectModalOpen,
    handleCreateProject,
    isNewEpisodeModalOpen,
    setIsNewEpisodeModalOpen,
    handleCreateEpisode,
    isAssignDubbersModalOpen,
    setIsAssignDubbersModalOpen,
    handleSaveProjectDubbers,
    isAssignModalOpen,
    setIsAssignModalOpen,
    handleAssignRole,
    characterName,
    setCharacterName,
    selectedUserId,
    setSelectedUserId,
    isCharacterManagementModalOpen,
    setIsCharacterManagementModalOpen,
    isRolesGridModalOpen,
    setIsRolesGridModalOpen,
    isYoutubeModalOpen,
    setIsYoutubeModalOpen,
    handleYoutubeDownload,
    isAssignSoundEngineerModalOpen,
    setIsAssignSoundEngineerModalOpen,
    handleAssignSoundEngineer,
    isProjectSettingsModalOpen,
    setIsProjectSettingsModalOpen,
    isProjectDeadlineModalOpen,
    setIsProjectDeadlineModalOpen,
    isEpisodeDeadlineModalOpen,
    setIsEpisodeDeadlineModalOpen,
    trackDeadlineModalState,
    setTrackDeadlineModalState,
    isExportModalOpen,
    setIsExportModalOpen,
    exportRole,
    handleExport,
    isUploading,
    setIsUploading,
    transcodingProgress,
    isMessageModalOpen,
    setIsMessageModalOpen,
    generatedMessage,
    isMessageCopied,
    setIsMessageCopied,
    isSubtitleSelectModalOpen,
    setIsSubtitleSelectModalOpen,
    pendingMkvUpload,
    setPendingMkvUpload,
    subtitleTracks,
    setSubtitleTracks,
    audioTracks,
    setAudioTracks,
    isMkvExtracting,
    handleMkvConfirmSingle,
    handleMkvConfirmMultiMerge,
    torrentMkvDetected,
    setTorrentMkvDetected,
    isTorrentModalOpen,
    setIsTorrentModalOpen,
    downloadStep,
    setDownloadStep,
    anime365AuthStatus,
    handleOpenAnime365AuthWindow,
    showManualCookieForm,
    setShowManualCookieForm,
    manualCookieVal,
    setManualCookieVal,
    handleSaveManualCookie,
    isLoadingAnime365,
    anime365Translations,
    handleAnime365Download,
    torrentQuery,
    setTorrentQuery,
    handleSearchTorrents,
    isSearchingTorrents,
    torrentReleaseGroup,
    setTorrentReleaseGroup,
    torrentSubCategory,
    setTorrentSubCategory,
    torrentCategory,
    setTorrentCategory,
    torrentResults,
    handleStartTorrentDownload,
    torrentMetadata,
    selectedFileIndexes,
    setSelectedFileIndexes,
    handleDownloadFiles,
    directDownloadProgress,
    handleCancelDirectDownload,
    downloadProgress,
    downloadPollIntervalRef,
    setActiveDownloadId,
    setDownloadProgress,
    isTextToSubModalOpen,
    setIsTextToSubModalOpen,
    handleTextToSubsSave,
    isSubDownloadModalOpen,
    setIsSubDownloadModalOpen,
    subSearchQuery,
    setSubSearchQuery,
    handleSearchSubtitles,
    subApiSource,
    setSubApiSource,
    subSourceLanguage,
    setSubSourceLanguage,
    isSearchingSubs,
    subDownloadResults,
    handleDownloadAndImportSubtitle,
    isNotificationTemplatesModalOpen,
    setIsNotificationTemplatesModalOpen,
    confirmState,
    setConfirmState,
    isMultiSubMergeModalOpen,
    setIsMultiSubMergeModalOpen,
    multiMergeInitialFiles,
    setMultiMergeInitialFiles,
    multiMergeTargetEpisodeId,
    setMultiMergeTargetEpisodeId,
    isTelegramClientModalOpen,
    setIsTelegramClientModalOpen
  } = props;

  return (
    <>
      {/* New Project Modal */}
      <CreateProjectModal 
        isOpen={isNewProjectModalOpen} 
        onClose={() => setIsNewProjectModalOpen(false)} 
        onCreate={handleCreateProject} 
      />

      {/* New Episode Modal */}
      <CreateEpisodeModal
        isOpen={isNewEpisodeModalOpen}
        onClose={() => setIsNewEpisodeModalOpen(false)}
        onCreate={handleCreateEpisode}
        defaultEpisodeNumber={(selectedProject?.episodes?.reduce((max, ep) => Math.max(max, ep.number), 0) || 0) + 1}
        project={selectedProject}
      />

      {/* Assign Dubbers Modal */}
      <AssignDubbersModal
        isOpen={isAssignDubbersModalOpen}
        onClose={() => setIsAssignDubbersModalOpen(false)}
        participants={participants}
        initialSelectedDubbers={selectedProject?.assignedDubberIds || []}
        onSave={handleSaveProjectDubbers}
      />

      {/* Assign Role Modal */}
      {isAssignModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Назначить роль</h2>
              <button onClick={() => setIsAssignModalOpen(false)} className="text-neutral-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleAssignRole} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-2">Имя персонажа</label>
                <input 
                  type="text" 
                  value={characterName} 
                  onChange={(e) => setCharacterName(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Напр: Наруто"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-2">Дабер</label>
                <select 
                  value={selectedUserId} 
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                  required
                >
                  <option value="">Выберите дабера</option>
                  {participants.map((p, idx) => (
                    <option key={(p.id || 'p') + idx} value={p.id}>{p.nickname}</option>
                  ))}
                </select>
              </div>
              <button type="submit" className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors">Назначить</button>
            </form>
          </div>
        </div>
      )}

      {/* Character Management Modal */}
      <CharacterManagementModal
        isOpen={isCharacterManagementModalOpen}
        onClose={() => setIsCharacterManagementModalOpen(false)}
        selectedProject={selectedProject}
        participants={participants}
        onRefresh={onRefresh}
      />

      {isRolesGridModalOpen && (
        <RolesGridModal
          project={selectedProject}
          participants={participants}
          onClose={() => setIsRolesGridModalOpen(false)}
        />
      )}

      {isYoutubeModalOpen && (
        <YoutubeDownloadModal
          isOpen={isYoutubeModalOpen}
          onClose={() => setIsYoutubeModalOpen(false)}
          onDownload={handleYoutubeDownload}
        />
      )}

      {/* Assign Sound Engineer Modal */}
      <AssignSoundEngineerModal
        isOpen={isAssignSoundEngineerModalOpen}
        onClose={() => setIsAssignSoundEngineerModalOpen(false)}
        participants={participants}
        initialSoundEngineerId={selectedProject?.soundEngineerId || ''}
        onAssign={handleAssignSoundEngineer}
      />

      {/* Project Settings Modal */}
      {isProjectSettingsModalOpen && selectedProject && (
        <ProjectSettingsModal
          isOpen={isProjectSettingsModalOpen}
          onClose={() => setIsProjectSettingsModalOpen(false)}
          project={selectedProject}
          currentEpisode={currentEpisode}
          onSave={onRefresh}
        />
      )}

      {/* Project Deadline Modal */}
      {isProjectDeadlineModalOpen && selectedProject && (
        <ProjectDeadlineModal
          isOpen={isProjectDeadlineModalOpen}
          onClose={() => setIsProjectDeadlineModalOpen(false)}
          project={selectedProject}
          onSave={onRefresh}
        />
      )}

      {/* Episode Deadline Modal */}
      {isEpisodeDeadlineModalOpen && currentEpisode && (
        <EpisodeDeadlineModal
          isOpen={isEpisodeDeadlineModalOpen}
          onClose={() => setIsEpisodeDeadlineModalOpen(false)}
          episode={currentEpisode}
          onSave={onRefresh}
        />
      )}

      {/* Dubber Track Deadline Modal */}
      {trackDeadlineModalState.isOpen && currentEpisode && (
        <TrackDeadlineModal
          isOpen={trackDeadlineModalState.isOpen}
          onClose={() => setTrackDeadlineModalState(prev => ({ ...prev, isOpen: false }))}
          episode={currentEpisode}
          dubberId={trackDeadlineModalState.dubberId}
          dubber={trackDeadlineModalState.dubber}
          characters={trackDeadlineModalState.characters}
          assignmentIds={trackDeadlineModalState.assignmentIds}
          currentDeadline={trackDeadlineModalState.currentDeadline}
          onSave={onRefresh}
        />
      )}
      {currentEpisode && (
        <ExportModal 
          isOpen={isExportModalOpen} 
          onClose={() => setIsExportModalOpen(false)} 
          episode={currentEpisode} 
          role={exportRole} 
          onExport={handleExport}
          isExporting={isUploading}
          progress={transcodingProgress || 0}
        />
      )}

      {/* Message Modal */}
      {isMessageModalOpen && generatedMessage && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[80vh] pointer-events-auto">
            <div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/50">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-blue-400" />
                Сгенерированное сообщение
              </h3>
              <button 
                onClick={() => setIsMessageModalOpen(false)}
                className="text-neutral-500 hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              <textarea
                readOnly
                value={generatedMessage}
                className="w-full h-64 bg-neutral-950 border border-neutral-800 rounded-xl p-4 text-neutral-300 font-mono text-sm focus:outline-none focus:border-blue-500 resize-none"
              />
            </div>
            <div className="p-4 border-t border-neutral-800 bg-neutral-950/50 flex gap-3">
              <button
                onClick={async () => {
                  if (!generatedMessage) return;
                  try {
                    const ok = await safeCopyToClipboard(generatedMessage);
                    if (ok) {
                      setIsMessageCopied(true);
                      toast.success("Сообщение скопировано в буфер обмена!");
                      setTimeout(() => setIsMessageCopied(false), 2000);
                    } else {
                      toast.error("Не удалось скопировать сообщение в буфер обмена");
                    }
                  } catch (e: any) {
                    toast.error("Ошибка при копировании: " + (e?.message || String(e)));
                  }
                }}
                className={`flex-1 px-4 py-2.5 rounded-lg font-medium transition-all flex items-center justify-center gap-2 cursor-pointer ${
                  isMessageCopied ? 'bg-emerald-600 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'
                }`}
              >
                {isMessageCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {isMessageCopied ? 'Скопировано!' : 'Копировать'}
              </button>
              <button
                onClick={() => setIsMessageModalOpen(false)}
                className="flex-1 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg font-medium transition-colors"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MKV Import & Subtitle Track Selection Modal */}
      {isSubtitleSelectModalOpen && pendingMkvUpload && (
        <MkvImportModal
          isOpen={isSubtitleSelectModalOpen}
          onClose={() => {
            setIsSubtitleSelectModalOpen(false);
            setPendingMkvUpload(null);
            setSubtitleTracks([]);
            setAudioTracks([]);
            setIsUploading(false);
          }}
          filePath={pendingMkvUpload.filePath}
          subtitleTracks={subtitleTracks}
          audioTracks={audioTracks}
          isProcessing={isMkvExtracting}
          onConfirmSingle={(subIdx, audioIdx) => {
            handleMkvConfirmSingle(subIdx, audioIdx);
          }}
          onConfirmMultiMerge={(tracks, audioIdx) => {
            handleMkvConfirmMultiMerge(tracks, audioIdx);
          }}
        />
      )}

      {/* Torrent Downloaded MKV Subtitles Detected Modal */}
      {torrentMkvDetected && (
        <TorrentMkvDetectedModal
          isOpen={!!torrentMkvDetected}
          onClose={() => setTorrentMkvDetected(null)}
          episodeNumber={torrentMkvDetected.episodeNumber}
          filePath={torrentMkvDetected.filePath}
          subtitlesCount={torrentMkvDetected.subtitleTracks.length}
          subtitleTracks={torrentMkvDetected.subtitleTracks}
          onOpenMultiMerge={() => {
            if (torrentMkvDetected.targetEpisode) {
              onEpisodeSelect(torrentMkvDetected.targetEpisode.number);
            }
            setSubtitleTracks(torrentMkvDetected.subtitleTracks);
            setAudioTracks([]);
            setPendingMkvUpload({
              filePath: torrentMkvDetected.filePath,
              type: 'RAW',
              episodeId: torrentMkvDetected.targetEpisode?.id || currentEpisode?.id
            });
            setTorrentMkvDetected(null);
            setIsSubtitleSelectModalOpen(true);
          }}
        />
      )}

      {isTorrentModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col pointer-events-auto max-h-[90vh]">
            <div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/50">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Globe className="w-5 h-5 text-indigo-400" />
                Скачивание RAW с торрента
              </h3>
              <button 
                onClick={() => {
                  if (downloadStep === 'downloading') {
                    if (confirm('Вы уверены, что хотите прервать скачивание? Окно будет закрыто, но загрузка может продолжиться в фоновом режиме.')) {
                      setIsTorrentModalOpen(false);
                    }
                  } else {
                    setIsTorrentModalOpen(false);
                  }
                }}
                className="text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {downloadStep === 'search' ? (
              <div className="p-6 flex flex-col gap-4 overflow-y-auto">
                {/* Anime 365 RAW block */}
                <div className="bg-neutral-950/65 p-4 border border-indigo-900/30 rounded-xl mb-1 text-left">
                  <div className="flex items-center justify-between mb-2.5 border-b border-indigo-950 pb-2">
                    <span className="text-xs font-bold text-indigo-400 tracking-wider uppercase flex items-center gap-1.5 font-sans">
                      <Zap className="w-4 h-4 text-amber-400" />
                      Anime365 RAW Стримы (Прямое скачивание)
                    </span>
                    <span className="text-[10px] text-neutral-500 font-sans">Без хардсаба • Оригинал</span>
                  </div>

                  {/* Anime365 Auth Status Header Bar */}
                  <div className="flex flex-col gap-2 mb-3 bg-neutral-900/45 p-2.5 rounded-lg border border-neutral-800/80 font-sans">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] text-neutral-400 font-medium">Авторизация:</span>
                        {anime365AuthStatus?.loggedIn ? (
                          <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded font-bold flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full inline-block animate-pulse"></span>
                            Активна
                          </span>
                        ) : (
                          <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded font-bold flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full inline-block"></span>
                            Не авторизован
                          </span>
                        )}
                        {anime365AuthStatus?.activeHost && (
                          <span className="text-[9px] text-neutral-500 font-mono">({anime365AuthStatus.activeHost.replace(/^https?:\/\//, '')})</span>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={handleOpenAnime365AuthWindow}
                          className="px-2 py-0.5 bg-indigo-600/90 hover:bg-indigo-500 hover:text-white text-neutral-200 rounded text-[9px] font-bold transition-all cursor-pointer uppercase tracking-wider"
                        >
                          {anime365AuthStatus?.loggedIn ? 'Обновить' : 'Войти'}
                        </button>
                        <button
                          onClick={() => setShowManualCookieForm(!showManualCookieForm)}
                          className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-[9px] font-medium transition-all cursor-pointer"
                        >
                          {showManualCookieForm ? 'Скрыть куки' : 'Ввести куки'}
                        </button>
                      </div>
                    </div>

                    {showManualCookieForm && (
                      <div className="mt-1.5 pt-2 border-t border-neutral-800/60 flex flex-col gap-2">
                        <label className="text-[9px] text-neutral-400 leading-normal">
                          Если встроенный вход не сработал или вы в Sandbox, вставьте заголовок <code className="bg-neutral-900 text-neutral-200 px-1 rounded">Cookie</code> со страницы профиля Anime365:
                        </label>
                        <div className="flex gap-2">
                          <input 
                            type="text"
                            value={manualCookieVal}
                            onChange={(e) => setManualCookieVal(e.target.value)}
                            placeholder="например: php_sessid=...; remember_user_token=..."
                            className="flex-1 bg-neutral-900 border border-neutral-800 text-xs px-2 py-1.5 rounded-md text-white font-mono focus:border-indigo-500 focus:outline-none"
                          />
                          <button
                            onClick={handleSaveManualCookie}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] px-3 py-1.5 rounded-md transition-all active:scale-95"
                          >
                            Сохранить
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {isLoadingAnime365 ? (
                    <div className="flex justify-center items-center py-4 gap-2 text-xs text-neutral-400 font-sans">
                      <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                      Загрузка RAW-видео с Anime365...
                    </div>
                  ) : anime365Translations?.filter(t => t.type === 'raw' || t.qualityType?.toLowerCase()?.includes('raw') || (t.title && t.title.toLowerCase().includes('raw')) || t.typeLang === 'jpn').length > 0 ? (
                    <div className="space-y-2 max-h-[140px] overflow-y-auto custom-scrollbar">
                      {anime365Translations
                        .filter(t => t.type === 'raw' || t.qualityType?.toLowerCase()?.includes('raw') || (t.title && t.title.toLowerCase().includes('raw')) || t.typeLang === 'jpn')
                        .map((item, idx) => (
                          <div key={idx} className="flex items-center justify-between bg-neutral-900/50 p-2.5 rounded-lg border border-neutral-800 hover:border-neutral-700 transition-all">
                            <div className="flex flex-col text-left">
                              <span className="text-xs font-semibold text-white">{item.title || 'RAW Источник'} ({item.authorsSummary || item.authorsList?.join(', ') || 'Оригинал'})</span>
                              <span className="text-[10px] text-neutral-400 mt-0.5">Качество: {item.qualityType || 'Auto'} • Стримы: {item.duration || '—'}</span>
                            </div>
                            <div className="flex items-center gap-1.5 font-sans">
                              <button
                                onClick={() => handleAnime365Download(item)}
                                className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-bold transition-all cursor-pointer font-sans flex items-center gap-1 shadow-sm active:scale-95"
                              >
                                <Download className="w-3 h-3 text-white" />
                                СКАЧАТЬ
                              </button>
                              {item.embedUrl && (
                                <button
                                  onClick={() => {
                                    ipcSafe.invoke('open-external', item.embedUrl);
                                    toast.success('Плеер запущен во внешнем браузере!');
                                  }}
                                  className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-[10px] font-medium transition-all cursor-pointer font-sans"
                                >
                                  Смотреть
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="text-center py-2 text-xs text-neutral-500 font-sans">
                      Прямых RAW источников вещания не обнаружено на Anime365 для этой серии. Воспользуйтесь торрентами ниже.
                    </div>
                  )}
                </div>

                <div className="bg-neutral-950/40 p-3 rounded-lg border border-neutral-800/50 text-xs text-neutral-400">
                  <span className="text-indigo-400 font-semibold">Поиск на Nyaa.si:</span> Мы автоматически подставили название проекта и номер серии. При необходимости вы можете изменить запрос вручную.
                </div>

                <div className="flex gap-2 font-sans">
                  <input
                    type="text"
                    value={torrentQuery}
                    onChange={(e) => setTorrentQuery(e.target.value)}
                    placeholder="Название аниме или запрос для поиска на торренте..."
                    className="flex-1 px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500 font-sans"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSearchTorrents();
                    }}
                  />
                  <button
                    onClick={handleSearchTorrents}
                    disabled={isSearchingTorrents}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-white font-medium text-sm rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    {isSearchingTorrents ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      'Поиск'
                    )}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-wider mb-1.5 font-sans">Релиз-группа</label>
                    <select
                      value={torrentReleaseGroup}
                      onChange={(e) => setTorrentReleaseGroup(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-neutral-950 border border-neutral-800 rounded-lg text-xs text-neutral-300 focus:outline-none focus:border-indigo-500 font-sans cursor-pointer"
                    >
                      <option value="">Любая (по умолчанию)</option>
                      <option value="[Erai-raws]">[Erai-raws]</option>
                      <option value="[SubsPlease]">[SubsPlease]</option>
                      <option value="[HorribleSubs]">[HorribleSubs]</option>
                      <option value="[Kaerizaki-Fansub]">[Kaerizaki-Fansub]</option>
                      <option value="[ToonsHub]">[ToonsHub]</option>
                      <option value="[Judas]">[Judas]</option>
                      <option value="[EMBER]">[EMBER]</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-wider mb-1.5 font-sans">Подкатегория</label>
                    <select
                      value={torrentSubCategory}
                      onChange={(e) => setTorrentSubCategory(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-neutral-950 border border-neutral-800 rounded-lg text-xs text-neutral-300 focus:outline-none focus:border-indigo-500 font-sans cursor-pointer"
                    >
                      <option value="raw">Raw (Без субтитров и перевода)</option>
                      <option value="eng">English-translated (Английские субтитры)</option>
                      <option value="non-eng">Non-English-translated (Другие языки)</option>
                      <option value="amv">Anime Music Video (AMV)</option>
                      <option value="">Все подкатегории</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-wider mb-1.5 font-sans">Категория</label>
                    <select
                      value={torrentCategory}
                      onChange={(e) => setTorrentCategory(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-neutral-950 border border-neutral-800 rounded-lg text-xs text-neutral-300 focus:outline-none focus:border-indigo-500 font-sans cursor-pointer"
                    >
                      <option value="anime">Аниме (Anime)</option>
                      <option value="live_action">Лайв-экшн (Live Action)</option>
                      <option value="audio">Аудио (Lossless/Lossy)</option>
                    </select>
                  </div>
                </div>

                {/* Subtitle list search results */}
                <div className="flex-1 flex flex-col min-h-[250px] max-h-[380px] overflow-y-auto border border-neutral-800 rounded-xl bg-neutral-950/20 pr-1">
                  {isSearchingTorrents ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-2 py-10">
                      <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                      <span className="text-sm text-neutral-400">Поиск раздач на Nyaa.si...</span>
                    </div>
                  ) : torrentResults.length > 0 ? (
                    <div className="divide-y divide-neutral-800/75">
                      {torrentResults.map((item: any, idx) => {
                        const hasMagnet = !!(item.magnet || item.link || item.torrent);
                        return (
                          <div key={idx} className="p-3.5 hover:bg-neutral-900/40 flex flex-col md:flex-row gap-3 items-start md:items-center justify-between transition-colors">
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-semibold text-neutral-200 line-clamp-2 leading-relaxed" title={item.name || item.title}>
                                {item.name || item.title}
                              </div>
                              <div className="flex flex-wrap items-center gap-2 mt-2 text-[10px] text-neutral-500 font-mono">
                                <span className="bg-neutral-800 text-neutral-300 px-1.5 py-0.5 rounded text-[9px] font-sans">
                                  {item.size || 'Неизвестно'}
                                </span>
                                <span>•</span>
                                <span>{item.date?.split(' ')[0] || item.timestamp || 'Нет даты'}</span>
                                {item.category && (
                                  <>
                                    <span>•</span>
                                    <span className="text-indigo-400 font-medium font-sans">{item.category}</span>
                                  </>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-3 shrink-0 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 border-neutral-800/40 pt-2.5 md:pt-0">
                              <div className="flex items-center gap-2 text-[10px] font-mono">
                                <span className="text-green-500 font-bold" title="Seeders">
                                  S: {item.seeders !== undefined ? item.seeders : (item.seeds || 0)}
                                </span>
                                <span className="text-neutral-600">|</span>
                                <span className="text-red-400 font-bold" title="Leechers">
                                  L: {item.leechers !== undefined ? item.leechers : (item.leechs || 0)}
                                </span>
                              </div>

                              <div className="flex gap-2">
                                {(item.link || item.torrent || '').includes('.torrent') || (item.link || item.torrent) ? (
                                  <button
                                    onClick={() => ipcSafe.invoke('open-external', item.torrent || item.link)}
                                    title="Скачать .torrent файл для стороннего клиента"
                                    className="px-2 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-md text-xs transition-colors flex items-center justify-center cursor-pointer"
                                  >
                                    <FileText className="w-3.5 h-3.5" />
                                  </button>
                                ) : null}
                                <button
                                  onClick={() => handleStartTorrentDownload(item)}
                                  disabled={!hasMagnet}
                                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white rounded-md text-xs font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                                >
                                  <Download className="w-3 h-3" />
                                  Облачная загрузка
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center py-12 text-center text-neutral-500">
                      <Globe className="w-10 h-10 text-neutral-700 mb-2.5 stroke-1" />
                      <span className="text-xs">Введите поисковый запрос и нажмите кнопку «Поиск».<br />Мы найдем лучшие раздачи прямо с Nyaa в качестве RAW-видео.</span>
                    </div>
                  )}
                </div>
              </div>
            ) : downloadStep === 'getting_meta' ? (
              <div className="p-12 flex flex-col items-center justify-center text-center gap-4">
                <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
                <div className="text-sm font-semibold text-white">Получение списка файлов торрента...</div>
                <div className="text-xs text-neutral-500">Это может занять некоторое время, в зависимости от количества пиров. Ожидание до 20 секунд.</div>
              </div>
            ) : downloadStep === 'select_files' ? (
              <div className="p-6 flex flex-col max-h-[70vh] overflow-hidden">
                <div className="text-sm font-semibold text-white mb-2 line-clamp-1">{torrentMetadata?.name}</div>
                <div className="text-xs text-neutral-400 mb-4">Выберите серии/файлы для загрузки. При пакетном скачивании они будут автоматически добавлены в проект.</div>
                
                <div className="flex-1 overflow-y-auto min-h-0 border border-neutral-800 rounded-lg">
                  <div className="divide-y divide-neutral-800">
                    {torrentMetadata?.files?.map(f => {
                      const detectedEp = extractEpisodeNumber(
                        f.name,
                        [selectedProject?.title, selectedProject?.originalTitle].filter(Boolean) as string[]
                      );
                      const ext = (f.name.split('.').pop() || '').toLowerCase();
                      const isVideo = ['mkv', 'mp4', 'webm', 'avi', 'mov', 'ts'].includes(ext);

                      return (
                        <label key={f.index} className="flex items-center justify-between p-3 hover:bg-neutral-900/50 transition-colors group cursor-pointer">
                          <div className="flex items-center gap-3 min-w-0 pr-4">
                            <input 
                              type="checkbox"
                              checked={selectedFileIndexes.includes(f.index)}
                              onChange={(e) => {
                                if (e.target.checked) setSelectedFileIndexes([...selectedFileIndexes, f.index]);
                                else setSelectedFileIndexes(selectedFileIndexes.filter(i => i !== f.index));
                              }}
                              className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 checked:bg-indigo-500 checked:border-indigo-500"
                            />
                            <div className="min-w-0">
                              <div className="text-sm text-neutral-200 truncate flex items-center gap-2" title={f.name}>
                                <span className="truncate">{f.name}</span>
                              </div>
                              <div className="flex items-center gap-2 text-xs text-neutral-500 font-mono mt-0.5">
                                <span>{(f.length / 1024 / 1024).toFixed(2)} MB</span>
                                {isVideo && detectedEp > 0 && (
                                  <span className="px-1.5 py-0.2 bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 rounded text-[10px] font-sans font-medium">
                                    → Серия {detectedEp}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
                
                <div className="mt-4 pt-4 border-t border-neutral-800 flex justify-end gap-3">
                  <button 
                    onClick={() => {
                        const allSelected = selectedFileIndexes.length === torrentMetadata?.files?.length;
                        if (allSelected) setSelectedFileIndexes([]);
                        else setSelectedFileIndexes(torrentMetadata?.files?.map(f => f.index) || []);
                    }}
                    className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Выбрать все
                  </button>
                  <button 
                    onClick={() => setDownloadStep('search')}
                    className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Назад
                  </button>
                  <button 
                    onClick={() => handleDownloadFiles()}
                    disabled={selectedFileIndexes.length === 0}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-800 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Скачать ({selectedFileIndexes.length})
                  </button>
                </div>
              </div>
            ) : downloadStep === 'direct_downloading' ? (
              <div className="p-8 flex flex-col items-center justify-center text-center gap-5">
                <div className="relative">
                  <div className="w-16 h-16 rounded-full bg-rose-600/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                    <Loader2 className="w-8 h-8 animate-spin" />
                  </div>
                  <span className="absolute -bottom-1 -right-1 bg-rose-500 text-white font-sans font-bold text-[8px] px-1.5 py-0.5 rounded-full border border-neutral-900">
                    HTTP/HLS
                  </span>
                </div>

                <div className="w-full max-w-md">
                  <div className="text-sm font-semibold text-white truncate max-w-sm mx-auto animate-pulse" title={directDownloadProgress?.fileName}>
                    {directDownloadProgress?.fileName || 'Загрузка видео с Anime365...'}
                  </div>
                  <div className="text-xs text-neutral-500 mt-1 font-mono">
                    {directDownloadProgress?.status === 'searching' 
                      ? 'Определение наилучшего зеркала и извлечение видеопотока...' 
                      : directDownloadProgress?.status === 'downloading'
                        ? 'Загрузка сегментов видеопотока...'
                        : directDownloadProgress?.status === 'completed'
                          ? 'Завершено'
                          : directDownloadProgress?.status}
                  </div>
                </div>

                <div className="w-full max-w-md bg-neutral-950/80 p-4 border border-neutral-800/80 rounded-xl flex flex-col gap-3 font-mono">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-neutral-400 font-sans">Прогресс скачивания</span>
                    <span className="text-rose-400 font-bold">{directDownloadProgress?.progress || 0}%</span>
                  </div>
                  
                  <div className="w-full bg-neutral-800 h-2 rounded-full overflow-hidden">
                    <div 
                      className="bg-rose-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${directDownloadProgress?.progress || 0}%` }}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-left pt-1 border-t border-neutral-800/40 text-[10px] text-neutral-400">
                    <div>
                      <span className="text-neutral-500 font-sans">Получено:</span>{' '}
                      <span className="text-rose-400 font-bold">
                        {directDownloadProgress?.downloadedBytes || '0.0 MB'}
                      </span>
                    </div>
                    <div>
                      <span className="text-neutral-500 font-sans">Тип:</span>{' '}
                      <span className="text-rose-400 font-bold">Raw Stream</span>
                    </div>
                  </div>
                </div>

                {directDownloadProgress?.logs && directDownloadProgress.logs.length > 0 && (
                  <div className="w-full max-w-md bg-neutral-950/90 border border-neutral-800 rounded-lg p-3 text-left font-mono text-[10px] text-neutral-400 flex flex-col gap-1.5 shadow-inner">
                    <div className="flex justify-between items-center text-[9px] text-neutral-500 border-b border-neutral-800/80 pb-1.5 mb-1 tracking-wider uppercase">
                      <span>ЛОГ ИЗВЛЕЧЕНИЯ И СКАЧИВАНИЯ (PROG)</span>
                      <span className="text-rose-500 animate-pulse flex items-center gap-1">
                        <span className="w-1 h-1 rounded-full bg-rose-500 inline-block"></span>
                        LIVE
                      </span>
                    </div>
                    <div className="max-h-36 overflow-y-auto flex flex-col gap-1 select-text custom-scrollbar pr-1">
                      {directDownloadProgress.logs.map((logLine, index) => {
                        let textClass = 'text-neutral-400';
                        if (logLine.includes('[WARN]')) textClass = 'text-amber-400 font-medium';
                        if (logLine.includes('[ERROR]')) textClass = 'text-red-400 font-medium';
                        if (logLine.includes('Successfully') || logLine.includes('completed')) textClass = 'text-emerald-400';
                        return (
                          <div key={index} className={`whitespace-pre-wrap leading-tight ${textClass}`}>
                            {logLine}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {directDownloadProgress?.error && (
                  <div className="w-full max-w-md bg-red-500/10 border border-red-500/20 p-3 rounded-lg flex items-start gap-1.5 text-red-400 text-left text-xs leading-relaxed">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Ошибка скачивания:</span> {directDownloadProgress.error}
                    </div>
                  </div>
                )}

                <button
                  onClick={handleCancelDirectDownload}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 hover:text-red-400 rounded-lg text-xs font-semibold text-neutral-300 transition-colors cursor-pointer"
                >
                  Отмена
                </button>
              </div>
            ) : (
              <div className="p-8 flex flex-col items-center justify-center text-center gap-5">
                <div className="relative">
                  <div className="w-16 h-16 rounded-full bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 animate-pulse">
                    <Loader2 className="w-8 h-8 animate-spin" />
                  </div>
                  <span className="absolute bottom-0 right-0 bg-indigo-500 text-white font-mono font-bold text-[9px] px-1.5 py-0.5 rounded-full border border-neutral-900">
                    {downloadProgress?.numPeers || 0} peers
                  </span>
                </div>

                <div className="w-full max-w-md">
                  <div className="text-sm font-semibold text-white truncate max-w-sm mx-auto" title={downloadProgress?.name}>
                    {downloadProgress?.name || 'Загрузка торрента...'}
                  </div>
                  <div className="text-xs text-neutral-500 mt-1 font-mono">
                    {downloadProgress?.status === 'downloading' ? 'Получение блоков...' : downloadProgress?.status === 'completed' ? 'Завершено' : downloadProgress?.status}
                  </div>
                </div>

                <div className="w-full max-w-md bg-neutral-950/80 p-4 border border-neutral-800/80 rounded-xl flex flex-col gap-3 font-mono">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-neutral-400 font-sans">Прогресс скачивания</span>
                    <span className="text-indigo-400 font-bold">{downloadProgress?.progress || 0}%</span>
                  </div>
                  
                  <div className="w-full bg-neutral-800 h-2 rounded-full overflow-hidden">
                    <div 
                      className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${downloadProgress?.progress || 0}%` }}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-left pt-1 border-t border-neutral-800/40 text-[10px] text-neutral-400">
                    <div>
                      <span className="text-neutral-500 font-sans">Скорость:</span>{' '}
                      <span className="text-indigo-400 font-bold">
                        {downloadProgress?.downloadSpeed 
                          ? (downloadProgress.downloadSpeed / (1024 * 1024)).toFixed(2) + ' MB/s' 
                          : '0.00 MB/s'}
                      </span>
                    </div>
                    <div>
                      <span className="text-neutral-500 font-sans">Пиры:</span>{' '}
                      <span className="text-indigo-400 font-bold">{downloadProgress?.numPeers || 0} соед.</span>
                    </div>
                  </div>
                </div>

                {downloadProgress?.error && (
                  <div className="w-full max-w-md bg-red-500/10 border border-red-500/20 p-3 rounded-lg flex items-start gap-1.5 text-red-400 text-left text-xs leading-relaxed">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Ошибка:</span> {downloadProgress.error}
                    </div>
                  </div>
                )}

                <button
                  onClick={() => {
                    if (confirm('Прервать скачивание? Данные для этой серии не будут сохранены.')) {
                      if (downloadPollIntervalRef.current) {
                        clearInterval(downloadPollIntervalRef.current);
                        downloadPollIntervalRef.current = null;
                      }
                      setActiveDownloadId(null);
                      setDownloadStep('search');
                      setDownloadProgress(null);
                    }
                  }}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 hover:text-red-400 rounded-lg text-xs font-semibold text-neutral-300 transition-colors cursor-pointer"
                >
                  Отмена
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Text to Subtitles Modal */}
      <TextToSubtitlesModal
        isOpen={isTextToSubModalOpen}
        onClose={() => setIsTextToSubModalOpen(false)}
        onSave={handleTextToSubsSave}
      />

      {isSubDownloadModalOpen && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-[9999] p-4 animate-fade-in font-sans pointer-events-auto">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col pointer-events-auto max-h-[85vh]">
            <div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/50">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Languages className="w-5 h-5 text-emerald-400" />
                Скачивание субтитров ({selectedProject?.title}, серия {currentEpisode?.number})
              </h3>
              <button 
                onClick={() => setIsSubDownloadModalOpen(false)}
                className="text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 flex flex-col gap-4 overflow-y-auto">
              <div className="flex flex-col md:flex-row gap-3">
                <div className="flex-1 flex gap-2">
                  <input
                    type="text"
                    value={subSearchQuery}
                    onChange={(e) => setSubSearchQuery(e.target.value)}
                    placeholder="Название аниме для поиска субтитров..."
                    className="flex-1 px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500 font-sans"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSearchSubtitles(subSearchQuery, subApiSource);
                    }}
                  />
                  <button
                    onClick={() => handleSearchSubtitles(subSearchQuery, subApiSource)}
                    disabled={isSearchingSubs}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-sm rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer font-sans"
                  >
                    {isSearchingSubs ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      'Поиск'
                    )}
                  </button>
                </div>

                <div className="flex gap-2 font-sans shrink-0">
                  <select
                    value={subApiSource}
                    onChange={(e) => {
                      setSubApiSource(e.target.value);
                      handleSearchSubtitles(subSearchQuery, e.target.value);
                    }}
                    className="px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-white text-xs focus:outline-none focus:border-emerald-500 cursor-pointer text-left font-sans"
                  >
                    <option value="anime365">Опция: Anime 365 (RU/Любые)</option>
                    <option value="kitsunekko">Опция: Kitsunekko (JA/Японские)</option>
                  </select>

                  <select
                    value={subSourceLanguage}
                    onChange={(e) => setSubSourceLanguage(e.target.value)}
                    className="px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-white text-xs focus:outline-none focus:border-emerald-500 cursor-pointer text-left font-sans"
                  >
                    <option value="all">Все языки</option>
                    <option value="RU">Русские (RU)</option>
                    <option value="JA">Японские (JA)</option>
                    <option value="EN">Английские (EN)</option>
                  </select>
                </div>
              </div>

              <div className="border border-neutral-800/80 rounded-xl overflow-hidden bg-neutral-950/40 text-left">
                <div className="max-h-[350px] overflow-y-auto custom-scrollbar">
                  {isSearchingSubs ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-3 text-neutral-400 font-sans">
                      <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
                      <span>Индексирование баз данных и сопоставление серий...</span>
                    </div>
                  ) : subDownloadResults && subDownloadResults.length > 0 ? (
                    <div className="divide-y divide-neutral-800/60">
                      {subDownloadResults
                        .filter(sub => subSourceLanguage === 'all' || sub.language?.toUpperCase() === subSourceLanguage.toUpperCase())
                        .map((sub, idx) => (
                          <div key={idx} className="p-3 flex items-center justify-between hover:bg-neutral-900/60 transition-all text-left">
                            <div className="flex flex-col gap-1 pr-4">
                              <div className="flex items-center gap-2">
                                <span className={`px-1.5 py-0.5 text-[9px] font-extrabold rounded-md ${
                                  sub.language === 'RU' ? 'bg-red-500/10 text-red-400 border border-red-500/25' : 
                                  sub.language === 'JA' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/25' : 
                                  'bg-blue-500/10 text-blue-400 border border-blue-500/25'
                                }`}>
                                  {sub.language}
                                </span>
                                <span className="px-1.5 py-0.5 text-[9px] font-extrabold rounded bg-neutral-800 text-neutral-300 font-mono">
                                  {sub.format}
                                </span>
                                <span className="text-xs font-semibold text-neutral-200 truncate max-w-[280px]">
                                  {sub.title}
                                </span>
                              </div>
                              <div className="text-[10px] text-neutral-500 font-sans mt-0.5">
                                Авторство / Саб-группа: <span className="text-neutral-400 font-semibold">{sub.authors || 'Официальные'}</span>
                              </div>
                            </div>

                            <button
                              onClick={() => handleDownloadAndImportSubtitle(sub)}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 hover:shadow-lg hover:shadow-emerald-600/10 active:scale-95 text-white rounded-lg text-xs font-bold font-sans flex items-center gap-1.5 transition-all cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                              Скачать
                            </button>
                          </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-neutral-500 font-sans">
                      <Languages className="w-10 h-10 text-neutral-700 mb-2" />
                      <span>Субтитры не найдены в выбранном источнике.</span>
                      <span className="text-[10px] text-neutral-600 mt-1">Попробуйте ввести другое название серии или сменить источник</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedProject && isNotificationTemplatesModalOpen && (
        <NotificationTemplatesModal
          isOpen={isNotificationTemplatesModalOpen}
          onClose={() => setIsNotificationTemplatesModalOpen(false)}
          project={selectedProject}
          latestEpisode={selectedProject.episodes?.[selectedProject.episodes.length - 1]}
          onSaveProject={async (projectId, updates) => {
            const updated = { ...selectedProject, ...updates };
            await ipcSafe.invoke('save-project', updated);
            onRefresh();
          }}
        />
      )}

      <ConfirmModal 
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        variant={confirmState.variant}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
      />

      <MultiSubtitleMergeModal
        isOpen={isMultiSubMergeModalOpen}
        onClose={() => {
          setIsMultiSubMergeModalOpen(false);
          setMultiMergeInitialFiles([]);
          setMultiMergeTargetEpisodeId(undefined);
        }}
        currentEpisode={currentEpisode}
        targetEpisodeId={multiMergeTargetEpisodeId}
        onRefresh={onRefresh}
        initialFiles={multiMergeInitialFiles}
      />

      {isTelegramClientModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4 overflow-hidden">
          <div className="w-full max-w-6xl max-h-[92vh] h-full flex flex-col my-auto">
            <TelegramClientPanel
              currentEpisode={currentEpisode}
              currentProject={selectedProject}
              allProjects={projects}
              onRefreshProjects={onRefresh}
              onClose={() => setIsTelegramClientModalOpen(false)}
            />
          </div>
        </div>
      )}
    </>
  );
};
