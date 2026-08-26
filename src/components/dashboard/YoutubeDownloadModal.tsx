import React, { useState } from 'react';
import { X, Youtube, Download, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { ipcSafe } from '../../lib/ipcSafe';

interface YoutubeDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDownload: (url: string, formatId: string, subLang: string) => Promise<void>;
}

export default function YoutubeDownloadModal({ isOpen, onClose, onDownload }: YoutubeDownloadModalProps) {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [videoInfo, setVideoInfo] = useState<any>(null);
  const [selectedFormat, setSelectedFormat] = useState<string>('best');
  const [selectedSub, setSelectedSub] = useState<string>('none');

  if (!isOpen) return null;

  const handleFetchInfo = async () => {
    if (!url) {
      toast.error('Введите ссылку на YouTube');
      return;
    }
    
    setIsLoading(true);
    try {
      const info = await ipcSafe.invoke('youtube-get-info', url);
      setVideoInfo(info);
      
      // Select best format by default
      const bestVideo = info.formats?.filter((f: any) => f.vcodec !== 'none' && f.acodec !== 'none').sort((a: any, b: any) => (b.height || 0) - (a.height || 0))[0];
      if (bestVideo) {
        setSelectedFormat(bestVideo.format_id);
      } else {
        setSelectedFormat('best');
      }

      // Detect ru or en subs if available
      const subs = [...Object.keys(info.subtitles || {}), ...Object.keys(info.automatic_captions || {})];
      if (subs.includes('ru')) setSelectedSub('ru');
      else if (subs.includes('en')) setSelectedSub('en');
      else setSelectedSub('none');

    } catch (err: any) {
      toast.error('Ошибка при получении данных: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!videoInfo) return;
    setIsDownloading(true);
    try {
      await onDownload(url, selectedFormat, selectedSub);
      toast.success('Загрузка завершена!');
      onClose();
    } catch (err: any) {
      toast.error('Ошибка при скачивании: ' + err.message);
    } finally {
      setIsDownloading(false);
    }
  };

  const getSubLanguages = () => {
    if (!videoInfo) return [];
    const subs = new Set<string>();
    Object.keys(videoInfo.subtitles || {}).forEach(k => subs.add(k));
    Object.keys(videoInfo.automatic_captions || {}).forEach(k => subs.add(k));
    return Array.from(subs).sort();
  };

  const getVideoFormats = () => {
    if (!videoInfo || !videoInfo.formats) return [];
    // Filter formats that have video
    return videoInfo.formats
      .filter((f: any) => f.vcodec !== 'none')
      .sort((a: any, b: any) => (b.height || 0) - (a.height || 0));
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-neutral-900 rounded-xl shadow-xl w-full max-w-lg overflow-hidden border border-neutral-800">
        <div className="flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-950">
          <h3 className="text-lg font-medium text-white flex items-center gap-2">
            <Youtube className="w-5 h-5 text-red-500" />
            Загрузить с YouTube
          </h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-white transition-colors" disabled={isDownloading}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-1">Ссылка на видео</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=..."
                className="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-red-500 transition-colors"
                disabled={isLoading || isDownloading}
              />
              <button 
                onClick={handleFetchInfo}
                disabled={isLoading || isDownloading || !url}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg transition-colors border border-neutral-700 disabled:opacity-50 flex items-center gap-2"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Искать
              </button>
            </div>
          </div>

          {videoInfo && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
              <div className="p-3 bg-neutral-800 rounded-lg border border-neutral-700">
                <h4 className="text-white font-medium line-clamp-2">{videoInfo.title}</h4>
                <div className="text-xs text-neutral-400 mt-1">ID: {videoInfo.id}</div>
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1">Качество видео</label>
                <select 
                  value={selectedFormat}
                  onChange={(e) => setSelectedFormat(e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-red-500"
                  disabled={isDownloading}
                >
                  <option value="best">Лучшее качество (Авто)</option>
                  {getVideoFormats().map((f: any) => (
                    <option key={f.format_id} value={f.format_id}>
                      {f.resolution || f.height ? `${f.height}p` : 'Неизвестно'} 
                      {f.ext ? ` (${f.ext})` : ''} 
                      {f.acodec === 'none' ? ' [Без звука]' : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-neutral-500 mt-1">Лучше выбирать форматы со звуком, если нет возможности объединить аудио и видео потоки.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1">Субтитры</label>
                <select 
                  value={selectedSub}
                  onChange={(e) => setSelectedSub(e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-red-500"
                  disabled={isDownloading}
                >
                  <option value="none">Без субтитров</option>
                  {getSubLanguages().map((lang) => (
                    <option key={lang} value={lang}>{lang.toUpperCase()}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-neutral-800 flex justify-end gap-3 bg-neutral-950">
          <button 
            onClick={onClose} 
            className="px-4 py-2 text-neutral-400 hover:text-white transition-colors"
            disabled={isDownloading}
          >
            Отмена
          </button>
          <button 
            onClick={handleDownload}
            disabled={!videoInfo || isDownloading}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {isDownloading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Скачивание...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Скачать
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
