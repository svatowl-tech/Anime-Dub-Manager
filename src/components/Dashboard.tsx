import React, { useState, useEffect, useMemo } from 'react';
import { Participant, Project, Episode, EpisodeStatus, ReleaseType } from '../types';
import { useEpisodeSync } from './dashboard/useEpisodeSync';
import { useProjectAutoUpdate } from '../hooks/useProjectAutoUpdate';
import GettingStartedGuide from './GettingStartedGuide';
import GeneralHub from './dashboard/GeneralHub';
import { MkvTrackInfo } from '../lib/mkvSubtitleExtractor';
import { useDashboardTorrentAndAnime365 } from './dashboard/useDashboardTorrentAndAnime365';
import { useDashboardMediaAndUploads } from './dashboard/useDashboardMediaAndUploads';
import { useDashboardProjectAndRoles } from './dashboard/useDashboardProjectAndRoles';
import { DashboardProjectDetailView } from './dashboard/DashboardProjectDetailView';
import { DashboardModalsAndTorrent } from './dashboard/DashboardModalsAndTorrent';

export interface DashboardProps {
  onNavigate?: (tab: string) => void;
  projects: Project[];
  selectedProjectId: string | null;
  currentEpisode: Episode | null;
  onProjectSelect: (id: string) => void;
  onEpisodeSelect: (num: number) => void;
  onRefresh: () => void;
}

export const STATUS_LABELS: Record<EpisodeStatus, string> = {
  UPLOAD: 'Загрузка ресурсов',
  ROLES: 'Распределение ролей',
  RECORDING: 'Запись звука',
  QA: 'Проверка качества',
  FIXES: 'Правки',
  SOUND_ENGINEERING: 'Звукорежиссура',
  FINISHED: 'Завершено'
};

export const RELEASE_TYPE_LABELS: Record<ReleaseType, string> = {
  VOICEOVER: 'Закадр',
  RECAST: 'Рекаст',
  REDUB: 'Редаб'
};

export const ROLE_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Ожидает',
  RECORDED: 'Записано',
  APPROVED: 'Одобрено',
  REJECTED: 'Отклонено',
  FIXES_NEEDED: 'Нужны правки'
};

export default function Dashboard({
  onNavigate,
  projects,
  selectedProjectId,
  currentEpisode,
  onProjectSelect,
  onEpisodeSelect,
  onRefresh
}: DashboardProps) {
  const [participants, setParticipants] = useState<Participant[]>([]);

  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [isNewEpisodeModalOpen, setIsNewEpisodeModalOpen] = useState(false);

  const [_isDeleteProjectModalOpen, setIsDeleteProjectModalOpen] = useState(false);
  const [_isDeleteEpisodeModalOpen, setIsDeleteEpisodeModalOpen] = useState(false);

  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [isCharacterManagementModalOpen, setIsCharacterManagementModalOpen] = useState(false);
  const [isRolesGridModalOpen, setIsRolesGridModalOpen] = useState(false);
  const [isYoutubeModalOpen, setIsYoutubeModalOpen] = useState(false);
  const [isAssignSoundEngineerModalOpen, setIsAssignSoundEngineerModalOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [characterName, setCharacterName] = useState('');

  const [isAssignDubbersModalOpen, setIsAssignDubbersModalOpen] = useState(false);
  const [isNotificationTemplatesModalOpen, setIsNotificationTemplatesModalOpen] = useState(false);

  const [isProjectSettingsModalOpen, setIsProjectSettingsModalOpen] = useState(false);
  const [isProjectDeadlineModalOpen, setIsProjectDeadlineModalOpen] = useState(false);
  const [isEpisodeDeadlineModalOpen, setIsEpisodeDeadlineModalOpen] = useState(false);
  const [trackDeadlineModalState, setTrackDeadlineModalState] = useState<{
    isOpen: boolean;
    dubberId?: string;
    dubber?: Participant;
    characters: string[];
    assignmentIds: string[];
    currentDeadline?: string;
  }>({
    isOpen: false,
    characters: [],
    assignmentIds: []
  });
  const [_projectSearch, _setProjectSearch] = useState('');

  const [isTelegramClientModalOpen, setIsTelegramClientModalOpen] = useState(false);

  const [torrentMkvDetected, setTorrentMkvDetected] = useState<{
    episodeNumber: number;
    filePath: string;
    subtitleTracks: MkvTrackInfo[];
    targetEpisode?: Episode;
  } | null>(null);

  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    variant?: 'danger' | 'warning' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  const selectedProject = useMemo(
    () => projects.find(p => p.id === selectedProjectId),
    [projects, selectedProjectId]
  );

  // 1. Torrent, Anime365 & Subtitle Download Controller Hook
  const {
    isTorrentModalOpen,
    setIsTorrentModalOpen,
    torrentQuery,
    setTorrentQuery,
    torrentCategory,
    setTorrentCategory,
    torrentSubCategory,
    setTorrentSubCategory,
    torrentReleaseGroup,
    setTorrentReleaseGroup,
    isSearchingTorrents,
    torrentResults,
    torrentMetadata,
    setActiveDownloadId,
    downloadStep,
    setDownloadStep,
    downloadProgress,
    setDownloadProgress,
    directDownloadProgress,
    anime365AuthStatus,
    manualCookieVal,
    setManualCookieVal,
    showManualCookieForm,
    setShowManualCookieForm,
    handleOpenAnime365AuthWindow,
    handleSaveManualCookie,
    downloadPollIntervalRef,
    anime365Translations,
    isLoadingAnime365,
    isUpdatingProjectData,
    isSubDownloadModalOpen,
    setIsSubDownloadModalOpen,
    isTextToSubModalOpen,
    setIsTextToSubModalOpen,
    subDownloadResults,
    isSearchingSubs,
    subSearchQuery,
    setSubSearchQuery,
    subSourceLanguage,
    setSubSourceLanguage,
    subApiSource,
    setSubApiSource,
    handleUpdateProjectData,
    openSubtitleDownloadModal,
    handleTextToSubsSave,
    handleSearchSubtitles,
    handleDownloadAndImportSubtitle,
    openTorrentDownloadModal,
    handleAnime365Download,
    handleCancelDirectDownload,
    handleSearchTorrents,
    handleStartTorrentDownload,
    selectedFileIndexes,
    setSelectedFileIndexes,
    handleDownloadFiles
  } = useDashboardTorrentAndAnime365({
    projects,
    selectedProject,
    currentEpisode,
    onRefresh,
    setTorrentMkvDetected
  });

  // 2. Media Uploads, MKV Extraction, YouTube Download & Export Queue Hook
  const {
    isUploading,
    setIsUploading,
    transcodingProgress,
    transcodingTasks,
    status,
    isExportModalOpen,
    setIsExportModalOpen,
    exportRole,
    setExportRole,
    generatedMessage,
    isMessageModalOpen,
    setIsMessageModalOpen,
    isMessageCopied,
    setIsMessageCopied,
    isHardsubEnabled,
    setIsHardsubEnabled,
    subtitleTracks,
    setSubtitleTracks,
    audioTracks,
    setAudioTracks,
    pendingMkvUpload,
    setPendingMkvUpload,
    isSubtitleSelectModalOpen,
    setIsSubtitleSelectModalOpen,
    isMkvExtracting,
    isMultiSubMergeModalOpen,
    setIsMultiSubMergeModalOpen,
    multiMergeInitialFiles,
    setMultiMergeInitialFiles,
    multiMergeTargetEpisodeId,
    setMultiMergeTargetEpisodeId,
    handleExport,
    handleGenerateReminderMessage,
    handleFileSelect,
    handleMkvConfirmSingle,
    handleMkvConfirmMultiMerge,
    handleExtractSubtitlesFromEpisodeRaw,
    handleYoutubeDownload,
    handleTranscodeCurrentEpisodeMkv
  } = useDashboardMediaAndUploads({
    projects,
    selectedProject,
    currentEpisode,
    participants,
    setParticipants,
    onRefresh
  });

  // 3. Project/Episode CRUD, Dubber & Role Assignments Hook
  const {
    nextEpisodeDate,
    newEpisodeAvailable,
    handleSaveProjectDubbers,
    handleCreateProject,
    handleDeleteProject,
    handleDeleteEpisode,
    handleFinishEpisode,
    handleCreateEpisode,
    handleAssignRole,
    handleAssignSoundEngineer
  } = useDashboardProjectAndRoles({
    projects,
    selectedProjectId,
    selectedProject,
    currentEpisode,
    participants,
    selectedUserId,
    setSelectedUserId,
    characterName,
    setCharacterName,
    onProjectSelect,
    onEpisodeSelect,
    onRefresh,
    setIsNewProjectModalOpen,
    setIsNewEpisodeModalOpen,
    setIsDeleteProjectModalOpen,
    setIsDeleteEpisodeModalOpen,
    setIsAssignDubbersModalOpen,
    setIsAssignModalOpen,
    setIsAssignSoundEngineerModalOpen,
    setConfirmState
  });

  // Background project metadata and character update
  useProjectAutoUpdate(selectedProject || null, onRefresh);

  const { syncEpisodeWithGlobalMapping } = useEpisodeSync(currentEpisode, selectedProject, onRefresh);

  useEffect(() => {
    syncEpisodeWithGlobalMapping();
  }, [currentEpisode?.id, selectedProject?.globalMapping, syncEpisodeWithGlobalMapping]);

  return (
    <div className="p-8 w-full max-w-none mx-auto space-y-8">
      {projects.length === 0 ? (
        <GettingStartedGuide onStart={() => setIsNewProjectModalOpen(true)} />
      ) : !selectedProjectId ? (
        <GeneralHub
          projects={projects}
          onProjectSelect={onProjectSelect}
          onEpisodeSelect={onEpisodeSelect}
          onRefresh={onRefresh}
          onCreateProjectClick={() => setIsNewProjectModalOpen(true)}
        />
      ) : (
        <DashboardProjectDetailView
          projects={projects}
          selectedProjectId={selectedProjectId}
          selectedProject={selectedProject}
          currentEpisode={currentEpisode}
          participants={participants}
          onProjectSelect={onProjectSelect}
          onEpisodeSelect={onEpisodeSelect}
          onRefresh={onRefresh}
          onNavigate={onNavigate}
          newEpisodeAvailable={newEpisodeAvailable}
          nextEpisodeDate={nextEpisodeDate}
          isUpdatingProjectData={isUpdatingProjectData}
          isUploading={isUploading}
          transcodingProgress={transcodingProgress}
          transcodingTasks={transcodingTasks}
          status={status}
          isHardsubEnabled={isHardsubEnabled}
          setIsHardsubEnabled={setIsHardsubEnabled}
          setIsAssignDubbersModalOpen={setIsAssignDubbersModalOpen}
          setIsAssignSoundEngineerModalOpen={setIsAssignSoundEngineerModalOpen}
          setIsRolesGridModalOpen={setIsRolesGridModalOpen}
          setIsTelegramClientModalOpen={setIsTelegramClientModalOpen}
          setIsCharacterManagementModalOpen={setIsCharacterManagementModalOpen}
          setIsNewEpisodeModalOpen={setIsNewEpisodeModalOpen}
          setIsProjectSettingsModalOpen={setIsProjectSettingsModalOpen}
          setIsNotificationTemplatesModalOpen={setIsNotificationTemplatesModalOpen}
          setIsProjectDeadlineModalOpen={setIsProjectDeadlineModalOpen}
          setIsEpisodeDeadlineModalOpen={setIsEpisodeDeadlineModalOpen}
          setIsYoutubeModalOpen={setIsYoutubeModalOpen}
          setIsTextToSubModalOpen={setIsTextToSubModalOpen}
          setMultiMergeInitialFiles={setMultiMergeInitialFiles}
          setIsMultiSubMergeModalOpen={setIsMultiSubMergeModalOpen}
          setIsAssignModalOpen={setIsAssignModalOpen}
          setExportRole={setExportRole}
          setIsExportModalOpen={setIsExportModalOpen}
          setTrackDeadlineModalState={setTrackDeadlineModalState}
          setTorrentQuery={setTorrentQuery}
          setDownloadStep={setDownloadStep}
          setIsTorrentModalOpen={setIsTorrentModalOpen}
          handleDeleteProject={handleDeleteProject}
          handleUpdateProjectData={handleUpdateProjectData}
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

      <DashboardModalsAndTorrent
        projects={projects}
        selectedProject={selectedProject}
        currentEpisode={currentEpisode}
        participants={participants}
        onEpisodeSelect={onEpisodeSelect}
        onRefresh={onRefresh}
        isNewProjectModalOpen={isNewProjectModalOpen}
        setIsNewProjectModalOpen={setIsNewProjectModalOpen}
        handleCreateProject={handleCreateProject}
        isNewEpisodeModalOpen={isNewEpisodeModalOpen}
        setIsNewEpisodeModalOpen={setIsNewEpisodeModalOpen}
        handleCreateEpisode={handleCreateEpisode}
        isAssignDubbersModalOpen={isAssignDubbersModalOpen}
        setIsAssignDubbersModalOpen={setIsAssignDubbersModalOpen}
        handleSaveProjectDubbers={handleSaveProjectDubbers}
        isAssignModalOpen={isAssignModalOpen}
        setIsAssignModalOpen={setIsAssignModalOpen}
        handleAssignRole={handleAssignRole}
        characterName={characterName}
        setCharacterName={setCharacterName}
        selectedUserId={selectedUserId}
        setSelectedUserId={setSelectedUserId}
        isCharacterManagementModalOpen={isCharacterManagementModalOpen}
        setIsCharacterManagementModalOpen={setIsCharacterManagementModalOpen}
        isRolesGridModalOpen={isRolesGridModalOpen}
        setIsRolesGridModalOpen={setIsRolesGridModalOpen}
        isYoutubeModalOpen={isYoutubeModalOpen}
        setIsYoutubeModalOpen={setIsYoutubeModalOpen}
        handleYoutubeDownload={handleYoutubeDownload}
        isAssignSoundEngineerModalOpen={isAssignSoundEngineerModalOpen}
        setIsAssignSoundEngineerModalOpen={setIsAssignSoundEngineerModalOpen}
        handleAssignSoundEngineer={handleAssignSoundEngineer}
        isProjectSettingsModalOpen={isProjectSettingsModalOpen}
        setIsProjectSettingsModalOpen={setIsProjectSettingsModalOpen}
        isProjectDeadlineModalOpen={isProjectDeadlineModalOpen}
        setIsProjectDeadlineModalOpen={setIsProjectDeadlineModalOpen}
        isEpisodeDeadlineModalOpen={isEpisodeDeadlineModalOpen}
        setIsEpisodeDeadlineModalOpen={setIsEpisodeDeadlineModalOpen}
        trackDeadlineModalState={trackDeadlineModalState}
        setTrackDeadlineModalState={setTrackDeadlineModalState}
        isExportModalOpen={isExportModalOpen}
        setIsExportModalOpen={setIsExportModalOpen}
        exportRole={exportRole}
        handleExport={handleExport}
        isUploading={isUploading}
        setIsUploading={setIsUploading}
        transcodingProgress={transcodingProgress}
        isMessageModalOpen={isMessageModalOpen}
        setIsMessageModalOpen={setIsMessageModalOpen}
        generatedMessage={generatedMessage}
        isMessageCopied={isMessageCopied}
        setIsMessageCopied={setIsMessageCopied}
        isSubtitleSelectModalOpen={isSubtitleSelectModalOpen}
        setIsSubtitleSelectModalOpen={setIsSubtitleSelectModalOpen}
        pendingMkvUpload={pendingMkvUpload}
        setPendingMkvUpload={setPendingMkvUpload}
        subtitleTracks={subtitleTracks}
        setSubtitleTracks={setSubtitleTracks}
        audioTracks={audioTracks}
        setAudioTracks={setAudioTracks}
        isMkvExtracting={isMkvExtracting}
        handleMkvConfirmSingle={handleMkvConfirmSingle}
        handleMkvConfirmMultiMerge={handleMkvConfirmMultiMerge}
        torrentMkvDetected={torrentMkvDetected}
        setTorrentMkvDetected={setTorrentMkvDetected}
        isTorrentModalOpen={isTorrentModalOpen}
        setIsTorrentModalOpen={setIsTorrentModalOpen}
        downloadStep={downloadStep}
        setDownloadStep={setDownloadStep}
        anime365AuthStatus={anime365AuthStatus}
        handleOpenAnime365AuthWindow={handleOpenAnime365AuthWindow}
        showManualCookieForm={showManualCookieForm}
        setShowManualCookieForm={setShowManualCookieForm}
        manualCookieVal={manualCookieVal}
        setManualCookieVal={setManualCookieVal}
        handleSaveManualCookie={handleSaveManualCookie}
        isLoadingAnime365={isLoadingAnime365}
        anime365Translations={anime365Translations}
        handleAnime365Download={handleAnime365Download}
        torrentQuery={torrentQuery}
        setTorrentQuery={setTorrentQuery}
        handleSearchTorrents={handleSearchTorrents}
        isSearchingTorrents={isSearchingTorrents}
        torrentReleaseGroup={torrentReleaseGroup}
        setTorrentReleaseGroup={setTorrentReleaseGroup}
        torrentSubCategory={torrentSubCategory}
        setTorrentSubCategory={setTorrentSubCategory}
        torrentCategory={torrentCategory}
        setTorrentCategory={setTorrentCategory}
        torrentResults={torrentResults}
        handleStartTorrentDownload={handleStartTorrentDownload}
        torrentMetadata={torrentMetadata}
        selectedFileIndexes={selectedFileIndexes}
        setSelectedFileIndexes={setSelectedFileIndexes}
        handleDownloadFiles={handleDownloadFiles}
        directDownloadProgress={directDownloadProgress}
        handleCancelDirectDownload={handleCancelDirectDownload}
        downloadProgress={downloadProgress}
        downloadPollIntervalRef={downloadPollIntervalRef}
        setActiveDownloadId={setActiveDownloadId}
        setDownloadProgress={setDownloadProgress}
        isTextToSubModalOpen={isTextToSubModalOpen}
        setIsTextToSubModalOpen={setIsTextToSubModalOpen}
        handleTextToSubsSave={handleTextToSubsSave}
        isSubDownloadModalOpen={isSubDownloadModalOpen}
        setIsSubDownloadModalOpen={setIsSubDownloadModalOpen}
        subSearchQuery={subSearchQuery}
        setSubSearchQuery={setSubSearchQuery}
        handleSearchSubtitles={handleSearchSubtitles}
        subApiSource={subApiSource}
        setSubApiSource={setSubApiSource}
        subSourceLanguage={subSourceLanguage}
        setSubSourceLanguage={setSubSourceLanguage}
        isSearchingSubs={isSearchingSubs}
        subDownloadResults={subDownloadResults}
        handleDownloadAndImportSubtitle={handleDownloadAndImportSubtitle}
        isNotificationTemplatesModalOpen={isNotificationTemplatesModalOpen}
        setIsNotificationTemplatesModalOpen={setIsNotificationTemplatesModalOpen}
        confirmState={confirmState}
        setConfirmState={setConfirmState}
        isMultiSubMergeModalOpen={isMultiSubMergeModalOpen}
        setIsMultiSubMergeModalOpen={setIsMultiSubMergeModalOpen}
        multiMergeInitialFiles={multiMergeInitialFiles}
        setMultiMergeInitialFiles={setMultiMergeInitialFiles}
        multiMergeTargetEpisodeId={multiMergeTargetEpisodeId}
        setMultiMergeTargetEpisodeId={setMultiMergeTargetEpisodeId}
        isTelegramClientModalOpen={isTelegramClientModalOpen}
        setIsTelegramClientModalOpen={setIsTelegramClientModalOpen}
      />
    </div>
  );
}
