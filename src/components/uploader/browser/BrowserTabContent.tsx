import React, { useEffect } from 'react';
import { AlertCircle, ExternalLink, RefreshCw, Layers } from 'lucide-react';
import { BrowserTab, BrowserEngineType } from './types';
import { Episode, ProjectLinks } from '../../../types';
import { TemplateType, CustomFieldItem } from '../types';
import { isWeb } from '../../../lib/ipcSafe';
import { InteractivePopupView } from './InteractivePopupView';
import { ContentExtractorView } from './ContentExtractorView';
import { ElectronWebviewHost } from './ElectronWebviewHost';

interface BrowserTabContentProps {
  tab: BrowserTab;
  isActive: boolean;
  onUpdateTab: (tabId: string, partial: Partial<BrowserTab>) => void;
  onOpenExternal: (url: string) => void;
  webviewRefCallback: (tabId: string, el: any) => void;
  currentEpisode?: Episode | null;
  generatedPost?: string;
  templateType?: TemplateType;
  onBuildPostText?: (type: TemplateType) => void;
  customFields?: CustomFieldItem[];
  projectLinks?: ProjectLinks;
}

export const BrowserTabContent: React.FC<BrowserTabContentProps> = ({
  tab,
  isActive,
  onUpdateTab,
  onOpenExternal,
  webviewRefCallback,
  currentEpisode,
  generatedPost,
  templateType,
  onBuildPostText,
  customFields,
  projectLinks
}) => {
  const isTabError = !!tab.error;
  
  // In Electron (!isWeb), Chromium native webview is the designated engine for web browsing.
  // Legacy or web-specific 'smart-proxy' / 'popup-overlay' fall back cleanly to 'direct-webview'.
  const currentEngine: BrowserEngineType = !isWeb
    ? (tab.engine === 'reader-extractor' ? 'reader-extractor' : tab.engine === 'sandbox-iframe' ? 'sandbox-iframe' : 'direct-webview')
    : (tab.engine || 'smart-proxy');

  // Handle messages from the proxy frame
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data && typeof e.data === 'object') {
        if (e.data.type === 'ADM_SWITCH_ENGINE' && e.data.engine) {
          onUpdateTab(tab.id, { engine: e.data.engine });
        } else if (e.data.type === 'ADM_BROWSER_PAGE_DATA') {
          onUpdateTab(tab.id, {
            title: e.data.title || tab.title,
            extractedData: {
              title: e.data.title,
              ogImage: e.data.ogImage,
              description: e.data.description,
              canonicalUrl: e.data.url
            }
          });
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [tab.id, tab.title, onUpdateTab]);

  return (
    <div
      className={`w-full h-full relative overflow-hidden bg-neutral-950 ${
        isActive ? 'flex flex-col' : 'hidden'
      }`}
      style={{ display: isActive ? 'flex' : 'none' }}
    >
      {/* Loading Progress Bar */}
      {tab.isLoading && (
        <div className="w-full h-0.5 bg-neutral-800 overflow-hidden absolute top-0 left-0 right-0 z-20">
          <div className="w-full h-full bg-sky-500 animate-pulse origin-left" />
        </div>
      )}

      {/* Main Engine Viewport */}
      <div className="flex-1 w-full h-full relative overflow-hidden bg-white">
        {/* ENGINE 1: POPUP OVERLAY (Web only) */}
        {isWeb && currentEngine === 'popup-overlay' ? (
          <InteractivePopupView
            tab={tab}
            onChangeEngine={(eng) => onUpdateTab(tab.id, { engine: eng })}
            onReload={() => onUpdateTab(tab.id, { isLoading: true, error: null })}
            currentEpisode={currentEpisode}
            generatedPost={generatedPost}
            templateType={templateType}
            onBuildPostText={onBuildPostText}
            customFields={customFields}
            projectLinks={projectLinks}
          />
        ) : /* ENGINE 2: READER / EXTRACTOR */
        currentEngine === 'reader-extractor' ? (
          <ContentExtractorView
            tab={tab}
            onUpdateTab={onUpdateTab}
          />
        ) : /* ENGINE 3: DIRECT IFRAME (SANDBOX) */
        currentEngine === 'sandbox-iframe' ? (
          <iframe
            key={`iframe_direct_${tab.id}`}
            src={tab.url}
            className="w-full h-full border-0 bg-white"
            title={tab.title}
            style={{
              width: `${100000 / tab.zoom}%`,
              height: `${100000 / tab.zoom}%`,
              transform: `scale(${tab.zoom / 100})`,
              transformOrigin: 'top left'
            }}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-presentation allow-downloads"
            onLoad={() => onUpdateTab(tab.id, { isLoading: false })}
            onError={() => {
              onUpdateTab(tab.id, {
                isLoading: false,
                error: 'Не удалось загрузить напрямую. Попробуйте Smart Proxy v2 или режим Окна.'
              });
            }}
          />
        ) : /* ENGINE 4: SMART PROXY V2 (WEB ONLY) */
        isWeb && currentEngine === 'smart-proxy' ? (
          <iframe
            key={`iframe_proxy_${tab.id}`}
            src={`/api/web-proxy?url=${encodeURIComponent(tab.url)}`}
            className="w-full h-full border-0 bg-white"
            title={tab.title}
            style={{
              width: `${100000 / tab.zoom}%`,
              height: `${100000 / tab.zoom}%`,
              transform: `scale(${tab.zoom / 100})`,
              transformOrigin: 'top left'
            }}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-presentation allow-downloads"
            onLoad={() => onUpdateTab(tab.id, { isLoading: false })}
            onError={() => {
              onUpdateTab(tab.id, {
                isLoading: false,
                error: 'Ошибка загрузки Smart Proxy. Переключитесь на Интерактивное окно.'
              });
            }}
          />
        ) : (
          /* ENGINE 5: DIRECT CHROMIUM WEBVIEW (ELECTRON NATIVE) */
          <ElectronWebviewHost
            key={`native_webview_${tab.id}`}
            tab={tab}
            onUpdateTab={onUpdateTab}
            webviewRefCallback={webviewRefCallback}
          />
        )}

        {/* Non-destructive Load Warning Banner */}
        {isTabError && (
          <div className="absolute top-2 left-3 right-3 z-30 bg-neutral-900/95 border border-red-500/40 backdrop-blur-md rounded-xl p-3 shadow-xl flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-neutral-200 overflow-hidden">
              <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="truncate">{tab.error}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => onUpdateTab(tab.id, { error: null, isLoading: true })}
                className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg transition flex items-center gap-1 cursor-pointer font-medium"
                title="Попробовать перезагрузить"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Повторить</span>
              </button>
              <button
                onClick={() => onOpenExternal(tab.url)}
                className="px-2.5 py-1 bg-sky-600/30 hover:bg-sky-600/50 text-sky-300 rounded-lg transition flex items-center gap-1 cursor-pointer font-medium"
                title="Открыть в основном браузере"
              >
                <ExternalLink className="w-3 h-3" />
                <span>Браузер</span>
              </button>
              <button
                onClick={() => onUpdateTab(tab.id, { error: null })}
                className="px-2 py-1 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition cursor-pointer"
                title="Скрыть предупреждение"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
