import React, { useState, useEffect } from 'react';
import { 
  Send, 
  Settings, 
  MessageSquare, 
  ShieldCheck, 
  Sparkles, 
  Layers, 
  Globe, 
  X, 
  Zap, 
  Users, 
  FileText,
  Lock,
  RefreshCw,
  Music,
  FileCheck
} from 'lucide-react';
import { toast } from 'sonner';
import { ipcSafe } from '../lib/ipcSafe';
import { 
  TelegramMTProtoStatus, 
  TelegramMTProtoDialog, 
  Episode, 
  Project 
} from '../types';
import { TelegramTabType } from './telegram/types';
import { TelegramAuthView } from './telegram/TelegramAuthView';
import { TelegramTracksTab } from './telegram/TelegramTracksTab';
import { TelegramPostVerifyTab } from './telegram/TelegramPostVerifyTab';
import { TelegramComposerTab } from './telegram/TelegramComposerTab';
import { TelegramAutomationsTab } from './telegram/TelegramAutomationsTab';
import { TelegramMessengerTab } from './telegram/TelegramMessengerTab';
import { TelegramDialogsTab } from './telegram/TelegramDialogsTab';
import { TelegramSettingsTab } from './telegram/TelegramSettingsTab';
import { ProjectChatModal } from './telegram/ProjectChatModal';

interface TelegramClientPanelProps {
  currentEpisode?: Episode | null;
  currentProject?: Project | null;
  allProjects?: Project[];
  onRefreshProjects?: () => void;
  onClose?: () => void;
}

export const TelegramClientPanel: React.FC<TelegramClientPanelProps> = ({
  currentEpisode,
  currentProject,
  allProjects,
  onRefreshProjects,
  onClose
}) => {
  const [activeTab, setActiveTab] = useState<TelegramTabType>('tracks');
  const [status, setStatus] = useState<TelegramMTProtoStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState<boolean>(true);
  
  // Dialogs
  const [dialogs, setDialogs] = useState<TelegramMTProtoDialog[]>([]);
  const [isLoadingDialogs, setIsLoadingDialogs] = useState<boolean>(false);
  const [selectedChatId, setSelectedChatId] = useState<string>('');

  // Selected Project for context
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    currentProject?.id || (allProjects && allProjects.length > 0 ? allProjects[0].id : '')
  );
  const activeProject = (allProjects || []).find(p => p.id === selectedProjectId) || currentProject || null;

  // Project Chat Config Modal
  const [isProjectModalOpen, setIsProjectModalOpen] = useState<boolean>(false);

  useEffect(() => {
    loadStatus();

    const handleAuthInvalidated = () => {
      console.warn('Telegram auth invalidated. Reloading status...');
      loadStatus();
    };

    window.addEventListener('telegram-auth-invalidated', handleAuthInvalidated);
    return () => {
      window.removeEventListener('telegram-auth-invalidated', handleAuthInvalidated);
    };
  }, []);

  const loadStatus = async () => {
    setIsLoadingStatus(true);
    try {
      const res = await ipcSafe.invoke('telegram-mtproto-get-status');
      if (res && res.status) {
        setStatus(res);
        if (res.status === 'connected') {
          loadDialogs();
        }
      }
    } catch (e: any) {
      console.warn('Could not load Telegram status:', e);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  const loadDialogs = async () => {
    setIsLoadingDialogs(true);
    try {
      const res = await ipcSafe.invoke('telegram-mtproto-get-dialogs', { limit: 80 });
      if (Array.isArray(res)) {
        setDialogs(res);
        if (res.length > 0 && !selectedChatId) {
          setSelectedChatId(res[0].id);
        }
      }
    } catch (e: any) {
      console.warn('Dialogs fetch error:', e);
      if (String(e).includes('AUTH_KEY_UNREGISTERED')) {
        // Session was invalid and has been cleared by backend
        setStatus(prev => prev ? { ...prev, status: 'disconnected', me: null } : { status: 'disconnected', me: null, settings: {} as any });
      }
    } finally {
      setIsLoadingDialogs(false);
    }
  };

  const isConnected = status?.status === 'connected';

  return (
    <div className="flex-1 flex flex-col h-full bg-neutral-950 text-white overflow-hidden select-none">
      {/* Top Header & Tab Navigation Bar */}
      <div className="bg-neutral-900 border-b border-neutral-800 px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
            <Send className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-bold text-white uppercase tracking-wider">Telegram Studio Center</h2>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                isConnected
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
              }`}>
                {isConnected ? 'MTProto Online' : 'Web Ready'}
              </span>
            </div>
            <p className="text-[11px] text-neutral-400">
              {activeProject ? `Проект: ${activeProject.title}` : 'Управление публикациями и чатами озвучки'}
            </p>
          </div>
        </div>

        {/* Tab Buttons */}
        <div className="flex items-center bg-neutral-950 p-1 rounded-xl border border-neutral-800 flex-wrap gap-1">
          <button
            onClick={() => setActiveTab('tracks')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
              activeTab === 'tracks'
                ? 'bg-violet-600 text-white shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Music className="w-3.5 h-3.5" />
            <span>Дорожки озвучки</span>
          </button>

          <button
            onClick={() => setActiveTab('verify')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
              activeTab === 'verify'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <FileCheck className="w-3.5 h-3.5" />
            <span>Проверка постинга</span>
          </button>

          <button
            onClick={() => setActiveTab('composer')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
              activeTab === 'composer'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Анонсы / Посты</span>
          </button>

          <button
            onClick={() => setActiveTab('automations')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
              activeTab === 'automations'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Автоматизации</span>
          </button>

          <button
            onClick={() => setActiveTab('messenger')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
              activeTab === 'messenger'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Мессенджер</span>
          </button>

          <button
            onClick={() => setActiveTab('dialogs')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
              activeTab === 'dialogs'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Каналы ({dialogs.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
              activeTab === 'settings'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Настройки MTProto</span>
          </button>
        </div>

        {/* Close button if modal/overlay mode */}
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition cursor-pointer"
            title="Закрыть панель"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Main Tab Content */}
      <div className="flex-1 overflow-hidden relative flex flex-col">
        {activeTab === 'tracks' && (
          isConnected ? (
            <TelegramTracksTab
              currentProject={activeProject}
              currentEpisode={currentEpisode}
              allProjects={allProjects}
              dialogs={dialogs}
              onRefreshProjects={onRefreshProjects}
            />
          ) : (
            <div className="flex-1 overflow-y-auto">
              <TelegramAuthView
                onSuccess={loadStatus}
                savedPhone={status?.settings?.phoneNumber}
                savedApiId={status?.settings?.apiId ? String(status.settings.apiId) : ''}
                savedApiHash={status?.settings?.apiHash || ''}
              />
            </div>
          )
        )}

        {activeTab === 'verify' && (
          isConnected ? (
            <TelegramPostVerifyTab
              currentProject={activeProject}
              currentEpisode={currentEpisode}
              dialogs={dialogs}
              defaultChannelId={status?.settings?.defaultChannelId || ''}
              onRefreshProjects={onRefreshProjects}
            />
          ) : (
            <div className="flex-1 overflow-y-auto">
              <TelegramAuthView
                onSuccess={loadStatus}
                savedPhone={status?.settings?.phoneNumber}
                savedApiId={status?.settings?.apiId ? String(status.settings.apiId) : ''}
                savedApiHash={status?.settings?.apiHash || ''}
              />
            </div>
          )
        )}

        {activeTab === 'composer' && (
          isConnected ? (
            <TelegramComposerTab
              currentProject={activeProject}
              currentEpisode={currentEpisode}
              dialogs={dialogs}
              defaultChannelId={status?.settings?.defaultChannelId || ''}
              headerTemplate={status?.settings?.headerTemplate || ''}
              footerTemplate={status?.settings?.footerTemplate || ''}
            />
          ) : (
            <div className="flex-1 overflow-y-auto">
              <TelegramAuthView
                onSuccess={loadStatus}
                savedPhone={status?.settings?.phoneNumber}
                savedApiId={status?.settings?.apiId ? String(status.settings.apiId) : ''}
                savedApiHash={status?.settings?.apiHash || ''}
              />
            </div>
          )
        )}

        {activeTab === 'automations' && (
          isConnected ? (
            <TelegramAutomationsTab
              currentProject={activeProject}
              currentEpisode={currentEpisode}
              allProjects={allProjects}
              dialogs={dialogs}
              defaultChannelId={status?.settings?.defaultChannelId || ''}
            />
          ) : (
            <div className="flex-1 overflow-y-auto">
              <TelegramAuthView
                onSuccess={loadStatus}
                savedPhone={status?.settings?.phoneNumber}
                savedApiId={status?.settings?.apiId ? String(status.settings.apiId) : ''}
                savedApiHash={status?.settings?.apiHash || ''}
              />
            </div>
          )
        )}

        {activeTab === 'messenger' && (
          isConnected ? (
            <TelegramMessengerTab
              dialogs={dialogs}
              selectedChatId={selectedChatId}
              onSelectChat={(id) => setSelectedChatId(id)}
            />
          ) : (
            <div className="flex-1 overflow-y-auto">
              <TelegramAuthView
                onSuccess={loadStatus}
                savedPhone={status?.settings?.phoneNumber}
                savedApiId={status?.settings?.apiId ? String(status.settings.apiId) : ''}
                savedApiHash={status?.settings?.apiHash || ''}
              />
            </div>
          )
        )}

        {activeTab === 'dialogs' && (
          isConnected ? (
            <TelegramDialogsTab
              dialogs={dialogs}
              isLoading={isLoadingDialogs}
              onRefresh={loadDialogs}
              onSelectChat={(id) => {
                setSelectedChatId(id);
                setActiveTab('messenger');
              }}
            />
          ) : (
            <div className="flex-1 overflow-y-auto">
              <TelegramAuthView
                onSuccess={loadStatus}
                savedPhone={status?.settings?.phoneNumber}
                savedApiId={status?.settings?.apiId ? String(status.settings.apiId) : ''}
                savedApiHash={status?.settings?.apiHash || ''}
              />
            </div>
          )
        )}

        {activeTab === 'settings' && (
          <div className="flex-1 overflow-y-auto">
            {!isConnected ? (
              <TelegramAuthView
                onSuccess={loadStatus}
                savedPhone={status?.settings?.phoneNumber}
                savedApiId={status?.settings?.apiId ? String(status.settings.apiId) : ''}
                savedApiHash={status?.settings?.apiHash || ''}
              />
            ) : (
              <TelegramSettingsTab
                status={status}
                onRefreshStatus={loadStatus}
              />
            )}
          </div>
        )}
      </div>

      {/* Project Chat Config Modal */}
      {isProjectModalOpen && activeProject && (
        <ProjectChatModal
          project={activeProject}
          isOpen={isProjectModalOpen}
          onClose={() => setIsProjectModalOpen(false)}
          onSaved={onRefreshProjects}
        />
      )}
    </div>
  );
};
