import { useState, useEffect, useCallback, useRef } from 'react';
import {
  LayoutDashboard,
  Scissors,
  Settings,
  Mic2,
  Activity,
  PlaySquare,
  Database,
  Image as ImageIcon,
  BarChart2,
  X,
  Archive,
  Send,
  Sliders,
  Clock,
  Terminal,
  Film,
  Bell,
  Menu,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Toaster, toast } from 'sonner';
import Dashboard from './components/Dashboard';
import VideoEditorPanel from './components/VideoEditorPanel';
import QAPanel from './components/QAPanel';
import TimingPanel from './components/TimingPanel';
import MixingPanel from './components/MixingPanel';
import ReleasePanel from './components/ReleasePanel';
import AssEditor from './contexts/AssEditor';
import DatabasePanel from './components/DatabasePanel';
import SettingsPanel from './components/SettingsPanel';
import TaskQueuePanel from './components/TaskQueuePanel';
import CoverGenerator from './components/CoverGenerator';
import StandaloneMediaSelector from './components/StandaloneMediaSelector';
import { StatsPanel } from './components/StatsPanel';
import ActiveDownloadsIndicator from './components/ActiveDownloadsIndicator';
import ArchivePanel from './components/ArchivePanel';
import { TelegramClientPanel } from './components/TelegramClientPanel';
import { UnsavedChangesModal } from './components/ui/UnsavedChangesModal';
import { ServerAuthGate } from './components/auth/ServerAuthGate';
import { ServerFilePickerModal } from './components/files/ServerFilePickerModal';
import { requestServerFilePicker } from './components/files/serverFilePickerBridge';
import { CuratorInboxPanel } from './components/inbox/CuratorInboxPanel';
import { UpdateBanner } from './components/updates/UpdateBanner';
import { AiEnvInstallModal } from './components/updates/AiEnvInstallModal';
import { Project, Episode } from './types';
import { ipcSafe, isWeb } from './lib/ipcSafe';
import { fetchCuratorInbox, probeServerCapabilities } from './lib/serverClient';
import { appLogger } from './lib/appLogger';
import { invalidateParticipantsCache } from './services/dbService';
import { VideoProvider } from './contexts/VideoContext';
import { useGlobalKeyboard } from './hooks/useGlobalKeyboard';
 
function AppContent() {
  type TabType =
    | 'dashboard'
    | 'inbox'
    | 'video-editor'
    | 'subtitles'
    | 'qa'
    | 'timing'
    | 'mixing'
    | 'release'
    | 'telegram'
    | 'settings'
    | 'database'
    | 'cover'
    | 'stats'
    | 'archive';
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [savedAudioUrl, setSavedAudioUrl] = useState<string | null>(null);
  const [logEventCount, setLogEventCount] = useState<number>(() => appLogger.getTimeline().length);
  const [isLiveServer, setIsLiveServer] = useState(false);
  const [inboxPendingCount, setInboxPendingCount] = useState(0);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const refreshInboxCount = useCallback(async () => {
    try {
      const res = await fetchCuratorInbox({ status: 'pending', limit: 1 });
      setInboxPendingCount(res.summary.pendingCount);
    } catch {}
  }, []);

  useEffect(() => {
    let throttleTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = appLogger.subscribe('all', () => {
      if (throttleTimer) return;
      throttleTimer = setTimeout(() => {
        throttleTimer = null;
        setLogEventCount(appLogger.getTimeline().length);
      }, 1000);
    });
    return () => {
      unsub();
      if (throttleTimer) clearTimeout(throttleTimer);
    };
  }, []);

  useEffect(() => {
    void probeServerCapabilities().then((caps) => {
      if (caps.liveServer) {
        setIsLiveServer(true);
        void refreshInboxCount();
      }
    });
    const unsubInbox = ipcSafe.on('curator-inbox-updated', (payload: any) => {
      if (payload && typeof payload.pendingCount === 'number') {
        setInboxPendingCount(payload.pendingCount);
      } else {
        void refreshInboxCount();
      }
    });
    return () => {
      unsubInbox();
    };
  }, [refreshInboxCount]);

  const handleCopyLogsToClipboard = async () => {
    const ok = await appLogger.copyToClipboard();
    if (ok) {
      toast.success('📋 Полный лог всех процессов успешно скопирован в буфер обмена!');
    } else {
      toast.error('Не удалось скопировать лог в буфер обмена.');
    }
  };
  
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [currentEpisode, setCurrentEpisode] = useState<Episode | null>(null);
  const [standaloneEpisode, setStandaloneEpisode] = useState<Episode | null>(null);

  // Unsaved changes interception for navigation
  interface UnsavedHandler {
    hasChanges: () => boolean;
    save: () => Promise<void>;
    discard: () => void;
  }
  const unsavedHandlerRef = useRef<UnsavedHandler | null>(null);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [isSavingPending, setIsSavingPending] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

  const confirmIfUnsaved = (action: () => void) => {
    if (unsavedHandlerRef.current && unsavedHandlerRef.current.hasChanges()) {
      pendingActionRef.current = action;
      setShowUnsavedModal(true);
      return;
    }
    action();
  };

  const handleSaveAndProceed = async () => {
    if (unsavedHandlerRef.current) {
      setIsSavingPending(true);
      try {
        await unsavedHandlerRef.current.save();
      } catch (e) {
        console.error("Failed to save changes:", e);
      } finally {
        setIsSavingPending(false);
      }
    }
    setShowUnsavedModal(false);
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    if (action) action();
  };

  const handleDiscardAndProceed = () => {
    if (unsavedHandlerRef.current) {
      unsavedHandlerRef.current.discard();
    }
    setShowUnsavedModal(false);
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    if (action) action();
  };

  const handleCancelModal = () => {
    setShowUnsavedModal(false);
    pendingActionRef.current = null;
  };

  const selectedProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  const projectsRef = useRef<Project[]>(projects);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  const standaloneEpisodeRef = useRef<Episode | null>(null);
  useEffect(() => {
    standaloneEpisodeRef.current = standaloneEpisode;
  }, [standaloneEpisode]);

  const isInitialLoad = useRef(true);

  const activeEpisodeToPass = currentEpisode || standaloneEpisode;

  useGlobalKeyboard();

  const loadProjects = useCallback(async (): Promise<void> => {
    try {
      const data = await ipcSafe.invoke('get-projects');
      if (Array.isArray(data)) {
        const normalizedData: Project[] = data.map((p: Project) => ({
          ...p,
          episodes: Array.isArray(p.episodes)
            ? [...p.episodes].sort((a, b) => (a.number || 0) - (b.number || 0))
            : []
        }));

        projectsRef.current = normalizedData;
        setProjects(normalizedData);

        let currentSelectedId = selectedProjectIdRef.current;

        // Do not auto-select first project on initial load, allowing the General Hub to open by default
        if (isInitialLoad.current && normalizedData.length > 0 && !currentSelectedId) {
          currentSelectedId = null;
          selectedProjectIdRef.current = null;
          setSelectedProjectId(null);
        }
        isInitialLoad.current = false;

        if (currentSelectedId) {
          const updatedProject = normalizedData.find((p: Project) => p.id === currentSelectedId);
          if (updatedProject) {
            const ep =
              updatedProject.episodes?.find((e: Episode) => e.number === updatedProject.lastActiveEpisode) ||
              updatedProject.episodes?.[0];
            setCurrentEpisode(ep ? { ...ep, project: updatedProject } : null);
          } else {
            // Project was deleted
            setCurrentEpisode(null);
            selectedProjectIdRef.current = null;
            setSelectedProjectId(null);
          }
        } else {
          setCurrentEpisode(null);
        }

        const currentStandalone = standaloneEpisodeRef.current;
        if (currentStandalone) {
          try {
            // Retrieve the updated episode from local storage
            // without losing the session file references
            const epsRaw = localStorage.getItem('episodes');
            if (epsRaw) {
              const eps = JSON.parse(epsRaw);
              const updatedStandalone = eps.find((e: any) => e.id === currentStandalone.id);
              if (updatedStandalone) {
                setStandaloneEpisode({
                  ...updatedStandalone,
                  // @ts-ignore
                  project: currentStandalone.project,
                  _standaloneVideoBuffer: (currentStandalone as any)._standaloneVideoBuffer,
                  _standaloneVideoUrl: (currentStandalone as any)._standaloneVideoUrl,
                  _standaloneSubText: (currentStandalone as any)._standaloneSubText
                });
              }
            }
          } catch (e) {}
        }
      }
    } catch (error) {
      console.error("Failed to load projects:", error);
    }
  }, []);

  useEffect(() => {
    loadProjects();
    // Ensure window has focus on startup to avoid unresponsive inputs
    window.focus();

    // Deferred lightweight auto-sync in background so startup I/O is never blocked
    const autoSyncTimer = setTimeout(async () => {
      try {
        const syncStatus = await ipcSafe.invoke('cloud-sync-status');
        if (syncStatus?.connected && syncStatus?.enabled) {
          const pullRes = await ipcSafe.invoke('cloud-pull', { lightweight: true });
          const hasUpdates =
            Array.isArray(pullRes) &&
            pullRes.some(
              (r: any) =>
                r &&
                (r.status === 'pulled_and_merged' ||
                  r.status === 'pulled_overwritten' ||
                  r.status === 'pulled')
            );
          if (hasUpdates) {
            invalidateParticipantsCache();
            await loadProjects();
          }
        }
      } catch (e) {
        console.error('Auto-sync failed:', e);
      }
    }, 2500);

    // Fix Electron focus bug: WebContents often drops caret focus.
    const handlePointerDown = () => {
      if (!document.hasFocus()) {
        window.focus();
      }
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    
    return () => {
      clearTimeout(autoSyncTimer);
      window.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [loadProjects]);

  const handleNavigate = (tab: TabType | string) => {
    setIsMobileMenuOpen(false);
    const nextTab = tab as TabType;
    if (nextTab === activeTab) return;
    appLogger.info('NAV', `Переключение вкладки: "${activeTab}" ➔ "${nextTab}"`);
    confirmIfUnsaved(() => setActiveTab(nextTab));
  };

  const handleOpenInboxTarget = (params: { projectId?: string; episodeNumber?: number; targetTab?: string }) => {
    confirmIfUnsaved(() => {
      if (params.projectId) {
        selectedProjectIdRef.current = params.projectId;
        setSelectedProjectId(params.projectId);
        const project = projectsRef.current.find((p) => p.id === params.projectId);
        if (project) {
          const ep =
            (params.episodeNumber !== undefined
              ? project.episodes?.find((e) => e.number === params.episodeNumber)
              : undefined) ||
            project.episodes?.find((e) => e.number === project.lastActiveEpisode) ||
            project.episodes?.[0];
          setCurrentEpisode(ep ? { ...ep, project } : null);
        }
      }
      if (params.targetTab) {
        setActiveTab(params.targetTab as TabType);
      } else {
        setActiveTab('dashboard');
      }
      setIsMobileMenuOpen(false);
    });
  };

  const handleProjectSelect = (projectId: string) => {
    confirmIfUnsaved(() => {
      appLogger.info('PROJECT', `Выбор проекта: "${projectId || 'none'}"`);
      const nextId = projectId || null;
      selectedProjectIdRef.current = nextId;
      setSelectedProjectId(nextId);
      if (!nextId) {
        setCurrentEpisode(null);
        return;
      }
      const project = projectsRef.current.find(p => p.id === nextId);
      if (project) {
        const ep =
          project.episodes?.find(e => e.number === project.lastActiveEpisode) ||
          project.episodes?.[0];
        if (ep) {
          setCurrentEpisode({ ...ep, project });
        } else {
          setCurrentEpisode(null);
        }
      } else {
        setCurrentEpisode(null);
      }
    });
  };

  const handleEpisodeSelect = async (episodeNumber: number) => {
    confirmIfUnsaved(async () => {
      const activeProjectId = selectedProjectIdRef.current;
      if (!activeProjectId) return;
      appLogger.info('PROJECT', `Выбор эпизода #${episodeNumber} в проекте "${activeProjectId}"`);
      const project = projectsRef.current.find(p => p.id === activeProjectId);
      if (project) {
        const updatedProject: Project = { ...project, lastActiveEpisode: episodeNumber };
        const ep = updatedProject.episodes?.find(e => e.number === episodeNumber) || updatedProject.episodes?.[0];
        projectsRef.current = projectsRef.current.map(p =>
          p.id === activeProjectId ? { ...p, lastActiveEpisode: episodeNumber } : p
        );
        setProjects(prev =>
          prev.map(p => (p.id === activeProjectId ? { ...p, lastActiveEpisode: episodeNumber } : p))
        );
        setCurrentEpisode(ep ? { ...ep, project: updatedProject } : null);

        if (project.lastActiveEpisode !== episodeNumber) {
          const { episodes: _eps, soundEngineer: _se, assignedDubbers: _ad, ...cleanProject } = updatedProject;
          await ipcSafe.invoke('save-project', cleanProject);
        }
      }
    });
  };

  const mobileDrawerTabs: { id: TabType; label: string; icon: any; badge?: number }[] = [
    { id: 'dashboard', label: 'Дашборд проекта', icon: LayoutDashboard },
    { id: 'inbox', label: 'Входящие куратора', icon: Bell, badge: inboxPendingCount },
    { id: 'video-editor', label: 'Редактирование видео', icon: Film },
    { id: 'subtitles', label: 'Утилиты (ASS)', icon: Scissors },
    { id: 'qa', label: 'QA Проверка', icon: Activity },
    { id: 'timing', label: 'Тайминг видео', icon: Clock },
    { id: 'mixing', label: 'Сведение видео', icon: Sliders },
    { id: 'cover', label: 'Обложки серии', icon: ImageIcon },
    { id: 'release', label: 'Сборка релиза', icon: PlaySquare },
    { id: 'telegram', label: 'Telegram клиент', icon: Send },
    { id: 'archive', label: 'Архив проектов', icon: Archive },
    { id: 'stats', label: 'Статистика', icon: BarChart2 },
    { id: 'database', label: 'База участников', icon: Database },
    { id: 'settings', label: 'Настройки', icon: Settings },
  ];

  return (
    <div className="flex flex-col md:flex-row h-[100dvh] bg-neutral-950 text-neutral-100 font-sans overflow-hidden">
      {/* Compact Mobile Top Bar */}
      <header className="md:hidden h-14 shrink-0 px-3 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
            <Mic2 className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-white truncate">
              {currentEpisode?.project?.title || 'Anime Dub Manager'}
            </div>
            {currentEpisode && (
              <div className="text-[11px] text-neutral-400 tabular-nums truncate">
                Серия {currentEpisode.number}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {isLiveServer && (
            <button
              type="button"
              onClick={() => void requestServerFilePicker({ mode: 'browse', title: 'Файлы на сервере' })}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-neutral-300 hover:bg-neutral-800"
              aria-label="Файлы сервера"
              title="Файлы сервера"
            >
              <FolderOpen className="w-5 h-5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(true)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-neutral-200 hover:bg-neutral-800"
            aria-label="Меню"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Desktop Sidebar (Collapsible) */}
      <aside
        className={`hidden md:flex shrink-0 bg-neutral-900 border-r border-neutral-800 flex-col transition-all duration-200 ${
          isSidebarCollapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        <div className={`${isSidebarCollapsed ? 'p-3' : 'p-6'} flex flex-col gap-3 border-b border-neutral-800`}>
          <div className={`flex items-center ${isSidebarCollapsed ? 'justify-center flex-col gap-2' : 'justify-between gap-2'}`}>
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0 shadow-lg shadow-blue-500/20">
                <Mic2 className="w-5 h-5 text-white" />
              </div>
              {!isSidebarCollapsed && (
                <span className="font-bold text-lg tracking-tight text-white truncate">Anime Dub Manager</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsSidebarCollapsed((v) => !v)}
              title={isSidebarCollapsed ? 'Развернуть боковую панель' : 'Свернуть боковую панель'}
              aria-label={isSidebarCollapsed ? 'Развернуть боковую панель' : 'Свернуть боковую панель'}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors shrink-0"
            >
              {isSidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          </div>
          
          {!isSidebarCollapsed && currentEpisode && (
            <div className="flex items-center justify-between bg-neutral-800/50 py-1.5 px-3 rounded-md text-xs border border-neutral-700/50">
               <span className="text-neutral-300 truncate max-w-[120px]" title={currentEpisode.project?.title}>
                 {currentEpisode.project?.title || 'Проект'}
               </span>
               <button 
                 onClick={() => confirmIfUnsaved(() => { setSelectedProjectId(null); setCurrentEpisode(null); })}
                 className="text-neutral-500 hover:text-red-400"
                 title="Закрыть проект и перейти в ручной режим"
               >
                 <X className="w-3.5 h-3.5" />
               </button>
            </div>
          )}
          {!isSidebarCollapsed && !currentEpisode && standaloneEpisode && (
            <div className="flex items-center justify-between bg-blue-900/20 py-1.5 px-3 rounded-md text-xs border border-blue-800/30">
               <span className="text-blue-400 font-medium">Ручной режим</span>
               <button 
                 onClick={() => confirmIfUnsaved(() => setStandaloneEpisode(null))}
                 className="text-blue-500 hover:text-red-400"
                 title="Очистить файлы ручного режима"
               >
                 <X className="w-3.5 h-3.5" />
               </button>
            </div>
          )}
        </div>
        
        <nav className={`flex-1 ${isSidebarCollapsed ? 'p-2' : 'p-4'} space-y-1 overflow-y-auto`}>
          <button
            id="step-dashboard"
            onClick={() => handleNavigate('dashboard')}
            title="Главная панель управления проектами и сериями"
            className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-4'} py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'dashboard' 
                ? 'bg-blue-600/10 text-blue-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <LayoutDashboard className="w-5 h-5 shrink-0" />
            {!isSidebarCollapsed && <span className="truncate">Дашборд проекта</span>}
          </button>

          <button
            id="step-inbox"
            onClick={() => handleNavigate('inbox')}
            title="Запросы AI-агента на согласование и уведомления куратора"
            className={`w-full relative flex items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'justify-between gap-2 px-4'} py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'inbox'
                ? 'bg-emerald-600/10 text-emerald-400'
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <Bell className="w-5 h-5 shrink-0" />
              {!isSidebarCollapsed && <span className="truncate">Входящие</span>}
            </div>
            {inboxPendingCount > 0 && (
              <span
                className={
                  isSidebarCollapsed
                    ? 'absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-semibold tabular-nums rounded bg-amber-500 text-neutral-950'
                    : 'text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300'
                }
              >
                {inboxPendingCount}
              </span>
            )}
          </button>

          <button
            id="step-video-editor"
            onClick={() => handleNavigate('video-editor')}
            title="Редактирование видео (FFmpeg без потери качества) с автоматическим пересчетом тайминга субтитров"
            className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-4'} py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'video-editor' 
                ? 'bg-emerald-600/10 text-emerald-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <Film className="w-5 h-5 shrink-0" />
            {!isSidebarCollapsed && <span className="truncate">Редактирование видео</span>}
          </button>

          <button
            id="step-subtitles"
            onClick={() => handleNavigate('subtitles')}
            title="Инструменты для редактирования и синхронизации субтитров (ASS)"
            className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-4'} py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'subtitles' 
                ? 'bg-indigo-600/10 text-indigo-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <Scissors className="w-5 h-5 shrink-0" />
            {!isSidebarCollapsed && <span className="truncate">Утилиты (ASS)</span>}
          </button>

          <button
            id="step-qa"
            onClick={() => handleNavigate('qa')}
            title="Проверка качества озвучки и синхронизации"
            className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-4'} py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'qa' 
                ? 'bg-blue-600/10 text-blue-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <Activity className="w-5 h-5 shrink-0" />
            {!isSidebarCollapsed && <span className="truncate">QA Проверка</span>}
          </button>

          <button
            id="step-timing"
            onClick={() => handleNavigate('timing')}
            title="Мультитрековый VAD-тайминг аудиодорожек и субтитров"
            className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-4'} py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'timing' 
                ? 'bg-amber-600/10 text-amber-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <Clock className="w-5 h-5 text-amber-400 shrink-0" />
            {!isSidebarCollapsed && <span className="truncate">Тайминг видео</span>}
          </button>

          <button
            id="step-mixing"
            onClick={() => handleNavigate('mixing')}
            title="Модульное сведение аудиодорожек и видеоряда серии"
            className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-4'} py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'mixing' 
                ? 'bg-purple-600/10 text-purple-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <Sliders className="w-5 h-5 shrink-0" />
            {!isSidebarCollapsed && <span className="truncate">Сведение видео</span>}
          </button>

          <button
            onClick={() => handleNavigate('cover')}
            title="Генерация обложек для серий"
            className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-4'} py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'cover' 
                ? 'bg-pink-600/10 text-pink-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <ImageIcon className="w-5 h-5 shrink-0" />
            {!isSidebarCollapsed && <span className="truncate">Обложки серии</span>}
          </button>

          <button
            onClick={() => handleNavigate('release')}
            title="Финальная сборка и экспорт релиза"
            className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-4'} py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'release' 
                ? 'bg-purple-600/10 text-purple-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <PlaySquare className="w-5 h-5 shrink-0" />
            {!isSidebarCollapsed && <span className="truncate">Сборка релиза</span>}
          </button>

          <button
            onClick={() => handleNavigate('telegram')}
            title="Полноценный клиент Telegram, мессенджер, чаты, анонсы и автопостинг"
            className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-4'} py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'telegram' 
                ? 'bg-sky-600/10 text-sky-400 font-bold' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <Send className="w-5 h-5 text-sky-400 shrink-0" />
            {!isSidebarCollapsed && <span className="truncate">Telegram клиент</span>}
          </button>

          <button
            onClick={() => handleNavigate('archive')}
            title="Архив завершенных и приостановленных проектов"
            className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-4'} py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'archive' 
                ? 'bg-amber-600/10 text-amber-500' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <Archive className="w-5 h-5 shrink-0" />
            {!isSidebarCollapsed && <span className="truncate">Архив проектов</span>}
          </button>
        </nav>

        <div className={`${isSidebarCollapsed ? 'p-2' : 'p-4'} border-t border-neutral-800 space-y-1`}>
          <button
            onClick={() => handleNavigate('stats')}
            title="Интеллектуальная аналитика работы дабберов, кураторов и звукорежиссеров"
            className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-4'} py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'stats' 
                ? 'bg-blue-600/10 text-blue-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <BarChart2 className="w-5 h-5 shrink-0" />
            {!isSidebarCollapsed && <span className="truncate">Статистика</span>}
          </button>
          <button
            onClick={() => handleNavigate('database')}
            title="Управление списком даберов, звукорежиссеров и их контактами"
            className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-4'} py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'database' 
                ? 'bg-blue-600/10 text-blue-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <Database className="w-5 h-5 shrink-0" />
            {!isSidebarCollapsed && <span className="truncate">База участников</span>}
          </button>
          <button
            onClick={() => handleNavigate('settings')}
            title="Настройка путей к файлам, API ключей и других параметров"
            className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-4'} py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'settings' 
                ? 'bg-neutral-800 text-white' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <Settings className="w-5 h-5 shrink-0" />
            {!isSidebarCollapsed && <span className="truncate">Настройки</span>}
          </button>

          {isLiveServer && (
            <button
              type="button"
              onClick={() => void requestServerFilePicker({ mode: 'browse', title: 'Файлы на сервере' })}
              title="Просмотр, загрузка и скачивание файлов с сервера"
              className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-4'} py-2.5 rounded-lg font-medium transition-colors text-left text-neutral-300 hover:bg-neutral-800 hover:text-white`}
            >
              <FolderOpen className="w-5 h-5 text-blue-400 shrink-0" />
              {!isSidebarCollapsed && <span className="truncate">Файлы сервера</span>}
            </button>
          )}

          {/* Quick Diagnostics & Copy Logs Button */}
          <div className="pt-2 border-t border-neutral-800/80">
            <button
              onClick={handleCopyLogsToClipboard}
              title="Скопировать подробный диагностический лог всех процессов в буфер обмена"
              className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'justify-between px-3'} py-2 rounded-lg text-xs font-mono font-medium text-sky-300 bg-sky-950/40 hover:bg-sky-900/50 border border-sky-800/50 transition-colors shadow-sm group`}
            >
              <div className="flex items-center gap-2 truncate">
                <Terminal className="w-3.5 h-3.5 text-sky-400 shrink-0 group-hover:animate-pulse" />
                {!isSidebarCollapsed && <span className="truncate">📋 Логи процессов</span>}
              </div>
              {!isSidebarCollapsed && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-900/80 text-sky-200 border border-sky-700/60">
                  {logEventCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`flex-1 min-h-0 bg-neutral-950 flex flex-col ${['subtitles', 'qa', 'timing', 'mixing', 'telegram', 'inbox'].includes(activeTab) ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        <UpdateBanner
          onOpenSettings={() => handleNavigate('settings')}
          onOpenInbox={() => handleNavigate('inbox')}
        />
        {activeTab === 'dashboard' && (
          <Dashboard 
            onNavigate={handleNavigate} 
            projects={projects}
            selectedProjectId={selectedProjectId}
            currentEpisode={currentEpisode}
            onProjectSelect={handleProjectSelect}
            onEpisodeSelect={handleEpisodeSelect}
            onRefresh={loadProjects}
          />
        )}
        {activeTab === 'inbox' && (
          <CuratorInboxPanel
            onOpenTarget={handleOpenInboxTarget}
            onOpenSettings={() => handleNavigate('settings')}
            onSummaryChange={(s) => setInboxPendingCount(s.pendingCount)}
          />
        )}
        {activeTab === 'video-editor' && (
          <div className="p-4 sm:p-6">
            {!activeEpisodeToPass ? (
              <StandaloneMediaSelector title="Редактирование видео" onApply={setStandaloneEpisode} />
            ) : (
              <VideoEditorPanel
                currentEpisode={activeEpisodeToPass}
                onRefresh={loadProjects}
                onOpenAssUtilities={() => handleNavigate('subtitles')}
              />
            )}
          </div>
        )}
        {activeTab === 'telegram' && (
          <div className="p-3 sm:p-5 h-full flex flex-col overflow-hidden">
            <TelegramClientPanel
              currentEpisode={activeEpisodeToPass}
              currentProject={currentEpisode?.project || (projects && projects.length > 0 ? projects[0] : null)}
              allProjects={projects}
              onRefreshProjects={loadProjects}
            />
          </div>
        )}
        {activeTab === 'archive' && (
          <ArchivePanel 
            projects={projects}
            onProjectSelect={handleProjectSelect}
            onNavigate={handleNavigate}
            onRefresh={loadProjects}
          />
        )}
        {activeTab === 'subtitles' && (!activeEpisodeToPass ? <StandaloneMediaSelector title="Утилиты субтитров" onApply={setStandaloneEpisode} /> : <AssEditor currentEpisode={activeEpisodeToPass} onRefresh={loadProjects} onRegisterUnsavedHandler={(h) => { unsavedHandlerRef.current = h; }} />)}
        {activeTab === 'release' && (!activeEpisodeToPass ? <StandaloneMediaSelector title="Сборка релиза" onApply={setStandaloneEpisode} /> : <ReleasePanel currentEpisode={activeEpisodeToPass} onRefresh={loadProjects} />)}
        {activeTab === 'database' && <DatabasePanel />}
        {activeTab === 'stats' && <StatsPanel />}
        {activeTab === 'settings' && <SettingsPanel />}
        {activeTab === 'qa' && (!activeEpisodeToPass ? <StandaloneMediaSelector title="QA Проверка" onApply={setStandaloneEpisode} /> : <QAPanel currentEpisode={activeEpisodeToPass} onRefresh={loadProjects} onNavigate={handleNavigate} />)}
        {activeTab === 'timing' && (!activeEpisodeToPass ? (
          <StandaloneMediaSelector title="Тайминг видео" onApply={setStandaloneEpisode} />
        ) : (
          <TimingPanel
            currentEpisode={activeEpisodeToPass}
            onRefresh={loadProjects}
            onNavigate={handleNavigate}
          />
        ))}
        {activeTab === 'mixing' && (!activeEpisodeToPass ? <StandaloneMediaSelector title="Сведение видео" onApply={setStandaloneEpisode} /> : <MixingPanel currentEpisode={activeEpisodeToPass} onRefresh={loadProjects} />)}
        {activeTab === 'cover' && (!activeEpisodeToPass ? <StandaloneMediaSelector title="Обложки серии" onApply={setStandaloneEpisode} /> : <CoverGenerator currentEpisode={activeEpisodeToPass} onRefresh={loadProjects} />)}
        {(!isWeb || isLiveServer) && <TaskQueuePanel />}
      </main>

      {/* Mobile Bottom Navigation Bar (5 touch targets >=44px) */}
      <nav className="md:hidden h-16 shrink-0 bg-neutral-900 border-t border-neutral-800 grid grid-cols-5 items-center px-1">
        {[
          { id: 'dashboard' as TabType, label: 'Проект', icon: LayoutDashboard },
          { id: 'inbox' as TabType, label: 'Входящие', icon: Bell, badge: inboxPendingCount },
          { id: 'qa' as TabType, label: 'QA', icon: Activity },
          { id: 'mixing' as TabType, label: 'Сведение', icon: Sliders },
        ].map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavigate(item.id)}
              className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-lg relative transition-colors ${
                isActive ? 'text-blue-400' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <div className="relative">
                <Icon className="w-5 h-5" />
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-neutral-950 text-[10px] font-bold flex items-center justify-center tabular-nums">
                    {item.badge}
                  </span>
                )}
              </div>
              <span className="text-[11px] font-medium truncate max-w-full px-1">{item.label}</span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setIsMobileMenuOpen(true)}
          className="min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-lg text-neutral-400 hover:text-neutral-200"
        >
          <Menu className="w-5 h-5" />
          <span className="text-[11px] font-medium">Меню</span>
        </button>
      </nav>

      {/* Mobile Slide-Over Navigation Drawer */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm flex justify-end">
          <div className="w-80 max-w-[85vw] h-full bg-neutral-900 border-l border-neutral-800 flex flex-col">
            <div className="px-4 py-3.5 border-b border-neutral-800 flex items-center justify-between">
              <span className="text-sm font-bold text-white">Все разделы студии</span>
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800"
                aria-label="Закрыть меню"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {mobileDrawerTabs.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavigate(item.id)}
                    className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-lg flex items-center justify-between gap-2 text-sm font-medium transition-colors ${
                      isActive ? 'bg-blue-600/15 text-blue-400' : 'text-neutral-300 hover:bg-neutral-800'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Icon className="w-5 h-5 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </div>
                    {item.badge !== undefined && item.badge > 0 && (
                      <span className="text-xs font-semibold tabular-nums px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}

              {isLiveServer && (
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    void requestServerFilePicker({ mode: 'browse', title: 'Файлы на сервере' });
                  }}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg flex items-center gap-3 text-sm font-medium text-neutral-300 hover:bg-neutral-800"
                >
                  <FolderOpen className="w-5 h-5 text-blue-400 shrink-0" />
                  <span>Файлы сервера</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  void handleCopyLogsToClipboard();
                }}
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg flex items-center justify-between text-sm font-medium text-sky-300 hover:bg-neutral-800"
              >
                <div className="flex items-center gap-3">
                  <Terminal className="w-5 h-5 text-sky-400 shrink-0" />
                  <span>Скопировать логи</span>
                </div>
                <span className="text-xs font-mono tabular-nums text-neutral-400">{logEventCount}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <Toaster position="top-right" richColors theme="dark" />
      <ActiveDownloadsIndicator />

      <UnsavedChangesModal
        isOpen={showUnsavedModal}
        title="Несохраненные изменения"
        message="В распределении ролей есть несохраненные изменения. Сохранить их перед переходом?"
        onSaveAndProceed={handleSaveAndProceed}
        onDiscardAndProceed={handleDiscardAndProceed}
        onCancel={handleCancelModal}
        isSaving={isSavingPending}
      />
    </div>
  );
}

export default function App() {
  return (
    <VideoProvider>
      <ServerAuthGate>
        <AppContent />
      </ServerAuthGate>
      <ServerFilePickerModal />
      <AiEnvInstallModal />
    </VideoProvider>
  );
}
