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

        {/* Load Error Alert Overlay */}
        {isTabError && (
          <div className="absolute inset-0 bg-neutral-950/90 backdrop-blur-sm z-30 flex items-center justify-center p-6 text-center">
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 max-w-md shadow-2xl space-y-4">
              <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-white font-bold text-sm">Не удалось отобразить страницу</h4>
                <p className="text-neutral-400 text-xs mt-1 leading-relaxed">{tab.error}</p>
              </div>
              <div className="flex items-center justify-center gap-2 pt-2 flex-wrap">
                <button
                  onClick={() => {
                    onUpdateTab(tab.id, { error: null, isLoading: true, engine: 'popup-overlay' });
                  }}
                  className="px-3.5 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5" />
                  Переключить в режим окна
                </button>
                <button
                  onClick={() => {
                    onUpdateTab(tab.id, { error: null, isLoading: true });
                  }}
                  className="px-3.5 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Повторить
                </button>
                <button
                  onClick={() => onOpenExternal(tab.url)}
                  className="px-3.5 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Chrome/Яндекс
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
