import React, { useState, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { getParticipants } from "../services/dbService";
import { Participant, Project, Episode, EpisodeStatus, ReleaseType } from "../types";
import { ipcSafe } from "../lib/ipcSafe";
import { getNextEpisodeDate } from "../services/animeService";
import { useEpisodeSync } from "./dashboard/useEpisodeSync";
import { useProjectAutoUpdate } from "../hooks/useProjectAutoUpdate";
import { SIGN_KEYWORDS } from "../constants";
import GettingStartedGuide from "./GettingStartedGuide";
import GeneralHub from "./dashboard/GeneralHub";
import { generateStartEpisodeMessage, generateStatusMessage, generateSoundEngineerMessage } from "../lib/templates";
import { sanitizeFolderName } from "../lib/pathUtils";
import { calculateDeadline } from "../lib/dateUtils";
import { SubFileItem } from "./MultiSubtitleMergeModal";
import { inspectMkvTracks, extractSelectedMkvTracks, MkvTrackInfo } from "../lib/mkvSubtitleExtractor";
import { useDashboardTorrentAndAnime365 } from "./dashboard/useDashboardTorrentAndAnime365";
import { DashboardProjectDetailView } from "./dashboard/DashboardProjectDetailView";
import { DashboardModalsAndTorrent } from "./dashboard/DashboardModalsAndTorrent";

interface DashboardProps {
  onNavigate?: (tab: string) => void;
  projects: Project[];
  selectedProjectId: string | null;
  currentEpisode: Episode | null;
  onProjectSelect: (id: string) => void;
  onEpisodeSelect: (num: number) => void;
  onRefresh: () => void;
}

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

  const [isDeleteProjectModalOpen, setIsDeleteProjectModalOpen] = useState(false);
  const [isDeleteEpisodeModalOpen, setIsDeleteEpisodeModalOpen] = useState(false);

  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [isCharacterManagementModalOpen, setIsCharacterManagementModalOpen] = useState(false);
  const [isRolesGridModalOpen, setIsRolesGridModalOpen] = useState(false);
  const [isYoutubeModalOpen, setIsYoutubeModalOpen] = useState(false);
  const [isAssignSoundEngineerModalOpen, setIsAssignSoundEngineerModalOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [characterName, setCharacterName] = useState('');

  const [isAssignDubbersModalOpen, setIsAssignDubbersModalOpen] = useState(false);
  const [isNotificationTemplatesModalOpen, setIsNotificationTemplatesModalOpen] = useState(false);

  const [isUploading, setIsUploading] = useState(false);
  const [transcodingProgress, setTranscodingProgress] = useState<number | null>(null);
  const [transcodingTasks, setTranscodingTasks] = useState<Record<string, { id: string, progress: number, eta: number | null, title?: string, episodeId?: string }>>({});
  const [status, setStatus] = useState<string>('');

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
  const [projectSearch, setProjectSearch] = useState('');

  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportRole, setExportRole] = useState<'DABBER' | 'SOUND_ENGINEER'>('DABBER');

  const [isTelegramClientModalOpen, setIsTelegramClientModalOpen] = useState(false);

  const [generatedMessage, setGeneratedMessage] = useState<string | null>(null);
  const [isMessageModalOpen, setIsMessageModalOpen] = useState(false);
  const [isMessageCopied, setIsMessageCopied] = useState(false);
  const [isHardsubEnabled, setIsHardsubEnabled] = useState(false);
  const [subtitleTracks, setSubtitleTracks] = useState<MkvTrackInfo[]>([]);
  const [audioTracks, setAudioTracks] = useState<MkvTrackInfo[]>([]);
  const [pendingMkvUpload, setPendingMkvUpload] = useState<{filePath: string, type: 'RAW' | 'SUB', episodeId?: string} | null>(null);
  const [isSubtitleSelectModalOpen, setIsSubtitleSelectModalOpen] = useState(false);
  const [isMkvExtracting, setIsMkvExtracting] = useState(false);
  const [selectedSubtitleIndex, setSelectedSubtitleIndex] = useState<number | undefined>();
  const [selectedAudioIndex, setSelectedAudioIndex] = useState<number | undefined>();
  const [isMultiSubMergeModalOpen, setIsMultiSubMergeModalOpen] = useState(false);
  const [multiMergeInitialFiles, setMultiMergeInitialFiles] = useState<SubFileItem[]>([]);
  const [multiMergeTargetEpisodeId, setMultiMergeTargetEpisodeId] = useState<string | undefined>(undefined);
  const [torrentMkvDetected, setTorrentMkvDetected] = useState<{
    episodeNumber: number;
    filePath: string;
    subtitleTracks: MkvTrackInfo[];
    targetEpisode?: Episode;
  } | null>(null);


  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  const selectedProject = useMemo(() => projects.find(p => p.id === selectedProjectId), [projects, selectedProjectId]);

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
    activeDownloadId,
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

  useEffect(() => {
    const removeCompletedListener = ipcSafe.on('task-completed', async (data: any) => {
      const { task } = data;
      if (task?.metadata?.roleName) {
        const currentProjects = projectsRef.current;
        const allEpisodes = currentProjects.flatMap(p => p.episodes || []);
        const epMatch = allEpisodes.find((e: any) => e.id === task.metadata.episodeId);
        if (epMatch) {
          const epWithProj = { ...epMatch, project: currentProjects.find(p => p.id === epMatch.projectId) };
          const parts = await getParticipants();
          let msg = '';
          if (task.metadata.roleName === 'DABBER') {
            msg = generateStartEpisodeMessage(epWithProj as any, parts);
          } else if (task.metadata.roleName === 'SOUND_ENGINEER') {
            msg = generateSoundEngineerMessage(epWithProj as any, '', parts);
          }
          if (msg) {
            setGeneratedMessage(msg);
            setIsMessageModalOpen(true);
            toast.success('Экспорт завершен!');
          }
        }
      }
    });
    return () => {
      removeCompletedListener();
    };
  }, []);


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
    onConfirm: () => {},
  });


  
  // Background project metadata and character update
  useProjectAutoUpdate(selectedProject || null, onRefresh);

  const { syncEpisodeWithGlobalMapping } = useEpisodeSync(currentEpisode, selectedProject, onRefresh);

  useEffect(() => {
    if (currentEpisode) {
      setIsHardsubEnabled(currentEpisode.isHardsub || false);
    }
  }, [currentEpisode]);

  useEffect(() => {
    syncEpisodeWithGlobalMapping();
  }, [currentEpisode?.id, selectedProject?.globalMapping, syncEpisodeWithGlobalMapping]);

  const handleExport = async (targetDir: string, skipConversion: boolean, smartExport?: boolean, uploadToYandex?: boolean, additionalProcessing?: boolean, autoApplyFixes?: boolean, includeSubtitles?: boolean, autoTiming?: boolean) => {
    if (!currentEpisode) return;
    
    try {
      const taskType = exportRole === 'DABBER' ? 'export-dabber-files' : 'export-sound-engineer-files';
      const roleName = exportRole === 'DABBER' ? 'Даберам' : 'Звукорежиссеру';
      const newStatus = exportRole === 'DABBER' ? 'RECORDING' : 'SOUND_ENGINEERING';
      
      const updatedEpisode = {
        ...currentEpisode,
        status: newStatus as any
      };
      
      await ipcSafe.invoke('save-episode', updatedEpisode);
      
      await ipcSafe.invoke('enqueue-ffmpeg-task', {
        type: taskType,
        payload: {
          episode: updatedEpisode,
          targetDir,
          skipConversion,
          smartExport,
          additionalProcessing,
          autoApplyFixes,
          includeSubtitles: includeSubtitles ?? true,
          autoTiming: autoTiming ?? false
        },
        metadata: {
          title: `Экспорт ${roleName}: ${currentEpisode.project?.title || 'Проект'} - Серия ${currentEpisode.number}`,
          episodeId: currentEpisode.id,
          roleName: exportRole, // 'DABBER' or 'SOUND_ENGINEER'
          projectId: currentEpisode.projectId,
          targetDir
        }
      });

      setIsExportModalOpen(false);
      toast.success(`Экспорт ${roleName} успешно поставлен в фоновую очередь!`);
      onRefresh();
    } catch (error: any) {
      console.error('Export enqueue error:', error);
      toast.error('Ошибка добавления экспорта в очередь: ' + (error.message || String(error)));
    }
  };

  const handleGenerateReminderMessage = () => {
    if (!currentEpisode) return;
    try {
      const msg = generateStatusMessage(currentEpisode, participants);
      setGeneratedMessage(msg);
      setIsMessageCopied(false);
      setIsMessageModalOpen(true);
    } catch (e: any) {
      console.error('Failed to generate reminder message:', e);
      toast.error('Ошибка формирования напоминания: ' + (e?.message || String(e)));
    }
  };



  const processFileUpload = async (
    filePath: string, 
    type: 'RAW' | 'SUB', 
    selectedSubtitleStreamIndex?: number, 
    selectedAudioStreamIndex?: number,
    targetEpisodeId?: string
  ) => {
    let episodeToUpdate = targetEpisodeId 
      ? selectedProject?.episodes?.find(e => e.id === targetEpisodeId) 
      : currentEpisode;
      
    if (!episodeToUpdate && targetEpisodeId) {
      try {
        const allProjects = await ipcSafe.invoke('get-projects');
        if (Array.isArray(allProjects)) {
          for (const p of allProjects) {
            const found = p.episodes?.find((e: any) => e.id === targetEpisodeId);
            if (found) {
              episodeToUpdate = found;
              break;
            }
          }
        }
      } catch (e) {
        console.error('Failed fetching latest projects in processFileUpload:', e);
      }
    }

    if (!episodeToUpdate) return;
    
    try {
      const fileName = filePath.split(/[\\/]/).pop() || 'file';
      const ext = fileName.split('.').pop()?.toLowerCase();

      // Use project title if available, otherwise fallback to ID
      const projectTitle = sanitizeFolderName(selectedProject?.title || 'Project');
      const episodeFolder = sanitizeFolderName(`Episode_${episodeToUpdate.number}`);
      const subDir = `${projectTitle}/${episodeFolder}`;

      // Refresh latestEp from get-project / get-projects to have most recent state
      let latestEp = episodeToUpdate;
      try {
        const proj: Project | null = await ipcSafe.invoke('get-project', selectedProject?.id);
        if (proj && Array.isArray(proj.episodes)) {
          const found = proj.episodes.find((e: any) => e.id === episodeToUpdate.id);
          if (found) latestEp = found;
        }
      } catch (e) {}

      // Helper function to extract characters and map to dubbers
      const extractActorsAndAssign = async (subPath: string) => {
        try {
          const result = await ipcSafe.invoke('get-raw-subtitles', subPath);
          if (result && result.actors) {
            const rawActors: string[] = result.actors;
            const lines: any[] = result.lines || [];

            let aliases: Record<string, string> = {};
            try {
              aliases = JSON.parse(selectedProject?.characterAliases || '{}');
            } catch (e) {}

            const lineCounts: Record<string, number> = {};
            lines.forEach(line => {
              const nameToUse = line.name || line.actor || line.style || "Unknown";
              const mainName = aliases[nameToUse] || nameToUse;
              lineCounts[mainName] = (lineCounts[mainName] || 0) + 1;
            });

            const mainActors = Array.from(new Set(rawActors.map(name => {
              const nameToUse = name || "Unknown";
              return aliases[nameToUse] || nameToUse;
            }))).filter(name => !SIGN_KEYWORDS.includes(name as string)) as string[];

            const globalMappingRaw = selectedProject?.globalMapping || '[]';
            let globalMapping: {characterName: string, dubberId: string, isMain?: boolean}[] = [];
            try {
              const parsed = JSON.parse(globalMappingRaw);
              if (Array.isArray(parsed)) {
                globalMapping = parsed;
              } else if (parsed && typeof parsed === 'object') {
                globalMapping = Object.entries(parsed).map(([k, v]) => ({ characterName: k, dubberId: v as string }));
              }
            } catch (e) {}

            const existingAssignments = Array.isArray(latestEp.assignments) ? latestEp.assignments : [];
            const existingNames = new Set(existingAssignments.map(a => a.characterName));

            const toAdd = mainActors.filter(name => !existingNames.has(name));

            const newAssignments = toAdd.map((actor: string) => {
              const mappingEntry = globalMapping.find(m => m.characterName === actor);
              let dubberId = mappingEntry?.dubberId || "";
              let isMain = mappingEntry?.isMain || false;

              if (!dubberId) {
                const matchedParticipant = participants.find(
                  p => p.nickname.toLowerCase() === actor.toLowerCase()
                );
                if (matchedParticipant) {
                  dubberId = matchedParticipant.id;
                }
              }

              const dubber = participants.find(p => p.id === dubberId);
              return {
                id: `${latestEp.id}-${actor}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                episodeId: latestEp.id,
                characterName: actor,
                dubberId: dubberId,
                dubber: dubber,
                status: "PENDING",
                lineCount: lineCounts[actor] || 0,
                isMain: isMain
              };
            });

            return [...existingAssignments, ...newAssignments];
          }
        } catch (e) {
          console.error("Auto-extract characters failed:", e);
        }
        return latestEp.assignments || [];
      };

      const updateData: any = {};

      // CASE 1: Video import with selected embedded subtitle track
      if (type === 'RAW' && ext === 'mkv' && selectedSubtitleStreamIndex !== undefined) {
        setStatus("Извлечение субтитров из MKV...");
        const tempSubPath = filePath.replace(/\.mkv$/i, `_track${selectedSubtitleStreamIndex}.ass`);
        let finalSubPath = '';

        try {
          const extractRes = await ipcSafe.invoke('extract-subtitle-track', {
            videoPath: filePath,
            outputPath: tempSubPath,
            streamIndex: selectedSubtitleStreamIndex
          });
          if (extractRes && extractRes.path) {
            const subCopyRes = await ipcSafe.invoke('copy-file', {
              sourcePath: extractRes.path,
              targetDir: subDir,
              fileName: 'subtitles.ass'
            });
            finalSubPath = subCopyRes?.path || extractRes.path;
            if (extractRes.path !== finalSubPath) {
              try { await ipcSafe.invoke('delete-file', extractRes.path); } catch(e) {}
            }
          }
        } catch (extErr) {
          console.error("Subtitle extraction failed:", extErr);
        }

        setStatus("Копирование видеофайла...");
        const copyVideoRes = await ipcSafe.invoke('copy-file', {
          sourcePath: filePath,
          targetDir: subDir,
          fileName: isHardsubEnabled ? 'raw_video_hardsub.mkv' : 'raw_video.mkv'
        });
        const finalVideoPath = copyVideoRes?.path || filePath;

        updateData.rawPath = finalVideoPath;
        updateData.isHardsub = isHardsubEnabled;

        if (finalSubPath) {
          updateData.subPath = finalSubPath;
          updateData.assignments = await extractActorsAndAssign(finalSubPath);
        }

        if (updateData.subPath || latestEp.subPath) {
          updateData.status = 'ROLES';
        }

        // Enqueue background transcode MKV -> MP4
        const mp4OutputPath = finalVideoPath.replace(/\.mkv$/i, '.mp4');
        try {
          await ipcSafe.invoke('enqueue-ffmpeg-task', {
            type: 'transcode-video',
            payload: {
              videoPath: finalVideoPath,
              outputPath: mp4OutputPath,
              options: { audioStreamIndex: selectedAudioStreamIndex }
            },
            metadata: {
              title: `Конвертация серии ${latestEp.number} (MKV -> MP4)`,
              episodeId: latestEp.id,
              episodeNumber: latestEp.number,
              projectId: selectedProject?.id,
              outputPath: mp4OutputPath
            }
          });
          toast.info(`Серия ${latestEp.number}: Конвертация MKV в MP4 запущена в фоновом режиме.`);
        } catch (tqErr) {
          console.error('Failed to enqueue transcode task:', tqErr);
        }

        const mergedEp = { ...latestEp, ...updateData };
        await ipcSafe.invoke('save-episode', mergedEp);
        onRefresh();
        toast.success(`Серия ${latestEp.number}: Видео и субтитры успешно импортированы!`);
        return;
      }

      // CASE 2: Subtitle-only extraction from MKV
      if (type === 'SUB' && ext === 'mkv') {
        if (selectedSubtitleStreamIndex === undefined) {
          return;
        }
        setStatus("Извлечение субтитров из MKV...");
        const tempSubPath = filePath.replace(/\.mkv$/i, `_track${selectedSubtitleStreamIndex}.ass`);
        let finalSubPath = '';

        const extractRes = await ipcSafe.invoke('extract-subtitle-track', {
          videoPath: filePath,
          outputPath: tempSubPath,
          streamIndex: selectedSubtitleStreamIndex
        });

        if (extractRes && extractRes.path) {
          const subCopyRes = await ipcSafe.invoke('copy-file', {
            sourcePath: extractRes.path,
            targetDir: subDir,
            fileName: 'subtitles.ass'
          });
          finalSubPath = subCopyRes?.path || extractRes.path;
          if (extractRes.path !== finalSubPath) {
            try { await ipcSafe.invoke('delete-file', extractRes.path); } catch(e) {}
          }
        }

        if (finalSubPath) {
          try {
            const proj: Project | null = await ipcSafe.invoke('get-project', selectedProject?.id);
            if (proj && Array.isArray(proj.episodes)) {
              const found = proj.episodes.find((e: any) => e.id === latestEp.id);
              if (found) latestEp = found;
            }
          } catch (e) {}

          updateData.subPath = finalSubPath;
          updateData.assignments = await extractActorsAndAssign(finalSubPath);
          if (latestEp.rawPath) {
            updateData.status = 'ROLES';
          }
          const mergedEp = { ...latestEp, ...updateData };
          await ipcSafe.invoke('save-episode', mergedEp);
          onRefresh();
          toast.success(`Серия ${latestEp.number}: Субтитры из MKV успешно извлечены и прикреплены!`);
        } else {
          toast.error("Не удалось извлечь субтитры из MKV файла.");
        }
        return;
      }

      // CASE 3 & 4: Standard file copy for RAW or SUB
      const isMkv = type === 'RAW' && ext === 'mkv';
      const originalExt = filePath.split('.').pop() || (type === 'RAW' ? (isMkv ? 'mkv' : 'mp4') : 'ass');
      const targetFileName = type === 'RAW'
        ? (isHardsubEnabled ? `raw_video_hardsub.${originalExt}` : `raw_video.${originalExt}`)
        : `subtitles.${originalExt}`;

      const copyRes = await ipcSafe.invoke('copy-file', {
        sourcePath: filePath,
        targetDir: subDir,
        fileName: targetFileName
      });

      if (copyRes && copyRes.path) {
        if (type === 'RAW') {
          updateData.rawPath = copyRes.path;
          updateData.isHardsub = isHardsubEnabled;

          if (isMkv) {
            const mp4OutputPath = copyRes.path.replace(/\.mkv$/i, '.mp4');
            try {
              await ipcSafe.invoke('enqueue-ffmpeg-task', {
                type: 'transcode-video',
                payload: {
                  videoPath: copyRes.path,
                  outputPath: mp4OutputPath,
                  options: { audioStreamIndex: selectedAudioStreamIndex }
                },
                metadata: {
                  title: `Конвертация серии ${latestEp.number} (MKV -> MP4)`,
                  episodeId: latestEp.id,
                  episodeNumber: latestEp.number,
                  projectId: selectedProject?.id,
                  outputPath: mp4OutputPath
                }
              });
              toast.info(`Серия ${latestEp.number}: Конвертация MKV в MP4 добавлена в очередь задач.`);
            } catch (tqErr) {
              console.error('Failed to enqueue transcode task:', tqErr);
            }
          }
        } else {
          updateData.subPath = copyRes.path;
          updateData.assignments = await extractActorsAndAssign(copyRes.path);
        }

        if ((updateData.subPath || latestEp.subPath) && (updateData.rawPath || latestEp.rawPath)) {
          updateData.status = 'ROLES';
        }

        const mergedEp = { ...latestEp, ...updateData };
        await ipcSafe.invoke('save-episode', mergedEp);
        onRefresh();
        toast.success(`${type === 'RAW' ? 'Видео' : 'Субтитры'} успешно загружены!`);
      } else {
        toast.error('Ошибка при сохранении файла: Не удалось получить путь к файлу.');
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Upload error:', error);
        toast.error('Ошибка при обработке файла: ' + (error.message || String(error)));
      }
    } finally {
      setIsUploading(false);
      setStatus('');
      setTranscodingProgress(null);
    }
  };

  const handleFileSelect = async (type: 'RAW' | 'SUB') => {
    if (!currentEpisode) return;

    setIsUploading(true);
    
    try {
      const res = await ipcSafe.invoke('select-file', {
        filters: type === 'RAW' 
          ? [{ name: 'Videos', extensions: ['mp4', 'webm', 'mkv', 'avi', 'mov', 'ts', 'flv'] }] 
          : [{ name: 'Subtitles', extensions: ['ass', 'srt', 'vtt', 'ssa'] }]
      });

      if (!res || !res.path) {
        setIsUploading(false);
        return;
      }

      const filePath = res.path;
      const fileName = filePath.split(/[\\/]/).pop() || 'file';
      const ext = fileName.split('.').pop()?.toLowerCase();
      
      if ((type === 'RAW' || type === 'SUB') && ext === 'mkv') {
        setStatus("Чтение метаданных MKV...");
        const { subtitles, audios } = await inspectMkvTracks(filePath);
        if (subtitles.length > 0 || (audios.length > 1 && type === 'RAW')) {
          setSubtitleTracks(subtitles);
          setAudioTracks(audios);
          if (audios.length > 0) setSelectedAudioIndex(audios[0].index);
          setSelectedSubtitleIndex(undefined);
          setPendingMkvUpload({ filePath, type, episodeId: currentEpisode.id });
          setIsSubtitleSelectModalOpen(true);
          return;
        }
      }

      await processFileUpload(filePath, type);
    } catch (error: any) {
      if (error && error.message === 'Selection canceled') {
        setIsUploading(false);
        return;
      }
      console.error('Upload error:', error);
      toast.error('Ошибка при загрузке файла: ' + (error instanceof Error ? error.message : String(error)));
      setIsUploading(false);
    }
  };

  const handleMkvConfirmSingle = async (chosenSubIndex?: number, chosenAudioIndex?: number) => {
    if (!pendingMkvUpload) return;
    const { filePath, type, episodeId } = pendingMkvUpload;
    setIsSubtitleSelectModalOpen(false);
    await processFileUpload(filePath, type, chosenSubIndex, chosenAudioIndex, episodeId);
    setPendingMkvUpload(null);
    setSubtitleTracks([]);
    setAudioTracks([]);
  };

  const handleMkvConfirmMultiMerge = async (selectedTracks: MkvTrackInfo[], chosenAudioIndex?: number) => {
    if (!pendingMkvUpload) return;
    const { filePath, type, episodeId } = pendingMkvUpload;
    setIsMkvExtracting(true);
    setStatus("Извлечение выбранных дорожек субтитров из MKV...");
    try {
      const extracted = await extractSelectedMkvTracks(filePath, selectedTracks);
      if (extracted.length === 0) {
        toast.error("Не удалось извлечь выбранные субтитры из MKV");
        setIsMkvExtracting(false);
        setIsUploading(false);
        return;
      }

      if (type === 'RAW') {
        await processFileUpload(filePath, 'RAW', undefined, chosenAudioIndex, episodeId);
      }

      setMultiMergeInitialFiles(extracted);
      setMultiMergeTargetEpisodeId(episodeId);
      setIsSubtitleSelectModalOpen(false);
      setPendingMkvUpload(null);
      setSubtitleTracks([]);
      setAudioTracks([]);
      setIsMultiSubMergeModalOpen(true);
      toast.success(`Извлечено ${extracted.length} дорожек субтитров. Открыт мульти-импорт!`);
    } catch (err: any) {
      console.error("Multi-sub extraction error:", err);
      toast.error("Ошибка извлечения субтитров: " + (err.message || String(err)));
    } finally {
      setIsMkvExtracting(false);
      setIsUploading(false);
      setStatus("");
    }
  };

  const handleExtractSubtitlesFromEpisodeRaw = async () => {
    if (!currentEpisode?.rawPath) {
      toast.error('У текущей серии нет прикрепленного RAW видео');
      return;
    }
    const ext = (currentEpisode.rawPath.split('.').pop() || '').toLowerCase();
    if (ext === 'mkv') {
      try {
        const { subtitles, audios } = await inspectMkvTracks(currentEpisode.rawPath);
        if (subtitles.length > 0) {
          setSubtitleTracks(subtitles);
          setAudioTracks(audios);
          setPendingMkvUpload({ filePath: currentEpisode.rawPath, type: 'SUB', episodeId: currentEpisode.id });
          setIsSubtitleSelectModalOpen(true);
          return;
        } else {
          toast.info('В MKV файле этой серии не найдено встроенных субтитров');
        }
      } catch (e) {
        console.warn('Could not inspect rawPath for subtitles:', e);
      }
    }
    setMultiMergeInitialFiles([]);
    setIsMultiSubMergeModalOpen(true);
  };

  const handleYoutubeDownload = async (url: string, formatId: string, subLang: string) => {
    if (!currentEpisode || !selectedProject) return;

    setStatus('Скачивание с YouTube...');
    try {
      const projectTitle = sanitizeFolderName(selectedProject.title || 'Project');
      const episodeFolder = sanitizeFolderName(`Episode_${currentEpisode.number}`);
      const targetDir = `${projectTitle}/${episodeFolder}`;
      const baseFilename = `yt_${Date.now()}`;
      
      const res = await ipcSafe.invoke('youtube-download', {
        url, formatId, subLang, targetDir, baseFilename
      });

      if (res && (res.videoFile || res.subFile)) {
        const episodeToUpdate = { ...currentEpisode };
        if (res.videoFile) episodeToUpdate.rawPath = res.videoFile;
        if (res.subFile) {
          episodeToUpdate.subPath = res.subFile;
          // Trigger get-raw-subtitles so it handles formatting later
        }

        await ipcSafe.invoke('save-episode', episodeToUpdate);
        toast.success('Успешно скачано с YouTube!');
        onRefresh();
      }
    } catch (err: any) {
      toast.error('Ошибка: ' + err.message);
      throw err;
    } finally {
      setStatus('');
    }
  };

  const handleTranscodeCurrentEpisodeMkv = async () => {
    if (!currentEpisode || !currentEpisode.rawPath || !currentEpisode.rawPath.toLowerCase().endsWith('.mkv')) {
      return;
    }
    const mp4OutputPath = currentEpisode.rawPath.replace(/\.mkv$/i, '.mp4');
    try {
      await ipcSafe.invoke('enqueue-ffmpeg-task', {
        type: 'transcode-video',
        payload: {
          videoPath: currentEpisode.rawPath,
          outputPath: mp4OutputPath,
          options: {}
        },
        metadata: {
          title: `Конвертация серии ${currentEpisode.number} (MKV -> MP4)`,
          episodeId: currentEpisode.id,
          projectId: selectedProject?.id,
          outputPath: mp4OutputPath
        }
      });
      toast.info(`Серия ${currentEpisode.number}: Конвертация MKV в MP4 добавлена в очередь задач.`);
    } catch (err: any) {
      console.error('Failed to enqueue transcode:', err);
      toast.error('Не удалось запустить конвертацию: ' + (err.message || 'Ошибка'));
    }
  };

  useEffect(() => {
    getParticipants().then(setParticipants);
    ipcSafe.invoke('get-config').then(data => {});
    
    // Fetch initial tasks
    ipcSafe.invoke('get-tasks').then((tasks: any[]) => {
      if (Array.isArray(tasks)) {
        const activeMap: Record<string, { id: string, progress: number, eta: number | null, title?: string, episodeId?: string }> = {};
        for (const t of tasks) {
          if (t.type === 'transcode-video' && (t.status === 'running' || t.status === 'pending')) {
            activeMap[t.id] = {
              id: t.id,
              progress: t.progress || 0,
              eta: t.eta ?? null,
              title: t.metadata?.title,
              episodeId: t.metadata?.episodeId
            };
          }
        }
        setTranscodingTasks(activeMap);
      }
    }).catch(() => {});

    let lastFfmpegTick = 0;
    const progressListener = (percent: number) => {
      const now = Date.now();
      if (now - lastFfmpegTick > 120 || percent === 100 || percent === 0) {
        lastFfmpegTick = now;
        setTranscodingProgress(percent);
      }
    };
    const unsubFfmpeg = ipcSafe.on('ffmpeg-progress', progressListener);

    let lastTaskTick = 0;
    const unsubTaskProgress = ipcSafe.on('task-progress', (data: { id: string, progress: number, eta: number | null, task?: any }) => {
      if (data && data.id) {
        const now = Date.now();
        if (now - lastTaskTick > 120 || data.progress === 100 || data.progress === 0) {
          lastTaskTick = now;
          setTranscodingProgress(data.progress);
          setTranscodingTasks(prev => {
            const existing = prev[data.id] || { id: data.id, progress: 0, eta: null };
            return {
              ...prev,
              [data.id]: {
                ...existing,
                id: data.id,
                progress: data.progress,
                eta: data.eta,
                episodeId: data.task?.metadata?.episodeId || existing.episodeId,
                title: data.task?.metadata?.title || existing.title
              }
            };
          });
        }
      }
    });

    const unsubQueueUpdated = ipcSafe.on('task-queue-updated', (tasks: any[]) => {
      if (Array.isArray(tasks)) {
        const activeMap: Record<string, { id: string, progress: number, eta: number | null, title?: string, episodeId?: string }> = {};
        for (const t of tasks) {
          if (t.type === 'transcode-video' && (t.status === 'running' || t.status === 'pending')) {
            activeMap[t.id] = {
              id: t.id,
              progress: t.progress || 0,
              eta: t.eta ?? null,
              title: t.metadata?.title,
              episodeId: t.metadata?.episodeId
            };
          }
        }
        setTranscodingTasks(activeMap);
      }
    });

    const unsubTaskCompleted = ipcSafe.on('task-completed', (data: any) => {
      if (data?.id) {
        setTranscodingTasks(prev => {
          const next = { ...prev };
          delete next[data.id];
          return next;
        });
      }
      if (data?.task?.type === 'transcode-video') {
        setTranscodingProgress(null);
        onRefresh();
      }
    });

    const unsubEpisodeUpdated = ipcSafe.on('episode-updated', () => {
      onRefresh();
    });
    
    return () => {
      unsubFfmpeg();
      unsubTaskProgress();
      unsubQueueUpdated();
      unsubTaskCompleted();
      unsubEpisodeUpdated();
    };
  }, []);

  const [nextEpisodeDate, setNextEpisodeDate] = useState<string | null>(null);
  const [newEpisodeAvailable, setNewEpisodeAvailable] = useState<number | null>(null);
  const projectTrackerCacheRef = useRef<Map<string, { timestamp: number; ep: number | null }>>(new Map());

  useEffect(() => {
    const fetchNextDate = async () => {
      if (selectedProject?.nextEpisodeDate) {
        setNextEpisodeDate(selectedProject.nextEpisodeDate);
      } else {
        setNextEpisodeDate(null);
      }
      
      const queryTitle = selectedProject?.originalTitle || selectedProject?.title;
      if (queryTitle) {
        try {
          const date = await getNextEpisodeDate(queryTitle);
          if (date) {
            setNextEpisodeDate(date);
          }
        } catch (e) {
          console.error('Error fetching/updating next episode date on layout match:', e);
        }
      }
    };
    fetchNextDate();
  }, [selectedProject?.id]);

  useEffect(() => {
    if (!selectedProject || !selectedProject.originalTitle) {
      setNewEpisodeAvailable(null);
      return;
    }

    const cacheKey = `${selectedProject.id}_${selectedProject.episodes?.length || 0}`;
    const cached = projectTrackerCacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) {
      setNewEpisodeAvailable(cached.ep);
      return;
    }

    const checkNewOnTracker = async () => {
      try {
        // Primary: Check on Anime365
        const checkRes = await ipcSafe.invoke('anime365-check-new-episodes', { projectId: selectedProject.id });
        if (checkRes && checkRes.maxEpisode) {
          const currentMaxEp = selectedProject.episodes?.reduce((max, ep) => Math.max(max, ep.number), 0) || 0;
          if (checkRes.maxEpisode > currentMaxEp) {
            setNewEpisodeAvailable(checkRes.maxEpisode);
            projectTrackerCacheRef.current.set(cacheKey, { timestamp: Date.now(), ep: checkRes.maxEpisode });
            return;
          } else {
            setNewEpisodeAvailable(null);
            projectTrackerCacheRef.current.set(cacheKey, { timestamp: Date.now(), ep: null });
            return;
          }
        }
      } catch (err) {
        console.warn('Anime365 episode announcement check failed, falling back to Nyaa tracker:', err);
      }

      try {
        // Fallback: Quietly search for RAWs on Nyaa
        const results = await ipcSafe.invoke('search-nyaa-torrents', {
           query: selectedProject.originalTitle,
           category: 'anime',
           subCategory: 'raw'
        });
        
        if (results && Array.isArray(results) && results.length > 0) {
           let maxEpFound = 0;
           results.forEach(r => {
              const match = r.title ? r.title.match(/[ -_]0*([1-9]\d*)[ -_xv]/i) : null;
              if (match) {
                 const ep = parseInt(match[1]);
                 if (ep > maxEpFound && ep < 1000) maxEpFound = ep;
              }
           });
           
           const currentMaxEp = selectedProject.episodes?.reduce((max, ep) => Math.max(max, ep.number), 0) || 0;
           const finalEp = maxEpFound > currentMaxEp ? maxEpFound : null;
           setNewEpisodeAvailable(finalEp);
           projectTrackerCacheRef.current.set(cacheKey, { timestamp: Date.now(), ep: finalEp });
        } else {
           setNewEpisodeAvailable(null);
           projectTrackerCacheRef.current.set(cacheKey, { timestamp: Date.now(), ep: null });
        }
      } catch (err) {
        console.warn('Network error or tracker unavailable during new episode check', err);
      }
    };
    checkNewOnTracker();
  }, [selectedProject?.id, selectedProject?.originalTitle, selectedProject?.episodes?.length]);

  const stats = useMemo(() => ({
    totalProjects: projects.length,
    activeEpisodes: projects.reduce((acc, p) => acc + (p.episodes?.filter(e => e.status !== 'FINISHED')?.length || 0), 0),
    finishedEpisodes: projects.reduce((acc, p) => acc + (p.episodes?.filter(e => e.status === 'FINISHED')?.length || 0), 0),
    pendingFixes: projects.reduce((acc, p) => acc + (p.episodes?.filter(e => e.status === 'FIXES')?.length || 0), 0)
  }), [projects]);

  const recentEpisodes = useMemo(() => projects
    .flatMap(p => (p.episodes || []).map(e => ({ ...e, projectTitle: p.title })))
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
    .slice(0, 5), [projects]);

  const handleSaveProjectDubbers = async (selectedDubbers: string[]) => {
    if (!selectedProject) return;
    const allowedDubbers = new Set(selectedDubbers);

    // Clean globalMapping
    let cleanedGlobalMapping = selectedProject.globalMapping;
    if (selectedProject.globalMapping) {
      try {
        const mapping = typeof selectedProject.globalMapping === 'string' ? JSON.parse(selectedProject.globalMapping) : selectedProject.globalMapping;
        if (Array.isArray(mapping)) {
          mapping.forEach((m: any) => {
            if (m.dubberId && !allowedDubbers.has(m.dubberId)) {
              m.dubberId = '';
            }
          });
          cleanedGlobalMapping = JSON.stringify(mapping);
        }
      } catch (e) {
        console.error('Error cleaning globalMapping in local state:', e);
      }
    }

    // Clean episode assignments
    const cleanedEpisodes = (selectedProject.episodes || []).map(ep => ({
      ...ep,
      assignments: (ep.assignments || []).map(a => ({
        ...a,
        dubberId: a.dubberId && !allowedDubbers.has(a.dubberId) ? undefined : a.dubberId,
        substituteId: a.substituteId && !allowedDubbers.has(a.substituteId) ? undefined : a.substituteId,
        dubber: a.dubberId && !allowedDubbers.has(a.dubberId) ? undefined : a.dubber,
        substitute: a.substituteId && !allowedDubbers.has(a.substituteId) ? undefined : a.substitute,
      }))
    }));

    const updatedProject = {
      ...selectedProject,
      assignedDubberIds: selectedDubbers,
      globalMapping: cleanedGlobalMapping,
      episodes: cleanedEpisodes
    };
    await ipcSafe.invoke('save-project', updatedProject);
    toast.success('Состав даберов обновлен. Привязки снятых даберов очищены.');
    onRefresh();
    setIsAssignDubbersModalOpen(false);
  };


  const handleCreateProject = async (projectData: any) => {
    try {
      const newProject = {
        id: Date.now().toString(),
        title: projectData.title,
        originalTitle: projectData.originalTitle || '',
        releaseType: projectData.releaseType || 'VOICEOVER',
        emoji: projectData.emoji || '❤️',
        isOngoing: projectData.isOngoing ?? true,
        synopsis: projectData.synopsis || '',
        posterUrl: projectData.posterUrl || '',
        typeAndSeason: projectData.typeAndSeason || '',
        totalEpisodes: projectData.totalEpisodes || 12,
        globalMapping: JSON.stringify(Array.isArray(projectData.characters) ? projectData.characters.map((c: any) => ({ characterName: c.name, dubberId: c.dubberId, photoUrl: c.photoUrl })) : []),
        links: JSON.stringify({ tg: '', vk: '', anime365: '', shikimori: '', kodik: '' }),
        status: 'ACTIVE' as const,
        lastActiveEpisode: 1,
        assignedDubberIds: [],
        episodes: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      await ipcSafe.invoke('save-project', newProject);
      toast.success('Проект успешно создан!');
      onRefresh();
      onProjectSelect(newProject.id);
      setIsNewProjectModalOpen(false);
    } catch (e) {
      console.error("Failed to create project:", e);
      toast.error('Ошибка при создании проекта');
    }
  };

  const handleDeleteProject = async () => {
    if (!selectedProjectId) return;
    setConfirmState({
      isOpen: true,
      title: 'Удаление проекта',
      message: 'Вы уверены, что хотите удалить этот проект и все его серии? Это действие необратимо.',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await ipcSafe.invoke('delete-project', selectedProjectId);
          onProjectSelect('');
          onRefresh();
          setIsDeleteProjectModalOpen(false);
          toast.success('Проект удален');
        } catch (error) {
          console.error("Failed to delete project:", error);
          toast.error('Ошибка при удалении проекта');
        }
      }
    });
  };

  const handleDeleteEpisode = async () => {
    if (!currentEpisode) return;
    setConfirmState({
      isOpen: true,
      title: 'Удаление серии',
      message: `Вы уверены, что хотите удалить серию ${currentEpisode.number}?`,
      variant: 'danger',
      onConfirm: async () => {
        try {
          await ipcSafe.invoke('delete-episode', currentEpisode.id);
          onRefresh();
          setIsDeleteEpisodeModalOpen(false);
          toast.success('Серия удалена');
        } catch (error) {
          console.error("Failed to delete episode:", error);
          toast.error('Ошибка при удалении серии');
        }
      }
    });
  };

  const handleFinishEpisode = async () => {
    if (!currentEpisode) return;
    
    setConfirmState({
      isOpen: true,
      title: 'Завершение серии',
      message: `Вы уверены, что хотите отметить серию ${currentEpisode.number} как завершенную?`,
      variant: 'info',
      onConfirm: async () => {
        try {
          const updatedEpisode = {
            ...currentEpisode,
            status: 'FINISHED' as EpisodeStatus
          };
          await ipcSafe.invoke('save-episode', updatedEpisode);
          onRefresh();
          toast.success('Серия завершена!');
        } catch (error) {
          console.error("Failed to finish episode:", error);
          toast.error('Ошибка при завершении серии');
        }
      }
    });
  };

  const handleCreateEpisode = async (episodeNumber: number, customTitle?: string, customDeadline?: string) => {
    if (!selectedProjectId || !selectedProject) return;
    
    // Check if episode with this number already exists
    const alreadyExists = selectedProject.episodes?.some(e => e.number === episodeNumber);
    if (alreadyExists) {
      toast.error(`Серия ${episodeNumber} уже добавлена в этот проект!`);
      return;
    }

    try {
      let episodeTitle = customTitle?.trim() || '';

      // Quick non-blocking attempt to fetch title if not provided by user
      if (!episodeTitle) {
        try {
          const timeoutPromise = new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 1500)
          );
          const fetchPromise = ipcSafe.invoke('get-episode-title', {
            title: selectedProject.title,
            originalTitle: selectedProject.originalTitle,
            episodeNumber,
            anime365Id: selectedProject.anime365Id
          });
          const fetchedTitle = await Promise.race([fetchPromise, timeoutPromise]);
          if (fetchedTitle && typeof fetchedTitle === 'string') {
            episodeTitle = fetchedTitle;
          }
        } catch {
          // Graceful non-blocking fallback
        }
      }

      const initialDeadline = customDeadline || calculateDeadline(selectedProject);
      const newEpisode: Episode = {
        id: Date.now().toString(),
        projectId: selectedProjectId,
        number: episodeNumber,
        title: episodeTitle,
        status: 'UPLOAD',
        deadline: initialDeadline,
        assignments: [],
        uploads: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      await ipcSafe.invoke('save-episode', newEpisode);

      // Keep project's lastActiveEpisode updated to the new episode
      await ipcSafe.invoke('save-project', {
        ...selectedProject,
        lastActiveEpisode: episodeNumber
      });
      
      await onRefresh();
      if (onEpisodeSelect) {
        onEpisodeSelect(episodeNumber);
      }
      setIsNewEpisodeModalOpen(false);
      toast.success(`Серия ${episodeNumber} успешно добавлена!`);
    } catch (e: any) {
      console.error('Failed to create episode:', e);
      toast.error(`Ошибка при создании серии: ${e?.message || 'Неизвестная ошибка'}`);
    }
  };

  const handleExportProject = async () => {
    if (!selectedProject) return;
    
    // Get all participants to include them in the export for full portability
    const allParticipants = await ipcSafe.invoke('get-participants');
    
    const exportData = {
      type: "PROJECT_RELEASE_BUNDLE",
      version: "1.2",
      exportDate: new Date().toISOString(),
      project: selectedProject,
      // Full list of participants ensures we can restore all references
      participants: allParticipants,
      // We can also include some summary stats for the "Audit"
      audit: {
        totalEpisodes: selectedProject.episodes?.length || 0,
        totalAssignments: selectedProject.episodes?.reduce((acc, ep) => acc + (ep.assignments?.length || 0), 0) || 0,
        totalUploads: selectedProject.episodes?.reduce((acc, ep) => acc + (ep.uploads?.length || 0), 0) || 0,
        completedEpisodes: selectedProject.episodes?.filter(ep => ep.status === 'FINISHED')?.length || 0
      }
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `${selectedProject.title}_release_audit_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleAssignRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentEpisode || !selectedUserId || !characterName || !selectedProject) return;

    // Check aliases
    const aliases: Record<string, string> = JSON.parse(selectedProject.characterAliases || '{}');
    const mainName = aliases[characterName] || characterName;

    const updateProjectGlobalMapping = async (char: string, dubberId: string) => {
      let gMap: { characterName: string; dubberId: string; isMain?: boolean }[] = [];
      try {
        const parsed = JSON.parse(selectedProject.globalMapping || '[]');
        gMap = Array.isArray(parsed) ? parsed : Object.entries(parsed).map(([k, v]) => ({ characterName: k, dubberId: v as string }));
      } catch (e) {
        gMap = [];
      }

      const seen = new Set<string>();
      let found = false;
      const updatedGMap: typeof gMap = [];

      for (const item of gMap) {
        if (!item.characterName || seen.has(item.characterName)) continue;
        seen.add(item.characterName);
        if (item.characterName === char) {
          found = true;
          updatedGMap.push({ ...item, dubberId });
        } else {
          updatedGMap.push(item);
        }
      }
      if (!found) {
        updatedGMap.push({ characterName: char, dubberId });
      }

      const assignedDubberIds = Array.isArray(selectedProject.assignedDubberIds)
        ? [...selectedProject.assignedDubberIds]
        : [];
      if (!assignedDubberIds.includes(dubberId)) {
        assignedDubberIds.push(dubberId);
      }

      const updatedMappingStr = JSON.stringify(updatedGMap);
      selectedProject.globalMapping = updatedMappingStr;
      selectedProject.assignedDubberIds = assignedDubberIds;

      const { episodes: _eps, soundEngineer: _se, assignedDubbers: _ad, ...projToSave } = selectedProject;
      await ipcSafe.invoke('save-project', {
        ...projToSave,
        assignedDubberIds,
        globalMapping: updatedMappingStr
      });
    };

    // Check if already assigned in this episode
    const existing = Array.isArray(currentEpisode.assignments) ? currentEpisode.assignments.find(a => a.characterName === mainName) : undefined;
    if (existing) {
      if (existing.dubberId === selectedUserId) {
        toast.error('Этот дабер уже назначен на этого персонажа в этой серии.');
        return;
      }
      
      setConfirmState({
        isOpen: true,
        title: 'Переназначение роли',
        message: `Персонаж "${mainName}" уже назначен на ${participants.find(p => p.id === existing.dubberId)?.nickname}. Переназначить на ${participants.find(p => p.id === selectedUserId)?.nickname}?`,
        onConfirm: async () => {
          // Remove existing assignment for this character
          const currentAssignments = Array.isArray(currentEpisode.assignments) ? currentEpisode.assignments.filter(a => a.characterName !== mainName) : [];
          
          const newAssignment = {
            id: Date.now().toString(),
            episodeId: currentEpisode.id,
            characterName: mainName,
            dubberId: selectedUserId,
            status: 'PENDING'
          };
          
          const updatedEpisode = {
            ...currentEpisode,
            assignments: [...currentAssignments, newAssignment]
          };
          
          await ipcSafe.invoke('save-episode', updatedEpisode);
          await updateProjectGlobalMapping(mainName, selectedUserId);
          onRefresh();
          toast.success('Роль переназначена');
        }
      });
      return;
    }

    const newAssignment = {
      id: Date.now().toString(),
      episodeId: currentEpisode.id,
      characterName: mainName,
      dubberId: selectedUserId,
      status: 'PENDING'
    };
    
    const updatedEpisode = {
      ...currentEpisode,
      assignments: [...(Array.isArray(currentEpisode.assignments) ? currentEpisode.assignments : []), newAssignment]
    };
    
    await ipcSafe.invoke('save-episode', updatedEpisode);
    await updateProjectGlobalMapping(mainName, selectedUserId);

    onRefresh();
    setIsAssignModalOpen(false);
    setSelectedUserId('');
    setCharacterName('');
  };

  const handleAssignSoundEngineer = async (soundEngineerId: string) => {
    if (selectedProject) {
      const updatedProject = { ...selectedProject, soundEngineerId };
      await ipcSafe.invoke('save-project', updatedProject);
    }
    onRefresh();
    setIsAssignSoundEngineerModalOpen(false);
  };


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
