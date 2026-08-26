import React from 'react';
import { X, Copy, Download, Film, Music, FileText, ExternalLink, Check } from 'lucide-react';
import { toast } from 'sonner';

interface CapturedMediaModalProps {
  isOpen: boolean;
  onClose: () => void;
  mediaUrls: string[];
  pageTitle?: string;
  onDownloadUrl?: (url: string) => void;
}

export const CapturedMediaModal: React.FC<CapturedMediaModalProps> = ({
  isOpen,
  onClose,
  mediaUrls,
  pageTitle,
  onDownloadUrl
}) => {
  const [copiedIndex, setCopiedIndex] = React.useState<number | null>(null);

  if (!isOpen) return null;

  const handleCopy = (url: string, index: number) => {
    navigator.clipboard.writeText(url);
    setCopiedIndex(index);
    toast.success('Ссылка скопирована в буфер обмена');
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const getMediaIcon = (url: string) => {
    if (/\.(m3u8|mp4|webm|mkv|mov|flv)($|\?)/i.test(url)) {
      return <Film className="w-4 h-4 text-sky-400" />;
    }
    if (/\.(mp3|m4a|aac|wav|ogg|flac)($|\?)/i.test(url)) {
      return <Music className="w-4 h-4 text-emerald-400" />;
    }
    return <FileText className="w-4 h-4 text-amber-400" />;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/60">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-2 bg-sky-950/80 border border-sky-800/50 rounded-lg text-sky-400">
              <Film className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white truncate">Захваченные медиассылки</h3>
              <p className="text-xs text-neutral-400 truncate">{pageTitle || 'Обнаружено на текущей странице'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Links List */}
        <div className="p-5 overflow-y-auto flex-1 space-y-3">
          {mediaUrls.length === 0 ? (
            <div className="text-center py-10 text-neutral-500 text-xs">
              Медиапотоки и видеофайлы на странице пока не обнаружены.
            </div>
          ) : (
            mediaUrls.map((url, idx) => (
              <div
                key={`${idx}_${url}`}
                className="p-3 bg-neutral-950 border border-neutral-800 rounded-xl flex items-center justify-between gap-3 group hover:border-neutral-700 transition"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="p-1.5 bg-neutral-900 rounded-md flex-shrink-0">
                    {getMediaIcon(url)}
                  </div>
                  <span className="text-xs font-mono text-neutral-300 truncate select-all flex-1">
                    {url}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => handleCopy(url, idx)}
                    className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition text-xs font-medium flex items-center gap-1 cursor-pointer"
                    title="Скопировать ссылку"
                  >
                    {copiedIndex === idx ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>

                  {onDownloadUrl && (
                    <button
                      onClick={() => {
                        onDownloadUrl(url);
                        onClose();
                      }}
                      className="px-2.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg transition text-xs font-medium flex items-center gap-1 cursor-pointer shadow-sm"
                      title="Загрузить через загрузчик"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Загрузить</span>
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-950/40 flex justify-between items-center text-xs text-neutral-400">
          <span>Всего ссылок: {mediaUrls.length}</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-xs font-medium transition cursor-pointer"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
