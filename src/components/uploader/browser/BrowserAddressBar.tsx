import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  ArrowRight, 
  RotateCw, 
  ExternalLink, 
  Copy, 
  Check, 
  ZoomIn, 
  ZoomOut, 
  Globe, 
  Lock, 
  Loader2, 
  Bookmark as BookmarkIcon, 
  Settings2,
  Terminal,
  Search,
  Volume2,
  VolumeX,
  Film
} from 'lucide-react';
import { BrowserTab, BookmarkItem, BrowserEngineType } from './types';
import { BrowserEngineSelector } from './BrowserEngineSelector';

interface BrowserAddressBarProps {
  activeTab: BrowserTab;
  onNavigate: (url: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  onSetZoom: (delta: number) => void;
  onOpenExternal: (url?: string) => void;
  bookmarks: BookmarkItem[];
  onSelectBookmark: (bm: BookmarkItem, openInNew?: boolean) => void;
  onOpenBookmarksModal: () => void;
  isLogsOpen: boolean;
  onToggleLogs: () => void;
  errorCount: number;
  onChangeEngine?: (engine: BrowserEngineType) => void;
  onToggleFind?: () => void;
  onToggleMute?: () => void;
  onOpenCapturedMedia?: () => void;
}

export const BrowserAddressBar: React.FC<BrowserAddressBarProps> = ({
  activeTab,
  onNavigate,
  onGoBack,
  onGoForward,
  onReload,
  onSetZoom,
  onOpenExternal,
  bookmarks,
  onSelectBookmark,
  onOpenBookmarksModal,
  isLogsOpen,
  onToggleLogs,
  errorCount,
  onChangeEngine,
  onToggleFind,
  onToggleMute,
  onOpenCapturedMedia
}) => {
  const [inputUrl, setInputUrl] = useState<string>(activeTab?.url || '');
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    setInputUrl(activeTab?.url || '');
  }, [activeTab?.url]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNavigate(inputUrl);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(inputUrl || activeTab?.url || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isHttps = activeTab?.url?.startsWith('https://');
  const capturedMediaCount = activeTab?.capturedMedia?.length || 0;

  return (
    <div className="bg-neutral-900 border-b border-neutral-800 flex flex-col flex-shrink-0">
      {/* Top Address & Tools Bar */}
      <div className="px-3 py-2 flex items-center gap-2 flex-wrap sm:flex-nowrap">
        {/* Navigation Buttons */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onGoBack}
            disabled={!activeTab?.canGoBack}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer"
            title="Назад"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <button
            onClick={onGoForward}
            disabled={!activeTab?.canGoForward}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer"
            title="Вперед"
          >
            <ArrowRight className="w-4 h-4" />
          </button>

          <button
            onClick={onReload}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition cursor-pointer"
            title="Перезагрузить страницу"
          >
            {activeTab?.isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
            ) : (
              <RotateCw className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Engine Switcher */}
        {onChangeEngine && (
          <BrowserEngineSelector
            currentEngine={activeTab?.engine || 'smart-proxy'}
            onChangeEngine={onChangeEngine}
          />
        )}

        {/* Omnibox URL Form */}
        <form onSubmit={handleSubmit} className="flex-1 flex items-center gap-2 min-w-[200px]">
          <div className="flex-1 flex items-center bg-neutral-950 border border-neutral-700/80 rounded-lg px-2.5 py-1 focus-within:border-sky-500 focus-within:ring-1 focus-within:ring-sky-500/30 transition shadow-inner">
            <span className="text-neutral-500 mr-1.5 flex-shrink-0" title={isHttps ? "Защищенное HTTPS соединение" : "HTTP"}>
              {isHttps ? (
                <Lock className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Globe className="w-3.5 h-3.5 text-neutral-400" />
              )}
            </span>
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="Введите URL или поисковый запрос..."
              className="flex-1 bg-transparent text-xs text-neutral-200 outline-none placeholder-neutral-500 font-mono select-all"
            />
          </div>

          <button
            type="submit"
            className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-medium transition shadow-sm flex-shrink-0 cursor-pointer"
          >
            Перейти
          </button>
        </form>

        {/* Browser Utilities */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Captured Media Sniffer Button */}
          {capturedMediaCount > 0 && onOpenCapturedMedia && (
            <button
              onClick={onOpenCapturedMedia}
              className="px-2 py-1.5 bg-amber-950/80 hover:bg-amber-900 text-amber-300 rounded-lg transition border border-amber-700/60 flex items-center gap-1.5 text-xs font-semibold cursor-pointer animate-pulse"
              title={`Обнаружено ${capturedMediaCount} медиассылок на странице`}
            >
              <Film className="w-3.5 h-3.5 text-amber-400" />
              <span>{capturedMediaCount}</span>
            </button>
          )}

          {/* Find In Page Button */}
          {onToggleFind && (
            <button
              onClick={onToggleFind}
              className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white rounded-lg transition border border-neutral-700/50 cursor-pointer"
              title="Поиск на странице (Ctrl+F)"
            >
              <Search className="w-4 h-4" />
            </button>
          )}

          {/* Mute Audio Button */}
          {onToggleMute && (
            <button
              onClick={onToggleMute}
              className={`p-1.5 rounded-lg transition border cursor-pointer ${
                activeTab?.isMuted
                  ? 'bg-red-950/80 text-red-400 border-red-700/60'
                  : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white border-neutral-700/50'
              }`}
              title={activeTab?.isMuted ? "Включить звук вкладки" : "Выключить звук вкладки"}
            >
              {activeTab?.isMuted ? (
                <VolumeX className="w-4 h-4 text-red-400" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>
          )}

          <button
            onClick={handleCopy}
            className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white rounded-lg transition border border-neutral-700/50 cursor-pointer"
            title="Скопировать URL"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>

          {/* External Browser Button */}
          <button
            onClick={() => onOpenExternal(activeTab?.url)}
            className="px-2.5 py-1.5 bg-sky-950/80 hover:bg-sky-900 text-sky-300 hover:text-sky-100 rounded-lg transition border border-sky-700/60 flex items-center gap-1.5 text-xs font-medium cursor-pointer"
            title="Открыть эту страницу в вашем системном браузере (Chrome / Яндекс / Edge)"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Внешний браузер</span>
          </button>

          {/* Logs toggle button */}
          <button
            onClick={onToggleLogs}
            className={`p-1.5 rounded-lg transition border flex items-center gap-1 text-xs cursor-pointer ${
              isLogsOpen
                ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/50'
                : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border-neutral-700/50'
            }`}
            title="Журнал работы загрузчика"
          >
            <Terminal className="w-4 h-4 text-emerald-400" />
            {errorCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
            )}
          </button>

          {/* Zoom Controls */}
          <div className="flex items-center gap-1 bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-0.5">
            <button
              onClick={() => onSetZoom(-10)}
              className="text-neutral-400 hover:text-white p-0.5 cursor-pointer"
              title="Уменьшить масштаб"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-mono text-neutral-300 min-w-[32px] text-center">{activeTab?.zoom || 100}%</span>
            <button
              onClick={() => onSetZoom(10)}
              className="text-neutral-400 hover:text-white p-0.5 cursor-pointer"
              title="Увеличить масштаб"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Manage Bookmarks */}
          <button
            onClick={onOpenBookmarksModal}
            className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-pink-400 rounded-lg transition border border-neutral-700/60 cursor-pointer"
            title="Настройка закладок"
          >
            <Settings2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Bookmarks Strip */}
      <div className="px-3 py-1.5 bg-neutral-950/70 border-t border-neutral-800/80 flex items-center gap-1.5 overflow-x-auto text-xs no-scrollbar">
        <span className="text-neutral-500 font-medium flex items-center gap-1 flex-shrink-0 pr-1 border-r border-neutral-800 text-[11px]">
          <BookmarkIcon className="w-3.5 h-3.5 text-pink-400" />
          Закладки:
        </span>

        {bookmarks.map((bm) => (
          <button
            key={bm.id}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.button === 1) {
                onSelectBookmark(bm, true);
              } else {
                onSelectBookmark(bm, false);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              onSelectBookmark(bm, true);
            }}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition flex items-center gap-1 flex-shrink-0 border cursor-pointer ${
              activeTab?.url === bm.url
                ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                : 'bg-neutral-800/80 text-neutral-300 hover:bg-neutral-800 border-neutral-700/60'
            }`}
            title={`${bm.name}\n(Клик: открыть в текущей вкладке, Ctrl+клик / ПКМ: в новой)`}
          >
            <span>{bm.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
