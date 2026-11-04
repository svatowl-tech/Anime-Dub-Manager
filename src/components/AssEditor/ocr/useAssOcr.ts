import { useState, useRef, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Episode } from '../../../types';
import { ipcSafe } from '../../../lib/ipcSafe';

export interface SubtitleLine {
  id: number;
  start: string;
  end: string;
  text: string;
  rawLineIndex: number;
}

export interface UseAssOcrProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
}

export function useAssOcr({ currentEpisode, onRefresh }: UseAssOcrProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [lines, setLines] = useState<SubtitleLine[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // OCR Options
  const [ocrLanguage, setOcrLanguage] = useState('rus+eng');
  const [preprocess, setPreprocess] = useState(false);

  // Crop / Region of Interest (ROI) options
  const [cropPreset, setCropPreset] = useState<string>('bottom25');
  const [customCropX, setCustomCropX] = useState<number>(0);
  const [customCropY, setCustomCropY] = useState<number>(75);
  const [customCropW, setCustomCropW] = useState<number>(100);
  const [customCropH, setCustomCropH] = useState<number>(25);

  // Video Frame / Screenshot Preview States
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [screenshotTime, setScreenshotTime] = useState<number>(10);
  const [screenshotPath, setScreenshotPath] = useState<string>('');
  const [isCapturing, setIsCapturing] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const getCropConfig = useCallback(() => {
    switch (cropPreset) {
      case 'full':
        return null;
      case 'bottom20':
        return { x: 0, y: 80, w: 100, h: 20 };
      case 'bottom25':
        return { x: 0, y: 75, w: 100, h: 25 };
      case 'bottom33':
        return { x: 0, y: 67, w: 100, h: 33 };
      case 'top20':
        return { x: 0, y: 0, w: 100, h: 20 };
      case 'custom':
        return { x: customCropX, y: customCropY, w: customCropW, h: customCropH };
      default:
        return null;
    }
  }, [cropPreset, customCropH, customCropW, customCropX, customCropY]);

  const updateCropPreset = useCallback((preset: string) => {
    setCropPreset(preset);
    let target = { x: 0, y: 75, w: 100, h: 25 };
    if (preset === 'bottom20') target = { x: 0, y: 80, w: 100, h: 20 };
    else if (preset === 'bottom25') target = { x: 0, y: 75, w: 100, h: 25 };
    else if (preset === 'bottom33') target = { x: 0, y: 67, w: 100, h: 33 };
    else if (preset === 'top20') target = { x: 0, y: 0, w: 100, h: 20 };
    else if (preset === 'full') target = { x: 0, y: 0, w: 100, h: 100 };

    if (preset !== 'custom') {
      setCustomCropX(target.x);
      setCustomCropY(target.y);
      setCustomCropW(target.w);
      setCustomCropH(target.h);
    }
  }, []);

  const formatTime = useCallback((seconds: number) => {
    if (isNaN(seconds) || seconds <= 0) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }, []);

  const handleTakeScreenshot = useCallback(async () => {
    if (!currentEpisode?.rawPath) return;
    setIsCapturing(true);
    try {
      const tempDir = await ipcSafe.invoke('get-temp-path');
      const outputPath = `${tempDir}/ocr_screenshot_${currentEpisode.id}_${Math.floor(screenshotTime)}.jpg`;
      const res = await ipcSafe.invoke('take-screenshot', {
        videoPath: currentEpisode.rawPath,
        timestamp: screenshotTime,
        outputPath
      });
      if (res && res.path) {
        setScreenshotPath(res.path);
        toast.success(`Кадр на ${formatTime(screenshotTime)} обновлен!`);
      }
    } catch (err: any) {
      console.error('[TakeScreenshot] Error:', err);
      toast.error('Не удалось захватить кадр из видео. Убедитесь, что ffmpeg доступен.');
    } finally {
      setIsCapturing(false);
    }
  }, [currentEpisode?.id, currentEpisode?.rawPath, formatTime, screenshotTime]);

  useEffect(() => {
    if (currentEpisode?.rawPath) {
      ipcSafe.invoke('get-video-metadata', currentEpisode.rawPath).then(meta => {
        if (meta && meta.format && meta.format.duration) {
          const duration = meta.format.duration;
          setVideoDuration(duration);

          const initialTime = Math.min(200, Math.floor(duration * 0.12)) || 10;
          setScreenshotTime(initialTime);

          setIsCapturing(true);
          ipcSafe.invoke('get-temp-path').then(tempDir => {
            const outputPath = `${tempDir}/ocr_screenshot_${currentEpisode.id}_init.jpg`;
            ipcSafe.invoke('take-screenshot', {
              videoPath: currentEpisode.rawPath,
              timestamp: initialTime,
              outputPath
            }).then(res => {
              if (res && res.path) {
                setScreenshotPath(res.path);
              }
            }).catch(e => console.warn("Failed to capture auto screenshot", e))
              .finally(() => setIsCapturing(false));
          });
        }
      }).catch(err => {
        console.warn("Error loaded metadata:", err);
      });
    } else {
      setScreenshotPath('');
      setVideoDuration(0);
    }
  }, [currentEpisode?.id, currentEpisode?.rawPath]);

  const loadSubtitles = useCallback(async () => {
    if (!currentEpisode?.subPath) return;
    try {
      const result = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
      setLines(result.lines || []);
    } catch (err) {
      console.error("Error loading subtitles:", err);
    }
  }, [currentEpisode?.subPath]);

  useEffect(() => {
    if (currentEpisode?.subPath) {
      loadSubtitles();
    } else {
      setLines([]);
    }
  }, [currentEpisode?.subPath, loadSubtitles]);

  const handleStartOcr = useCallback(async () => {
    if (!currentEpisode || !currentEpisode.rawPath) return;

    let subPath = currentEpisode.subPath;
    if (!subPath) {
      subPath = currentEpisode.rawPath.replace(/\.[^/.]+$/, ".ass");
    }

    setIsProcessing(true);
    setProgress(0);
    setStatus('Подготовка к распознаванию...');

    let removeListener: (() => void) | undefined;

    try {
      removeListener = ipcSafe.on('ffmpeg-progress', (p: number) => {
        setProgress(p);
        setStatus(`Распознавание хардсаба: ${Math.round(p)}%`);
      });

      await ipcSafe.invoke('extract-hardsub', {
        videoPath: currentEpisode.rawPath,
        outputAssPath: subPath,
        language: ocrLanguage,
        preprocess: preprocess,
        crop: getCropConfig()
      });

      if (!currentEpisode.subPath) {
        await ipcSafe.invoke('save-episode', {
          ...currentEpisode,
          subPath: subPath,
          isHardsub: true
        });
      }

      setStatus('Распознавание завершено!');
      setProgress(100);
      onRefresh();
      await loadSubtitles();
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setStatus(`Ошибка: ${err.message}`);
      }
    } finally {
      setIsProcessing(false);
      if (removeListener) removeListener();
    }
  }, [currentEpisode, getCropConfig, loadSubtitles, ocrLanguage, onRefresh, preprocess]);

  const handleSave = useCallback(async () => {
    if (!currentEpisode?.subPath || lines.length === 0) return;

    setIsSaving(true);
    try {
      await ipcSafe.invoke('save-translated-subtitles', {
        assFilePath: currentEpisode.subPath,
        translatedLines: lines.map(l => ({ rawLineIndex: l.rawLineIndex, text: l.text }))
      });
      setStatus('Изменения сохранены!');
      setTimeout(() => setStatus(''), 3000);
    } catch (err: any) {
      setStatus(`Ошибка при сохранении: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  }, [currentEpisode?.subPath, lines]);

  const assTimeToSeconds = (time: string): number => {
    if (!time) return 0;
    const parts = time.split(':');
    if (parts.length !== 3) return 0;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const s = parseFloat(parts[2]);
    return h * 3600 + m * 60 + s;
  };

  const handleLineClick = useCallback((line: SubtitleLine) => {
    if (videoRef.current) {
      videoRef.current.currentTime = assTimeToSeconds(line.start);
      videoRef.current.play().catch(e => {
        if (e?.name !== 'AbortError') console.error(e);
      });
    }
    setEditingId(line.id);
  }, []);

  const handleTextChange = useCallback((id: number, newText: string) => {
    setLines(prev => prev.map(l => l.id === id ? { ...l, text: newText } : l));
  }, []);

  return {
    isProcessing,
    status,
    progress,
    lines,
    editingId,
    isSaving,
    ocrLanguage,
    setOcrLanguage,
    preprocess,
    setPreprocess,
    cropPreset,
    setCropPreset,
    customCropX,
    setCustomCropX,
    customCropY,
    setCustomCropY,
    customCropW,
    setCustomCropW,
    customCropH,
    setCustomCropH,
    videoDuration,
    screenshotTime,
    setScreenshotTime,
    screenshotPath,
    isCapturing,
    videoRef,
    scrollRef,
    getCropConfig,
    updateCropPreset,
    handleTakeScreenshot,
    formatTime,
    loadSubtitles,
    handleStartOcr,
    handleSave,
    handleLineClick,
    handleTextChange,
  };
}
