import React, { useState, useEffect } from 'react';
import { 
  FolderOpen, Calendar, Clock, MessageSquare, Zap, 
  ExternalLink, Plus, Users, Mic, CheckCircle2, 
  AlertCircle, RefreshCw, Archive, Clipboard, Check, Play
} from 'lucide-react';
import { Project, Episode, Participant, EpisodeStatus } from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';
import { toast } from 'sonner';
import { formatFullDeadline } from '../../lib/templates';

interface GeneralHubProps {
  projects: Project[];
  onProjectSelect: (id: string) => void;
  onEpisodeSelect: (num: number) => void;
  onRefresh: () => void;
  onCreateProjectClick: () => void;
}

const STATUS_LABELS: Record<EpisodeStatus, string> = {
  UPLOAD: 'Загрузка ресурсов',
  ROLES: 'Распределение ролей',
  RECORDING: 'Запись звука',
  QA: 'Проверка качества',
  FIXES: 'Правки',
  SOUND_ENGINEERING: 'Звукорежиссура',
  FINISHED: 'Завершено'
};

const STATUS_COLORS: Record<EpisodeStatus, string> = {
  UPLOAD: 'bg-neutral-800 text-neutral-400 border-neutral-700',
  ROLES: 'bg-blue-950/40 text-blue-400 border-blue-900/50',
  RECORDING: 'bg-amber-950/40 text-amber-400 border-amber-900/50',
  QA: 'bg-indigo-950/40 text-indigo-400 border-indigo-900/50',
  FIXES: 'bg-red-950/40 text-red-400 border-red-900/50',
  SOUND_ENGINEERING: 'bg-purple-950/40 text-purple-400 border-purple-900/50',
  FINISHED: 'bg-emerald-950/40 text-emerald-400 border-emerald-900/50'
};

export default function GeneralHub({
  projects,
  onProjectSelect,
  onEpisodeSelect,
  onRefresh,
  onCreateProjectClick
}: GeneralHubProps) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [servicesStatus, setServicesStatus] = useState<Record<string, { status: string; latency: number; error?: string }>>({});
  const [isCheckingServices, setIsCheckingServices] = useState(false);
  const [newEpisodesMap, setNewEpisodesMap] = useState<Record<string, number | null>>({});
  const [isCheckingNewEpisodes, setIsCheckingNewEpisodes] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Reminder modal state
  const [reminderText, setReminderText] = useState<string | null>(null);
  const [reminderProject, setReminderProject] = useState<Project | null>(null);
  const [reminderEpisode, setReminderEpisode] = useState<Episode | null>(null);
  const [copied, setCopied] = useState(false);

  // Filter only active projects for the main hub
  const activeProjects = projects.filter(p => p.status !== 'COMPLETED');

  // Load participants on mount
  useEffect(() => {
    const loadParticipants = async () => {
      try {
        const parts = await ipcSafe.invoke('get-participants');
        if (parts) setParticipants(parts);
      } catch (e) {
        console.error('Failed to load participants for hub:', e);
      }
    };
    loadParticipants();
    checkServices();
  }, []);

  // Check services connection status
  const checkServices = async () => {
    if (isCheckingServices) return;
    setIsCheckingServices(true);
    try {
      const res = await ipcSafe.invoke('check-services-status');
      if (res) {
        setServicesStatus(res);
      }
    } catch (e) {
      console.error('Failed to check services status:', e);
    } finally {
      setIsCheckingServices(false);
    }
  };

  // Check new episodes on trackers for active projects
  const checkNewEpisodesOnTracker = async () => {
    if (isCheckingNewEpisodes || activeProjects.length === 0) return;
    setIsCheckingNewEpisodes(true);
    toast.info('Проверяем новые серии на трекерах...');
    
    const resultsMap: Record<string, number | null> = {};
    
    // Check concurrently up to 4 projects at a time to be fast and safe
    const checkProject = async (p: Project) => {
      try {
        const checkRes = await ipcSafe.invoke('anime365-check-new-episodes', { projectId: p.id });
        if (checkRes && checkRes.maxEpisode) {
          const currentMaxEp = p.episodes?.reduce((max, ep) => Math.max(max, ep.number), 0) || 0;
          if (checkRes.maxEpisode > currentMaxEp) {
            resultsMap[p.id] = checkRes.maxEpisode;
            return;
          }
        }
      } catch (err) {
        // Fallback to Nyaa
        if (p.originalTitle) {
          try {
            const results = await ipcSafe.invoke('search-nyaa-torrents', {
              query: p.originalTitle,
              category: 'anime',
              subCategory: 'raw'
            });
            if (results && Array.isArray(results) && results.length > 0) {
              let maxEpFound = 0;
              results.forEach(r => {
                const match = r.title ? r.title.match(/[ -_]0*([1-9]\d*)[ -_xv]/i) : null;
                if (match) {
                  const ep = parseInt(match[1]);
                  if (ep > maxEpFound && ep < 1000) maxEpFound = ep;
                }
              });
              const currentMaxEp = p.episodes?.reduce((max, ep) => Math.max(max, ep.number), 0) || 0;
              if (maxEpFound > currentMaxEp) {
                resultsMap[p.id] = maxEpFound;
                return;
              }
            }
          } catch (e) {}
        }
      }
      resultsMap[p.id] = null;
    };

    try {
      // Process in batches
      for (let i = 0; i < activeProjects.length; i += 3) {
        const batch = activeProjects.slice(i, i + 3);
        await Promise.all(batch.map(p => checkProject(p)));
      }
      setNewEpisodesMap(resultsMap);
      toast.success('Проверка серий завершена!');
    } catch (e) {
      console.error('Error during batch tracker check:', e);
    } finally {
      setIsCheckingNewEpisodes(false);
    }
  };

  // Trigger tracker check automatically when projects change
  useEffect(() => {
    if (activeProjects.length > 0 && Object.keys(newEpisodesMap).length === 0) {
      checkNewEpisodesOnTracker();
    }
  }, [projects]);

  // Handle archiving a project
  const handleArchiveProject = async (p: Project, e: React.MouseEvent) => {
    e.stopPropagation(); // Don't trigger project selection click
    try {
      const updated = {
        ...p,
        status: 'COMPLETED' as const,
        updatedAt: new Date().toISOString()
      };
      await ipcSafe.invoke('save-project', updated);
      toast.success(`Проект "${p.title}" успешно отправлен в архив!`);
      onRefresh();
    } catch (err: any) {
      toast.error('Не удалось архивировать проект: ' + err.message);
    }
  };

  // Calculate detailed progress of an episode
  const getEpisodeProgress = (ep: Episode) => {
    if (ep.status === 'FINISHED') return 100;
    if (ep.status === 'UPLOAD') return 10;
    if (ep.status === 'ROLES') return 25;
    
    const total = ep.assignments?.length || 0;
    const approved = ep.assignments?.filter(a => a.status === 'APPROVED').length || 0;
    const recorded = ep.assignments?.filter(a => a.status === 'RECORDED').length || 0;
    
    if (ep.status === 'RECORDING') {
      if (total === 0) return 40;
      return Math.round(30 + ((approved + recorded) / (total * 2)) * 30);
    }
    if (ep.status === 'QA') return 70;
    if (ep.status === 'FIXES') {
      if (total === 0) return 80;
      return Math.round(75 + (approved / total) * 10);
    }
    if (ep.status === 'SOUND_ENGINEERING') return 90;
    return 0;
  };

  // Generate reminder message
  const triggerReminder = (p: Project, ep: Episode, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const pendingDubbers = ep.assignments
      .filter(a => a.status === 'PENDING' || a.status === 'FIXES_NEEDED' || a.status === 'REJECTED')
      .map(a => {
        const part = participants.find(part => part.id === a.dubberId);
        const name = part ? (part.telegram ? `@${part.telegram}` : part.nickname) : a.characterName;
        const stateLabel = a.status === 'FIXES_NEEDED' ? '⚠️ (нужны правки)' : '🎙️ (ожидает озвучки)';
        return `• ${name} — роль ${a.characterName} ${stateLabel}`;
      });

    const formatDeadlineShort = (dateStr?: string) => {
      if (!dateStr) return 'не указан';
      const date = new Date(dateStr);
      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      return `${day}.${month}`;
    };

    const deadlineStr = formatFullDeadline(ep.deadline, ep.fixesDeadline);
    
    let msg = `⏰ **Напоминание о сдаче серии!**\n`;
    msg += `🎬 Проект: **${p.emoji || '❤️'} ${p.title}**\n`;
    msg += `👾 Серия **#${ep.number}**\n`;
    msg += `📅 Дедлайн сдачи: **${deadlineStr}**\n`;
    msg += `📊 Текущий этап: **${STATUS_LABELS[ep.status] || ep.status}**\n\n`;
    
    if (pendingDubbers.length > 0) {
      msg += `Ребята, очень ждем ваши озвучки / правки:\n${pendingDubbers.join('\n')}\n\nСдаем по возможности скорее! 🙏`;
    } else if (ep.status === 'SOUND_ENGINEERING') {
      const se = participants.find(part => part.id === p.soundEngineerId);
      const seMention = se ? (se.telegram ? `@${se.telegram}` : se.nickname) : 'звукорежиссер';
      msg += `🔊 Серия уже на этапе звукорежиссуры у **${seMention}**. Готовимся к релизу! 🚀`;
    } else {
      msg += `🎉 Все роли успешно сданы и проверены! Серия готовится к финализации.`;
    }

    setReminderText(msg);
    setReminderProject(p);
    setReminderEpisode(ep);
    setCopied(false);
  };

  const copyToClipboard = () => {
    if (reminderText) {
      navigator.clipboard.writeText(reminderText);
      setCopied(true);
      toast.success('Текст напоминания скопирован в буфер обмена!');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Stats calculation
  const stats = {
    totalActive: activeProjects.length,
    inProgressEpisodes: activeProjects.reduce((acc, p) => acc + (p.episodes?.filter(e => e.status !== 'FINISHED')?.length || 0), 0),
    completedEpisodes: activeProjects.reduce((acc, p) => acc + (p.episodes?.filter(e => e.status === 'FINISHED')?.length || 0), 0),
    fixesRequiredCount: activeProjects.reduce((acc, p) => acc + (p.episodes?.filter(e => e.status === 'FIXES')?.length || 0), 0)
  };

  // Filter projects based on search query
  const filteredProjects = activeProjects.filter(p => 
    p.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (p.originalTitle && p.originalTitle.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="space-y-8 pb-12">
      {/* Upper Widgets: Stats and Controls */}
      <div className="flex flex-col xl:flex-row gap-6 justify-between items-start">
        <div className="flex-1 w-full space-y-4">
          <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-3">
            <span className="bg-gradient-to-r from-blue-500 to-indigo-500 bg-clip-text text-transparent">
              Панель Управления Проектами
            </span>
          </h1>
          <p className="text-neutral-400 text-sm max-w-2xl">
            Информационный хаб для отслеживания готовности серий, выхода релизов на трекерах, 
            координации дабберов и отправки быстрых напоминаний.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
          <div className="relative flex-1 md:flex-initial">
            <input 
              type="text" 
              placeholder="Поиск по тайтлам..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full md:w-64 bg-neutral-900 border border-neutral-800 focus:border-blue-500 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={checkNewEpisodesOnTracker}
            disabled={isCheckingNewEpisodes}
            className="flex items-center gap-2 px-4 py-2.5 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-neutral-300 hover:text-white rounded-xl text-sm font-semibold transition-all cursor-pointer disabled:opacity-50"
            title="Проверить появление новых серий на Anime365 и Nyaa"
          >
            <RefreshCw className={`w-4 h-4 ${isCheckingNewEpisodes ? 'animate-spin text-blue-400' : ''}`} />
            <span>Проверить серии</span>
          </button>
          <button
            onClick={onCreateProjectClick}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-blue-500/15 hover:shadow-blue-500/25 transition-all cursor-pointer"
          >
            <Plus className="w-4.5 h-4.5" />
            <span>Новый проект</span>
          </button>
        </div>
      </div>

      {/* Aggregate Stats Dashboard Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gradient-to-b from-neutral-900 to-neutral-950 border border-neutral-800 p-5 rounded-2xl flex items-center gap-4 shadow-sm">
          <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center shrink-0">
            <FolderOpen className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider">Тайтлов в работе</p>
            <p className="text-2xl font-bold text-white mt-0.5">{stats.totalActive}</p>
          </div>
        </div>

        <div className="bg-gradient-to-b from-neutral-900 to-neutral-950 border border-neutral-800 p-5 rounded-2xl flex items-center gap-4 shadow-sm">
          <div className="w-12 h-12 bg-amber-500/10 rounded-xl flex items-center justify-center shrink-0">
            <Clock className="w-6 h-6 text-amber-400" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider">Серий в работе</p>
            <p className="text-2xl font-bold text-white mt-0.5">{stats.inProgressEpisodes}</p>
          </div>
        </div>

        <div className="bg-gradient-to-b from-neutral-900 to-neutral-950 border border-neutral-800 p-5 rounded-2xl flex items-center gap-4 shadow-sm">
          <div className="w-12 h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider">Выпущенных серий</p>
            <p className="text-2xl font-bold text-white mt-0.5">{stats.completedEpisodes}</p>
          </div>
        </div>

        <div className="bg-gradient-to-b from-neutral-900 to-neutral-950 border border-neutral-800 p-5 rounded-2xl flex items-center gap-4 shadow-sm">
          <div className={`w-12 h-12 ${stats.fixesRequiredCount > 0 ? 'bg-red-500/10 text-red-400' : 'bg-neutral-800 text-neutral-500'} rounded-xl flex items-center justify-center shrink-0`}>
            <AlertCircle className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider">Серий с правками</p>
            <p className={`text-2xl font-bold ${stats.fixesRequiredCount > 0 ? 'text-red-400 animate-pulse' : 'text-white'} mt-0.5`}>
              {stats.fixesRequiredCount}
            </p>
          </div>
        </div>
      </div>

      {/* Main List Grid of Projects */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredProjects.map(project => {
          // Find the active episode
          // Typically the first episode that is not FINISHED, or the lastActiveEpisode
          const activeEp = project.episodes?.find(e => e.number === project.lastActiveEpisode) || 
                           project.episodes?.find(e => e.status !== 'FINISHED') || 
                           project.episodes?.[project.episodes.length - 1];
          
          const maxEp = project.episodes?.reduce((max, ep) => Math.max(max, ep.number), 0) || 0;
          const newEpNum = newEpisodesMap[project.id];
          const hasNewEp = newEpNum && newEpNum > maxEp;

          const progress = activeEp ? getEpisodeProgress(activeEp) : 0;

          return (
            <div 
              key={project.id}
              onClick={() => onProjectSelect(project.id)}
              className="bg-neutral-900/60 hover:bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-2xl overflow-hidden shadow-lg transition-all group flex flex-col h-full cursor-pointer hover:shadow-xl hover:shadow-black/25 relative"
            >
              {/* Optional New Episode Badge */}
              {hasNewEp && (
                <div className="absolute top-3 right-3 z-10 px-3 py-1 bg-amber-500 text-black text-[10px] font-extrabold uppercase rounded-full flex items-center gap-1 shadow-lg shadow-amber-500/20 animate-bounce">
                  <Zap className="w-3.5 h-3.5 fill-black" />
                  Вышла {newEpNum} серия!
                </div>
              )}

              {/* Cover Header */}
              <div className="h-40 relative bg-neutral-950 shrink-0 overflow-hidden">
                {project.posterUrl ? (
                  <div className="absolute inset-0">
                    <img 
                      src={project.posterUrl} 
                      alt={project.title} 
                      className="w-full h-full object-cover filter blur-[2px] scale-105 opacity-30 group-hover:opacity-40 transition-opacity"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-neutral-900 via-neutral-900/80 to-transparent" />
                  </div>
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-tr from-neutral-950 via-neutral-900 to-neutral-950" />
                )}

                {/* Info Overlay */}
                <div className="absolute bottom-4 left-4 right-4 flex gap-4 items-end">
                  {project.posterUrl && (
                    <img 
                      src={project.posterUrl} 
                      alt={project.title} 
                      className="w-16 h-24 rounded-lg object-cover shadow-md border border-neutral-800 relative shrink-0"
                      referrerPolicy="no-referrer"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  )}
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-xl shrink-0">{project.emoji || '❤️'}</span>
                      <span className="text-xs px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded-full font-bold border border-blue-500/20">
                        {project.releaseType || 'Закадр'}
                      </span>
                      {project.isOngoing && (
                        <span className="w-2 h-2 rounded-full bg-green-500" title="Онгоинг" />
                      )}
                    </div>
                    <h3 className="text-lg font-bold text-white leading-tight truncate group-hover:text-blue-400 transition-colors">
                      {project.title}
                    </h3>
                    <p className="text-[11px] text-neutral-400 font-medium italic truncate mt-0.5">
                      {project.originalTitle || 'No original title'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Card Body */}
              <div className="p-5 flex-1 flex flex-col justify-between space-y-4 text-left">
                {/* Active Episode Block */}
                {activeEp ? (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-extrabold text-neutral-200">Серия {activeEp.number}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider ${STATUS_COLORS[activeEp.status]}`}>
                          {STATUS_LABELS[activeEp.status]}
                        </span>
                      </div>
                      <span className="text-xs font-bold text-neutral-400">{progress}%</span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-neutral-950 h-2 rounded-full overflow-hidden border border-neutral-800">
                      <div 
                        className={`h-full rounded-full transition-all duration-500 ${
                          activeEp.status === 'FINISHED' ? 'bg-emerald-500' :
                          activeEp.status === 'FIXES' ? 'bg-red-500' :
                          activeEp.status === 'SOUND_ENGINEERING' ? 'bg-purple-500' :
                          'bg-blue-500'
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>

                    {/* Deadline and Assignments info */}
                    <div className="grid grid-cols-2 gap-4 text-xs pt-1">
                      <div className="flex items-center gap-1.5 text-neutral-400">
                        <Calendar className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                        <span className="truncate">
                          Дедлайн: <strong className="text-neutral-300">{formatFullDeadline(activeEp.deadline, activeEp.fixesDeadline)}</strong>
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-neutral-400 justify-end">
                        <Users className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                        <span className="truncate">
                          Сдано: <strong className="text-neutral-300">
                            {activeEp.assignments?.filter(a => a.status === 'APPROVED' || a.status === 'RECORDED').length || 0} / {activeEp.assignments?.length || 0}
                          </strong>
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="py-6 text-center text-xs text-neutral-500 italic bg-neutral-950/30 rounded-xl border border-dashed border-neutral-800">
                    Серии еще не созданы
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex items-center gap-2 pt-2 border-t border-neutral-800 shrink-0" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => onProjectSelect(project.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 text-blue-400" />
                    <span>Войти</span>
                  </button>

                  {activeEp && (
                    <button
                      onClick={(e) => triggerReminder(project, activeEp, e)}
                      className="flex items-center justify-center gap-1 px-3 py-2 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 hover:text-indigo-300 rounded-xl text-xs font-bold transition-colors border border-indigo-500/10 cursor-pointer"
                      title="Сформировать готовое напоминание о дедлайне для отправки в чат"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>Напомнить</span>
                    </button>
                  )}

                  <button
                    onClick={(e) => handleArchiveProject(project, e)}
                    className="p-2 bg-neutral-800/50 hover:bg-red-950/20 text-neutral-500 hover:text-red-400 hover:border-red-900/30 border border-transparent rounded-xl transition-all cursor-pointer"
                    title="Завершить проект и отправить его в архив"
                  >
                    <Archive className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {filteredProjects.length === 0 && (
          <div className="col-span-full py-16 text-center bg-neutral-900/20 border border-dashed border-neutral-800 rounded-3xl space-y-3">
            <FolderOpen className="w-12 h-12 text-neutral-600 mx-auto" />
            <p className="text-neutral-400 text-sm font-medium">Активных проектов по данному запросу не найдено.</p>
            <p className="text-xs text-neutral-500">Начните со создания нового проекта или поиска в верхнем меню.</p>
          </div>
        )}
      </div>

      {/* Services Connectivity Footer Row */}
      <div className="pt-6 border-t border-neutral-900">
        <div className="bg-neutral-900/30 border border-neutral-900/80 rounded-2xl px-6 py-3 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-neutral-500">
          <div className="flex flex-wrap items-center gap-6 justify-center md:justify-start">
            <span className="font-bold uppercase tracking-wider text-[10px] text-neutral-400 flex items-center gap-1.5 shrink-0">
              <Zap className="w-3.5 h-3.5 text-blue-400" />
              Статус сервисов:
            </span>
            {Object.entries(servicesStatus).map(([name, statusData]) => (
              <div key={name} className="flex items-center gap-2" title={statusData.error || `Ответ: ${statusData.latency}мс`}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${statusData.status === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                <span className="text-neutral-400 font-medium">{name}</span>
                {statusData.status === 'online' && (
                  <span className="text-[9px] text-neutral-600 font-mono">({statusData.latency}мс)</span>
                )}
              </div>
            ))}
            {Object.keys(servicesStatus).length === 0 && (
              <span className="italic text-neutral-600">Опрашиваем доступность внешних API...</span>
            )}
          </div>

          <button
            onClick={checkServices}
            disabled={isCheckingServices}
            className="text-[10px] text-neutral-400 hover:text-white flex items-center gap-1.5 font-bold uppercase tracking-wider border border-neutral-800 px-3 py-1.5 rounded-lg hover:bg-neutral-800 transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${isCheckingServices ? 'animate-spin' : ''}`} />
            Обновить API
          </button>
        </div>
      </div>

      {/* Reminder Copy Modal Dialog */}
      {reminderText && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-neutral-900 border border-neutral-800 rounded-3xl w-full max-w-lg p-6 shadow-2xl relative space-y-4">
            <div className="flex justify-between items-center border-b border-neutral-800 pb-3">
              <h3 className="text-md font-bold text-white flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-indigo-400" />
                Напоминание о сдаче серии
              </h3>
              <button 
                onClick={() => setReminderText(null)}
                className="text-neutral-400 hover:text-white text-sm font-bold bg-neutral-800 hover:bg-neutral-700 w-7 h-7 rounded-full flex items-center justify-center transition-colors"
              >
                &times;
              </button>
            </div>

            <div className="text-xs text-neutral-400 leading-relaxed">
              Этот готовый шаблон сформирован автоматически на основе статуса ролей. Скопируйте его для отправки в ваш рабочий Telegram/VK чат.
            </div>

            <div className="bg-neutral-950 rounded-2xl p-4 border border-neutral-800 max-h-64 overflow-y-auto font-sans text-sm text-neutral-200 whitespace-pre-wrap selection:bg-indigo-500/30">
              {reminderText}
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={copyToClipboard}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold transition-colors cursor-pointer"
              >
                {copied ? <Check className="w-4 h-4" /> : <Clipboard className="w-4 h-4" />}
                <span>{copied ? 'Скопировано!' : 'Скопировать в буфер'}</span>
              </button>
              <button
                onClick={() => setReminderText(null)}
                className="px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-xl text-sm font-semibold transition-colors cursor-pointer"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
