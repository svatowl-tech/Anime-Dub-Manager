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
  // Auth Modal (QR / Phone)
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);

  useEffect(() => {
    loadStatus();

    const handleAuthInvalidated = () => {
      console.warn('Telegram auth invalidated. Reloading status...');
      setStatus(prev => prev ? { ...prev, status: 'disconnected', me: null } : null);
      setDialogs([]);
      loadStatus();
      toast.error('Сессия Telegram устарела. Пожалуйста, выполните повторный вход.');
      setIsAuthModalOpen(true);
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
        } else {
          setDialogs([]);
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
      } else {
        setDialogs([]);
      }
    } catch (e: any) {
      console.warn('Dialogs fetch error:', e);
      const errStr = String(e?.message || e || '');
      if (errStr.includes('AUTH_KEY_UNREGISTERED') || errStr.includes('Сессия Telegram устарела')) {
        setStatus(prev => prev ? { ...prev, status: 'disconnected', me: null } : { status: 'disconnected', me: null, settings: {} as any });
        setDialogs([]);
        setIsAuthModalOpen(true);
      }
    } finally {
      setIsLoadingDialogs(false);
    }
  };

  const isConnected = status?.status === 'connected';
  const hasBot = !!(status?.botConnected || status?.settings?.botToken);

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
              <button
                onClick={() => !isConnected && setIsAuthModalOpen(true)}
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition flex items-center gap-1 ${
                  isConnected
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                    : hasBot
                    ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30 hover:bg-purple-500/25 cursor-pointer'
                    : 'bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 cursor-pointer'
                }`}
                title={!isConnected ? 'Нажмите для входа в MTProto' : 'MTProto подключен'}
              >
                {isConnected ? 'MTProto Online' : hasBot ? 'Bot API Online (MTProto offline)' : 'Авторизоваться в MTProto'}
              </button>
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
            <span>Настройки</span>
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

      {/* Offline Alert Strip when MTProto is disconnected */}
      {!isConnected && (
        <div className="bg-amber-950/40 border-b border-amber-900/50 px-4 py-2 flex items-center justify-between text-xs text-amber-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span>
              Telegram MTProto не подключен. {hasBot ? 'Отправка постов работает через Bot API.' : 'Авторизуйтесь по QR / телефону для чтения чатов и скачивания дорожек.'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsAuthModalOpen(true)}
              className="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg text-xs transition cursor-pointer"
            >
              Войти через QR-код
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-semibold rounded-lg text-xs transition cursor-pointer"
            >
              Настроить Bot API
            </button>
          </div>
        </div>
      )}

      {/* Main Tab Content */}
      <div className="flex-1 overflow-hidden relative flex flex-col">
        {activeTab === 'tracks' && (
          <TelegramTracksTab
            currentProject={activeProject}
            currentEpisode={currentEpisode}
            allProjects={allProjects}
            dialogs={dialogs}
            onRefreshProjects={onRefreshProjects}
          />
        )}

        {activeTab === 'verify' && (
          <TelegramPostVerifyTab
            currentProject={activeProject}
            currentEpisode={currentEpisode}
            dialogs={dialogs}
            defaultChannelId={status?.settings?.defaultChannelId || ''}
            onRefreshProjects={onRefreshProjects}
          />
        )}

        {activeTab === 'composer' && (
          <TelegramComposerTab
            currentProject={activeProject}
            currentEpisode={currentEpisode}
            dialogs={dialogs}
            defaultChannelId={status?.settings?.defaultChannelId || ''}
            headerTemplate={status?.settings?.headerTemplate || ''}
            footerTemplate={status?.settings?.footerTemplate || ''}
          />
        )}

        {activeTab === 'automations' && (
          <TelegramAutomationsTab
            currentProject={activeProject}
            currentEpisode={currentEpisode}
            allProjects={allProjects}
            dialogs={dialogs}
            defaultChannelId={status?.settings?.defaultChannelId || ''}
          />
        )}

        {activeTab === 'messenger' && (
          <TelegramMessengerTab
            dialogs={dialogs}
            selectedChatId={selectedChatId}
            onSelectChat={(id) => setSelectedChatId(id)}
          />
        )}

        {activeTab === 'dialogs' && (
          <TelegramDialogsTab
            dialogs={dialogs}
            isLoading={isLoadingDialogs}
            onRefresh={loadDialogs}
            onSelectChat={(id) => {
              setSelectedChatId(id);
              setActiveTab('messenger');
            }}
          />
        )}

        {activeTab === 'settings' && (
          <TelegramSettingsTab
            status={status}
            onRefreshStatus={loadStatus}
            onOpenAuth={() => setIsAuthModalOpen(true)}
          />
        )}
      </div>

      {/* Auth Modal (QR / Phone) */}
      {isAuthModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-3xl max-w-xl w-full max-h-[90vh] overflow-y-auto relative p-6 shadow-2xl">
            <button
              onClick={() => setIsAuthModalOpen(false)}
              className="absolute right-4 top-4 p-2 text-neutral-400 hover:text-white rounded-full hover:bg-neutral-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="mb-4">
              <h3 className="text-base font-bold text-white">Авторизация в Telegram MTProto</h3>
              <p className="text-xs text-neutral-400">Сканируйте QR-код через мобильное приложение Telegram или войдите по номеру телефона</p>
            </div>
            <TelegramAuthView
              onSuccess={async () => {
                await loadStatus();
                setIsAuthModalOpen(false);
                toast.success('Авторизация в Telegram MTProto успешна!');
              }}
              savedPhone={status?.settings?.phoneNumber}
              savedApiId={status?.settings?.apiId ? String(status.settings.apiId) : ''}
              savedApiHash={status?.settings?.apiHash || ''}
            />
          </div>
        </div>
      )}

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
