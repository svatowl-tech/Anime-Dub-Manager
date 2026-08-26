import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Loader2, Play, Save, Video, ChevronRight, AlertCircle, CheckCircle2, Edit3, Crop, Camera, RefreshCw, Sliders } from 'lucide-react';
import { toast } from 'sonner';
import { Episode } from '../types';
import { ipcSafe } from '../lib/ipcSafe';
import VisualCropEditor from './VisualCropEditor';

interface AssOcrPanelProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
}

interface SubtitleLine {
  id: number;
  start: string;
  end: string;
  text: string;
  rawLineIndex: number;
}

export default function AssOcrPanel({ currentEpisode, onRefresh }: AssOcrPanelProps) {
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

  const getCropConfig = () => {
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
  };

  const updateCropPreset = (preset: string) => {
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
  };

  const handleTakeScreenshot = async () => {
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
  };

  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds <= 0) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Monitor episode modifications & fetch metadata & initial frames
  useEffect(() => {
    if (currentEpisode?.rawPath) {
      ipcSafe.invoke('get-video-metadata', currentEpisode.rawPath).then(meta => {
        if (meta && meta.format && meta.format.duration) {
          const duration = meta.format.duration;
          setVideoDuration(duration);
          
          // Select default timestamp at 12% duration or 90 seconds
          const initialTime = Math.min(200, Math.floor(duration * 0.12)) || 10;
          setScreenshotTime(initialTime);
          
          // Capture automatically
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
  }, [currentEpisode?.rawPath]);

  useEffect(() => {
    if (currentEpisode?.subPath) {
      loadSubtitles();
    } else {
      setLines([]);
    }
  }, [currentEpisode?.subPath]);

  const loadSubtitles = async () => {
    if (!currentEpisode?.subPath) return;
    try {
      const result = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
      setLines(result.lines || []);
    } catch (err) {
      console.error("Error loading subtitles:", err);
    }
  };

  const handleStartOcr = async () => {
    if (!currentEpisode || !currentEpisode.rawPath) return;
    
    let subPath = currentEpisode.subPath;
    if (!subPath) {
      // Generate subPath if not exists
      subPath = currentEpisode.rawPath.replace(/\.[^/.]+$/, ".ass");
    }

    setIsProcessing(true);
    setProgress(0);
    setStatus('Подготовка к распознаванию...');
    
    let removeListener: (() => void) | undefined;
    
    try {
      // Listen for progress using the safer way
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
      
      // Update episode with new subPath if it was empty
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
  };

  const handleSave = async () => {
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
  };

  const assTimeToSeconds = (time: string): number => {
    if (!time) return 0;
    const parts = time.split(':');
    if (parts.length !== 3) return 0;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const s = parseFloat(parts[2]);
    return h * 3600 + m * 60 + s;
  };

  const handleLineClick = (line: SubtitleLine) => {
    if (videoRef.current) {
      videoRef.current.currentTime = assTimeToSeconds(line.start);
      videoRef.current.play().catch(e => {
        if (e?.name !== 'AbortError') console.error(e);
      });
    }
    setEditingId(line.id);
  };

  const handleTextChange = (id: number, newText: string) => {
    setLines(prev => prev.map(l => l.id === id ? { ...l, text: newText } : l));
  };

  if (lines.length > 0) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
      <div key="header" className="p-4 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Video className="w-5 h-5 text-emerald-400" />
            Коррекция хардсаба
          </h2>
          <span className="text-xs text-neutral-500 bg-neutral-800 px-2 py-1 rounded-full border border-neutral-700">
            {lines.length} строк
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleStartOcr}
            disabled={isProcessing}
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-sm transition-colors flex items-center gap-2"
          >
            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Перераспознать
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-bold transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Сохранить
          </button>
        </div>
      </div>

      <div key="content" className="flex-1 flex overflow-hidden">
        {/* Video Preview */}
        <div className="w-1/2 p-4 bg-black flex flex-col items-center justify-between border-r border-neutral-800 overflow-y-auto">
          <div className="w-full flex-1 flex flex-col justify-center">
            <div className="relative w-full aspect-video bg-neutral-900 rounded-lg overflow-hidden shadow-2xl border border-neutral-800">
              {currentEpisode?.rawPath ? (
                <div className="relative w-full h-full">
                  <video
                    ref={videoRef}
                    src={`file://${currentEpisode.rawPath}`}
                    className="w-full h-full object-contain"
                    controls
                  />
                  {/* Visual crop overlay */}
                  {getCropConfig() && (
                    <div 
                      className="absolute border-2 border-emerald-500 bg-emerald-500/15 pointer-events-none transition-all duration-200 z-10"
                      style={{
                        left: `${getCropConfig()!.x}%`,
                        top: `${getCropConfig()!.y}%`,
                        width: `${getCropConfig()!.w}%`,
                        height: `${getCropConfig()!.h}%`,
                      }}
                    >
                      <div className="absolute top-0 left-0 bg-emerald-600 text-[9px] text-white font-bold px-1.5 py-0.5 rounded-br uppercase tracking-wide">
                        Область OCR
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-neutral-500 gap-4">
                  <Video className="w-12 h-12 opacity-20" />
                  <p>Видео не найдено</p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 w-full p-4 bg-neutral-900/50 rounded-xl border border-neutral-800 space-y-3 shrink-0">
            <h3 className="text-xs font-bold text-neutral-300 uppercase tracking-wider flex items-center gap-2">
              <Crop className="w-4 h-4 text-emerald-400" />
              Параметры повторного распознавания
            </h3>
            
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-neutral-500 uppercase font-bold mb-1 block">Язык OCR</label>
                <select 
                  value={ocrLanguage}
                  onChange={(e) => setOcrLanguage(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg text-xs text-white px-2 py-1.5 outline-none focus:border-emerald-500/50 transition-colors"
                >
                  <option value="rus+eng">Русский + Английский</option>
                  <option value="rus">Русский</option>
                  <option value="eng">Английский</option>
                  <option value="jpn+eng">Японский + Английский</option>
                  <option value="jpn">Японский</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] text-neutral-500 uppercase font-bold mb-1 block">Область кадра (Crop)</label>
                <select 
                  value={cropPreset}
                  onChange={(e) => setCropPreset(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg text-xs text-white px-2 py-1.5 outline-none focus:border-emerald-500/50 transition-colors"
                >
                  <option value="bottom25">Нижние 25%</option>
                  <option value="bottom20">Нижние 20%</option>
                  <option value="bottom33">Нижние 33%</option>
                  <option value="top20">Верхние 20%</option>
                  <option value="full">Весь кадр</option>
                  <option value="custom">Ручной выбор</option>
                </select>
              </div>
            </div>

            {cropPreset === 'custom' && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 bg-neutral-950 p-2.5 rounded-lg border border-neutral-800 text-[11px]">
                <div>
                  <div className="flex justify-between text-neutral-500 mb-0.5">
                    <span>Смещение Y:</span>
                    <span className="font-mono text-emerald-400">{customCropY}%</span>
                  </div>
                  <input 
                    type="range" min="0" max="100" 
                    value={customCropY} 
                    onChange={(e) => setCustomCropY(Number(e.target.value))}
                    className="w-full h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-emerald-500" 
                  />
                </div>
                <div>
                  <div className="flex justify-between text-neutral-500 mb-0.5">
                    <span>Высота:</span>
                    <span className="font-mono text-emerald-400">{customCropH}%</span>
                  </div>
                  <input 
                    type="range" min="5" max="100" 
                    value={customCropH} 
                    onChange={(e) => setCustomCropH(Number(e.target.value))}
                    className="w-full h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-emerald-500" 
                  />
                </div>
                <div>
                  <div className="flex justify-between text-neutral-500 mb-0.5">
                    <span>Смещение X:</span>
                    <span className="font-mono text-emerald-400">{customCropX}%</span>
                  </div>
                  <input 
                    type="range" min="0" max="100" 
                    value={customCropX} 
                    onChange={(e) => setCustomCropX(Number(e.target.value))}
                    className="w-full h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-emerald-500" 
                  />
                </div>
                <div>
                  <div className="flex justify-between text-neutral-500 mb-0.5">
                    <span>Ширина:</span>
                    <span className="font-mono text-emerald-400">{customCropW}%</span>
                  </div>
                  <input 
                    type="range" min="5" max="100" 
                    value={customCropW} 
                    onChange={(e) => setCustomCropW(Number(e.target.value))}
                    className="w-full h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-emerald-500" 
                  />
                </div>
              </div>
            )}

            <div className="flex items-center gap-4 pt-1">
              <label className="flex items-center gap-2 cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={preprocess}
                  onChange={(e) => setPreprocess(e.target.checked)}
                  className="rounded border-neutral-800 bg-neutral-950 text-emerald-500 focus:ring-emerald-500/20"
                />
                <span className="text-[11px] text-neutral-400 group-hover:text-neutral-300 transition-colors">Предподготовка изображений (Контраст)</span>
              </label>
            </div>
          </div>
        </div>

        {/* Subtitle List */}
        <div className="w-1/2 flex flex-col bg-neutral-950 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 space-y-2" ref={scrollRef}>
            {lines.map((line, index) => (
              <div
                key={line.id || `line-${index}`}
                onClick={() => handleLineClick(line)}
                className={`p-3 rounded-lg border transition-all cursor-pointer group ${
                  editingId === line.id
                    ? 'bg-emerald-500/10 border-emerald-500/50 shadow-lg shadow-emerald-500/5'
                    : 'bg-neutral-900/50 border-neutral-800 hover:border-neutral-700'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-neutral-500 bg-neutral-950 px-1.5 py-0.5 rounded border border-neutral-800">
                      {line.start}
                    </span>
                    <ChevronRight className="w-3 h-3 text-neutral-700" />
                    <span className="text-[10px] font-mono text-neutral-500 bg-neutral-950 px-1.5 py-0.5 rounded border border-neutral-800">
                      {line.end}
                    </span>
                  </div>
                  <Play className={`w-3 h-3 transition-opacity ${editingId === line.id ? 'opacity-100 text-emerald-500' : 'opacity-0 group-hover:opacity-50 text-neutral-400'}`} />
                </div>
                <textarea
                  value={line.text}
                  onChange={(e) => handleTextChange(line.id, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full bg-transparent border-none text-sm text-neutral-200 focus:ring-0 p-0 resize-none min-h-[1.5rem]"
                  rows={Math.max(1, line.text.split('\n').length)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Status Bar */}
      {status && (
        <div key="status-bar" className="px-4 py-2 bg-neutral-900 border-t border-neutral-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs text-neutral-400">
            {isProcessing ? <Loader2 className="w-3 h-3 animate-spin text-emerald-500" /> : <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
            {status}
          </div>
          {isProcessing && (
            <div className="w-32 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-emerald-500 transition-all duration-300" 
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
      )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-neutral-950 overflow-y-auto custom-scrollbar p-6 space-y-6 font-sans select-none">
      {/* Top Welcome Panel */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-neutral-900 shrink-0">
        <div className="space-y-1 text-left">
          <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
            <span className="p-1.5 bg-emerald-500/10 rounded-lg text-emerald-400 border border-emerald-500/20">
              <Sparkles className="w-5 h-5 fill-emerald-400/20 animate-pulse" />
            </span>
            Мастер распознавания хардсаба (OCR)
          </h2>
          <p className="text-xs text-neutral-400">
            Интерактивный захват кадров со встроенной областью обрезки для высокоточного распознавания вшитых субтитров.
          </p>
        </div>
        
        {currentEpisode?.rawPath && (
          <div className="flex items-center gap-3 bg-neutral-900/40 border border-neutral-800/80 rounded-xl px-4 py-2 text-left">
            <Video className="w-8 h-8 text-emerald-500/60 shrink-0" />
            <div className="text-[11px]">
              <div className="text-neutral-500 font-bold uppercase tracking-wider">Исходный видеофайл</div>
              <div className="text-white font-semibold truncate max-w-[200px]" title={currentEpisode.rawPath}>
                {currentEpisode.rawPath.split(/[/\\]/).pop()}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main Layout Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Column: Visual Crop Workspace (7 cols) */}
        <div className="xl:col-span-7 space-y-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-300 uppercase tracking-wider flex items-center gap-2">
                <Camera className="w-4 h-4 text-emerald-400" />
                Интерактивная область обрезки
              </span>
              <span className="text-[10px] text-neutral-500 bg-neutral-950 px-2 py-0.5 rounded-full border border-neutral-800">
                Зажмите и тащите для изменения зоны
              </span>
            </div>

            {/* Simulated Frame Editor Component */}
            <div className="relative">
              <VisualCropEditor
                screenshotUrl={screenshotPath ? `file://${screenshotPath}` : null}
                cropX={customCropX}
                cropY={customCropY}
                cropW={customCropW}
                cropH={customCropH}
                onChange={(rect) => {
                  setCropPreset('custom');
                  setCustomCropX(rect.x);
                  setCustomCropY(rect.y);
                  setCustomCropW(rect.w);
                  setCustomCropH(rect.h);
                }}
                disabled={isProcessing}
              />

              {/* Loader overlay during capture */}
              {isCapturing && (
                <div className="absolute inset-0 bg-neutral-950/85 backdrop-blur-sm rounded-xl flex flex-col items-center justify-center gap-3 text-neutral-400 z-30 animate-fade-in">
                  <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                  <span className="text-xs font-semibold uppercase tracking-wider animate-pulse">Захват кадра через FFmpeg...</span>
                </div>
              )}
            </div>

            {/* Screenshot Timeline Scrubbing Panel */}
            <div className="bg-neutral-950/60 rounded-xl p-3 border border-neutral-800/60 space-y-3">
              <div className="flex items-center justify-between text-xs text-neutral-400">
                <span className="flex items-center gap-1.5 font-semibold text-neutral-300">
                  <Sliders className="w-3.5 h-3.5 text-emerald-400" />
                  Момент для скриншота:
                </span>
                <span className="text-xs font-mono font-bold bg-neutral-900 border border-neutral-800 text-emerald-400 px-2 py-0.5 rounded">
                  {formatTime(screenshotTime)} {videoDuration > 0 && `/ ${formatTime(videoDuration)}`}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="1"
                  max={videoDuration || 1800}
                  step="1"
                  value={screenshotTime}
                  onChange={(e) => setScreenshotTime(Number(e.target.value))}
                  disabled={!currentEpisode?.rawPath || isCapturing}
                  className="flex-1 h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-emerald-500 disabled:opacity-30"
                />

                <button
                  onClick={handleTakeScreenshot}
                  disabled={!currentEpisode?.rawPath || isCapturing || isProcessing}
                  type="button"
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 shadow-lg shadow-emerald-600/10 active:scale-95 cursor-pointer"
                >
                  {isCapturing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  Обновить кадр
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Ocr Settings & Presets Dashboard (5 cols) */}
        <div className="xl:col-span-12 xl:col-start-1 xl:mt-0 xl:col-span-5 space-y-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-xl space-y-5 text-left">
            {/* Aspect Preset selectors */}
            <div className="space-y-2">
              <label className="text-[10px] text-neutral-500 uppercase font-black tracking-wider block">Быстрые пресеты области</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'bottom25', label: 'Нижние 25%' },
                  { id: 'bottom20', label: 'Нижние 20%' },
                  { id: 'bottom33', label: 'Нижние 33%' },
                  { id: 'top20', label: 'Верхние 20%' },
                  { id: 'full', label: 'Весь экран' },
                  { id: 'custom', label: 'Вручную' }
                ].map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => updateCropPreset(preset.id)}
                    type="button"
                    className={`px-3 py-2 text-xs font-bold rounded-xl border text-center transition-all cursor-pointer ${
                      cropPreset === preset.id
                        ? 'bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-600/10'
                        : 'bg-neutral-950 text-neutral-400 border-neutral-800/80 hover:bg-neutral-900 hover:text-white'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Precision Crop Controls */}
            <div className="bg-neutral-950/45 border border-neutral-800/60 rounded-2xl p-4 space-y-4">
              <div className="text-[10px] text-neutral-300 font-extrabold uppercase tracking-wider flex items-center gap-1.5 border-b border-neutral-800/60 pb-2">
                <Crop className="w-3.5 h-3.5 text-emerald-400" />
                Тонкая настройка области (Сужение / Сдвиг)
              </div>
              
              <div className="space-y-3.5 text-left">
                {/* Horizontal Coordinate Settings */}
                <div className="p-3 bg-neutral-950 rounded-xl border border-neutral-800/35 space-y-3">
                  <span className="text-[9px] font-extrabold text-neutral-500 uppercase tracking-widest block">ПО ГОРИЗОНТАЛИ (СУЖЕНИЕ)</span>
                  <div>
                    <div className="flex justify-between text-[11px] text-neutral-400 mb-1">
                      <span>Смещение X (Сдвиг влево/вправо):</span>
                      <span className="font-mono font-bold text-emerald-400">{customCropX}%</span>
                    </div>
                    <input 
                      type="range" min="0" max="95" 
                      value={customCropX} 
                      onChange={(e) => {
                        setCropPreset('custom');
                        const val = Number(e.target.value);
                        setCustomCropX(val);
                        // Ensure width doesn't spill over 100% boundary
                        if (val + customCropW > 100) {
                          setCustomCropW(100 - val);
                        }
                      }}
                      className="w-full h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-emerald-500" 
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] text-neutral-400 mb-1">
                      <span>Ширина области / Сужение:</span>
                      <span className="font-mono font-bold text-emerald-400">{customCropW}%</span>
                    </div>
                    <input 
                      type="range" min="5" max={100 - customCropX} 
                      value={customCropW} 
                      onChange={(e) => {
                        setCropPreset('custom');
                        setCustomCropW(Number(e.target.value));
                      }}
                      className="w-full h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-emerald-500" 
                    />
                  </div>
                </div>

                {/* Vertical Coordinate Settings */}
                <div className="p-3 bg-neutral-950 rounded-xl border border-neutral-800/35 space-y-3">
                  <span className="text-[9px] font-extrabold text-neutral-500 uppercase tracking-widest block">ПО ВЕРТИКАЛИ (ВЫСОТА)</span>
                  <div>
                    <div className="flex justify-between text-[11px] text-neutral-400 mb-1">
                      <span>Смещение Y (Сдвиг вверх/вниз):</span>
                      <span className="font-mono font-bold text-emerald-400">{customCropY}%</span>
                    </div>
                    <input 
                      type="range" min="0" max="95" 
                      value={customCropY} 
                      onChange={(e) => {
                        setCropPreset('custom');
                        const val = Number(e.target.value);
                        setCustomCropY(val);
                        // Ensure height doesn't spill over 100% boundary
                        if (val + customCropH > 100) {
                          setCustomCropH(100 - val);
                        }
                      }}
                      className="w-full h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-emerald-500" 
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] text-neutral-400 mb-1">
                      <span>Высота области:</span>
                      <span className="font-mono font-bold text-emerald-400">{customCropH}%</span>
                    </div>
                    <input 
                      type="range" min="5" max={100 - customCropY} 
                      value={customCropH} 
                      onChange={(e) => {
                        setCropPreset('custom');
                        setCustomCropH(Number(e.target.value));
                      }}
                      className="w-full h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-emerald-500" 
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Language Selection */}
            <div className="space-y-2">
              <label className="text-[10px] text-neutral-500 uppercase font-black tracking-wider block">Языковой пакет распознавания (Tesseract)</label>
              <select
                value={ocrLanguage}
                onChange={(e) => setOcrLanguage(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-white px-3 py-2.5 outline-none focus:border-emerald-500 cursor-pointer transition-colors"
              >
                <option value="rus+eng">Русский + Английский (Рекомендуется)</option>
                <option value="rus">Русский (Только RU)</option>
                <option value="eng">Английский (Только EN)</option>
                <option value="jpn+eng">Японский + Английский</option>
                <option value="jpn">Японский (Только JA)</option>
              </select>
            </div>

            {/* Preprocessing enhancement */}
            <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-800/60">
              <label className="flex items-center gap-3 cursor-pointer group select-none">
                <input
                  type="checkbox"
                  checked={preprocess}
                  onChange={(e) => setPreprocess(e.target.checked)}
                  className="w-4 h-4 rounded border-neutral-800 bg-neutral-950 text-emerald-500 focus:ring-emerald-500/15"
                />
                <div className="text-[11px] space-y-0.5">
                  <span className="text-neutral-300 font-bold group-hover:text-emerald-400 transition-colors">Предварительный контраст (Preprocess)</span>
                  <p className="text-neutral-500 leading-relaxed font-normal">
                    Фильтрует шумы заднего фона перед распознаванием. Значительно улучшает OCR для стилизованных субтитров.
                  </p>
                </div>
              </label>
            </div>

            {/* Action panel & status */}
            <div className="pt-3 border-t border-neutral-900 space-y-4">
              <button
                onClick={handleStartOcr}
                disabled={isProcessing || !currentEpisode?.rawPath}
                className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl font-black text-sm transition-all flex items-center justify-center gap-2 shadow-xl shadow-emerald-500/10 hover:shadow-emerald-500/20 active:scale-95 cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Идет распознавание... {Math.round(progress)}%
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5 fill-amber-300/15 text-amber-300" />
                    Начать распознавание субтитров
                  </>
                )}
              </button>

              {!currentEpisode?.rawPath && (
                <div className="flex items-start gap-2.5 text-amber-500 text-xs bg-amber-500/5 px-4 py-3 rounded-xl border border-amber-500/10">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Файлы не обнаружены.</span> Сначала привяжите или импортируйте видеофайл (RAW) для этой серии в панели управления.
                  </div>
                </div>
              )}

              {status && (
                <div className="p-3 bg-neutral-950 text-xs text-neutral-300 border border-neutral-800 rounded-xl flex items-center gap-2 animate-fade-in font-mono">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping shrink-0" />
                  <span>Статус: {status}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
