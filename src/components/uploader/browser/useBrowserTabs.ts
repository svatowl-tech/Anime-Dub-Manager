import { useState, useRef, useCallback, useEffect } from 'react';
import { BrowserTab, BookmarkItem, BrowserEngineType } from './types';
import { isWeb, ipcSafe } from '../../../lib/ipcSafe';
import { toast } from 'sonner';
import { appLogger } from '../../../lib/appLogger';

const STORAGE_KEY_TABS = 'adm_uploader_browser_tabs';
const STORAGE_KEY_ACTIVE = 'adm_uploader_active_tab_id';

const DEFAULT_FIRST_URL = 'https://cabinet.vkvideo.ru/';

export function useBrowserTabs(initialUrl?: string, onSelectBookmarkUrl?: (url: string) => void) {
  const [tabs, setTabs] = useState<BrowserTab[]>(() => {
    const defaultEngine: BrowserEngineType = isWeb ? 'smart-proxy' : 'direct-webview';
    try {
      const saved = localStorage.getItem(STORAGE_KEY_TABS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((t: any) => ({
            ...t,
            isLoading: false,
            error: null,
            zoom: t.zoom || 100,
            // In Electron, fallback legacy smart-proxy/popup-overlay to direct-webview
            engine: !isWeb && (t.engine === 'smart-proxy' || t.engine === 'popup-overlay' || !t.engine) 
              ? 'direct-webview' 
              : (t.engine || defaultEngine)
          }));
        }
      }
    } catch (e) {}

    const firstUrl = initialUrl || DEFAULT_FIRST_URL;
    return [
      {
        id: 'tab_1',
        title: 'VK Видео',
        url: firstUrl,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        zoom: 100,
        engine: defaultEngine,
        error: null
      }
    ];
  });

  const [activeTabId, setActiveTabId] = useState<string>(() => {
    const savedActive = localStorage.getItem(STORAGE_KEY_ACTIVE);
    return savedActive || 'tab_1';
  });

  const webviewRefs = useRef<Record<string, any>>({});

  // Ensure activeTabId is valid
  useEffect(() => {
    const defaultEngine: BrowserEngineType = isWeb ? 'smart-proxy' : 'direct-webview';
    if (tabs.length === 0) {
      const newId = `tab_${Date.now()}`;
      setTabs([
        {
          id: newId,
          title: 'Новая вкладка',
          url: DEFAULT_FIRST_URL,
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          zoom: 100,
          engine: defaultEngine,
          error: null
        }
      ]);
      setActiveTabId(newId);
    } else if (!tabs.some(t => t.id === activeTabId)) {
      setActiveTabId(tabs[0].id);
    }
  }, [tabs, activeTabId]);

  // Persist tabs configuration
  useEffect(() => {
    try {
      const serialized = tabs.map(t => ({
        id: t.id,
        title: t.title,
        url: t.url,
        favicon: t.favicon,
        zoom: t.zoom,
        engine: t.engine
      }));
      localStorage.setItem(STORAGE_KEY_TABS, JSON.stringify(serialized));
      localStorage.setItem(STORAGE_KEY_ACTIVE, activeTabId);
    } catch (e) {}
  }, [tabs, activeTabId]);

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

  const createNewTab = useCallback((url?: string, title?: string, defaultEngine?: BrowserEngineType) => {
    const targetUrl = url || 'https://vk.com/video';
    const targetTitle = title || 'Новая вкладка';
    const newId = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const engineToUse: BrowserEngineType = defaultEngine || (isWeb ? 'smart-proxy' : 'direct-webview');
    
    const newTab: BrowserTab = {
      id: newId,
      title: targetTitle,
      url: targetUrl,
      isLoading: true,
      canGoBack: false,
      canGoForward: false,
      zoom: 100,
      engine: engineToUse,
      error: null
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newId);
    appLogger.info('uploader', `Создана новая вкладка [${engineToUse}]: ${targetUrl}`);
    return newId;
  }, []);

  const closeTab = useCallback((tabIdToClose: string) => {
    const defaultEngine: BrowserEngineType = isWeb ? 'smart-proxy' : 'direct-webview';
    setTabs(prev => {
      if (prev.length <= 1) {
        return [
          {
            id: `tab_${Date.now()}`,
            title: 'Новая вкладка',
            url: DEFAULT_FIRST_URL,
            isLoading: false,
            canGoBack: false,
            canGoForward: false,
            zoom: 100,
            engine: defaultEngine,
            error: null
          }
        ];
      }
      const filtered = prev.filter(t => t.id !== tabIdToClose);
      if (activeTabId === tabIdToClose) {
        const nextIndex = Math.max(0, prev.findIndex(t => t.id === tabIdToClose) - 1);
        setActiveTabId(filtered[nextIndex]?.id || filtered[0].id);
      }
      return filtered;
    });

    delete webviewRefs.current[tabIdToClose];
  }, [activeTabId]);

  const updateTab = useCallback((tabId: string, partial: Partial<BrowserTab>) => {
    setTabs(prev => prev.map(t => (t.id === tabId ? { ...t, ...partial } : t)));
  }, []);

  const changeTabEngine = useCallback((newEngine: BrowserEngineType) => {
    updateTab(activeTabId, { engine: newEngine, error: null, isLoading: true });
    toast.success(`Движок изменен: ${newEngine}`);
  }, [activeTabId, updateTab]);

  const navigateActiveTab = useCallback((url: string) => {
    let cleanUrl = url.trim();
    if (!cleanUrl) return;

    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      if (cleanUrl.includes('.') && !cleanUrl.includes(' ')) {
        cleanUrl = `https://${cleanUrl}`;
      } else {
        cleanUrl = `https://duckduckgo.com/?q=${encodeURIComponent(cleanUrl)}`;
      }
    }

    updateTab(activeTabId, { url: cleanUrl, isLoading: true, error: null });

    const webview = webviewRefs.current[activeTabId];
    if (webview && !isWeb && typeof webview.loadURL === 'function') {
      try {
        webview.loadURL(cleanUrl).catch(() => {});
      } catch (e) {}
    }

    if (onSelectBookmarkUrl) {
      onSelectBookmarkUrl(cleanUrl);
    }
  }, [activeTabId, updateTab, onSelectBookmarkUrl]);

  const handleOpenBookmarkInTab = useCallback((bm: BookmarkItem, openInNew = false) => {
    const targetEngine: BrowserEngineType = !isWeb 
      ? 'direct-webview' 
      : (bm.defaultEngine || activeTab?.engine || 'smart-proxy');

    if (openInNew) {
      createNewTab(bm.url, bm.name, targetEngine);
    } else {
      updateTab(activeTabId, { 
        url: bm.url, 
        title: bm.name, 
        isLoading: true, 
        error: null,
        engine: targetEngine
      });
      const webview = webviewRefs.current[activeTabId];
      if (webview && !isWeb && typeof webview.loadURL === 'function') {
        try {
          webview.loadURL(bm.url).catch(() => {});
        } catch (e) {}
      }
      if (onSelectBookmarkUrl) onSelectBookmarkUrl(bm.url);
    }
  }, [activeTabId, activeTab?.engine, createNewTab, updateTab, onSelectBookmarkUrl]);

  const goBack = useCallback(() => {
    const webview = webviewRefs.current[activeTabId];
    if (webview && typeof webview.goBack === 'function' && webview.canGoBack()) {
      webview.goBack();
    }
  }, [activeTabId]);

  const goForward = useCallback(() => {
    const webview = webviewRefs.current[activeTabId];
    if (webview && typeof webview.goForward === 'function' && webview.canGoForward()) {
      webview.goForward();
    }
  }, [activeTabId]);

  const reloadActiveTab = useCallback(() => {
    updateTab(activeTabId, { isLoading: true, error: null });
    const webview = webviewRefs.current[activeTabId];
    if (webview && typeof webview.reload === 'function') {
      webview.reload();
    }
  }, [activeTabId, updateTab]);

  const setZoom = useCallback((delta: number) => {
    const currentZoom = activeTab?.zoom || 100;
    const nextZoom = Math.min(175, Math.max(50, currentZoom + delta));
    updateTab(activeTabId, { zoom: nextZoom });
    
    const webview = webviewRefs.current[activeTabId];
    if (webview && typeof webview.setZoomFactor === 'function') {
      webview.setZoomFactor(nextZoom / 100);
    }
  }, [activeTab?.zoom, activeTabId, updateTab]);

  const openExternal = useCallback((urlToOpen?: string) => {
    const target = urlToOpen || activeTab?.url || DEFAULT_FIRST_URL;
    if (isWeb) {
      window.open(target, '_blank', 'noopener,noreferrer');
    } else {
      ipcSafe.invoke('open-external', target).catch(() => {
        window.open(target, '_blank');
      });
    }
    toast.success('Открыто в системном браузере (Chrome / Яндекс / Edge)');
  }, [activeTab?.url]);

  const [isFindOpen, setIsFindOpen] = useState(false);
  const [matchStats, setMatchStats] = useState({ activeMatchOrdinal: 0, numberOfMatches: 0 });
  const [isCapturedMediaOpen, setIsCapturedMediaOpen] = useState(false);

  const toggleMuteActiveTab = useCallback(() => {
    const nextMuted = !activeTab?.isMuted;
    updateTab(activeTabId, { isMuted: nextMuted });
    const webview = webviewRefs.current[activeTabId];
    if (webview && typeof webview.setAudioMuted === 'function') {
      webview.setAudioMuted(nextMuted);
    }
  }, [activeTab?.isMuted, activeTabId, updateTab]);

  const findInPage = useCallback((text: string, options?: { forward?: boolean; findNext?: boolean }) => {
    if (!text) return;
    const webview = webviewRefs.current[activeTabId];
    if (webview && typeof webview.findInPage === 'function') {
      webview._onFoundInPageResult = (res: any) => {
        setMatchStats({
          activeMatchOrdinal: res.activeMatchOrdinal || 0,
          numberOfMatches: res.numberOfMatches || 0
        });
      };
      webview.findInPage(text, options || { forward: true, findNext: false });
    }
  }, [activeTabId]);

  const stopFindInPage = useCallback(() => {
    const webview = webviewRefs.current[activeTabId];
    if (webview && typeof webview.stopFindInPage === 'function') {
      webview.stopFindInPage('clearSelection');
    }
    setMatchStats({ activeMatchOrdinal: 0, numberOfMatches: 0 });
  }, [activeTabId]);

  const toggleFindOpen = useCallback(() => {
    setIsFindOpen(prev => {
      if (prev) stopFindInPage();
      return !prev;
    });
  }, [stopFindInPage]);

  const clearStorageData = useCallback(async () => {
    if (isWeb) {
      toast.success('Кэш браузера очищен');
      return;
    }
    try {
      await ipcSafe.invoke('clear-webview-storage');
      toast.success('Кэш, куки и сессии авторизации успешно сброшены');
      reloadActiveTab();
    } catch (e: any) {
      toast.error(`Ошибка сброса кэша: ${e?.message || e}`);
    }
  }, [reloadActiveTab]);

  const openDevTools = useCallback(() => {
    const webview = webviewRefs.current[activeTabId];
    if (webview && typeof webview.openDevTools === 'function') {
      if (webview.isDevToolsOpened && webview.isDevToolsOpened()) {
        webview.closeDevTools();
      } else {
        webview.openDevTools();
        toast.info('Консоль разработчика вебвью открыта');
      }
    } else {
      toast.info('Инспектор доступен в десктопной версии Electron');
    }
  }, [activeTabId]);

  return {
    tabs,
    activeTabId,
    activeTab,
    setActiveTabId,
    createNewTab,
    closeTab,
    updateTab,
    changeTabEngine,
    navigateActiveTab,
    handleOpenBookmarkInTab,
    goBack,
    goForward,
    reloadActiveTab,
    setZoom,
    openExternal,
    openDevTools,
    clearStorageData,
    webviewRefs,
    toggleMuteActiveTab,
    isFindOpen,
    toggleFindOpen,
    findInPage,
    stopFindInPage,
    matchStats,
    isCapturedMediaOpen,
    setIsCapturedMediaOpen
  };
}
