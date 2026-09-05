import React, { useState, useEffect, useCallback } from 'react';
import { BookmarkItem, TemplateType, CustomFieldItem } from './types';
import { Episode, ProjectLinks } from '../../types';
import { useModuleLogs } from '../../hooks/useModuleLogs';
import { LogViewerDrawer } from '../common/LogViewerDrawer';
import { useBrowserTabs } from './browser/useBrowserTabs';
import { BrowserTabsBar } from './browser/BrowserTabsBar';
import { BrowserAddressBar } from './browser/BrowserAddressBar';
import { BrowserTabContent } from './browser/BrowserTabContent';
import { BrowserFindBar } from './browser/BrowserFindBar';
import { CapturedMediaModal } from './browser/CapturedMediaModal';
import { isWeb, ipcSafe } from '../../lib/ipcSafe';
import { appLogger } from '../../lib/appLogger';
import { toast } from 'sonner';

interface EmbeddedBrowserProps {
  activeUrl: string;
  onNavigateUrl: (url: string) => void;
  bookmarks: BookmarkItem[];
  onSelectBookmark: (bm: BookmarkItem) => void;
  onOpenBookmarksModal: () => void;
  onOpenTelegramModal: () => void;
  currentEpisode?: Episode | null;
  generatedPost?: string;
  templateType?: TemplateType;
  onBuildPostText?: (type: TemplateType) => void;
  customFields?: CustomFieldItem[];
  projectLinks?: ProjectLinks;
}

export const EmbeddedBrowser: React.FC<EmbeddedBrowserProps> = ({
  activeUrl,
  onNavigateUrl,
  bookmarks,
  onSelectBookmark,
  onOpenBookmarksModal,
  onOpenTelegramModal,
  currentEpisode = null,
  generatedPost,
  templateType,
  onBuildPostText,
  customFields,
  projectLinks
}) => {
  const [isLogsOpen, setIsLogsOpen] = useState<boolean>(false);
  const { logs: uploaderLogs, clearLogs: clearUploaderLogs } = useModuleLogs('uploader');
  const errorCount = uploaderLogs.filter(l => l.level === 'error').length;

  const {
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
  } = useBrowserTabs(activeUrl, onNavigateUrl);

  // Keyboard shortcut Ctrl+F to open Find In Page
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleFindOpen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleFindOpen]);

  // When activeUrl changes from external quick links, update active tab
  useEffect(() => {
    if (activeUrl && activeTab && activeTab.url !== activeUrl) {
      navigateActiveTab(activeUrl);
    }
  }, [activeUrl]);

  // Callback to register each active webview in the refs map for top-level toolbar actions
  const webviewRefCallback = useCallback((tabId: string, webview: any) => {
    if (!webview || isWeb) {
      delete webviewRefs.current[tabId];
      return;
    }
    webviewRefs.current[tabId] = webview;
  }, [webviewRefs]);

  // Inject post into active webpage input field
  const handleInjectPost = useCallback(async () => {
    if (!generatedPost || !generatedPost.trim()) {
      toast.warning('Сначала сгенерируйте текст поста в левой панели');
      return;
    }

    const webview = webviewRefs.current[activeTabId];
    if (webview && !isWeb) {
      if (typeof webview._admInjectPost === 'function') {
        const ok = await webview._admInjectPost(generatedPost);
        if (ok) {
          toast.success('Текст поста успешно вставлен в поле на странице!');
          return;
        }
      }
    }

    // Fallback: Copy to clipboard and inform user
    try {
      await navigator.clipboard.writeText(generatedPost);
      toast.success('Текст поста скопирован в буфер обмена (нажмите Ctrl+V в нужном поле)');
    } catch (e) {
      toast.error('Не удалось скопировать текст в буфер');
    }
  }, [generatedPost, activeTabId, webviewRefs]);

  // Copy post text directly to clipboard
  const handleCopyPostText = useCallback(async () => {
    if (!generatedPost || !generatedPost.trim()) {
      toast.warning('Текст поста не сгенерирован');
      return;
    }
    try {
      await navigator.clipboard.writeText(generatedPost);
      toast.success('Текст поста скопирован в буфер обмена');
    } catch (e) {
      toast.error('Не удалось скопировать текст');
    }
  }, [generatedPost]);

  // Copy cover image to system clipboard as an image (allows pressing Ctrl+V on sites to upload)
  const handleCopyCover = useCallback(async () => {
    const coverUrl = (currentEpisode as any)?.coverImage || currentEpisode?.project?.posterUrl || (currentEpisode as any)?.posterImage;
    if (!coverUrl) {
      toast.warning('Обложка серии не найдена');
      return;
    }

    if (!isWeb) {
      try {
        const res = await ipcSafe.invoke('browser-copy-image-to-clipboard', coverUrl);
        if (res && res.success) {
          toast.success('Файл обложки скопирован как картинка! Нажмите Ctrl+V на сайте.');
          return;
        }
      } catch (e) {}
    }

    // Web fallback
    try {
      const resp = await fetch(coverUrl);
      const blob = await resp.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob })
      ]);
      toast.success('Изображение обложки скопировано в буфер (Ctrl+V)');
    } catch (e) {
      await navigator.clipboard.writeText(coverUrl);
      toast.info('Ссылка на обложку скопирована в буфер');
    }
  }, [currentEpisode]);

  // Open dedicated standalone auth window for difficult SSO / Cloudflare / VK ID
  const handleOpenAuthWindow = useCallback(async (url?: string) => {
    const target = url || activeTab?.url;
    if (!target) return;
    if (!isWeb) {
      toast.info('Открывается защищенное окно авторизации...');
      await ipcSafe.invoke('browser-open-auth-window', { url: target, title: activeTab?.title || 'Вход' });
      reloadActiveTab();
      toast.success('Сессия обновлена!');
    } else {
      window.open(target, '_blank');
    }
  }, [activeTab?.url, activeTab?.title, reloadActiveTab]);

  return (
    <div id="embedded-browser-container" className="flex-1 flex flex-col h-full bg-neutral-950 overflow-hidden relative">
      {/* 1. Multi-Tab Bar */}
      <BrowserTabsBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={closeTab}
        onNewTab={() => createNewTab()}
        onOpenTelegramModal={onOpenTelegramModal}
        onClearStorage={clearStorageData}
        onOpenDevTools={openDevTools}
      />

      {/* 2. Address & Utilities Toolbar with Quick Bookmarks */}
      <BrowserAddressBar
        activeTab={activeTab}
        onNavigate={navigateActiveTab}
        onGoBack={goBack}
        onGoForward={goForward}
        onReload={reloadActiveTab}
        onSetZoom={setZoom}
        onOpenExternal={openExternal}
        bookmarks={bookmarks}
        onSelectBookmark={(bm, openInNew) => {
          handleOpenBookmarkInTab(bm, openInNew);
          onSelectBookmark(bm);
        }}
        onOpenBookmarksModal={onOpenBookmarksModal}
        isLogsOpen={isLogsOpen}
        onToggleLogs={() => setIsLogsOpen(!isLogsOpen)}
        errorCount={errorCount}
        onChangeEngine={changeTabEngine}
        onToggleFind={toggleFindOpen}
        onToggleMute={toggleMuteActiveTab}
        onOpenCapturedMedia={() => setIsCapturedMediaOpen(true)}
        onInjectPost={handleInjectPost}
        onCopyPostText={handleCopyPostText}
        onCopyCover={handleCopyCover}
        onOpenAuthWindow={() => handleOpenAuthWindow()}
        hasGeneratedPost={!!generatedPost && generatedPost.trim().length > 0}
        hasCover={!!((currentEpisode as any)?.coverImage || currentEpisode?.project?.posterUrl || (currentEpisode as any)?.posterImage)}
      />

      {/* 3. Floating Find In Page Bar */}
      <BrowserFindBar
        isOpen={isFindOpen}
        onClose={toggleFindOpen}
        onFind={findInPage}
        onStopFind={stopFindInPage}
        matchStats={matchStats}
      />

      {/* 4. Captured Media Modal */}
      <CapturedMediaModal
        isOpen={isCapturedMediaOpen}
        onClose={() => setIsCapturedMediaOpen(false)}
        mediaUrls={activeTab?.capturedMedia || []}
        pageTitle={activeTab?.title}
      />

      {/* 5. Persistent Multi-Tab WebViews Canvas */}
      <div className="flex-1 w-full h-full bg-white relative overflow-hidden flex flex-col">
        {/* Main Tabs Area */}
        <div className="flex-1 h-full min-w-0 relative flex flex-col overflow-hidden bg-neutral-950">
          {tabs.map((tab) => (
            <BrowserTabContent
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              onUpdateTab={updateTab}
              onOpenExternal={openExternal}
              webviewRefCallback={webviewRefCallback}
              currentEpisode={currentEpisode}
              generatedPost={generatedPost}
              templateType={templateType}
              onBuildPostText={onBuildPostText}
              customFields={customFields}
              projectLinks={projectLinks}
            />
          ))}

          {/* Collapsible Logger Drawer at bottom of browser */}
          {isLogsOpen && (
            <div className="w-full p-2 bg-neutral-950 border-t border-neutral-800 z-20">
              <LogViewerDrawer
                title="Журнал работы загрузчика"
                scope="uploader"
                logs={uploaderLogs}
                onClear={clearUploaderLogs}
                isOpen={isLogsOpen}
                onToggle={() => setIsLogsOpen(!isLogsOpen)}
                maxHeightClass="max-h-48"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
