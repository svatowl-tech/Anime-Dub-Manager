import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { Episode } from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';
import { resolveLocalPath } from '../../lib/webFileSystem';
import { appLogger } from '../../lib/appLogger';
import { useModuleLogs } from '../../hooks/useModuleLogs';

export interface CutSegment {
  id: string;
  startSec: number;
  endSec: number;
  label: string;
  enabled: boolean;
}

export interface InsertedVideoItem {
  id: string;
  filePath: string;
  previewUrl?: string;
  name: string;
  durationSec: number;
  width?: number;
  height?: number;
  enabled: boolean;
}

export interface InsertedImageItem {
  id: string;
  filePath: string;
  previewUrl?: string;
  name: string;
  role: 'start' | 'middle' | 'end';
  insertAtOriginalSec?: number;
  durationSec: number;
  enabled: boolean;
}

export interface OverlayImageItem {
  id: string;
  filePath: string;
  previewUrl?: string;
  name: string;
  startSec: number;
  endSec: number;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  opacity: number;
  enabled: boolean;
}

export interface VideoEditorPanelProps {
  currentEpisode: Episode | null;
  onRefresh: () => Promise<void> | void;
  onOpenAssUtilities?: () => void;
}

export function formatTimeSec(sec: number): string {
  const s = Math.max(0, Number(sec) || 0);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = Math.floor(s % 60);
  const cs = Math.round((s % 1) * 100) % 100;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function parseTimeInput(val: string): number | null {
  if (!val || typeof val !== 'string') return null;
  const clean = val.trim().replace(',', '.');
  if (/^\d+(\.\d+)?$/.test(clean)) {
    return Math.max(0, parseFloat(clean));
  }
  const parts = clean.split(':');
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10) || 0;
    const s = parseFloat(parts[1]) || 0;
    return Math.max(0, m * 60 + s);
  }
  if (parts.length === 3) {
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    const s = parseFloat(parts[2]) || 0;
    return Math.max(0, h * 3600 + m * 60 + s);
  }
  return null;
}

export function useVideoEditorController({
  currentEpisode,
  onRefresh
}: VideoEditorPanelProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoSrc, setVideoSrc] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [sourceDuration, setSourceDuration] = useState(0);
  const [sourceMeta, setSourceMeta] = useState<any>(null);

  // Active sub-tab in editor controls
  const [activeSection, setActiveSection] = useState<'trim-cut' | 'images' | 'videos' | 'subs'>('trim-cut');

  // 1. Trim start & end
  const [trimStartSec, setTrimStartSec] = useState<number>(0);
  const [trimEndSec, setTrimEndSec] = useState<number>(0);
  const [trimStartInput, setTrimStartInput] = useState<string>('00:00.00');
  const [trimEndInput, setTrimEndInput] = useState<string>('00:00.00');

  // 2. Cut segments
  const [cuts, setCuts] = useState<CutSegment[]>([]);
  const [draftCutStart, setDraftCutStart] = useState<number>(0);
  const [draftCutEnd, setDraftCutEnd] = useState<number>(10);
  const [draftCutLabel, setDraftCutLabel] = useState<string>('');

  // 3. Images (start / middle / end / overlay)
  const [startImages, setStartImages] = useState<InsertedImageItem[]>([]);
  const [midImages, setMidImages] = useState<InsertedImageItem[]>([]);
  const [endImages, setEndImages] = useState<InsertedImageItem[]>([]);
  const [overlayImages, setOverlayImages] = useState<OverlayImageItem[]>([]);

  // 4. External videos (intro / outro)
  const [introVideos, setIntroVideos] = useState<InsertedVideoItem[]>([]);
  const [outroVideos, setOutroVideos] = useState<InsertedVideoItem[]>([]);

  // 5. Preview plan & subtitle recalculation preview
  const [previewData, setPreviewData] = useState<{
    plan: any;
    subPreview: any;
  } | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // 6. Rendering state & logs
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [isRestoring, setIsRestoring] = useState(false);
  const [lastRenderResult, setLastRenderResult] = useState<any>(null);
  const [isLogsDrawerOpen, setIsLogsDrawerOpen] = useState(false);
  const [showInlineConsole, setShowInlineConsole] = useState(true);

  const { logs: moduleLogs, clearLogs: clearModuleLogs } = useModuleLogs('VIDEO-EDITOR');
  const errorCount = moduleLogs.filter((l) => l.level === 'error').length;

  // Reset or load video when episode or its rawPath changes
  useEffect(() => {
    let cancelled = false;

    const loadEpisodeMedia = async () => {
      if (!currentEpisode?.rawPath) {
        setVideoSrc('');
        setSourceDuration(0);
        setSourceMeta(null);
        return;
      }

      appLogger.info('VIDEO-EDITOR', `Загрузка медиаданных серии #${currentEpisode.number}`, {
        episodeId: currentEpisode.id,
        rawPath: currentEpisode.rawPath,
        subPath: currentEpisode.subPath
      });

      try {
        const resolvedUrl = await resolveLocalPath(currentEpisode.rawPath);
        if (!cancelled) {
          const urlWithBust = resolvedUrl.includes('?')
            ? `${resolvedUrl}&_t=${encodeURIComponent(currentEpisode.updatedAt || String(Date.now()))}`
            : resolvedUrl;
          setVideoSrc(urlWithBust);
        }
      } catch (e: any) {
        appLogger.error('VIDEO-EDITOR', `Ошибка разрешения пути видео: ${e?.message || e}`);
      }

      try {
        const meta = await ipcSafe.invoke('video-editor-probe', currentEpisode.rawPath);
        if (!cancelled && meta) {
          setSourceMeta(meta);
          const dur = Number(meta.durationSec) || 0;
          if (dur > 0) {
            setSourceDuration(dur);
            setTrimStartSec(0);
            setTrimEndSec(dur);
            setTrimStartInput(formatTimeSec(0));
            setTrimEndInput(formatTimeSec(dur));
            setDraftCutEnd(Math.min(dur, 15));
          }
          appLogger.info(
            'VIDEO-EDITOR',
            `Метаданные видео получены: ${meta.width}x${meta.height}, ${meta.videoCodec}, ${meta.fpsStr} fps, длительность ${dur.toFixed(2)}с`
          );
        }
      } catch (err: any) {
        appLogger.warn('VIDEO-EDITOR', `Не удалось получить ffprobe-метаданные: ${err?.message || err}`);
      }
    };

    setCuts([]);
    setStartImages([]);
    setMidImages([]);
    setEndImages([]);
    setOverlayImages([]);
    setIntroVideos([]);
    setOutroVideos([]);
    setLastRenderResult(null);

    loadEpisodeMedia();

    return () => {
      cancelled = true;
    };
  }, [currentEpisode?.id, currentEpisode?.rawPath]);

  // Listen to backend video-editor-log and video-editor-progress events
  useEffect(() => {
    const unsubLog = ipcSafe.on('video-editor-log', (data: any) => {
      if (!data || !data.message) return;
      const lvl = data.level === 'error' ? 'error' : data.level === 'warn' ? 'warn' : 'info';
      appLogger[lvl]('VIDEO-EDITOR', data.message);
    });

    const unsubProg = ipcSafe.on('video-editor-progress', (pct: number) => {
      if (typeof pct === 'number' && !isNaN(pct)) {
        setRenderProgress(pct);
      }
    });

    return () => {
      unsubLog();
      unsubProg();
    };
  }, []);

  // Build operations payload
  const buildOperationsPayload = useCallback(() => {
    return {
      trimStartSec,
      trimEndSec: trimEndSec > 0 ? trimEndSec : sourceDuration,
      cuts,
      introVideos,
      startImages,
      midImages,
      endImages,
      outroVideos,
      overlayImages
    };
  }, [
    trimStartSec,
    trimEndSec,
    sourceDuration,
    cuts,
    introVideos,
    startImages,
    midImages,
    endImages,
    outroVideos,
    overlayImages
  ]);

  // Live preview of timeline & subtitle recalculation
  useEffect(() => {
    if (!sourceDuration || sourceDuration <= 0) return;

    const timer = setTimeout(async () => {
      setIsPreviewLoading(true);
      try {
        const res = await ipcSafe.invoke('video-editor-preview-plan', {
          sourceDurationSec: sourceDuration,
          subPath: currentEpisode?.subPath || '',
          operations: buildOperationsPayload()
        });
        if (res) {
          setPreviewData(res);
        }
      } catch (e: any) {
        console.warn('Preview plan calculation error:', e);
      } finally {
        setIsPreviewLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [sourceDuration, currentEpisode?.subPath, buildOperationsPayload]);

  // Video player controls
  const seekTo = (sec: number) => {
    const clamped = Math.max(0, Math.min(sourceDuration || 36000, sec));
    setCurrentTime(clamped);
    if (videoRef.current) {
      videoRef.current.currentTime = clamped;
    }
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  };

  // Trim handlers
  const handleSetTrimStartFromPlayer = () => {
    const t = Number(currentTime.toFixed(2));
    if (trimEndSec > 0 && t >= trimEndSec - 0.5) {
      toast.warning('Начало видео должно быть меньше точки конца видео');
      return;
    }
    setTrimStartSec(t);
    setTrimStartInput(formatTimeSec(t));
    appLogger.info('VIDEO-EDITOR', `Установлена подрезка начала: ${formatTimeSec(t)} (${t}с)`);
  };

  const handleSetTrimEndFromPlayer = () => {
    const t = Number(currentTime.toFixed(2));
    if (t <= trimStartSec + 0.5) {
      toast.warning('Конец видео должен быть больше точки начала видео');
      return;
    }
    setTrimEndSec(t);
    setTrimEndInput(formatTimeSec(t));
    appLogger.info('VIDEO-EDITOR', `Установлена подрезка конца: ${formatTimeSec(t)} (${t}с)`);
  };

  const handleResetTrim = () => {
    setTrimStartSec(0);
    setTrimEndSec(sourceDuration);
    setTrimStartInput(formatTimeSec(0));
    setTrimEndInput(formatTimeSec(sourceDuration));
    appLogger.info('VIDEO-EDITOR', 'Сброшена подрезка начала и конца видео');
  };

  // Cut segment handlers
  const handleAddCutSegment = (presetStart?: number, presetEnd?: number, presetLabel?: string) => {
    const s = presetStart !== undefined ? presetStart : draftCutStart;
    const e = presetEnd !== undefined ? presetEnd : draftCutEnd;
    if (e <= s + 0.1) {
      toast.warning('Конец вырезаемого фрагмента должен быть больше его начала');
      return;
    }
    const newCut: CutSegment = {
      id: `cut_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      startSec: Number(s.toFixed(2)),
      endSec: Number(e.toFixed(2)),
      label: presetLabel || draftCutLabel.trim() || `Вырезка ${cuts.length + 1}`,
      enabled: true
    };
    setCuts((prev) => [...prev, newCut]);
    setDraftCutLabel('');
    appLogger.info(
      'VIDEO-EDITOR',
      `Добавлен вырезаемый фрагмент "${newCut.label}": [${formatTimeSec(newCut.startSec)} — ${formatTimeSec(newCut.endSec)}] (${(newCut.endSec - newCut.startSec).toFixed(2)}с)`
    );
    toast.success(`Добавлен вырезаемый участок: ${formatTimeSec(newCut.startSec)} — ${formatTimeSec(newCut.endSec)}`);
  };

  // Image pickers
  const handlePickInsertedImage = async (role: 'start' | 'middle' | 'end') => {
    try {
      const res = await ipcSafe.invoke('select-file', {
        title: 'Выберите изображение для вставки в видео',
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
      });
      if (!res || res.canceled || !res.path) return;

      const filePath = res.path;
      const previewUrl = await resolveLocalPath(filePath);
      const name = filePath.split(/[\\/]/).pop() || 'image.png';
      const insertAt = Number(currentTime.toFixed(2));

      const item: InsertedImageItem = {
        id: `img_${role}_${Date.now()}`,
        filePath,
        previewUrl,
        name,
        role,
        insertAtOriginalSec: role === 'middle' ? insertAt : undefined,
        durationSec: 3.0,
        enabled: true
      };

      if (role === 'start') {
        setStartImages((prev) => [...prev, item]);
        appLogger.info('VIDEO-EDITOR', `Добавлена картинка в начало: "${name}" (длительность 3.0с)`);
      } else if (role === 'middle') {
        setMidImages((prev) => [...prev, item]);
        appLogger.info(
          'VIDEO-EDITOR',
          `Добавлена картинка в середину на таймкод ${formatTimeSec(insertAt)}: "${name}" (длительность 3.0с)`
        );
      } else {
        setEndImages((prev) => [...prev, item]);
        appLogger.info('VIDEO-EDITOR', `Добавлена картинка в конец: "${name}" (длительность 3.0с)`);
      }
      toast.success(`Картинка «${name}» добавлена!`);
    } catch (e: any) {
      toast.error(`Ошибка выбора изображения: ${e?.message || e}`);
    }
  };

  const handlePickOverlayImage = async () => {
    try {
      const res = await ipcSafe.invoke('select-file', {
        title: 'Выберите изображение для наложения поверх видео',
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
      });
      if (!res || res.canceled || !res.path) return;

      const filePath = res.path;
      const previewUrl = await resolveLocalPath(filePath);
      const name = filePath.split(/[\\/]/).pop() || 'overlay.png';
      const start = Number(currentTime.toFixed(2));
      const end = Number(Math.min(sourceDuration || start + 5, start + 5).toFixed(2));

      const item: OverlayImageItem = {
        id: `ov_${Date.now()}`,
        filePath,
        previewUrl,
        name,
        startSec: start,
        endSec: Math.max(start + 0.5, end),
        xPercent: 50,
        yPercent: 50,
        widthPercent: 35,
        opacity: 1,
        enabled: true
      };

      setOverlayImages((prev) => [...prev, item]);
      appLogger.info(
        'VIDEO-EDITOR',
        `Добавлено наложение картинки поверх видео: "${name}" [${formatTimeSec(item.startSec)} — ${formatTimeSec(item.endSec)}]`
      );
      toast.success(`Наложение картинки «${name}» добавлено!`);
    } catch (e: any) {
      toast.error(`Ошибка выбора изображения: ${e?.message || e}`);
    }
  };

  // External video pickers (Intro / Outro)
  const handlePickExternalVideo = async (role: 'intro' | 'outro') => {
    try {
      const res = await ipcSafe.invoke('select-file', {
        title: role === 'intro' ? 'Выберите видео для вставки в начало (Интро)' : 'Выберите видео для вставки в конец (Аутро)',
        filters: [{ name: 'Video Files', extensions: ['mp4', 'mkv', 'mov', 'webm', 'avi', 'ts'] }]
      });
      if (!res || res.canceled || !res.path) return;

      const filePath = res.path;
      const name = filePath.split(/[\\/]/).pop() || 'video.mp4';
      const meta = await ipcSafe.invoke('video-editor-probe', filePath);
      const dur = Number(meta?.durationSec) || 5;

      const item: InsertedVideoItem = {
        id: `vid_${role}_${Date.now()}`,
        filePath,
        name,
        durationSec: dur,
        width: meta?.width,
        height: meta?.height,
        enabled: true
      };

      if (role === 'intro') {
        setIntroVideos((prev) => [...prev, item]);
        appLogger.info(
          'VIDEO-EDITOR',
          `Добавлено стороннее видео в начало (Интро): "${name}" (${dur.toFixed(2)}с, ${meta?.width || '?'}x${meta?.height || '?'})`
        );
      } else {
        setOutroVideos((prev) => [...prev, item]);
        appLogger.info(
          'VIDEO-EDITOR',
          `Добавлено стороннее видео в конец (Аутро): "${name}" (${dur.toFixed(2)}с, ${meta?.width || '?'}x${meta?.height || '?'})`
        );
      }
      toast.success(`Видео «${name}» (${dur.toFixed(1)}с) добавлено ${role === 'intro' ? 'в начало' : 'в конец'}!`);
    } catch (e: any) {
      toast.error(`Ошибка выбора видеофайла: ${e?.message || e}`);
    }
  };

  // Check if any changes are configured
  const hasAnyEdits =
    trimStartSec > 0.02 ||
    (trimEndSec > 0 && sourceDuration > 0 && trimEndSec < sourceDuration - 0.02) ||
    cuts.some((c) => c.enabled) ||
    startImages.some((i) => i.enabled) ||
    midImages.some((i) => i.enabled) ||
    endImages.some((i) => i.enabled) ||
    overlayImages.some((o) => o.enabled) ||
    introVideos.some((v) => v.enabled) ||
    outroVideos.some((v) => v.enabled);

  // Main Render & Reload into Episode action
  const handleRenderAndApply = async () => {
    if (!currentEpisode?.rawPath) {
      toast.error('У текущей серии нет загруженного видеофайла');
      return;
    }
    if (!hasAnyEdits) {
      toast.info('Внесите хотя бы одно изменение (подрезку, вырезку, вставку картинки или видео) перед рендерингом');
      return;
    }

    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
    }

    setIsRendering(true);
    setRenderProgress(1);
    setShowInlineConsole(true);

    const ops = buildOperationsPayload();
    appLogger.info('VIDEO-EDITOR', 'Запуск рендеринга видео и автоматического пересчета субтитров...', ops);

    try {
      const result = await ipcSafe.invoke('video-editor-render', {
        episodeId: currentEpisode.id,
        projectId: currentEpisode.projectId,
        videoPath: currentEpisode.rawPath,
        subPath: currentEpisode.subPath,
        operations: ops
      });

      setLastRenderResult(result);
      appLogger.info('VIDEO-EDITOR', 'Рендеринг и пересчет субтитров успешно завершены!', {
        newVideoPath: result?.videoPath,
        newSubPath: result?.subPath,
        outputDurationSec: result?.outputDurationSec,
        subtitleStats: result?.subtitleStats
      });

      await onRefresh();

      toast.success(
        `Видео отрендерено за ${result?.elapsedSec || '0'}с! Субтитры автоматически пересчитаны и перезагружены в серию.`
      );
    } catch (err: any) {
      appLogger.error('VIDEO-EDITOR', `Ошибка рендеринга видео: ${err?.message || err}`, err);
      toast.error(`Ошибка при рендеринге видео: ${err?.message || String(err)}`);
    } finally {
      setIsRendering(false);
      setRenderProgress(0);
    }
  };

  // Restore original unedited video & subtitles
  const handleRestoreOriginal = async () => {
    if (!currentEpisode?.id) return;
    setIsRestoring(true);
    appLogger.info('VIDEO-EDITOR', `Восстановление исходного нетронутого видео и субтитров серии #${currentEpisode.number}...`);
    try {
      const res = await ipcSafe.invoke('video-editor-restore-original', {
        episodeId: currentEpisode.id
      });
      await onRefresh();
      toast.success('Исходное видео и оригинальные субтитры серии успешно восстановлены!');
      appLogger.info('VIDEO-EDITOR', 'Исходные медиафайлы восстановлены', res);
    } catch (err: any) {
      appLogger.error('VIDEO-EDITOR', `Ошибка восстановления исходника: ${err?.message || err}`);
      toast.error(`Не удалось восстановить исходник: ${err?.message || err}`);
    } finally {
      setIsRestoring(false);
    }
  };

  const activeOverlaysAtCurrentTime = overlayImages.filter(
    (ov) => ov.enabled && currentTime >= ov.startSec && currentTime <= ov.endSec
  );

  return {
    videoRef,
    videoSrc,
    isPlaying,
     setIsPlaying,
    currentTime,
    setCurrentTime,
    sourceDuration,
    setSourceDuration,
    sourceMeta,
    activeSection,
    setActiveSection,
    trimStartSec,
    setTrimStartSec,
    trimEndSec,
    setTrimEndSec,
    trimStartInput,
    setTrimStartInput,
    trimEndInput,
    setTrimEndInput,
    cuts,
    setCuts,
    draftCutStart,
    setDraftCutStart,
    draftCutEnd,
    setDraftCutEnd,
    draftCutLabel,
    setDraftCutLabel,
    startImages,
    setStartImages,
    midImages,
    setMidImages,
    endImages,
    setEndImages,
    overlayImages,
    setOverlayImages,
    introVideos,
    setIntroVideos,
    outroVideos,
    setOutroVideos,
    previewData,
    isPreviewLoading,
    isRendering,
    renderProgress,
    isRestoring,
    lastRenderResult,
    isLogsDrawerOpen,
    setIsLogsDrawerOpen,
    showInlineConsole,
    setShowInlineConsole,
    moduleLogs,
    clearModuleLogs,
    errorCount,
    seekTo,
    togglePlay,
    handleSetTrimStartFromPlayer,
    handleSetTrimEndFromPlayer,
    handleResetTrim,
    handleAddCutSegment,
    handlePickInsertedImage,
    handlePickOverlayImage,
    handlePickExternalVideo,
    hasAnyEdits,
    handleRenderAndApply,
    handleRestoreOriginal,
    activeOverlaysAtCurrentTime
  };
}
