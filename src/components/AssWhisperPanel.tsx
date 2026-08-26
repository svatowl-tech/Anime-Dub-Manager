import React, { useState, useEffect } from 'react';
import { Mic, Loader2, Play, Save, Video, ChevronRight, AlertCircle, CheckCircle2, Download, Settings2, Sparkles } from 'lucide-react';
import { Episode } from '../types';
import { ipcSafe } from '../lib/ipcSafe';
import { toast } from 'sonner';

interface AssWhisperPanelProps {
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

export default function AssWhisperPanel({ currentEpisode, onRefresh }: AssWhisperPanelProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [lines, setLines] = useState<SubtitleLine[]>([]);
  const [downloadedModels, setDownloadedModels] = useState<string[]>([]);
  
  // Options
  const [whisperLanguage, setWhisperLanguage] = useState('ja');
  const [selectedModel, setSelectedModel] = useState('tiny');
  const [useWhisperX, setUseWhisperX] = useState(false);
  const [mergeMode, setMergeMode] = useState<'merge' | 'overwrite'>('merge');

  const availableModels = [
    { id: 'tiny', name: 'Tiny (Быстро, низкая точность)', size: '~75 MB' },
    { id: 'base', name: 'Base (Базовая)', size: '~145 MB' },
    { id: 'small', name: 'Small (Хорошая точность)', size: '~480 MB' },
    { id: 'medium', name: 'Medium (Высокая точность)', size: '~1.5 GB' },
    { id: 'large-v3-turbo', name: 'Large V3 Turbo (Максимальная точность)', size: '~1.6 GB' }
  ];

  useEffect(() => {
    loadSubtitles();
    loadModels();
    
    const removeWhisperListener = ipcSafe.on('whisper-progress', (p: number) => {
      setProgress(p);
    });

    const removeDownloadListener = ipcSafe.on('whisper-download-progress', (data: { percent: number }) => {
      setDownloadProgress(data.percent);
    });

    return () => {
      removeWhisperListener();
      removeDownloadListener();
    };
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

  const loadModels = async () => {
    try {
      const models = await ipcSafe.invoke('get-downloaded-whisper-models');
      setDownloadedModels(models || []);
      if (models && models.length > 0 && !models.includes(selectedModel)) {
        setSelectedModel(models[0]);
      }
    } catch (err) {
      console.error("Error loading models:", err);
    }
  };

  const handleDownloadModel = async () => {
    setIsDownloading(true);
    setDownloadProgress(0);
    setStatus(`Скачивание модели ${selectedModel}...`);
    try {
      await ipcSafe.invoke('download-whisper-model', { modelName: selectedModel });
      toast.success(`Модель ${selectedModel} успешно скачана!`);
      await loadModels();
    } catch (err: any) {
      toast.error(`Ошибка скачивания: ${err.message}`);
    } finally {
      setIsDownloading(false);
      setStatus('');
    }
  };

  const handleStartWhisper = async () => {
    if (!currentEpisode || !currentEpisode.rawPath) {
      toast.error("Не найден путь к видеофайлу");
      return;
    }

    if (!useWhisperX && !downloadedModels.includes(selectedModel)) {
      toast.error(`Сначала нужно скачать модель ${selectedModel}`);
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setStatus('Подготовка к распознаванию звука...');
    
    try {
      const srtPath = await ipcSafe.invoke('transcribe-whisper', {
        videoPath: currentEpisode.rawPath,
        language: whisperLanguage,
        model: selectedModel,
        useWhisperX: useWhisperX
      });

      setStatus('Конвертация и загрузка субтитров...');
      
      // If we don't have a subPath yet, use the generated SRT as base or convert to ASS
      let targetSubPath = currentEpisode.subPath;
      if (!targetSubPath) {
        targetSubPath = currentEpisode.rawPath.replace(/\.[^/.]+$/, ".ass");
        // We'll need a service to convert SRT to ASS or just use it.
        // For now, let's assume we want to update the episode.
        await ipcSafe.invoke('save-episode', {
          ...currentEpisode,
          subPath: targetSubPath
        });
      }

      // Convert SRT to ASS using existing service if possible, or just copy text
      const srtData = await ipcSafe.invoke('get-raw-subtitles', srtPath);
      const newLines = srtData.lines || srtData;
      
      await ipcSafe.invoke('merge-subtitles', {
        filePath: targetSubPath,
        newLines: newLines,
        overwrite: mergeMode === 'overwrite'
      });

      setStatus('Распознавание звука завершено!');
      setProgress(100);
      onRefresh();
      await loadSubtitles();
      toast.success("Звук успешно распознан и субтитры загружены!");
    } catch (err: any) {
      console.error('Whisper UI Error:', err);
      setStatus(`Ошибка: ${err.message}`);
      toast.error(`Ошибка: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const isModelDownloaded = downloadedModels.includes(selectedModel);

  return (
    <div className="flex flex-col items-center justify-center h-full p-12 text-center space-y-8 overflow-y-auto">
      <div className="w-20 h-20 bg-blue-500/10 rounded-full flex items-center justify-center border border-blue-500/20">
        <Mic className="w-10 h-10 text-blue-500" />
      </div>

      <div className="max-w-md space-y-2">
        <h2 className="text-2xl font-bold text-white">Распознавание речи (Whisper)</h2>
        <p className="text-neutral-400">
          Превратите звук в текст автоматически прямо в FFmpeg. Поддерживает японский, русский и другие языки.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl">
        {/* Settings */}
        <div className="p-6 bg-neutral-900/50 border border-neutral-800 rounded-2xl text-left space-y-4">
          <div className="flex items-center gap-2 text-blue-400 font-bold text-sm">
            <Settings2 className="w-4 h-4" />
            Настройки AI
          </div>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-neutral-950 border border-neutral-850 rounded-xl">
              <div className="flex flex-col text-left">
                <span className="text-xs font-bold text-white">Разделять по персонажам (WhisperX)</span>
                <span className="text-[10px] text-neutral-500">Автоматическое распознавание ролей</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={useWhisperX} 
                  onChange={(e) => setUseWhisperX(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-neutral-400 after:border-neutral-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600 peer-checked:after:bg-white peer-checked:after:border-white"></div>
              </label>
            </div>

            <div>
              <label className="text-[10px] text-neutral-500 uppercase font-bold mb-1.5 block tracking-wider">Язык озвучки</label>
              <select 
                value={whisperLanguage}
                onChange={(e) => setWhisperLanguage(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl text-sm text-white px-4 py-2.5 outline-none focus:border-blue-500/50 transition-colors"
              >
                <option value="ja">Японский</option>
                <option value="ru">Русский</option>
                <option value="en">Английский</option>
                <option value="auto">Автоопределение</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] text-neutral-500 uppercase font-bold mb-1.5 block tracking-wider">Режим сохранения</label>
              <div className="grid grid-cols-2 gap-2 bg-neutral-950 p-1.5 border border-neutral-800 rounded-xl">
                <button
                  type="button"
                  onClick={() => setMergeMode('merge')}
                  className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${mergeMode === 'merge' ? 'bg-blue-600 text-white shadow-sm' : 'text-neutral-400 hover:text-white bg-transparent'}`}
                >
                  Объединить
                </button>
                <button
                  type="button"
                  onClick={() => setMergeMode('overwrite')}
                  className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${mergeMode === 'overwrite' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'text-neutral-400 hover:text-white bg-transparent'}`}
                >
                  Перезаписать
                </button>
              </div>
            </div>

            <div>
              <label className="text-[10px] text-neutral-500 uppercase font-bold mb-1.5 block tracking-wider">Модель Whisper</label>
              <div className="space-y-2">
                <select 
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl text-sm text-white px-4 py-2.5 outline-none focus:border-blue-500/50 transition-colors"
                >
                  {availableModels.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.size})
                    </option>
                  ))}
                </select>
                
                {useWhisperX ? (
                  <div className="flex items-start gap-2 text-[10px] text-indigo-400 bg-indigo-500/5 p-2.5 rounded-xl border border-indigo-500/10">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>Для работы WhisperX требуется установленная ИИ-среда. Модель будет скачана автоматически в Python при первом запуске.</span>
                  </div>
                ) : (
                  <>
                    {!isModelDownloaded && (
                      <button
                        onClick={handleDownloadModel}
                        disabled={isDownloading}
                        className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-lg text-xs font-bold transition-all"
                      >
                        {isDownloading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Download className="w-3.5 h-3.5" />
                        )}
                        {isDownloading ? `Скачивание... ${downloadProgress}%` : 'Скачать модель'}
                      </button>
                    )}
                    {isModelDownloaded && (
                      <div className="flex items-center gap-1.5 text-[10px] text-emerald-500 font-bold justify-center">
                        <CheckCircle2 className="w-3 h-3" />
                        Модель готова к использованию
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Info & Requirements */}
        <div className="p-6 bg-neutral-900/50 border border-neutral-800 rounded-2xl text-left space-y-4">
          <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm">
            <Sparkles className="w-4 h-4" />
            Особенности
          </div>
          <ul className="text-xs text-neutral-400 space-y-2.5 list-none">
            <li className="flex gap-2">
              <span className="text-indigo-500 font-bold">•</span>
              <span>Молниеносная скорость благодаря интеграции в FFmpeg.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-indigo-500 font-bold">•</span>
              <span>Транскрибация напрямую из видеофайла.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-indigo-500 font-bold">•</span>
              <span>Сгенерированные субтитры будут сразу добавлены в проект.</span>
            </li>
          </ul>
          <div className="mt-4 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
             <div className="flex items-center gap-2 text-amber-500 mb-1">
               <AlertCircle className="w-3.5 h-3.5" />
               <span className="text-[10px] font-bold uppercase tracking-wider">Требование</span>
             </div>
             <p className="text-[10px] text-amber-500/70 leading-relaxed">
               Ваш FFmpeg должен быть версии 8.0 или выше и скомпилирован с поддержкой Whisper.
             </p>
          </div>
        </div>
      </div>

      <div className="space-y-4 w-full flex flex-col items-center">
        <button 
          onClick={handleStartWhisper}
          disabled={isProcessing || !currentEpisode?.rawPath || (!useWhisperX && !isModelDownloaded)}
          className="px-10 py-5 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold transition-all flex items-center gap-4 disabled:opacity-50 shadow-2xl shadow-blue-500/30 group active:scale-95"
        >
          {isProcessing ? (
            <Loader2 className="w-6 h-6 animate-spin" />
          ) : (
            <Sparkles className="w-6 h-6 group-hover:scale-110 transition-all text-blue-200" />
          )}
          <span className="text-lg">
            {isProcessing ? `Распознавание... ${progress}%` : 'Запустить распознавание аудио'}
          </span>
        </button>

        {!currentEpisode?.rawPath && (
          <div className="flex items-center gap-2 text-amber-500 text-sm bg-amber-500/10 px-4 py-2 rounded-lg border border-amber-500/20 animate-pulse">
            <AlertCircle className="w-4 h-4" />
            Сначала выберите видеофайл в настройках серии
          </div>
        )}
      </div>

      {status && (
        <div className="flex flex-col items-center gap-3">
          <div className="px-6 py-3 bg-neutral-800 text-neutral-300 rounded-xl text-sm border border-neutral-700 shadow-lg">
            {status}
          </div>
          {isProcessing && (
            <div className="w-64 h-2 bg-neutral-900 rounded-full overflow-hidden border border-neutral-800">
              <div 
                className="h-full bg-blue-500 transition-all duration-500" 
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
