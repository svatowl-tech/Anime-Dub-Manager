import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { getParticipants } from '../../services/dbService';
import { Participant, Project, Episode } from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';
import {
  generateStartEpisodeMessage,
  generateStatusMessage,
  generateSoundEngineerMessage
} from '../../lib/templates';
import { sanitizeFolderName } from '../../lib/pathUtils';
import { SubFileItem } from '../MultiSubtitleMergeModal';
import {
  inspectMkvTracks,
  extractSelectedMkvTracks,
  MkvTrackInfo
} from '../../lib/mkvSubtitleExtractor';
import { extractActorsAndAssignFromSubtitles } from './useDashboardProjectAndRoles';

export interface UseDashboardMediaAndUploadsParams {
  projects: Project[];
  selectedProject: Project | undefined;
  currentEpisode: Episode | null;
  participants: Participant[];
  setParticipants: React.Dispatch<React.SetStateAction<Participant[]>>;
  onRefresh: () => void;
}

export function useDashboardMediaAndUploads({
  projects,
  selectedProject,
  currentEpisode,
  participants,
  setParticipants,
  onRefresh
}: UseDashboardMediaAndUploadsParams) {
  const [isUploading, setIsUploading] = useState(false);
  const [transcodingProgress, setTranscodingProgress] = useState<number | null>(null);
  const [transcodingTasks, setTranscodingTasks] = useState<
    Record<string, { id: string; progress: number; eta: number | null; title?: string; episodeId?: string }>
  >({});
  const [status, setStatus] = useState<string>('');

  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportRole, setExportRole] = useState<'DABBER' | 'SOUND_ENGINEER'>('DABBER');

  const [generatedMessage, setGeneratedMessage] = useState<string | null>(null);
  const [isMessageModalOpen, setIsMessageModalOpen] = useState(false);
  const [isMessageCopied, setIsMessageCopied] = useState(false);
  const [isHardsubEnabled, setIsHardsubEnabled] = useState(false);
  const [subtitleTracks, setSubtitleTracks] = useState<MkvTrackInfo[]>([]);
  const [audioTracks, setAudioTracks] = useState<MkvTrackInfo[]>([]);
  const [pendingMkvUpload, setPendingMkvUpload] = useState<{
    filePath: string;
    type: 'RAW' | 'SUB';
    episodeId?: string;
  } | null>(null);
  const [isSubtitleSelectModalOpen, setIsSubtitleSelectModalOpen] = useState(false);
  const [isMkvExtracting, setIsMkvExtracting] = useState(false);
  const [selectedSubtitleIndex, setSelectedSubtitleIndex] = useState<number | undefined>();
  const [selectedAudioIndex, setSelectedAudioIndex] = useState<number | undefined>();
  const [isMultiSubMergeModalOpen, setIsMultiSubMergeModalOpen] = useState(false);
  const [multiMergeInitialFiles, setMultiMergeInitialFiles] = useState<SubFileItem[]>([]);
  const [multiMergeTargetEpisodeId, setMultiMergeTargetEpisodeId] = useState<string | undefined>(undefined);

  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  useEffect(() => {
    if (currentEpisode) {
      setIsHardsubEnabled(currentEpisode.isHardsub || false);
    }
  }, [currentEpisode]);

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

  useEffect(() => {
    getParticipants().then(setParticipants);

    // Fetch initial tasks
    ipcSafe
      .invoke('get-tasks')
      .then((tasks: any[]) => {
        if (Array.isArray(tasks)) {
          const activeMap: Record<
            string,
            { id: string; progress: number; eta: number | null; title?: string; episodeId?: string }
          > = {};
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
      })
      .catch(() => {});

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
    const unsubTaskProgress = ipcSafe.on(
      'task-progress',
      (data: { id: string; progress: number; eta: number | null; task?: any }) => {
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
      }
    );

    const unsubQueueUpdated = ipcSafe.on('task-queue-updated', (tasks: any[]) => {
      if (Array.isArray(tasks)) {
        const activeMap: Record<
          string,
          { id: string; progress: number; eta: number | null; title?: string; episodeId?: string }
        > = {};
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
  }, [onRefresh, setParticipants]);

  const handleExport = async (
    targetDir: string,
    skipConversion: boolean,
    smartExport?: boolean,
    _uploadToYandex?: boolean,
    additionalProcessing?: boolean,
    autoApplyFixes?: boolean,
    includeSubtitles?: boolean,
    autoTiming?: boolean,
    selectedTrackIds?: string[]
  ) => {
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
          autoTiming: autoTiming ?? false,
          selectedTrackIds: Array.isArray(selectedTrackIds) ? selectedTrackIds : undefined
        },
        metadata: {
          title: `Экспорт ${roleName}: ${currentEpisode.project?.title || 'Проект'} - Серия ${currentEpisode.number}`,
          episodeId: currentEpisode.id,
          roleName: exportRole,
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

      const projectTitle = sanitizeFolderName(selectedProject?.title || 'Project');
      const episodeFolder = sanitizeFolderName(`Episode_${episodeToUpdate.number}`);
      const subDir = `${projectTitle}/${episodeFolder}`;

      let latestEp = episodeToUpdate;
      try {
        const proj: Project | null = await ipcSafe.invoke('get-project', selectedProject?.id);
        if (proj && Array.isArray(proj.episodes)) {
          const found = proj.episodes.find((e: any) => e.id === episodeToUpdate.id);
          if (found) latestEp = found;
        }
      } catch (e) {}

      const extractActorsAndAssign = (subPath: string) =>
        extractActorsAndAssignFromSubtitles(subPath, latestEp, selectedProject, participants);

      const updateData: any = {};

      // CASE 1: Video import with selected embedded subtitle track
      if (type === 'RAW' && ext === 'mkv' && selectedSubtitleStreamIndex !== undefined) {
        setStatus('Извлечение субтитров из MKV...');
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
              try {
                await ipcSafe.invoke('delete-file', extractRes.path);
              } catch (e) {}
            }
          }
        } catch (extErr) {
          console.error('Subtitle extraction failed:', extErr);
        }

        setStatus('Копирование видеофайла...');
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
        setStatus('Извлечение субтитров из MKV...');
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
            try {
              await ipcSafe.invoke('delete-file', extractRes.path);
            } catch (e) {}
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
          toast.error('Не удалось извлечь субтитры из MKV файла.');
        }
        return;
      }

      // CASE 3 & 4: Standard file copy for RAW or SUB
      const isMkv = type === 'RAW' && ext === 'mkv';
      const originalExt = filePath.split('.').pop() || (type === 'RAW' ? (isMkv ? 'mkv' : 'mp4') : 'ass');
      const targetFileName =
        type === 'RAW'
          ? isHardsubEnabled
            ? `raw_video_hardsub.${originalExt}`
            : `raw_video.${originalExt}`
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
        filters:
          type === 'RAW'
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
        setStatus('Чтение метаданных MKV...');
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
    setStatus('Извлечение выбранных дорожек субтитров из MKV...');
    try {
      const extracted = await extractSelectedMkvTracks(filePath, selectedTracks);
      if (extracted.length === 0) {
        toast.error('Не удалось извлечь выбранные субтитры из MKV');
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
      console.error('Multi-sub extraction error:', err);
      toast.error('Ошибка извлечения субтитров: ' + (err.message || String(err)));
    } finally {
      setIsMkvExtracting(false);
      setIsUploading(false);
      setStatus('');
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
        url,
        formatId,
        subLang,
        targetDir,
        baseFilename
      });

      if (res && (res.videoFile || res.subFile)) {
        const episodeToUpdate = { ...currentEpisode };
        if (res.videoFile) episodeToUpdate.rawPath = res.videoFile;
        if (res.subFile) {
          episodeToUpdate.subPath = res.subFile;
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

  return {
    isUploading,
    setIsUploading,
    transcodingProgress,
    setTranscodingProgress,
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
    selectedSubtitleIndex,
    selectedAudioIndex,
    isMultiSubMergeModalOpen,
    setIsMultiSubMergeModalOpen,
    multiMergeInitialFiles,
    setMultiMergeInitialFiles,
    multiMergeTargetEpisodeId,
    setMultiMergeTargetEpisodeId,
    handleExport,
    handleGenerateReminderMessage,
    processFileUpload,
    handleFileSelect,
    handleMkvConfirmSingle,
    handleMkvConfirmMultiMerge,
    handleExtractSubtitlesFromEpisodeRaw,
    handleYoutubeDownload,
    handleTranscodeCurrentEpisodeMkv
  };
}
