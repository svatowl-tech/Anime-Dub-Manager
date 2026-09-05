import React, { useState } from 'react';
import { FolderOpen, FileVideo, Image as ImageIcon, Copy, Check, Download, FileText, Sparkles } from 'lucide-react';
import { Episode } from '../../types';

interface ReleaseFilesSectionProps {
  currentEpisode: Episode | null;
  copyToClipboard: (text: string, label: string) => void;
  handleShowInFolder: (path?: string | null) => void;
}

export const ReleaseFilesSection: React.FC<ReleaseFilesSectionProps> = ({
  currentEpisode,
  copyToClipboard,
  handleShowInFolder
}) => {
  const [copiedImage, setCopiedImage] = useState(false);
  const [copyingImg, setCopyingImg] = useState(false);

  const currentPosterPath = typeof currentEpisode?.uploads?.[0] === 'string' 
    ? currentEpisode.uploads[0] 
    : currentEpisode?.uploads?.[0]?.path || currentEpisode?.project?.posterUrl || '';
  const currentVideoPath = currentEpisode?.rawPath || '';
  const currentSubPath = (currentEpisode as any)?.subPath || '';

  // Copy raw image blob to clipboard so user can press Ctrl+V directly into VK/RuTube/TG
  const copyImageBlobToClipboard = async () => {
    if (!currentPosterPath) return;
    setCopyingImg(true);
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = currentPosterPath.startsWith('http') || currentPosterPath.startsWith('data:') 
        ? currentPosterPath 
        : `file://${currentPosterPath}`;

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 600;
      canvas.height = img.naturalHeight || 900;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(async (blob) => {
          if (blob && navigator.clipboard && (window as any).ClipboardItem) {
            try {
              const item = new (window as any).ClipboardItem({ 'image/png': blob });
              await navigator.clipboard.write([item]);
              setCopiedImage(true);
              setTimeout(() => setCopiedImage(false), 2500);
            } catch (e) {
              // Fallback to path copy
              copyToClipboard(currentPosterPath, 'Путь к обложке');
            }
          } else {
            copyToClipboard(currentPosterPath, 'Путь к обложке');
          }
        }, 'image/png');
      }
    } catch (err) {
      console.warn('Canvas image copy failed, copying file path instead:', err);
      copyToClipboard(currentPosterPath, 'Путь к обложке');
    } finally {
      setCopyingImg(false);
    }
  };

  // Download/save poster
  const handleSavePoster = () => {
    if (!currentPosterPath) return;
    const a = document.createElement('a');
    a.href = currentPosterPath;
    a.download = `${currentEpisode?.project?.title || 'cover'}_ep${currentEpisode?.number || '1'}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3.5 space-y-3">
      <div className="flex items-center justify-between text-xs text-neutral-400 font-medium">
        <span className="flex items-center gap-1.5 text-neutral-200 font-semibold">
          <FolderOpen className="w-4 h-4 text-amber-400" />
          Файлы и медиа релиза
        </span>
        <span className="text-[11px] text-neutral-500">Клик: скопировать / 2x: папка</span>
      </div>

      {/* Poster preview banner & quick actions */}
      {currentPosterPath && (
        <div className="flex items-center gap-3 bg-neutral-950/80 border border-neutral-800/80 p-2.5 rounded-lg">
          <div className="w-14 h-20 bg-neutral-900 rounded border border-neutral-700/60 overflow-hidden flex-shrink-0 relative group">
            <img 
              src={currentPosterPath} 
              alt="Постер" 
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
          <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5 space-y-2">
            <div>
              <div className="text-xs font-semibold text-white truncate">
                Обложка серии #{currentEpisode?.number || '1'}
              </div>
              <div className="text-[11px] text-neutral-400 truncate font-mono">
                {currentPosterPath.split(/[\\/]/).pop()}
              </div>
            </div>
            
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={copyImageBlobToClipboard}
                disabled={copyingImg}
                className="px-2.5 py-1 bg-pink-600 hover:bg-pink-500 active:scale-95 text-white rounded-md text-[11px] font-medium transition flex items-center gap-1 cursor-pointer shadow-sm"
                title="Скопировать изображение в буфер обмена для быстрой вставки (Ctrl+V) на сайт"
              >
                {copiedImage ? <Check className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                <span>{copiedImage ? 'Картинка в буфере!' : 'Скопировать картинку (Ctrl+V)'}</span>
              </button>
              <button
                onClick={handleSavePoster}
                className="p-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-md text-[11px] transition cursor-pointer"
                title="Скачать обложку"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleShowInFolder(currentPosterPath)}
                className="p-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-md text-[11px] transition cursor-pointer"
                title="Показать файл обложки в папке проводника"
              >
                <FolderOpen className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Grid of paths */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <button
          onClick={() => copyToClipboard(currentVideoPath, 'Путь к видеофайлу')}
          onDoubleClick={() => handleShowInFolder(currentVideoPath)}
          className="p-2.5 bg-neutral-800/80 hover:bg-neutral-800 border border-neutral-700/50 rounded-lg text-left transition flex items-center justify-between group cursor-pointer"
          title="Клик: скопировать путь, Двойной клик: открыть папку"
        >
          <div className="flex items-center gap-2 truncate">
            <FileVideo className="w-4 h-4 text-sky-400 flex-shrink-0" />
            <div className="truncate">
              <span className="block truncate text-neutral-200 font-medium">Видеофайл (MP4)</span>
              <span className="block truncate text-[10px] text-neutral-500 font-mono">
                {currentVideoPath ? currentVideoPath.split(/[\\/]/).pop() : 'Не указан'}
              </span>
            </div>
          </div>
          <Copy className="w-3.5 h-3.5 text-neutral-500 group-hover:text-neutral-200 flex-shrink-0" />
        </button>

        <button
          onClick={() => copyToClipboard(currentPosterPath, 'Путь к обложке')}
          onDoubleClick={() => handleShowInFolder(currentPosterPath)}
          className="p-2.5 bg-neutral-800/80 hover:bg-neutral-800 border border-neutral-700/50 rounded-lg text-left transition flex items-center justify-between group cursor-pointer"
          title="Клик: скопировать путь, Двойной клик: открыть папку"
        >
          <div className="flex items-center gap-2 truncate">
            <ImageIcon className="w-4 h-4 text-pink-400 flex-shrink-0" />
            <div className="truncate">
              <span className="block truncate text-neutral-200 font-medium">Файл обложки</span>
              <span className="block truncate text-[10px] text-neutral-500 font-mono">
                {currentPosterPath ? currentPosterPath.split(/[\\/]/).pop() : 'Не указан'}
              </span>
            </div>
          </div>
          <Copy className="w-3.5 h-3.5 text-neutral-500 group-hover:text-neutral-200 flex-shrink-0" />
        </button>

        {currentSubPath && (
          <button
            onClick={() => copyToClipboard(currentSubPath, 'Путь к субтитрам')}
            onDoubleClick={() => handleShowInFolder(currentSubPath)}
            className="p-2.5 bg-neutral-800/80 hover:bg-neutral-800 border border-neutral-700/50 rounded-lg text-left transition flex items-center justify-between group cursor-pointer col-span-full"
            title="Клик: скопировать путь, Двойной клик: открыть папку"
          >
            <div className="flex items-center gap-2 truncate">
              <FileText className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <div className="truncate">
                <span className="block truncate text-neutral-200 font-medium">Субтитры (ASS)</span>
                <span className="block truncate text-[10px] text-neutral-500 font-mono">
                  {currentSubPath.split(/[\\/]/).pop()}
                </span>
              </div>
            </div>
            <Copy className="w-3.5 h-3.5 text-neutral-500 group-hover:text-neutral-200 flex-shrink-0" />
          </button>
        )}
      </div>
    </div>
  );
};
