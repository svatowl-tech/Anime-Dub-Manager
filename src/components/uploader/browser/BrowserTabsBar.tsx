import React from 'react';
import { Plus, X, Globe, Loader2, Send, Trash2, Code2 } from 'lucide-react';
import { BrowserTab } from './types';

interface BrowserTabsBarProps {
  tabs: BrowserTab[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
  onOpenTelegramModal: () => void;
  onClearStorage: () => void;
  onOpenDevTools: () => void;
}

export const BrowserTabsBar: React.FC<BrowserTabsBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onOpenTelegramModal,
  onClearStorage,
  onOpenDevTools
}) => {
  return (
    <div className="bg-neutral-950 px-2 pt-1.5 border-b border-neutral-800 flex items-center justify-between gap-2 select-none overflow-hidden flex-shrink-0">
      {/* Scrollable Tabs List */}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1 min-w-0">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs font-medium max-w-[200px] min-w-[110px] cursor-pointer transition-all border-t border-x relative ${
                isActive
                  ? 'bg-neutral-900 text-white border-neutral-700/80 shadow-md'
                  : 'bg-neutral-950/60 text-neutral-400 hover:bg-neutral-900/60 hover:text-neutral-200 border-transparent'
              }`}
              title={`${tab.title} (${tab.url})`}
            >
              {/* Favicon or status icon */}
              {tab.isLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400 flex-shrink-0" />
              ) : tab.favicon ? (
                <img
                  src={tab.favicon}
                  alt=""
                  className="w-3.5 h-3.5 rounded-sm object-contain flex-shrink-0"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              ) : (
                <Globe className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-sky-400' : 'text-neutral-500'}`} />
              )}

              {/* Tab Title */}
              <span className="truncate flex-1 text-[11px]">
                {tab.title || 'Новая вкладка'}
              </span>

              {/* Close Tab Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                className="p-0.5 rounded hover:bg-neutral-800 text-neutral-400 hover:text-white opacity-60 group-hover:opacity-100 transition cursor-pointer flex-shrink-0"
                title="Закрыть вкладку"
              >
                <X className="w-3 h-3" />
              </button>

              {/* Active Tab bottom indicator */}
              {isActive && (
                <div className="absolute bottom-[-1px] left-0 right-0 h-[2px] bg-sky-500" />
              )}
            </div>
          );
        })}

        {/* Add New Tab Button */}
        <button
          onClick={onNewTab}
          className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-900 transition cursor-pointer flex-shrink-0"
          title="Открыть новую вкладку"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Right Quick Controls */}
      <div className="flex items-center gap-1.5 flex-shrink-0 pb-1">
        <button
          onClick={onOpenTelegramModal}
          className="px-2 py-1 rounded-md text-[11px] font-bold bg-sky-950/80 hover:bg-sky-900 text-sky-300 border border-sky-700/60 transition flex items-center gap-1 shadow-sm cursor-pointer"
          title="Telegram MTProto Клиент"
        >
          <Send className="w-3 h-3 text-sky-400" />
          <span className="hidden md:inline">TG Client</span>
        </button>

        <button
          onClick={onClearStorage}
          className="p-1 rounded-md text-neutral-400 hover:text-amber-300 hover:bg-neutral-900 transition border border-transparent hover:border-neutral-800 cursor-pointer"
          title="Очистить кэш и куки авторизации (сброс сессий)"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onOpenDevTools}
          className="p-1 rounded-md text-neutral-400 hover:text-emerald-300 hover:bg-neutral-900 transition border border-transparent hover:border-neutral-800 cursor-pointer"
          title="Инспектор элементов / DevTools"
        >
          <Code2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
