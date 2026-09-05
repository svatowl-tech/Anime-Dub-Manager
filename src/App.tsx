import { useState, useEffect, useCallback, useRef } from 'react';
import { LayoutDashboard, Scissors, Settings, Mic2, Activity, PlaySquare, Database, Image as ImageIcon, BarChart2, X, Archive, Globe, Send, MessageSquare } from 'lucide-react';
import { Toaster } from 'sonner';
import Dashboard from './components/Dashboard';
import QAPanel from './components/QAPanel';
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
import { Project, Episode } from './types';
import { ipcSafe, isWeb } from './lib/ipcSafe';
import { VideoProvider } from './contexts/VideoContext';
import { useGlobalKeyboard } from './hooks/useGlobalKeyboard';
 
function AppContent() {
  type TabType = 'dashboard' | 'subtitles' | 'qa' | 'release' | 'telegram' | 'settings' | 'database' | 'cover' | 'stats' | 'archive';
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [savedAudioUrl, setSavedAudioUrl] = useState<string | null>(null);
  
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [currentEpisode, setCurrentEpisode] = useState<Episode | null>(null);
  const [standaloneEpisode, setStandaloneEpisode] = useState<Episode | null>(null);

  const selectedProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  const standaloneEpisodeRef = useRef<Episode | null>(null);
  useEffect(() => {
    standaloneEpisodeRef.current = standaloneEpisode;
  }, [standaloneEpisode]);

  const isInitialLoad = useRef(true);

  const activeEpisodeToPass = currentEpisode || standaloneEpisode;

  useGlobalKeyboard();

  const loadProjects = useCallback(async () => {
    try {
      const data = await ipcSafe.invoke('get-projects');
      if (data) {
        setProjects(data);
        
        let currentSelectedId = selectedProjectIdRef.current;
        
        // Do not auto-select first project on initial load, allowing the General Hub to open by default
        if (isInitialLoad.current && data.length > 0 && !currentSelectedId) {
          currentSelectedId = null;
          setSelectedProjectId(null);
        }
        isInitialLoad.current = false;
        
        if (currentSelectedId) {
          const updatedProject = data.find((p: Project) => p.id === currentSelectedId);
          if (updatedProject) {
            const ep = updatedProject.episodes?.find((e: Episode) => e.number === updatedProject.lastActiveEpisode) || updatedProject.episodes?.[0];
            setCurrentEpisode(ep ? { ...ep, project: updatedProject } : null);
          } else {
             // Project was deleted
             setCurrentEpisode(null);
             setSelectedProjectId(null);
          }
        } else {
          setCurrentEpisode(null);
        }
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
         } catch(e) {}
      }

    } catch (error) {
      console.error("Failed to load projects:", error);
    }
  }, []);

  useEffect(() => {
    loadProjects();
    // Ensure window has focus on startup to avoid unresponsive inputs
    window.focus();

    // Auto-sync locally
    const doAutoSync = async () => {
      try {
        const syncStatus = await ipcSafe.invoke('cloud-sync-status');
        if (syncStatus?.connected && syncStatus?.enabled) {
          await ipcSafe.invoke('cloud-pull');
          // Reload projects after cloud pull completes
          await loadProjects();
        }
      } catch (e) {
        console.error('Auto-sync failed:', e);
      }
    };
    doAutoSync();

    // Fix Electron focus bug: WebContents often drops caret focus.
    const handlePointerDown = () => {
      // Calling window.focus() on interaction tells OS to re-focus the window context
      if (!document.hasFocus()) {
        window.focus();
      }
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [loadProjects]);

  const handleNavigate = (tab: TabType) => {
    setActiveTab(tab);
  };

  const handleProjectSelect = (projectId: string) => {
    setSelectedProjectId(projectId || null);
    if (!projectId) {
      setCurrentEpisode(null);
      return;
    }
    const project = projects.find(p => p.id === projectId);
    if (project) {
      const ep = project.episodes.find(e => e.number === project.lastActiveEpisode) || project.episodes[0];
      if (ep) {
        setCurrentEpisode({ ...ep, project });
      } else {
        setCurrentEpisode(null);
      }
    } else {
      setCurrentEpisode(null);
    }
  };

  const handleEpisodeSelect = async (episodeNumber: number) => {
    if (!selectedProjectId) return;
    const project = projects.find(p => p.id === selectedProjectId);
    if (project) {
      await ipcSafe.invoke('save-project', { ...project, lastActiveEpisode: episodeNumber });
      await loadProjects();
    }
  };

  return (
    <div className="flex h-screen bg-neutral-950 text-neutral-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-neutral-900 border-r border-neutral-800 flex flex-col">
        <div className="p-6 flex flex-col gap-3 border-b border-neutral-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Mic2 className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight text-white">Anime Dub Manager</span>
          </div>
          
          {currentEpisode && (
            <div className="flex items-center justify-between bg-neutral-800/50 py-1.5 px-3 rounded-md text-xs border border-neutral-700/50">
               <span className="text-neutral-300 truncate max-w-[120px]" title={currentEpisode.project?.title}>
                 {currentEpisode.project?.title || 'Проект'}
               </span>
               <button 
                 onClick={() => { setSelectedProjectId(null); setCurrentEpisode(null); }}
                 className="text-neutral-500 hover:text-red-400"
                 title="Закрыть проект и перейти в ручной режим"
               >
                 <X className="w-3.5 h-3.5" />
               </button>
            </div>
          )}
          {(!currentEpisode && standaloneEpisode) && (
            <div className="flex items-center justify-between bg-blue-900/20 py-1.5 px-3 rounded-md text-xs border border-blue-800/30">
               <span className="text-blue-400 font-medium">Ручной режим</span>
               <button 
                 onClick={() => setStandaloneEpisode(null)}
                 className="text-blue-500 hover:text-red-400"
                 title="Очистить файлы ручного режима"
               >
                 <X className="w-3.5 h-3.5" />
               </button>
            </div>
          )}
        </div>
        
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          <button
            id="step-dashboard"
            onClick={() => setActiveTab('dashboard')}
            title="Главная панель управления проектами и сериями"
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'dashboard' 
                ? 'bg-blue-600/10 text-blue-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <LayoutDashboard className="w-5 h-5" />
            <span>Дашборд проекта</span>
          </button>

          <button
            id="step-subtitles"
            onClick={() => setActiveTab('subtitles')}
            title="Инструменты для редактирования и синхронизации субтитров (ASS)"
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'subtitles' 
                ? 'bg-indigo-600/10 text-indigo-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <Scissors className="w-5 h-5" />
            <span>Утилиты (ASS)</span>
          </button>

          <button
            id="step-qa"
            onClick={() => setActiveTab('qa')}
            title="Проверка качества озвучки и синхронизации"
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'qa' 
                ? 'bg-blue-600/10 text-blue-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <Activity className="w-5 h-5" />
            <span>QA Проверка</span>
          </button>

          <button
            onClick={() => setActiveTab('cover')}
            title="Генерация обложек для серий"
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'cover' 
                ? 'bg-pink-600/10 text-pink-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <ImageIcon className="w-5 h-5" />
            <span>Обложки серии</span>
          </button>

          <button
            onClick={() => setActiveTab('release')}
            title="Финальная сборка и экспорт релиза"
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'release' 
                ? 'bg-purple-600/10 text-purple-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <PlaySquare className="w-5 h-5" />
            <span>Сборка релиза</span>
          </button>

          <button
            onClick={() => setActiveTab('telegram')}
            title="Полноценный клиент Telegram, мессенджер, чаты, анонсы и автопостинг"
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'telegram' 
                ? 'bg-sky-600/10 text-sky-400 font-bold' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <Send className="w-5 h-5 text-sky-400" />
            <span>Telegram клиент</span>
          </button>

          <button
            onClick={() => setActiveTab('archive')}
            title="Архив завершенных и приостановленных проектов"
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'archive' 
                ? 'bg-amber-600/10 text-amber-500' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <Archive className="w-5 h-5" />
            <span>Архив проектов</span>
          </button>
        </nav>

        <div className="p-4 border-t border-neutral-800 space-y-1">
          <button
            onClick={() => setActiveTab('stats')}
            title="Интеллектуальная аналитика работы дабберов, кураторов и звукорежиссеров"
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'stats' 
                ? 'bg-blue-600/10 text-blue-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <BarChart2 className="w-5 h-5" />
            <span>Статистика</span>
          </button>
          <button
            onClick={() => setActiveTab('database')}
            title="Управление списком даберов, звукорежиссеров и их контактами"
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'database' 
                ? 'bg-blue-600/10 text-blue-400' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <Database className="w-5 h-5" />
            <span>База участников</span>
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            title="Настройка путей к файлам, API ключей и других параметров"
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors text-left ${
              activeTab === 'settings' 
                ? 'bg-neutral-800 text-white' 
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            <Settings className="w-5 h-5" />
            <span>Настройки</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`flex-1 bg-neutral-950 flex flex-col ${['subtitles', 'qa', 'telegram'].includes(activeTab) ? 'overflow-hidden' : 'overflow-y-auto'}`}>
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
        {activeTab === 'subtitles' && (!activeEpisodeToPass ? <StandaloneMediaSelector title="Утилиты субтитров" onApply={setStandaloneEpisode} /> : <AssEditor currentEpisode={activeEpisodeToPass} onRefresh={loadProjects} />)}
        {activeTab === 'release' && (!activeEpisodeToPass ? <StandaloneMediaSelector title="Сборка релиза" onApply={setStandaloneEpisode} /> : <ReleasePanel currentEpisode={activeEpisodeToPass} onRefresh={loadProjects} />)}
        {activeTab === 'database' && <DatabasePanel />}
        {activeTab === 'stats' && <StatsPanel />}
        {activeTab === 'settings' && <SettingsPanel />}
        {activeTab === 'qa' && (!activeEpisodeToPass ? <StandaloneMediaSelector title="QA Проверка" onApply={setStandaloneEpisode} /> : <QAPanel currentEpisode={activeEpisodeToPass} onRefresh={loadProjects} />)}
        {activeTab === 'cover' && (!activeEpisodeToPass ? <StandaloneMediaSelector title="Обложки серии" onApply={setStandaloneEpisode} /> : <CoverGenerator currentEpisode={activeEpisodeToPass} onRefresh={loadProjects} />)}
        {!isWeb && <TaskQueuePanel />}
      </main>
      <Toaster position="top-right" richColors theme="dark" />
      <ActiveDownloadsIndicator />
    </div>
  );
}

export default function App() {
  return (
    <VideoProvider>
      <AppContent />
    </VideoProvider>
  );
}
