import React, { useRef, useEffect, useState } from 'react';
import { BrowserTab } from './types';
import { appLogger } from '../../../lib/appLogger';
import { getBrowserPreloadPath, fetchBrowserPreloadPath } from '../../../lib/electronPreloadPath';

interface ElectronWebviewHostProps {
  tab: BrowserTab;
  onUpdateTab: (tabId: string, partial: Partial<BrowserTab>) => void;
  webviewRefCallback: (tabId: string, el: any) => void;
}

export const ElectronWebviewHost: React.FC<ElectronWebviewHostProps> = ({
  tab,
  onUpdateTab,
  webviewRefCallback
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<any>(null);
  const isDomReadyRef = useRef<boolean>(false);
  const lastNavigatedUrlRef = useRef<string>(tab.url);

  const [preloadScriptPath, setPreloadScriptPath] = useState<string | undefined>(getBrowserPreloadPath);

  useEffect(() => {
    if (!preloadScriptPath) {
      fetchBrowserPreloadPath().then((p) => {
        if (p) setPreloadScriptPath(p);
      });
    }
  }, [preloadScriptPath]);

  // Format preload path for webview (file:// URL with forward slashes)
  const formattedPreload = preloadScriptPath
    ? (preloadScriptPath.startsWith('file://') ? preloadScriptPath : `file://${preloadScriptPath.replace(/\\/g, '/')}`)
    : undefined;

  // Setup webview instance and lifecycle listeners once on mount
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    // Attach custom post injection helper directly onto webview object
    webview._admInjectPost = async (text: string) => {
      try {
        if (typeof webview.send === 'function') {
          webview.send('adm-inject-post', text);
        }
        if (typeof webview.executeJavaScript === 'function') {
          await webview.executeJavaScript(`(function() {
            try {
              const text = ${JSON.stringify(text)};
              let target = document.activeElement;
              if (!target || target === document.body || (target.tagName !== 'TEXTAREA' && target.tagName !== 'INPUT' && !target.isContentEditable)) {
                target = document.querySelector('#post_field') || 
                         document.querySelector('.mention_rich_ta') ||
                         document.querySelector('.input-message-input') || 
                         document.querySelector('#message') || 
                         document.querySelector('textarea[name="message"]') ||
                         document.querySelector('[contenteditable="true"]') ||
                         document.querySelector('textarea') || 
                         document.querySelector('input[type="text"]');
              }
              if (target) {
                target.focus();
                if (target.isContentEditable) {
                  document.execCommand('insertText', false, text);
                  if (!target.innerText || !target.innerText.includes(text.slice(0, 15))) {
                    target.innerText = text;
                  }
                } else {
                  const start = target.selectionStart || 0;
                  const end = target.selectionEnd || 0;
                  target.value = target.value.slice(0, start) + text + target.value.slice(end);
                  target.selectionStart = target.selectionEnd = start + text.length;
                }
                target.dispatchEvent(new Event('input', { bubbles: true }));
                target.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              }
            } catch(e) {}
            return false;
          })()`);
        }
        return true;
      } catch (e) {
        console.warn('[ElectronWebviewHost] injectPost error:', e);
        return false;
      }
    };

    // Register with parent ref map
    webviewRefCallback(tab.id, webview);

    const handleDomReady = () => {
      isDomReadyRef.current = true;
      try {
        if (typeof webview.setZoomFactor === 'function' && tab.zoom) {
          webview.setZoomFactor(tab.zoom / 100);
        }
      } catch (e) {}
    };

    const handleStart = () => {
      onUpdateTab(tab.id, { isLoading: true, error: null });
    };

    const handleStop = () => {
      onUpdateTab(tab.id, { isLoading: false });
      try {
        if (isDomReadyRef.current) {
          const canBack = typeof webview.canGoBack === 'function' ? webview.canGoBack() : false;
          const canFwd = typeof webview.canGoForward === 'function' ? webview.canGoForward() : false;
          const currentSrc = typeof webview.getURL === 'function' ? webview.getURL() : webview.src;

          onUpdateTab(tab.id, {
            canGoBack: canBack,
            canGoForward: canFwd,
            url: currentSrc || undefined
          });

          if (typeof webview.getTitle === 'function') {
            const t = webview.getTitle();
            if (t && t.trim()) {
              onUpdateTab(tab.id, { title: t.trim() });
            }
          }
        }
      } catch (e) {}
    };

    const handleFail = (e: any) => {
      onUpdateTab(tab.id, { isLoading: false });
      // Ignore ERR_ABORTED (-3), ERR_BLOCKED_BY_CLIENT (-20), and normal navigation cancellations
      if (e.errorCode === -3 || e.errorCode === -102 || e.errorCode === -20 || e.errorCode === -105) {
        return;
      }
      appLogger.error('uploader', `[Вкладка] Ошибка загрузки (${e.errorCode}): ${e.errorDescription || 'Неизвестная ошибка'} [${e.validatedURL || tab.url}]`);
      // Only set error message if main frame failed completely and no content is loaded
      if (e.isMainFrame !== false) {
        onUpdateTab(tab.id, {
          error: `Ошибка загрузки: ${e.errorDescription || 'Не удалось открыть страницу'} (${e.errorCode})`
        });
      }
    };

    const handleNavigate = (e: any) => {
      if (e.url && (e.url.startsWith('http://') || e.url.startsWith('https://'))) {
        if (e.url !== lastNavigatedUrlRef.current) {
          lastNavigatedUrlRef.current = e.url;
          onUpdateTab(tab.id, { url: e.url });
          appLogger.info('uploader', `[Вкладка] Переход на адрес: ${e.url}`);
        }
      }
    };

    const handlePageTitle = (e: any) => {
      if (e.title && e.title.trim()) {
        onUpdateTab(tab.id, { title: e.title.trim() });
      }
    };

    const handlePageFavicon = (e: any) => {
      if (e.favicons && e.favicons.length > 0) {
        onUpdateTab(tab.id, { favicon: e.favicons[0] });
      }
    };

    const handleAudioStateChanged = (e: any) => {
      onUpdateTab(tab.id, { isAudible: e.audible });
    };

    const handleFoundInPage = (e: any) => {
      if (e.result && typeof (webview as any)._onFoundInPageResult === 'function') {
        (webview as any)._onFoundInPageResult(e.result);
      }
    };

    const handleIpcMessage = (e: any) => {
      if (e.channel === 'browser-page-metadata' && e.args && e.args[0]) {
        const { title, favicon, mediaUrls } = e.args[0];
        const patch: any = {};
        if (title) patch.title = title;
        if (favicon) patch.favicon = favicon;
        if (Array.isArray(mediaUrls) && mediaUrls.length > 0) {
          patch.capturedMedia = Array.from(new Set([...(tab.capturedMedia || []), ...mediaUrls]));
        }
        onUpdateTab(tab.id, patch);
      }
    };

    webview.addEventListener('dom-ready', handleDomReady);
    webview.addEventListener('did-start-loading', handleStart);
    webview.addEventListener('did-stop-loading', handleStop);
    webview.addEventListener('did-finish-load', handleStop);
    webview.addEventListener('did-fail-load', handleFail);
    webview.addEventListener('did-navigate', handleNavigate);
    webview.addEventListener('did-navigate-in-page', handleNavigate);
    webview.addEventListener('page-title-updated', handlePageTitle);
    webview.addEventListener('page-favicon-updated', handlePageFavicon);
    webview.addEventListener('ipc-message', handleIpcMessage);
    webview.addEventListener('media-started-playing', () => onUpdateTab(tab.id, { isAudible: true }));
    webview.addEventListener('media-paused', () => onUpdateTab(tab.id, { isAudible: false }));
    webview.addEventListener('found-in-page', handleFoundInPage);

    return () => {
      isDomReadyRef.current = false;
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.removeEventListener('did-start-loading', handleStart);
      webview.removeEventListener('did-stop-loading', handleStop);
      webview.removeEventListener('did-finish-load', handleStop);
      webview.removeEventListener('did-fail-load', handleFail);
      webview.removeEventListener('did-navigate', handleNavigate);
      webview.removeEventListener('did-navigate-in-page', handleNavigate);
      webview.removeEventListener('page-title-updated', handlePageTitle);
      webview.removeEventListener('page-favicon-updated', handlePageFavicon);
      webview.removeEventListener('ipc-message', handleIpcMessage);
      webview.removeEventListener('found-in-page', handleFoundInPage);
    };
  }, [tab.id, onUpdateTab, webviewRefCallback]);

  // Handle URL changes safely after DOM is ready
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !isDomReadyRef.current) return;

    try {
      const currentUrl = typeof webview.getURL === 'function' ? webview.getURL() : '';
      if (tab.url && tab.url !== currentUrl && tab.url !== lastNavigatedUrlRef.current) {
        lastNavigatedUrlRef.current = tab.url;
        if (typeof webview.loadURL === 'function') {
          webview.loadURL(tab.url).catch((err: any) => {
            // Ignore benign abort errors
            if (err?.message && !err.message.includes('ERR_ABORTED')) {
              console.warn('[ElectronWebviewHost] loadURL:', err);
            }
          });
        }
      }
    } catch (e) {}
  }, [tab.url]);

  // Handle zoom changes
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !isDomReadyRef.current) return;
    try {
      if (typeof webview.setZoomFactor === 'function' && tab.zoom) {
        webview.setZoomFactor(tab.zoom / 100);
      }
    } catch (e) {}
  }, [tab.zoom]);

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-white">
      <webview
        key={`wv_${tab.id}_${preloadScriptPath ? 'preloaded' : 'initial'}`}
        ref={webviewRef}
        src={tab.url}
        partition="persist:publisher"
        allowpopups={true}
        preload={formattedPreload}
        useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
        httpreferrer="https://google.com"
        webpreferences="contextIsolation=yes, nodeIntegration=no, nodeIntegrationInSubFrames=no, allowRunningInsecureContent=yes, javascript=yes, webSecurity=no"
        style={{
          width: `${100000 / tab.zoom}%`,
          height: `${100000 / tab.zoom}%`,
          transform: `scale(${tab.zoom / 100})`,
          transformOrigin: 'top left'
        }}
        className="w-full h-full border-0 bg-white"
      />
    </div>
  );
};
