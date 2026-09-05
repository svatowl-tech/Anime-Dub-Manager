import React, { useState, useEffect } from 'react';
import { 
  Globe, 
  RotateCw, 
  ExternalLink, 
  ZoomIn, 
  ZoomOut, 
  ShieldCheck, 
  Sparkles, 
  Send, 
  Lock,
  Layers
} from 'lucide-react';
import { isWeb, ipcSafe } from '../../lib/ipcSafe';
import { getBrowserPreloadPath, fetchBrowserPreloadPath } from '../../lib/electronPreloadPath';
import { toast } from 'sonner';

type TelegramWebFlavor = 'a' | 'k' | 'z';

export const TelegramWebTab: React.FC = () => {
  const [flavor, setFlavor] = useState<TelegramWebFlavor>('a');
  const [zoom, setZoom] = useState<number>(100);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [key, setKey] = useState<number>(1);
  const [preloadScriptPath, setPreloadScriptPath] = useState<string | undefined>(getBrowserPreloadPath);

  useEffect(() => {
    if (!preloadScriptPath && !isWeb) {
      fetchBrowserPreloadPath().then((p) => {
        if (p) setPreloadScriptPath(p);
      });
    }
  }, [preloadScriptPath]);

  const getUrl = (flv: TelegramWebFlavor) => {
    switch (flv) {
      case 'k':
        return 'https://web.telegram.org/k/';
      case 'z':
        return 'https://web.telegram.org/z/';
      case 'a':
      default:
        return 'https://web.telegram.org/a/';
    }
  };

  const handleReload = () => {
    setIsLoading(true);
    setKey(prev => prev + 1);
    setTimeout(() => setIsLoading(false), 1000);
  };

  const handleSetZoom = (delta: number) => {
    setZoom(prev => Math.min(150, Math.max(70, prev + delta)));
  };

  const handleOpenExternal = () => {
    const url = getUrl(flavor);
    if (isWeb) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      ipcSafe.invoke('open-external', url).catch(() => {
        window.open(url, '_blank');
      });
    }
    toast.success('Telegram Web открыт в системном браузере');
  };

  const currentUrl = getUrl(flavor);

  return (
    <div className="flex-1 flex flex-col h-full bg-neutral-950 overflow-hidden relative">
      {/* Top Telegram Web Control Strip */}
      <div className="bg-neutral-900 border-b border-neutral-800 px-3 py-2 flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap flex-shrink-0">
        <div className="flex items-center gap-2">
          {/* Flavor Switcher (Web A / Web K / Web Z) */}
          <div className="flex items-center bg-neutral-950 p-1 rounded-lg border border-neutral-800">
            <button
              onClick={() => setFlavor('a')}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition cursor-pointer ${
                flavor === 'a' 
                  ? 'bg-sky-600 text-white shadow-sm' 
                  : 'text-neutral-400 hover:text-white'
              }`}
              title="Telegram Web Version A (Современная быстрая версия)"
            >
              Web A (Основная)
            </button>
            <button
              onClick={() => setFlavor('k')}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition cursor-pointer ${
                flavor === 'k' 
                  ? 'bg-sky-600 text-white shadow-sm' 
                  : 'text-neutral-400 hover:text-white'
              }`}
              title="Telegram Web Version K (Классическая стабильная версия)"
            >
              Web K (Классик)
            </button>
            <button
              onClick={() => setFlavor('z')}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition cursor-pointer ${
                flavor === 'z' 
                  ? 'bg-sky-600 text-white shadow-sm' 
                  : 'text-neutral-400 hover:text-white'
              }`}
              title="Telegram Web Version Z (Легковесная версия Teact)"
            >
              Web Z
            </button>
          </div>

          <button
            onClick={handleReload}
            className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white rounded-lg transition border border-neutral-700/60 cursor-pointer"
            title="Перезагрузить Telegram Web"
          >
            <RotateCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-sky-400' : ''}`} />
          </button>
        </div>

        {/* Center Info Notice */}
        <div className="hidden lg:flex items-center gap-1.5 text-xs text-neutral-400">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Изолированная безопасная сессия Telegram Web (куки и авторизация сохраняются)</span>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-1.5">
          {/* Zoom */}
          <div className="flex items-center gap-1 bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-0.5">
            <button
              onClick={() => handleSetZoom(-10)}
              className="text-neutral-400 hover:text-white p-0.5 cursor-pointer"
              title="Уменьшить"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-mono text-neutral-300 min-w-[32px] text-center">{zoom}%</span>
            <button
              onClick={() => handleSetZoom(10)}
              className="text-neutral-400 hover:text-white p-0.5 cursor-pointer"
              title="Увеличить"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={handleOpenExternal}
            className="px-2.5 py-1.5 bg-sky-950/80 hover:bg-sky-900 text-sky-300 hover:text-sky-100 rounded-lg transition border border-sky-700/60 flex items-center gap-1.5 text-xs font-medium cursor-pointer"
            title="Открыть Telegram Web в системном браузере"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">В браузере</span>
          </button>
        </div>
      </div>

      {/* Main Web View Area */}
      <div className="flex-1 w-full h-full bg-white relative overflow-hidden">
        {isWeb ? (
          <iframe
            key={`tg-web-iframe-${flavor}-${key}`}
            src={currentUrl}
            className="w-full h-full border-0"
            title="Telegram Web"
            style={{
              width: `${100000 / zoom}%`,
              height: `${100000 / zoom}%`,
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'top left'
            }}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads allow-modals"
          />
        ) : (
          <webview
            key={`tg-web-webview-${flavor}-${key}`}
            src={currentUrl}
            partition="persist:publisher"
            allowpopups={true}
            useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
            webpreferences="contextIsolation=yes, nodeIntegration=no, nodeIntegrationInSubFrames=no, allowRunningInsecureContent=yes, javascript=yes"
            style={{
              width: `${100000 / zoom}%`,
              height: `${100000 / zoom}%`,
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'top left'
            }}
            className="w-full h-full border-0 bg-white"
          />
        )}
      </div>
    </div>
  );
};
