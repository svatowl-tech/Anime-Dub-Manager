import React, { useState, useEffect, useRef } from 'react';
import { 
  Trophy, Clock, Users, BarChart2, 
  Download, Film, Sparkles, CheckCircle, ListFilter, Copy, HelpCircle 
} from 'lucide-react';
import { ipcSafe } from '../lib/ipcSafe';
import { Project, Participant } from '../types';
import { toast } from 'sonner';
import { safeCopyToClipboard } from '../lib/clipboard';
import {
  ParticipantStats,
  GlobalMetrics,
  Achievement,
  calculateStudioStatistics,
  formatStatsClipboardText,
  renderStatsCanvasAndDownload
} from './stats/statsEngineAndCanvasExport.service';

export {
  type ParticipantStats,
  type GlobalMetrics,
  type Achievement,
  calculateStudioStatistics,
  formatStatsClipboardText,
  renderStatsCanvasAndDownload
};

export const StatsPanel: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('all');
  const [loading, setLoading] = useState<boolean>(true);
  
  const [globalMetrics, setGlobalMetrics] = useState<GlobalMetrics>({
    totalProjects: 0,
    activeProjects: 0,
    completedProjects: 0,
    totalEpisodes: 0,
    finishedEpisodes: 0,
    averageRecordingTimeHours: 0,
    overallOnTimeRate: 0,
  });

  const [dubberStats, setDubberStats] = useState<ParticipantStats[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const projectsData = await ipcSafe.invoke('get-projects') || [];
      const participantsData = await ipcSafe.invoke('get-participants') || [];
      setProjects(projectsData);
      setParticipants(participantsData);
      
      calculateStatistics(projectsData, participantsData, 'all');
    } catch (error) {
      console.error('Failed to load statistics data:', error);
      toast.error('Не удалось загрузить данные для статистики');
    } finally {
      setLoading(false);
    }
  };

  const calculateStatistics = (
    allProjects: Project[], 
    allParticipants: Participant[], 
    projectId: string
  ) => {
    const result = calculateStudioStatistics(allProjects, allParticipants, projectId);
    setGlobalMetrics(result.globalMetrics);
    setDubberStats(result.dubberStats);
    setAchievements(result.achievements);
  };

  const handleProjectFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedProjectId(val);
    calculateStatistics(projects, participants, val);
  };

  const copyStatsToClipboard = async () => {
    const text = formatStatsClipboardText(
      selectedProjectId,
      projects,
      globalMetrics,
      achievements,
      dubberStats
    );
    await safeCopyToClipboard(text);
    toast.success('Красивая текстовая статистика скопирована в буфер обмена!');
  };

  const downloadStatsImage = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ok = renderStatsCanvasAndDownload(
      canvas,
      selectedProjectId,
      projects,
      globalMetrics,
      achievements,
      dubberStats
    );
    if (ok) {
      toast.success('Изображение статистики успешно сгенерировано и скачано!');
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 bg-neutral-950">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4" />
        <span className="text-neutral-400 font-medium font-mono text-sm">АНАЛИЗ И СБОР МЕТРИК ТАЙТЛОВ...</span>
      </div>
    );
  }

  return (
    <div className="flex-1 p-8 space-y-8 bg-neutral-950">
      
      {/* Header section with Filter */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-neutral-800 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <BarChart2 className="w-5 h-5 text-blue-400" />
            <span className="text-xs font-bold text-blue-400 uppercase tracking-widest font-mono">// dub studio stats</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-2">
            Интеллектуальная Аналитика <Sparkles className="w-6 h-6 text-yellow-400 animate-pulse" />
          </h1>
          <p className="text-neutral-400 text-sm mt-1">
            Учет времени озвучки, сдачи правок и сведения звука с выдачей ачивок.
          </p>
        </div>

        {/* Project Select and Action Buttons */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1.5">
            <ListFilter className="w-4 h-4 text-neutral-500" />
            <select 
              value={selectedProjectId} 
              onChange={handleProjectFilterChange}
              className="bg-transparent border-none text-sm text-neutral-300 focus:outline-none cursor-pointer pr-4 font-medium"
            >
              <option value="all" className="bg-neutral-900">⚡ Все релизы</option>
              {projects.map(p => (
                <option key={p.id} value={p.id} className="bg-neutral-900">
                  {p.emoji || '🎬'} {p.title}
                </option>
              ))}
            </select>
          </div>

          <button 
            onClick={copyStatsToClipboard}
            className="flex items-center gap-2 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 px-4 py-2 rounded-lg text-sm transition-colors border border-neutral-800 font-medium"
            title="Скопировать красивое текстовое сообщение для мессенджеров"
          >
            <Copy className="w-4 h-4 text-indigo-400" />
            <span>Скопировать</span>
          </button>

          <button 
            onClick={downloadStatsImage}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm transition-all font-semibold shadow-lg shadow-blue-500/10"
            title="Скачать статистику в виде красивой карточки-картинки"
          >
            <Download className="w-4 h-4" />
            <span>Экспорт в PNG</span>
          </button>
        </div>
      </div>

      {/* Hidden canvas for image generation */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Info Warning card about historical metrics */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex items-start gap-3">
        <HelpCircle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
        <div className="text-sm">
          <span className="font-semibold text-blue-300">Аналитический алгоритм:</span> для старых эпизодов статистика вычисляется на основе дат загруженных файлов, комментариев и редактирования. Для всех новых серий после обновления будет вестись непрерывное посекундное логирование переходов статусов в бэкенде.
        </div>
      </div>

      {/* Grid of Global Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 relative overflow-hidden group hover:border-neutral-700 transition-all">
          <div className="absolute right-4 bottom-4 opacity-5 text-neutral-100 group-hover:scale-110 transition-transform">
            <Film className="w-20 h-20" />
          </div>
          <span className="text-xs uppercase font-mono text-neutral-500 block mb-1">Выпущено Серий</span>
          <span className="text-3xl font-extrabold text-white block font-mono">
            {globalMetrics.finishedEpisodes} <span className="text-neutral-500 text-lg">/ {globalMetrics.totalEpisodes}</span>
          </span>
          <p className="text-xs text-neutral-400 mt-2">
            Выполнение объема работ: {globalMetrics.totalEpisodes > 0 ? Math.round((globalMetrics.finishedEpisodes / globalMetrics.totalEpisodes) * 100) : 0}%
          </p>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 relative overflow-hidden group hover:border-neutral-700 transition-all">
          <div className="absolute right-4 bottom-4 opacity-5 text-neutral-100 group-hover:scale-110 transition-transform">
            <Clock className="w-20 h-20" />
          </div>
          <span className="text-xs uppercase font-mono text-neutral-500 block mb-1">Ср. Запись Серии</span>
          <span className="text-3xl font-extrabold text-emerald-400 block font-mono">
            ~{globalMetrics.averageRecordingTimeHours} <span className="text-neutral-500 text-lg">часов</span>
          </span>
          <p className="text-xs text-neutral-400 mt-2">
            От старта записи до готовых звуковых дорожек дабберов
          </p>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 relative overflow-hidden group hover:border-neutral-700 transition-all">
          <div className="absolute right-4 bottom-4 opacity-5 text-neutral-100 group-hover:scale-110 transition-transform">
            <CheckCircle className="w-20 h-20" />
          </div>
          <span className="text-xs uppercase font-mono text-neutral-500 block mb-1">Точность Дедлайнов</span>
          <span className="text-3xl font-extrabold text-yellow-400 block font-mono">
            {globalMetrics.overallOnTimeRate}%
          </span>
          <p className="text-xs text-neutral-400 mt-2">
            Сдача озвучки до истечения таймера ограничения
          </p>
        </div>
      </div>

      {/* Row for Achievements */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Trophy className="w-5 h-5 text-yellow-500" />
          <h2 className="text-xl font-bold text-white tracking-tight">Заслужили ачивки сезона</h2>
          <span className="text-xs font-semibold text-neutral-500 font-mono">({achievements.length} медалей)</span>
        </div>

        {achievements.length === 0 ? (
          <div className="bg-neutral-900 border border-neutral-800 p-8 rounded-xl text-center text-neutral-450">
            Для выдачи наград необходимо накопить больше завершенных серий со сданными дорожками.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {achievements.map(ach => (
              <div 
                key={ach.id} 
                className={`border rounded-xl p-5 relative overflow-hidden flex flex-col justify-between transition-all hover:scale-[1.02] ${ach.badgeColor}`}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-3xl">{ach.icon}</span>
                    <span className="text-xs font-mono font-bold bg-neutral-950/45 px-2 py-0.5 rounded border border-white/5 uppercase select-none">badge</span>
                  </div>
                  <h3 className="text-base font-bold text-white tracking-tight mb-1">{ach.title}</h3>
                  <p className="text-xs text-neutral-300 leading-relaxed mb-4">{ach.description}</p>
                </div>
                
                <div className="border-t border-white/5 pt-3 flex items-center justify-between">
                  <span className="text-xs text-neutral-400">Обладатель:</span>
                  <span className="text-sm font-extrabold text-white bg-black/30 px-2.5 py-1 rounded font-mono border border-white/5 truncate max-w-[170px]" title={ach.winnerName}>
                    {ach.winnerName} <span className="text-xs text-blue-300 font-normal ml-1">({ach.valueText})</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rating List & Leaderboards */}
      <div className="w-full">
        
        {/* Dubbers Rating */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 w-full flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-neutral-800 pb-4 mb-4">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-white text-base">Таблица лидеров дабберов</h3>
              </div>
              <span className="text-xs font-mono text-neutral-500">Минимум 1 сдача</span>
            </div>

            {dubberStats.length === 0 ? (
              <div className="text-neutral-500 text-sm py-8 text-center">Озвученных реплик или сданных дорожек пока нет.</div>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                {dubberStats.map((d, index) => (
                  <div key={d.id} className="bg-neutral-950 border border-neutral-850 hover:border-neutral-750 transition-colors p-3.5 rounded-lg flex flex-wrap md:flex-nowrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        index === 0 ? 'bg-yellow-500 text-black' :
                        index === 1 ? 'bg-neutral-300 text-black' :
                        index === 2 ? 'bg-amber-700 text-white' : 'bg-neutral-850 text-neutral-400'
                      }`}>
                        {index + 1}
                      </span>
                      <div>
                        <span className="font-bold text-neutral-100 block max-w-[130px] md:max-w-none truncate">{d.nickname}</span>
                        <span className="text-[10px] text-neutral-500 font-medium tracking-wide uppercase">{d.roles.slice(0, 2).join(', ') || 'Даббер'}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-6 text-sm shrink-0">
                      <div className="text-center">
                        <span className="text-[10px] block uppercase text-neutral-500 font-mono mb-0.5">СЕРИЙ</span>
                        <span className="font-bold font-mono text-neutral-200">{d.completedAssignments}</span>
                      </div>
                      <div className="text-center">
                        <span className="text-[10px] block uppercase text-neutral-500 font-mono mb-0.5">РЕПЛИКИ</span>
                        <span className="font-bold font-mono text-neutral-200">{d.totalLineCount}</span>
                      </div>
                      <div className="text-center">
                        <span className="text-[10px] block uppercase text-neutral-500 font-mono mb-0.5">ВРЕМЯ ЗАПИСИ (СР)</span>
                        <span className="font-semibold font-mono text-neutral-300">
                           {d.averageRecordingTimeHours > 0 ? `${d.averageRecordingTimeHours} ч` : '—'}
                        </span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-[10px] block uppercase text-neutral-500 font-mono mb-1">вовремя</span>
                      <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                        d.reliabilityRate >= 80 ? 'bg-emerald-500/10 text-emerald-400' :
                        d.reliabilityRate >= 50 ? 'bg-yellow-500/10 text-yellow-400' :
                        'bg-rose-500/10 text-rose-400'
                      }`}>
                        {d.reliabilityRate}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="mt-4 pt-4 border-t border-neutral-800 text-xs text-neutral-400 flex items-center gap-1.5 font-sans">
            <span>💡</span> <span>Количество реплик подтягивается из закреплений ролей в субтитрах (.ASS).</span>
          </div>
        </div>

      </div>

    </div>
  );
};
