import React from "react";
import {
  X,
  MessageSquare,
  Copy,
  Check
} from "lucide-react";
import { toast } from "sonner";
import { safeCopyToClipboard } from "../../lib/clipboard";
import { TelegramClientPanel } from "../TelegramClientPanel";
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
import MultiSubtitleMergeModal from "../MultiSubtitleMergeModal";
import MkvImportModal from "../mkv/MkvImportModal";
import TorrentMkvDetectedModal from "../mkv/TorrentMkvDetectedModal";
import { DashboardTorrentAndSubsDownloadModals } from "./DashboardTorrentAndSubsDownloadModals";

export { DashboardTorrentAndSubsDownloadModals };

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
    isTextToSubModalOpen,
    setIsTextToSubModalOpen,
    handleTextToSubsSave,
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
        defaultEpisodeNumber={(selectedProject?.episodes?.reduce((max: number, ep: any) => Math.max(max, ep.number), 0) || 0) + 1}
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
                  {participants.map((p: any, idx: number) => (
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
          onClose={() => setTrackDeadlineModalState((prev: any) => ({ ...prev, isOpen: false }))}
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
              type: 'SUB',
              episodeId: torrentMkvDetected.targetEpisode?.id || currentEpisode?.id
            });
            setTorrentMkvDetected(null);
            setIsSubtitleSelectModalOpen(true);
          }}
        />
      )}

      {/* Torrent & Online Subtitles Download Modals */}
      <DashboardTorrentAndSubsDownloadModals {...props} />

      {/* Text to Subtitles Modal */}
      <TextToSubtitlesModal
        isOpen={isTextToSubModalOpen}
        onClose={() => setIsTextToSubModalOpen(false)}
        onSave={handleTextToSubsSave}
      />

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
        onCancel={() => setConfirmState((prev: any) => ({ ...prev, isOpen: false }))}
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
