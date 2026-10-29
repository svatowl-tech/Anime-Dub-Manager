import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Scissors,
  Film,
  Image as ImageIcon,
  Plus,
  Trash2,
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Clock,
  Layers,
  Sparkles,
  Terminal,
  ArrowRight,
  FileVideo,
  FileText,
  Sliders,
  Loader2,
  ChevronRight,
  SkipBack,
  SkipForward,
  Maximize2
} from 'lucide-react';
import { toast } from 'sonner';
import { Episode } from '../types';
import { ipcSafe } from '../lib/ipcSafe';
import { resolveLocalPath } from '../lib/webFileSystem';
import { appLogger } from '../lib/appLogger';
import { useModuleLogs } from '../hooks/useModuleLogs';
import { LogViewerDrawer } from './common/LogViewerDrawer';

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

interface VideoEditorPanelProps {
  currentEpisode: Episode | null;
  onRefresh: () => Promise<void> | void;
  onOpenAssUtilities?: () => void;
}

function formatTimeSec(sec: number): string {
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

function parseTimeInput(val: string): number | null {
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

export default function VideoEditorPanel({
  currentEpisode,
  onRefresh,
  onOpenAssUtilities
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
          // Append cache-busting query if custom-media so reloaded video always refreshes
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

    // Reset editing operations when switching to a newly rendered video or another episode
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

      // Reload project & episode state so downstream tabs (especially AssEditor) immediately receive the updated video and recalculated subtitles
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

  // Active overlays at current playback time for live preview on player
  const activeOverlaysAtCurrentTime = overlayImages.filter(
    (ov) => ov.enabled && currentTime >= ov.startSec && currentTime <= ov.endSec
  );

  if (!currentEpisode) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] text-center p-8 bg-neutral-900/40 border border-neutral-800 rounded-2xl">
        <Film className="w-14 h-14 text-neutral-600 mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">Серия не выбрана</h2>
        <p className="text-sm text-neutral-400 max-w-md">
          Выберите проект и серию в верхнем меню или загрузите видео и субтитры в Дашборде проекта, чтобы открыть редактор видео.
        </p>
      </div>
    );
  }

  if (!currentEpisode.rawPath) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] text-center p-8 bg-neutral-900/40 border border-neutral-800 rounded-2xl">
        <FileVideo className="w-14 h-14 text-amber-500/70 mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">Видеофайл еще не загружен в серию #{currentEpisode.number}</h2>
        <p className="text-sm text-neutral-400 max-w-md">
          Сначала загрузите исходное видео (и субтитры) на вкладке «Дашборд проекта», после чего вернитесь сюда для быстрой подрезки, вставок и пересчета тайминга субтитров.
        </p>
      </div>
    );
  }

  const plan = previewData?.plan;
  const subPreview = previewData?.subPreview;
  const canRestoreOriginal =
    Boolean(currentEpisode.originalRawPath) &&
    currentEpisode.originalRawPath !== currentEpisode.rawPath;

  return (
    <div className="space-y-5 pb-12">
      {/* Top Header Bar */}
      <div className="bg-neutral-900/90 border border-neutral-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-lg">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Scissors className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg font-bold text-white">
                Редактирование видео (FFmpeg Direct Stream Copy)
              </h1>
              <span className="text-xs px-2.5 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-medium">
                Серия #{currentEpisode.number}
              </span>
              {sourceMeta && (
                <span className="text-xs px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 font-mono">
                  {sourceMeta.width}×{sourceMeta.height} • {sourceMeta.videoCodec?.toUpperCase()} • { Number(sourceMeta.fps || 24).toFixed(2) } fps
                </span>
              )}
            </div>
            <p className="text-xs text-neutral-400 mt-0.5 flex items-center gap-3 flex-wrap">
              <span className="truncate max-w-[420px]" title={currentEpisode.rawPath}>
                Видео: <span className="text-neutral-300 font-mono">{currentEpisode.rawPath.split(/[\\/]/).pop()}</span>
              </span>
              <span>•</span>
              <span className="truncate max-w-[320px]" title={currentEpisode.subPath || 'Не прикреплены'}>
                Субтитры:{' '}
                {currentEpisode.subPath ? (
                  <span className="text-emerald-400 font-mono">{currentEpisode.subPath.split(/[\\/]/).pop()}</span>
                ) : (
                  <span className="text-amber-400">не прикреплены</span>
                )}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={() => setIsLogsDrawerOpen(true)}
            className="px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium flex items-center gap-2 border border-neutral-700 transition-colors"
            title="Открыть подробный журнал операций видеоредактора"
          >
            <Terminal className="w-4 h-4 text-indigo-400" />
            <span>Логи ({moduleLogs.length})</span>
            {errorCount > 0 && (
              <span className="px-1.5 py-0.2 bg-red-500/20 text-red-400 rounded text-[10px] font-bold">
                {errorCount}
              </span>
            )}
          </button>

          {canRestoreOriginal && (
            <button
              onClick={handleRestoreOriginal}
              disabled={isRendering || isRestoring}
              className="px-3.5 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-50"
              title="Вернуть нетронутое исходное видео и оригинальные субтитры до редактирования"
            >
              {isRestoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              <span>Вернуть исходник</span>
            </button>
          )}

          {lastRenderResult && onOpenAssUtilities && (
            <button
              onClick={onOpenAssUtilities}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg transition-all"
            >
              <FileText className="w-4 h-4" />
              <span>Перейти в Утилиты (ASS)</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={handleRenderAndApply}
            disabled={isRendering || !hasAnyEdits}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-indigo-600/20 transition-all"
          >
            {isRendering ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Рендеринг ({renderProgress}%)...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Отрендерить и перезагрузить в серию</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Rendering Progress Banner */}
      {isRendering && (
        <div className="bg-indigo-950/40 border border-indigo-500/40 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-indigo-200">
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              Выполняется обработка FFmpeg и пересчет таймингов ASS субтитров...
            </span>
            <span className="font-mono text-indigo-300">{renderProgress}%</span>
          </div>
          <div className="w-full h-2 bg-neutral-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 transition-all duration-200"
              style={{ width: `${Math.max(3, renderProgress)}%` }}
            />
          </div>
        </div>
      )}

      {/* Last Render Summary Banner */}
      {lastRenderResult && !isRendering && (
        <div className="bg-emerald-950/30 border border-emerald-500/40 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
            <div className="text-xs space-y-0.5">
              <div className="font-bold text-emerald-200">
                Видео и субтитры успешно сохранены в папку проекта и перезагружены в серию!
              </div>
              <div className="text-neutral-300">
                Новая длительность: <span className="font-mono font-semibold text-white">{formatTimeSec(lastRenderResult.outputDurationSec)}</span>
                {lastRenderResult.subtitleStats?.hasSubtitles && (
                  <>
                    {' • '}Субтитры: сдвинуто <span className="text-emerald-300 font-bold">{lastRenderResult.subtitleStats.shiftedLines}</span>,
                    подрезано <span className="text-amber-300 font-bold">{lastRenderResult.subtitleStats.trimmedLines}</span>,
                    удалено (в вырезках) <span className="text-rose-300 font-bold">{lastRenderResult.subtitleStats.removedLines}</span> из {lastRenderResult.subtitleStats.totalLines} реплик.
                  </>
                )}
              </div>
            </div>
          </div>
          {onOpenAssUtilities && (
            <button
              onClick={onOpenAssUtilities}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5"
            >
              <span>Открыть Утилиты (ASS)</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Main 2-Column Workspace: Left = Video Player & Visual Timeline, Right = Editing Tools */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* LEFT COLUMN (7 cols): Video Preview Player + Timeline Visualizer */}
        <div className="xl:col-span-7 space-y-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-3.5 shadow-lg">
            {/* Video Player Container with Live Overlay Preview */}
            <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-neutral-800">
              {videoSrc ? (
                <video
                  ref={videoRef}
                  src={videoSrc}
                  className="w-full h-full object-contain"
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onLoadedMetadata={(e) => {
                    const dur = e.currentTarget.duration;
                    if (dur && !isNaN(dur) && dur > 0) {
                      setSourceDuration(dur);
                      if (trimEndSec === 0 || trimEndSec > dur) {
                        setTrimEndSec(dur);
                        setTrimEndInput(formatTimeSec(dur));
                      }
                    }
                  }}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  controls
                />
              ) : (
                <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
                  Загрузка видеоплеера...
                </div>
              )}

              {/* Live Overlay Images Preview on top of video */}
              {activeOverlaysAtCurrentTime.map((ov) => (
                <div
                  key={ov.id}
                  className="pointer-events-none absolute border border-indigo-400/60 shadow-lg"
                  style={{
                    left: `${ov.xPercent}%`,
                    top: `${ov.yPercent}%`,
                    width: `${ov.widthPercent}%`,
                    transform: 'translate(-50%, -50%)',
                    opacity: ov.opacity
                  }}
                >
                  {ov.previewUrl && (
                    <img
                      src={ov.previewUrl}
                      alt={ov.name}
                      className="w-full h-auto object-contain block"
                    />
                  )}
                  <span className="absolute -top-5 left-0 bg-indigo-600/90 text-white text-[10px] px-1.5 py-0.5 rounded font-mono whitespace-nowrap">
                    Overlay: {ov.name}
                  </span>
                </div>
              ))}
            </div>

            {/* Frame-Accurate Scrubber & Quick Time Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-2 bg-neutral-950/80 p-2.5 rounded-xl border border-neutral-800/80">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={togglePlay}
                  className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                  title="Воспроизвести / Пауза"
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => seekTo(currentTime - 5)}
                  className="px-2 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-mono"
                >
                  -5с
                </button>
                <button
                  onClick={() => seekTo(currentTime - 1)}
                  className="px-2 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-mono"
                >
                  -1с
                </button>
                <button
                  onClick={() => seekTo(currentTime - 0.04)}
                  className="px-2 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-mono"
                  title="Шаг на 1 кадр назад"
                >
                  -1к
                </button>
                <button
                  onClick={() => seekTo(currentTime + 0.04)}
                  className="px-2 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-mono"
                  title="Шаг на 1 кадр вперед"
                >
                  +1к
                </button>
                <button
                  onClick={() => seekTo(currentTime + 1)}
                  className="px-2 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-mono"
                >
                  +1с
                </button>
                <button
                  onClick={() => seekTo(currentTime + 5)}
                  className="px-2 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-mono"
                >
                  +5с
                </button>
              </div>

              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="text-neutral-400">Позиция:</span>
                <span className="px-2.5 py-1 rounded bg-neutral-900 border border-neutral-700 text-indigo-300 font-bold">
                  {formatTimeSec(currentTime)}
                </span>
                <span className="text-neutral-500">/</span>
                <span className="text-neutral-300">{formatTimeSec(sourceDuration)}</span>
              </div>
            </div>

            {/* Quick Action Bar from Current Playhead */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                onClick={handleSetTrimStartFromPlayer}
                className="px-3 py-2 rounded-xl bg-neutral-800/90 hover:bg-neutral-700 border border-neutral-700 text-xs text-neutral-200 font-medium flex items-center justify-center gap-1.5 transition-colors"
                title="Отрезать всё до текущей секунды плеера"
              >
                <SkipBack className="w-3.5 h-3.5 text-amber-400" />
                <span>Начало = {formatTimeSec(currentTime)}</span>
              </button>

              <button
                onClick={handleSetTrimEndFromPlayer}
                className="px-3 py-2 rounded-xl bg-neutral-800/90 hover:bg-neutral-700 border border-neutral-700 text-xs text-neutral-200 font-medium flex items-center justify-center gap-1.5 transition-colors"
                title="Отрезать всё после текущей секунды плеера"
              >
                <SkipForward className="w-3.5 h-3.5 text-amber-400" />
                <span>Конец = {formatTimeSec(currentTime)}</span>
              </button>

              <button
                onClick={() => {
                  setDraftCutStart(Number(currentTime.toFixed(2)));
                  if (draftCutEnd <= currentTime) {
                    setDraftCutEnd(Number(Math.min(sourceDuration, currentTime + 10).toFixed(2)));
                  }
                  setActiveSection('trim-cut');
                  toast.info(`Начало вырезки установлено: ${formatTimeSec(currentTime)}`);
                }}
                className="px-3 py-2 rounded-xl bg-neutral-800/90 hover:bg-neutral-700 border border-neutral-700 text-xs text-neutral-200 font-medium flex items-center justify-center gap-1.5 transition-colors"
              >
                <Scissors className="w-3.5 h-3.5 text-rose-400" />
                <span>Вырезать [Отсюда...</span>
              </button>

              <button
                onClick={() => {
                  const endT = Number(currentTime.toFixed(2));
                  setDraftCutEnd(endT);
                  setActiveSection('trim-cut');
                  if (endT > draftCutStart + 0.1) {
                    handleAddCutSegment(draftCutStart, endT);
                  } else {
                    toast.info(`Конец вырезки установлен: ${formatTimeSec(endT)}`);
                  }
                }}
                className="px-3 py-2 rounded-xl bg-neutral-800/90 hover:bg-neutral-700 border border-neutral-700 text-xs text-neutral-200 font-medium flex items-center justify-center gap-1.5 transition-colors"
              >
                <Scissors className="w-3.5 h-3.5 text-emerald-400" />
                <span>...До сюда] (+вырезка)</span>
              </button>
            </div>

            {/* Visual Timeline Map */}
            <div className="space-y-2 pt-2 border-t border-neutral-800">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-neutral-300 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  Карта исходного видео и правок
                </span>
                {plan && (
                  <span className="text-neutral-400 font-mono">
                    Исходник: <strong className="text-neutral-200">{formatTimeSec(plan.sourceDurationSec)}</strong>
                    {' ➔ '}
                    Итог: <strong className="text-emerald-400">{formatTimeSec(plan.totalOutputDurationSec)}</strong>
                    {' '}
                    ({plan.totalOutputDurationSec - plan.sourceDurationSec >= 0 ? '+' : ''}
                    {(plan.totalOutputDurationSec - plan.sourceDurationSec).toFixed(2)}с)
                  </span>
                )}
              </div>

              {/* Source video bar with cuts, playhead, mid-inserts, and overlays */}
              <div
                className="relative h-8 bg-emerald-950/60 border border-neutral-700 rounded-lg overflow-hidden cursor-pointer select-none"
                onClick={(e) => {
                  if (!sourceDuration) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  seekTo(ratio * sourceDuration);
                }}
                title="Нажмите для перехода к нужному моменту исходного видео"
              >
                {/* Merged cut regions (red) */}
                {plan?.mergedCuts?.map((c: any, idx: number) => {
                  const leftPct = (c.start / (sourceDuration || 1)) * 100;
                  const widthPct = ((c.end - c.start) / (sourceDuration || 1)) * 100;
                  return (
                    <div
                      key={idx}
                      className="absolute top-0 bottom-0 bg-rose-600/65 border-x border-rose-400/60 flex items-center justify-center text-[10px] text-white font-bold overflow-hidden"
                      style={{ left: `${leftPct}%`, width: `${Math.max(0.5, widthPct)}%` }}
                      title={`Вырезано: ${formatTimeSec(c.start)} — ${formatTimeSec(c.end)}`}
                    >
                      {widthPct > 6 ? 'ВЫРЕЗАНО' : ''}
                    </div>
                  );
                })}

                {/* Overlay ranges (purple bar at top) */}
                {overlayImages
                  .filter((o) => o.enabled)
                  .map((ov) => {
                    const leftPct = (ov.startSec / (sourceDuration || 1)) * 100;
                    const widthPct = ((ov.endSec - ov.startSec) / (sourceDuration || 1)) * 100;
                    return (
                      <div
                        key={ov.id}
                        className="absolute top-0 h-2.5 bg-purple-500/80 border border-purple-300 rounded-b"
                        style={{ left: `${leftPct}%`, width: `${Math.max(1, widthPct)}%` }}
                        title={`Картинка поверх видео: ${ov.name} (${formatTimeSec(ov.startSec)} - ${formatTimeSec(ov.endSec)})`}
                      />
                    );
                  })}

                {/* Mid-image insertion markers (cyan vertical pins) */}
                {midImages
                  .filter((m) => m.enabled)
                  .map((m) => {
                    const leftPct = ((m.insertAtOriginalSec || 0) / (sourceDuration || 1)) * 100;
                    return (
                      <div
                        key={m.id}
                        className="absolute top-0 bottom-0 w-1 bg-cyan-400 shadow-[0_0_8px_#22d3ee]"
                        style={{ left: `${leftPct}%` }}
                        title={`Вставка картинки "${m.name}" (${m.durationSec}с) на ${formatTimeSec(m.insertAtOriginalSec || 0)}`}
                      />
                    );
                  })}

                {/* Current Playhead */}
                {sourceDuration > 0 && (
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_6px_#fff] z-10"
                    style={{ left: `${(currentTime / sourceDuration) * 100}%` }}
                  />
                )}
              </div>

              {/* Final Assembled Blocks Preview */}
              {plan?.blocks && plan.blocks.length > 0 && (
                <div className="flex items-center gap-1 overflow-x-auto py-1 text-[11px]">
                  {plan.blocks.map((b: any, i: number) => {
                    const isSource = b.type === 'source-slice';
                    const isImage = b.type === 'image-clip';
                    return (
                      <div
                        key={b.id || i}
                        className={`px-2.5 py-1 rounded-md border shrink-0 flex items-center gap-1.5 ${
                          isSource
                            ? 'bg-emerald-950/50 border-emerald-600/40 text-emerald-200'
                            : isImage
                            ? 'bg-cyan-950/60 border-cyan-500/40 text-cyan-200'
                            : 'bg-amber-950/60 border-amber-500/40 text-amber-200'
                        }`}
                      >
                        {isSource ? (
                          <Film className="w-3 h-3 text-emerald-400" />
                        ) : isImage ? (
                          <ImageIcon className="w-3 h-3 text-cyan-400" />
                        ) : (
                          <FileVideo className="w-3 h-3 text-amber-400" />
                        )}
                        <span className="font-medium">
                          {isSource
                            ? `Серия [${formatTimeSec(b.origStart)}–${formatTimeSec(b.origEnd)}]`
                            : `${b.name} (${b.durationSec.toFixed(1)}с)`}
                        </span>
                        {b.overlays?.length > 0 && (
                          <span className="px-1 rounded bg-purple-500/30 text-purple-200 text-[10px]">
                            +{b.overlays.length} overlay
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN (5 cols): Tabbed Editing Controls & Subtitle Recalculation Preview */}
        <div className="xl:col-span-5 space-y-4">
          {/* Sub-navigation tabs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 bg-neutral-900 p-1.5 rounded-2xl border border-neutral-800">
            <button
              onClick={() => setActiveSection('trim-cut')}
              className={`py-2 px-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                activeSection === 'trim-cut'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
              }`}
            >
              <Scissors className="w-3.5 h-3.5" />
              <span>Подрезка</span>
              {(trimStartSec > 0.02 ||
                (trimEndSec > 0 && trimEndSec < sourceDuration - 0.02) ||
                cuts.length > 0) && (
                <span className="w-2 h-2 rounded-full bg-rose-400" />
              )}
            </button>

            <button
              onClick={() => setActiveSection('images')}
              className={`py-2 px-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                activeSection === 'images'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>Картинки</span>
              {startImages.length + midImages.length + endImages.length + overlayImages.length > 0 && (
                <span className="px-1.5 rounded-full bg-cyan-500/30 text-cyan-200 text-[10px]">
                  {startImages.length + midImages.length + endImages.length + overlayImages.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveSection('videos')}
              className={`py-2 px-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                activeSection === 'videos'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              <span>Интро/Аутро</span>
              {introVideos.length + outroVideos.length > 0 && (
                <span className="px-1.5 rounded-full bg-amber-500/30 text-amber-200 text-[10px]">
                  {introVideos.length + outroVideos.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveSection('subs')}
              className={`py-2 px-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                activeSection === 'subs'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Субтитры</span>
              {subPreview?.shiftedLines > 0 && (
                <span className="px-1.5 rounded-full bg-emerald-500/30 text-emerald-200 text-[10px]">
                  {subPreview.shiftedLines}
                </span>
              )}
            </button>
          </div>

          {/* SECTION 1: TRIM & CUT */}
          {activeSection === 'trim-cut' && (
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-5 shadow-lg">
              {/* Trim Start and End */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <SkipBack className="w-4 h-4 text-amber-400" />
                    Подрезать начало и конец видео
                  </h3>
                  {(trimStartSec > 0.02 || (trimEndSec > 0 && trimEndSec < sourceDuration - 0.02)) && (
                    <button
                      onClick={handleResetTrim}
                      className="text-xs text-neutral-400 hover:text-white underline"
                    >
                      Сбросить подрезку
                    </button>
                  )}
                </div>
                <p className="text-xs text-neutral-400">
                  Прямое копирование потоков (<code className="text-indigo-300">-c copy</code>) без перекодирования и потери качества.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Trim Start */}
                  <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2">
                    <label className="text-xs font-medium text-neutral-300 block">
                      Начало видео (отрезать всё ДО):
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={trimStartInput}
                        onChange={(e) => setTrimStartInput(e.target.value)}
                        onBlur={() => {
                          const parsed = parseTimeInput(trimStartInput);
                          if (parsed !== null && parsed < (trimEndSec || sourceDuration)) {
                            setTrimStartSec(parsed);
                            setTrimStartInput(formatTimeSec(parsed));
                          } else {
                            setTrimStartInput(formatTimeSec(trimStartSec));
                          }
                        }}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-700 text-xs font-mono text-white"
                        placeholder="00:00.00"
                      />
                      <button
                        onClick={handleSetTrimStartFromPlayer}
                        className="px-2.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 text-xs whitespace-nowrap"
                        title="Взять текущее время плеера"
                      >
                        Из плеера
                      </button>
                    </div>
                  </div>

                  {/* Trim End */}
                  <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2">
                    <label className="text-xs font-medium text-neutral-300 block">
                      Конец видео (отрезать всё ПОСЛЕ):
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={trimEndInput}
                        onChange={(e) => setTrimEndInput(e.target.value)}
                        onBlur={() => {
                          const parsed = parseTimeInput(trimEndInput);
                          if (parsed !== null && parsed > trimStartSec && parsed <= sourceDuration) {
                            setTrimEndSec(parsed);
                            setTrimEndInput(formatTimeSec(parsed));
                          } else {
                            setTrimEndInput(formatTimeSec(trimEndSec || sourceDuration));
                          }
                        }}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-700 text-xs font-mono text-white"
                        placeholder="24:00.00"
                      />
                      <button
                        onClick={handleSetTrimEndFromPlayer}
                        className="px-2.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 text-xs whitespace-nowrap"
                        title="Взять текущее время плеера"
                      >
                        Из плеера
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Cut Arbitrary Ranges */}
              <div className="space-y-3 pt-4 border-t border-neutral-800">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Scissors className="w-4 h-4 text-rose-400" />
                  Вырезать фрагмент (из начала, середины или конца)
                </h3>
                <p className="text-xs text-neutral-400">
                  Укажите интервал <span className="text-neutral-200">[От — До]</span>, который нужно вырезать. Все субтитры после вырезки автоматически сдвинутся назад на длительность вырезанного куска.
                </p>

                <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 space-y-3">
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="text-[11px] text-neutral-400 block mb-1">Вырезать ОТ (сек / ММ:СС):</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max={sourceDuration || 36000}
                          value={draftCutStart}
                          onChange={(e) => setDraftCutStart(Math.max(0, parseFloat(e.target.value) || 0))}
                          className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-700 text-xs font-mono text-white"
                        />
                        <button
                          onClick={() => setDraftCutStart(Number(currentTime.toFixed(2)))}
                          className="px-2 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-[11px] text-neutral-300 shrink-0"
                          title="Взять текущее время плеера"
                        >
                          Плеер
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="text-[11px] text-neutral-400 block mb-1">Вырезать ДО (сек / ММ:СС):</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max={sourceDuration || 36000}
                          value={draftCutEnd}
                          onChange={(e) => setDraftCutEnd(Math.max(0, parseFloat(e.target.value) || 0))}
                          className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-700 text-xs font-mono text-white"
                        />
                        <button
                          onClick={() => setDraftCutEnd(Number(currentTime.toFixed(2)))}
                          className="px-2 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-[11px] text-neutral-300 shrink-0"
                          title="Взять текущее время плеера"
                        >
                          Плеер
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={draftCutLabel}
                      onChange={(e) => setDraftCutLabel(e.target.value)}
                      placeholder="Название (напр. Реклама / Заставка / Повтор)"
                      className="flex-1 px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-700 text-xs text-white"
                    />
                    <button
                      onClick={() => handleAddCutSegment()}
                      className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-1.5 shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Добавить вырезку</span>
                    </button>
                  </div>
                </div>

                {/* List of Cut Segments */}
                {cuts.length > 0 && (
                  <div className="space-y-2">
                    {cuts.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-rose-950/25 border border-rose-500/30 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={c.enabled}
                            onChange={(e) =>
                              setCuts((prev) =>
                                prev.map((item) => (item.id === c.id ? { ...item, enabled: e.target.checked } : item))
                              )
                            }
                            className="rounded border-neutral-600"
                          />
                          <div>
                            <div className="font-semibold text-rose-200">{c.label}</div>
                            <div className="font-mono text-[11px] text-neutral-400">
                              {formatTimeSec(c.startSec)} — {formatTimeSec(c.endSec)} (минус {(c.endSec - c.startSec).toFixed(2)}с)
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => seekTo(c.startSec)}
                            className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[11px]"
                          >
                            Перейти
                          </button>
                          <button
                            onClick={() => setCuts((prev) => prev.filter((item) => item.id !== c.id))}
                            className="p-1.5 rounded hover:bg-rose-500/20 text-rose-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION 2: IMAGES (START / MIDDLE / END / OVERLAY) */}
          {activeSection === 'images' && (
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-5 shadow-lg">
              {/* Insert Image as Video Segment (Start / Middle / End) */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-cyan-400" />
                  Вставка картинки как участка видео (раздвигает субтитры)
                </h3>
                <p className="text-xs text-neutral-400">
                  Добавляет изображение в начало, в выбранную точку посередине или в конец видео. Субтитры после вставленной картинки автоматически сдвигаются вперед на её длительность.
                </p>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => handlePickInsertedImage('start')}
                    className="px-3 py-2.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-200 text-xs font-semibold flex flex-col items-center gap-1 transition-colors"
                  >
                    <Plus className="w-4 h-4 text-cyan-400" />
                    <span>В начало</span>
                  </button>

                  <button
                    onClick={() => handlePickInsertedImage('middle')}
                    className="px-3 py-2.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-200 text-xs font-semibold flex flex-col items-center gap-1 transition-colors"
                  >
                    <Plus className="w-4 h-4 text-cyan-400" />
                    <span>В середину ({formatTimeSec(currentTime)})</span>
                  </button>

                  <button
                    onClick={() => handlePickInsertedImage('end')}
                    className="px-3 py-2.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-200 text-xs font-semibold flex flex-col items-center gap-1 transition-colors"
                  >
                    <Plus className="w-4 h-4 text-cyan-400" />
                    <span>В конец</span>
                  </button>
                </div>

                {/* List of Start / Middle / End Images */}
                {[...startImages, ...midImages, ...endImages].length > 0 && (
                  <div className="space-y-2 pt-2">
                    {[
                      ...startImages.map((x) => ({ ...x, listType: 'start' as const })),
                      ...midImages.map((x) => ({ ...x, listType: 'middle' as const })),
                      ...endImages.map((x) => ({ ...x, listType: 'end' as const }))
                    ].map((img) => {
                      const updateItem = (patch: Partial<InsertedImageItem>) => {
                        const setter =
                          img.listType === 'start'
                            ? setStartImages
                            : img.listType === 'middle'
                            ? setMidImages
                            : setEndImages;
                        setter((prev) => prev.map((it) => (it.id === img.id ? { ...it, ...patch } : it)));
                      };
                      const removeItem = () => {
                        const setter =
                          img.listType === 'start'
                            ? setStartImages
                            : img.listType === 'middle'
                            ? setMidImages
                            : setEndImages;
                        setter((prev) => prev.filter((it) => it.id !== img.id));
                      };

                      return (
                        <div
                          key={img.id}
                          className="p-2.5 rounded-xl bg-neutral-950 border border-cyan-500/30 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {img.previewUrl && (
                              <img
                                src={img.previewUrl}
                                alt={img.name}
                                className="w-10 h-10 rounded object-cover border border-neutral-700 shrink-0"
                              />
                            )}
                            <div className="min-w-0 space-y-1">
                              <div className="font-semibold text-white truncate flex items-center gap-1.5">
                                <span className="px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 text-[10px] uppercase">
                                  {img.listType === 'start'
                                    ? 'В начале'
                                    : img.listType === 'middle'
                                    ? 'Посередине'
                                    : 'В конце'}
                                </span>
                                <span className="truncate">{img.name}</span>
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <label className="text-[11px] text-neutral-400 flex items-center gap-1">
                                  Длит. (сек):
                                  <input
                                    type="number"
                                    step="0.5"
                                    min="0.5"
                                    max="120"
                                    value={img.durationSec}
                                    onChange={(e) =>
                                      updateItem({ durationSec: Math.max(0.5, parseFloat(e.target.value) || 3) })
                                    }
                                    className="w-16 px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-700 font-mono text-white"
                                  />
                                </label>
                                {img.listType === 'middle' && (
                                  <label className="text-[11px] text-neutral-400 flex items-center gap-1">
                                    Таймкод (сек):
                                    <input
                                      type="number"
                                      step="0.5"
                                      min="0"
                                      max={sourceDuration || 36000}
                                      value={img.insertAtOriginalSec || 0}
                                      onChange={(e) =>
                                        updateItem({
                                          insertAtOriginalSec: Math.max(0, parseFloat(e.target.value) || 0)
                                        })
                                      }
                                      className="w-20 px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-700 font-mono text-white"
                                    />
                                    <button
                                      onClick={() => updateItem({ insertAtOriginalSec: Number(currentTime.toFixed(2)) })}
                                      className="px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-[10px] text-cyan-300"
                                    >
                                      Плеер
                                    </button>
                                  </label>
                                )}
                              </div>
                            </div>
                          </div>

                          <button
                            onClick={removeItem}
                            className="p-1.5 rounded hover:bg-rose-500/20 text-rose-400 shrink-0"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Overlay Image on Top of Video */}
              <div className="space-y-3 pt-4 border-t border-neutral-800">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Maximize2 className="w-4 h-4 text-purple-400" />
                    Наложить картинку ПОВЕРХ видео (Overlay)
                  </h3>
                  <button
                    onClick={handlePickOverlayImage}
                    className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Добавить поверх</span>
                  </button>
                </div>
                <p className="text-xs text-neutral-400">
                  Накладывает картинку (плашку, логотип, мем, цензуру) поверх видео в заданном интервале времени без изменения длительности серии.
                </p>

                {overlayImages.length > 0 && (
                  <div className="space-y-3">
                    {overlayImages.map((ov) => {
                      const updateOv = (patch: Partial<OverlayImageItem>) => {
                        setOverlayImages((prev) =>
                          prev.map((item) => (item.id === ov.id ? { ...item, ...patch } : item))
                        );
                      };

                      return (
                        <div
                          key={ov.id}
                          className="p-3 rounded-xl bg-neutral-950 border border-purple-500/30 space-y-2.5 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              {ov.previewUrl && (
                                <img
                                  src={ov.previewUrl}
                                  alt={ov.name}
                                  className="w-9 h-9 rounded object-contain bg-black border border-neutral-700"
                                />
                              )}
                              <span className="font-semibold text-purple-200 truncate">{ov.name}</span>
                            </div>
                            <button
                              onClick={() => setOverlayImages((prev) => prev.filter((item) => item.id !== ov.id))}
                              className="p-1 rounded hover:bg-rose-500/20 text-rose-400"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <label className="text-[11px] text-neutral-400">
                              Показать ОТ (сек):
                              <div className="flex items-center gap-1 mt-0.5">
                                <input
                                  type="number"
                                  step="0.2"
                                  value={ov.startSec}
                                  onChange={(e) => updateOv({ startSec: Math.max(0, parseFloat(e.target.value) || 0) })}
                                  className="w-full px-2 py-1 rounded bg-neutral-900 border border-neutral-700 font-mono text-white"
                                />
                                <button
                                  onClick={() => updateOv({ startSec: Number(currentTime.toFixed(2)) })}
                                  className="px-2 py-1 rounded bg-neutral-800 text-[10px] text-neutral-300"
                                >
                                  Плеер
                                </button>
                              </div>
                            </label>

                            <label className="text-[11px] text-neutral-400">
                              Показать ДО (сек):
                              <div className="flex items-center gap-1 mt-0.5">
                                <input
                                  type="number"
                                  step="0.2"
                                  value={ov.endSec}
                                  onChange={(e) => updateOv({ endSec: Math.max(0, parseFloat(e.target.value) || 0) })}
                                  className="w-full px-2 py-1 rounded bg-neutral-900 border border-neutral-700 font-mono text-white"
                                />
                                <button
                                  onClick={() => updateOv({ endSec: Number(currentTime.toFixed(2)) })}
                                  className="px-2 py-1 rounded bg-neutral-800 text-[10px] text-neutral-300"
                                >
                                  Плеер
                                </button>
                              </div>
                            </label>
                          </div>

                          <div className="grid grid-cols-3 gap-2 pt-1">
                            <label className="text-[11px] text-neutral-400">
                              Позиция X ({ov.xPercent}%):
                              <input
                                type="range"
                                min="0"
                                max="100"
                                value={ov.xPercent}
                                onChange={(e) => updateOv({ xPercent: Number(e.target.value) })}
                                className="w-full accent-purple-500 mt-1"
                              />
                            </label>
                            <label className="text-[11px] text-neutral-400">
                              Позиция Y ({ov.yPercent}%):
                              <input
                                type="range"
                                min="0"
                                max="100"
                                value={ov.yPercent}
                                onChange={(e) => updateOv({ yPercent: Number(e.target.value) })}
                                className="w-full accent-purple-500 mt-1"
                              />
                            </label>
                            <label className="text-[11px] text-neutral-400">
                              Размер ({ov.widthPercent}%):
                              <input
                                type="range"
                                min="5"
                                max="100"
                                value={ov.widthPercent}
                                onChange={(e) => updateOv({ widthPercent: Number(e.target.value) })}
                                className="w-full accent-purple-500 mt-1"
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION 3: EXTERNAL VIDEOS (INTRO / OUTRO) */}
          {activeSection === 'videos' && (
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-5 shadow-lg">
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Film className="w-4 h-4 text-amber-400" />
                  Добавить стороннее видео в начало (Интро) или в конец (Аутро)
                </h3>
                <p className="text-xs text-neutral-400">
                  Позволяет прикрепить интро студии или дисклеймер перед серией (автоматически сдвинет все субтитры вперед на длительность интро) и/или аутро в конец серии. Основное видео серии копируется напрямую (<code className="text-indigo-300">-c copy</code>).
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={() => handlePickExternalVideo('intro')}
                    className="p-3.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 text-xs font-bold flex items-center justify-center gap-2 transition-colors"
                  >
                    <Plus className="w-4 h-4 text-amber-400" />
                    <span>Добавить видео в НАЧАЛО</span>
                  </button>

                  <button
                    onClick={() => handlePickExternalVideo('outro')}
                    className="p-3.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 text-xs font-bold flex items-center justify-center gap-2 transition-colors"
                  >
                    <Plus className="w-4 h-4 text-amber-400" />
                    <span>Добавить видео в КОНЕЦ</span>
                  </button>
                </div>

                {/* Intro Videos List */}
                {introVideos.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <div className="text-xs font-semibold text-amber-300">Видео в начале (сдвигают субтитры вперед):</div>
                    {introVideos.map((v) => (
                      <div
                        key={v.id}
                        className="p-2.5 rounded-xl bg-neutral-950 border border-amber-500/30 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-white truncate">{v.name}</div>
                          <div className="text-[11px] text-neutral-400 font-mono">
                            Длительность: +{v.durationSec.toFixed(2)}с {v.width ? `• ${v.width}×${v.height}` : ''}
                          </div>
                        </div>
                        <button
                          onClick={() => setIntroVideos((prev) => prev.filter((item) => item.id !== v.id))}
                          className="p-1.5 rounded hover:bg-rose-500/20 text-rose-400"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Outro Videos List */}
                {outroVideos.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <div className="text-xs font-semibold text-amber-300">Видео в конце (после завершения серии):</div>
                    {outroVideos.map((v) => (
                      <div
                        key={v.id}
                        className="p-2.5 rounded-xl bg-neutral-950 border border-amber-500/30 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-white truncate">{v.name}</div>
                          <div className="text-[11px] text-neutral-400 font-mono">
                            Длительность: +{v.durationSec.toFixed(2)}с {v.width ? `• ${v.width}×${v.height}` : ''}
                          </div>
                        </div>
                        <button
                          onClick={() => setOutroVideos((prev) => prev.filter((item) => item.id !== v.id))}
                          className="p-1.5 rounded hover:bg-rose-500/20 text-rose-400"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION 4: SUBTITLE RECALCULATION PREVIEW */}
          {activeSection === 'subs' && (
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-4 shadow-lg">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-emerald-400" />
                  Авто-пересчет тайминга субтитров (ASS / SRT)
                </h3>
                {isPreviewLoading && <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />}
              </div>

              {!currentEpisode.subPath ? (
                <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs text-amber-200 flex items-center gap-2.5">
                  <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
                  <span>
                    К этой серии еще не прикреплен файл субтитров. Загрузите ASS/SRT в Дашборде проекта, чтобы редактор автоматически пересчитал все тайминги под новое видео.
                  </span>
                </div>
              ) : subPreview ? (
                <>
                  {/* Stats Grid */}
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div className="p-2.5 rounded-xl bg-neutral-950 border border-neutral-800">
                      <div className="text-[10px] text-neutral-400 uppercase">Всего строк</div>
                      <div className="text-sm font-bold text-white font-mono mt-0.5">{subPreview.totalLines}</div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-neutral-950 border border-emerald-500/30">
                      <div className="text-[10px] text-emerald-400 uppercase">Сдвинуто</div>
                      <div className="text-sm font-bold text-emerald-300 font-mono mt-0.5">{subPreview.shiftedLines}</div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-neutral-950 border border-amber-500/30">
                      <div className="text-[10px] text-amber-400 uppercase">Подрезано</div>
                      <div className="text-sm font-bold text-amber-300 font-mono mt-0.5">{subPreview.trimmedLines}</div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-neutral-950 border border-rose-500/30">
                      <div className="text-[10px] text-rose-400 uppercase">В вырезке</div>
                      <div className="text-sm font-bold text-rose-300 font-mono mt-0.5">{subPreview.removedLines}</div>
                    </div>
                  </div>

                  {/* Preview Table */}
                  <div className="max-h-[320px] overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950 divide-y divide-neutral-800/70">
                    {(subPreview.sampleChanges || []).map((row: any, idx: number) => (
                      <div key={idx} className="p-2.5 text-xs space-y-1 hover:bg-neutral-900/60">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-indigo-300 truncate">
                            #{row.lineNumber} • {row.actor}
                          </span>
                          {row.status === 'removed' ? (
                            <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono text-[10px] font-bold">
                              УДАЛЕНА (В ВЫРЕЗКЕ)
                            </span>
                          ) : (
                            <span
                              className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                                row.deltaSec === 0
                                  ? 'bg-neutral-800 text-neutral-400'
                                  : row.deltaSec > 0
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'bg-amber-500/20 text-amber-300'
                              }`}
                            >
                              {row.oldStart} ➔ {row.newStart} ({row.deltaSec >= 0 ? `+${row.deltaSec}с` : `${row.deltaSec}с`})
                            </span>
                          )}
                        </div>
                        <div className="text-neutral-400 truncate">{row.text}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Live Process Log Console */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-lg">
        <div
          onClick={() => setShowInlineConsole((v) => !v)}
          className="px-4 py-2.5 bg-neutral-950 border-b border-neutral-800 flex items-center justify-between cursor-pointer select-none"
        >
          <div className="flex items-center gap-2 text-xs font-bold text-neutral-300">
            <Terminal className="w-4 h-4 text-indigo-400" />
            <span>Журнал процессов видеоредактора и пересчета ASS (Real-Time Debug Log)</span>
            <span className="text-[11px] px-2 py-0.2 rounded bg-neutral-800 text-neutral-400 font-mono">
              {moduleLogs.length} записей
            </span>
          </div>
          <div className="flex items-center gap-2">
            {moduleLogs.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearModuleLogs();
                }}
                className="text-[11px] text-neutral-400 hover:text-white px-2 py-0.5 rounded bg-neutral-800"
              >
                Очистить
              </button>
            )}
            <span className="text-xs text-neutral-500">{showInlineConsole ? 'Свернуть ▲' : 'Развернуть ▼'}</span>
          </div>
        </div>

        {showInlineConsole && (
          <div className="max-h-52 overflow-y-auto p-3 bg-neutral-950/90 font-mono text-[11px] space-y-1">
            {moduleLogs.length === 0 ? (
              <div className="text-neutral-500 italic py-2">
                Журнал готов. Все операции подрезки, склейки FFmpeg и пересчета таймингов ASS логируются здесь в реальном времени.
              </div>
            ) : (
              moduleLogs.slice(-80).map((entry) => (
                <div
                  key={entry.id}
                  className={`flex items-start gap-2 leading-relaxed ${
                    entry.level === 'error'
                      ? 'text-rose-400'
                      : entry.level === 'warn'
                      ? 'text-amber-300'
                      : 'text-neutral-300'
                  }`}
                >
                  <span className="text-neutral-500 shrink-0">[{entry.time}]</span>
                  <span className="break-all">{entry.message}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Full Log Viewer Drawer */}
      <LogViewerDrawer
        isOpen={isLogsDrawerOpen}
        onToggle={() => setIsLogsDrawerOpen((prev) => !prev)}
        title="Логи Редактирования Видео и Пересчета ASS"
        scope="VIDEO-EDITOR"
        logs={moduleLogs}
        onClear={clearModuleLogs}
      />
    </div>
  );
}
