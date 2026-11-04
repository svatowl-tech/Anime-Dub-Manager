import { useState, useEffect, useCallback } from 'react';
import { ipcSafe } from '../../../lib/ipcSafe';
import { Episode } from '../../../types';
import { toast } from 'sonner';
import {
  MkvTrackInfo,
  formatTrackDisplayName,
  SubtitleCharacterAnalysis,
  analyzeAllMkvSubtitleTracks,
} from '../../../lib/mkvSubtitleExtractor';
import { sanitizeFolderName } from '../../../lib/pathUtils';

export interface SubFileItem {
  id: string;
  path: string;
  name: string;
  lineCount: number;
  actors: string[];
  sourceType?: 'file' | 'mkv';
  trackTitle?: string;
}

export interface UseMultiSubtitleMergeProps {
  isOpen: boolean;
  onClose: () => void;
  currentEpisode: Episode | null;
  targetEpisodeId?: string;
  onRefresh: () => void;
  initialFiles?: SubFileItem[];
  initialVideoPath?: string;
}

export function useMultiSubtitleMerge({
  isOpen,
  onClose,
  currentEpisode,
  targetEpisodeId,
  onRefresh,
  initialFiles = [],
  initialVideoPath,
}: UseMultiSubtitleMergeProps) {
  const [files, setFiles] = useState<SubFileItem[]>([]);
  const [mode, setMode] = useState<'component' | 'combine' | 'smart'>('component');

  // Component mode selections
  const [textSourceIndex, setTextSourceIndex] = useState<number>(0);
  const [styleSourceIndex, setStyleSourceIndex] = useState<number>(0);
  const [actorSourceIndex, setActorSourceIndex] = useState<number>(-1);

  const [isProcessing, setIsProcessing] = useState(false);

  // MKV Track Picker Modal state
  const [mkvPickerOpen, setMkvPickerOpen] = useState(false);
  const [pendingMkvPath, setPendingMkvPath] = useState<string | null>(null);
  const [mkvTracks, setMkvTracks] = useState<MkvTrackInfo[]>([]);
  const [selectedTrackIndexes, setSelectedTrackIndexes] = useState<number[]>([]);
  const [isExtractingTracks, setIsExtractingTracks] = useState(false);
  const [mkvTrackAnalyses, setMkvTrackAnalyses] = useState<Record<number, SubtitleCharacterAnalysis>>({});
  const [isAnalyzingMkvTracks, setIsAnalyzingMkvTracks] = useState(false);

  // Extract a specific track from video path and add to files list
  const extractAndAddTrack = useCallback(async (videoPath: string, track: MkvTrackInfo) => {
    const videoName = videoPath.split(/[\\/]/).pop() || 'video.mkv';
    const trackLabel = formatTrackDisplayName(track, 'Саб');

    const tempFileName = `extracted_sub_stream${track.index}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.ass`;
    const tempOutputPath = videoPath.replace(/\.[^/.]+$/, `_${tempFileName}`);

    const res = await ipcSafe.invoke('extract-subtitle-track', {
      videoPath,
      outputPath: tempOutputPath,
      streamIndex: track.index
    });

    if (res && res.path) {
      const raw = await ipcSafe.invoke('get-raw-subtitles', res.path);
      const lineCount = raw?.lines?.length || 0;
      const actors = raw?.actors || [];

      const newItem: SubFileItem = {
        id: `mkv-sub-${track.index}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        path: res.path,
        name: `${videoName} — ${trackLabel}`,
        lineCount,
        actors,
        sourceType: 'mkv',
        trackTitle: trackLabel
      };

      setFiles(prev => {
        const next = [...prev, newItem];
        if (next.length === 2 && mode === 'component') setStyleSourceIndex(1);
        if (next.length === 3 && mode === 'component') setActorSourceIndex(2);
        return next;
      });
      toast.success(`Дорожка "${trackLabel}" успешно извлечена!`);
    }
  }, [mode]);

  // Process video file to inspect subtitle tracks
  const inspectAndAddVideo = useCallback(async (videoPath: string) => {
    setIsProcessing(true);
    try {
      const metadataRes = await ipcSafe.invoke('get-video-metadata', videoPath);
      if (metadataRes && metadataRes.streams) {
        const subs: MkvTrackInfo[] = metadataRes.streams.filter((s: any) => s.codec_type === 'subtitle');
        if (subs.length === 0) {
          toast.error('В этом видеофайле не найдено вшитых субтитров');
          return;
        }

        if (subs.length === 1) {
          await extractAndAddTrack(videoPath, subs[0]);
        } else {
          setPendingMkvPath(videoPath);
          setMkvTracks(subs);
          setMkvPickerOpen(true);

          setIsAnalyzingMkvTracks(true);
          analyzeAllMkvSubtitleTracks(videoPath, subs, (idx, analysis) => {
            setMkvTrackAnalyses(prev => ({ ...prev, [idx]: analysis }));
          }).then((results) => {
            setMkvTrackAnalyses(results);
            setIsAnalyzingMkvTracks(false);
            const recIdx = Object.keys(results).find(k => results[Number(k)]?.isRecommendedForDubbing);
            if (recIdx) {
              setSelectedTrackIndexes([Number(recIdx)]);
            }
          }).catch(() => {
            setIsAnalyzingMkvTracks(false);
          });

          const defTrack = subs.find(s => s.disposition?.default);
          if (defTrack) {
            setSelectedTrackIndexes([defTrack.index]);
          } else {
            setSelectedTrackIndexes(subs.map(s => s.index));
          }
        }
      } else {
        toast.error('Не удалось прочитать метаданные видеофайла');
      }
    } catch (e: any) {
      console.error(e);
      toast.error('Ошибка анализа видеофайла: ' + (e.message || String(e)));
    } finally {
      setIsProcessing(false);
    }
  }, [extractAndAddTrack]);

  // Synchronize initial files when modal opens or initialFiles change
  useEffect(() => {
    if (isOpen) {
      if (initialFiles && initialFiles.length > 0) {
        setFiles(initialFiles);
        if (initialFiles.length >= 2) {
          setStyleSourceIndex(1);
        }
        if (initialFiles.length >= 3) {
          setActorSourceIndex(2);
        }
      } else if (initialVideoPath) {
        inspectAndAddVideo(initialVideoPath);
      }
    }
  }, [isOpen, initialFiles, initialVideoPath, inspectAndAddVideo]);

  const handleConfirmMkvTracks = useCallback(async () => {
    if (!pendingMkvPath || selectedTrackIndexes.length === 0) return;
    setIsExtractingTracks(true);
    try {
      for (const trackIdx of selectedTrackIndexes) {
        const track = mkvTracks.find(t => t.index === trackIdx);
        if (track) {
          await extractAndAddTrack(pendingMkvPath, track);
        }
      }
      setMkvPickerOpen(false);
      setPendingMkvPath(null);
    } catch (e: any) {
      console.error(e);
      toast.error('Ошибка извлечения дорожек: ' + (e.message || String(e)));
    } finally {
      setIsExtractingTracks(false);
    }
  }, [extractAndAddTrack, mkvTracks, pendingMkvPath, selectedTrackIndexes]);

  const handleAddFile = useCallback(async () => {
    try {
      const res = await ipcSafe.invoke('select-file', {
        filters: [
          { name: 'Все поддерживаемые файлы', extensions: ['ass', 'srt', 'vtt', 'ssa', 'mkv', 'mp4', 'webm', 'avi', 'mov'] },
          { name: 'Субтитры', extensions: ['ass', 'srt', 'vtt', 'ssa'] },
          { name: 'Видео (MKV, MP4)', extensions: ['mkv', 'mp4', 'webm', 'avi', 'mov'] }
        ]
      });

      if (res && res.path) {
        const filePath = res.path;
        const ext = filePath.split('.').pop()?.toLowerCase() || '';

        if (['mkv', 'mp4', 'webm', 'avi', 'mov'].includes(ext)) {
          await inspectAndAddVideo(filePath);
        } else {
          const name = filePath.split(/[\\/]/).pop() || 'subtitles.ass';
          const raw = await ipcSafe.invoke('get-raw-subtitles', filePath);
          const lineCount = raw?.lines?.length || 0;
          const actors = raw?.actors || [];

          const newItem: SubFileItem = {
            id: Math.random().toString(),
            path: filePath,
            name,
            lineCount,
            actors,
            sourceType: 'file'
          };

          setFiles(prev => {
            const next = [...prev, newItem];
            if (next.length === 2 && mode === 'component') setStyleSourceIndex(1);
            if (next.length === 3 && mode === 'component') setActorSourceIndex(2);
            return next;
          });
        }
      }
    } catch (e: any) {
      console.error(e);
      toast.error('Ошибка выбора файла: ' + (e.message || String(e)));
    }
  }, [inspectAndAddVideo, mode]);

  const handleAddCurrentRaw = useCallback(async () => {
    if (!currentEpisode?.rawPath) {
      toast.error('У текущей серии нет прикрепленного RAW видеофайла');
      return;
    }
    await inspectAndAddVideo(currentEpisode.rawPath);
  }, [currentEpisode?.rawPath, inspectAndAddVideo]);

  const cleanupTempFiles = useCallback(async (fileList: SubFileItem[], extraPaths: string[] = []) => {
    const pathsToDelete = [
      ...fileList.filter(f => f.sourceType === 'mkv').map(f => f.path),
      ...extraPaths
    ];
    for (const p of pathsToDelete) {
      if (p) {
        try {
          await ipcSafe.invoke('delete-file', p);
        } catch (e) {
          // Ignore deletion error
        }
      }
    }
  }, []);

  const handleCloseModal = useCallback(async () => {
    await cleanupTempFiles(files);
    setFiles([]);
    onClose();
  }, [cleanupTempFiles, files, onClose]);

  const handleRemoveFile = useCallback(async (id: string) => {
    const fileToRemove = files.find(f => f.id === id);
    if (fileToRemove && fileToRemove.sourceType === 'mkv') {
      try {
        await ipcSafe.invoke('delete-file', fileToRemove.path);
      } catch (e) {}
    }
    setFiles(prev => {
      const filtered = prev.filter(f => f.id !== id);
      if (textSourceIndex >= filtered.length) setTextSourceIndex(Math.max(0, filtered.length - 1));
      if (styleSourceIndex >= filtered.length) setStyleSourceIndex(Math.max(0, filtered.length - 1));
      if (actorSourceIndex >= filtered.length) setActorSourceIndex(-1);
      return filtered;
    });
  }, [actorSourceIndex, files, styleSourceIndex, textSourceIndex]);

  const handleMoveFile = useCallback((index: number, direction: 'up' | 'down') => {
    setFiles(prev => {
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = temp;
      return next;
    });
  }, []);

  const handleMerge = useCallback(async () => {
    if (files.length === 0) {
      toast.error('Добавьте хотя бы один файл субтитров');
      return;
    }

    if (!currentEpisode) return;

    setIsProcessing(true);
    try {
      const epIdToUse = targetEpisodeId || currentEpisode.id;
      let latestEp = currentEpisode;
      try {
        const allProjects = await ipcSafe.invoke('get-projects');
        if (Array.isArray(allProjects)) {
          for (const p of allProjects) {
            const found = p.episodes?.find((e: any) => e.id === epIdToUse);
            if (found) {
              latestEp = found;
              break;
            }
          }
        }
      } catch (e) {}

      const projectTitle = sanitizeFolderName(latestEp.project?.title || currentEpisode.project?.title || 'Project');
      const episodeFolder = sanitizeFolderName(`Episode_${latestEp.number}`);
      const subDir = `${projectTitle}/${episodeFolder}`;
      const targetFileName = `subtitles.ass`;

      const tempOutputPath = files[0].path.replace(/\.[^/.]+$/, '_merged.ass');

      const mergeRes = await ipcSafe.invoke('merge-multiple-subtitles', {
        filePaths: files.map(f => f.path),
        options: {
          mode,
          textSourceIndex: Math.min(textSourceIndex, files.length - 1),
          styleSourceIndex: Math.min(styleSourceIndex, files.length - 1),
          actorSourceIndex,
          outputPath: tempOutputPath
        }
      });

      if (mergeRes && mergeRes.outputPath) {
        const copyRes = await ipcSafe.invoke('copy-file', {
          sourcePath: mergeRes.outputPath,
          targetDir: subDir,
          fileName: targetFileName
        });

        if (copyRes && copyRes.path) {
          const updateData: any = {
            ...latestEp,
            subPath: copyRes.path,
            updatedAt: new Date().toISOString()
          };

          if (latestEp.rawPath && updateData.subPath) {
            updateData.status = 'ROLES';
          }

          try {
            const rawSubResult = await ipcSafe.invoke('get-raw-subtitles', copyRes.path);
            if (rawSubResult && rawSubResult.actors) {
              const rawActors: string[] = rawSubResult.actors;
              const lines: any[] = rawSubResult.lines || [];
              const aliases: Record<string, string> = JSON.parse(currentEpisode.project?.characterAliases || '{}');

              const existingAssignments = latestEp.assignments || [];
              const existingActors = new Set(existingAssignments.map((a: any) => a.characterName));

              const newAssignments = rawActors
                .filter(actor => !existingActors.has(actor))
                .map(actor => {
                  const actorLines = lines.filter((l: any) => l.actor === actor);
                  const aliasedDubberId = aliases[actor];
                  return {
                    id: `${latestEp.id}-${actor}-${Date.now()}`,
                    episodeId: latestEp.id,
                    characterName: actor,
                    dubberId: aliasedDubberId || undefined,
                    lineCount: actorLines.length,
                    status: 'PENDING'
                  };
                });

              updateData.assignments = [...existingAssignments, ...newAssignments];
            }
          } catch (e) {
            console.error("Auto character parsing error:", e);
          }

          await ipcSafe.invoke('save-episode', updateData);
          toast.success(`Серия ${latestEp.number}: Объединенные субтитры успешно прикреплены!`);

          await cleanupTempFiles(files, [mergeRes.outputPath]);
          setFiles([]);
          onRefresh();
          onClose();
        } else {
          toast.error('Не удалось сохранить объединенный файл в папку серии');
        }
      } else {
        toast.error('Не удалось объединить субтитры');
      }
    } catch (e: any) {
      console.error(e);
      toast.error('Ошибка объединения субтитров: ' + (e.message || String(e)));
    } finally {
      setIsProcessing(false);
    }
  }, [actorSourceIndex, cleanupTempFiles, currentEpisode, files, mode, onClose, onRefresh, styleSourceIndex, targetEpisodeId, textSourceIndex]);

  return {
    files,
    setFiles,
    mode,
    setMode,
    textSourceIndex,
    setTextSourceIndex,
    styleSourceIndex,
    setStyleSourceIndex,
    actorSourceIndex,
    setActorSourceIndex,
    isProcessing,
    mkvPickerOpen,
    setMkvPickerOpen,
    pendingMkvPath,
    setPendingMkvPath,
    mkvTracks,
    selectedTrackIndexes,
    setSelectedTrackIndexes,
    isExtractingTracks,
    mkvTrackAnalyses,
    isAnalyzingMkvTracks,
    handleConfirmMkvTracks,
    handleAddFile,
    handleAddCurrentRaw,
    handleCloseModal,
    handleRemoveFile,
    handleMoveFile,
    handleMerge,
  };
}
