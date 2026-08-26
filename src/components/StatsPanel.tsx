import React, { useState, useEffect, useRef } from 'react';
import { 
  Trophy, Award, Clock, Users, TrendingUp, BarChart2, 
  Download, Share2, Shield, Calendar, Film, Play, Headphones, 
  Sparkles, CheckCircle, ChevronDown, ListFilter, Copy, HelpCircle 
} from 'lucide-react';
import { ipcSafe } from '../lib/ipcSafe';
import { Project, Episode, Participant, RoleAssignment, UploadedFile, EpisodeStatus } from '../types';
import { toast } from 'sonner';

interface ParticipantStats {
  id: string;
  nickname: string;
  roles: string[];
  completedAssignments: number;
  totalRecordingTimeMs: number; // For normal recordings
  averageRecordingTimeHours: number;
  recordingCount: number;
  
  totalFixesTimeMs: number; // For fixes
  averageFixesTimeHours: number;
  fixCount: number;
  
  totalLineCount: number;
  onTimeSubmissions: number;
  lateSubmissions: number;
  reliabilityRate: number; // Percentage on-time
}

interface GlobalMetrics {
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  totalEpisodes: number;
  finishedEpisodes: number;
  averageRecordingTimeHours: number;
  overallOnTimeRate: number;
}

interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string; // emoji or key
  badgeColor: string;
  winnerName: string;
  valueText: string;
}

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
    // 1. Filter projects based on selection
    const filteredProjects = projectId === 'all' 
      ? allProjects 
      : allProjects.filter(p => p.id === projectId);

    const episodes: Episode[] = [];
    filteredProjects.forEach(p => {
      if (p.episodes) {
        p.episodes.forEach(ep => {
          episodes.push({ ...ep, project: p });
        });
      }
    });

    const totalPr = filteredProjects.length;
    const activePr = filteredProjects.filter(p => p.status === 'ACTIVE').length;
    const completedPr = filteredProjects.filter(p => p.status === 'COMPLETED').length;
    const totalEp = episodes.length;
    const finishedEp = episodes.filter(e => e.status === 'FINISHED').length;

    // Helper: Find recording start from status history, or estimate it smartly
    const getRecordingStartTime = (episode: Episode): number => {
      if (episode.statusHistory) {
        const recEntry = episode.statusHistory.find(h => h.status === 'RECORDING');
        if (recEntry) return new Date(recEntry.timestamp).getTime();
      }
      
      // Fallback 1: Earliest upload minus 3 days, capped at episode's createdAt
      const epsUploads = episode.uploads || [];
      const dubberUploads = epsUploads.filter(u => u.type === 'DUBBER_FILE');
      if (dubberUploads.length > 0) {
        const minUpload = Math.min(...dubberUploads.map(u => new Date(u.createdAt).getTime()));
        const estimatedStart = minUpload - (3 * 24 * 60 * 60 * 1000); // 3 days earlier
        const createdTime = new Date(episode.createdAt).getTime();
        return Math.max(createdTime, estimatedStart);
      }
      
      // Fallback 2: Episode creation date
      return new Date(episode.createdAt).getTime();
    };

    // Helper: Find fixes start from status history, or estimate it
    const getFixesStartTime = (episode: Episode): number => {
      if (episode.statusHistory) {
        const fixesEntry = episode.statusHistory.find(h => h.status === 'FIXES');
        if (fixesEntry) return new Date(fixesEntry.timestamp).getTime();
      }
      const epsUploads = episode.uploads || [];
      const fixesUploads = epsUploads.filter(u => u.type === 'FIXES');
      if (fixesUploads.length > 0) {
        const minFix = Math.min(...fixesUploads.map(u => new Date(u.createdAt).getTime()));
        return minFix - (1 * 24 * 60 * 60 * 1000); // 1 day earlier
      }
      return new Date(episode.createdAt).getTime() + (5 * 24 * 60 * 60 * 1000); // default fallback
    };

    // Initialize map for dubber stats
    const dubberMap = new Map<string, ParticipantStats>();
    allParticipants.forEach(p => {
      dubberMap.set(p.id, {
        id: p.id,
        nickname: p.nickname,
        roles: p.roles || [],
        completedAssignments: 0,
        totalRecordingTimeMs: 0,
        averageRecordingTimeHours: 0,
        recordingCount: 0,
        totalFixesTimeMs: 0,
        averageFixesTimeHours: 0,
        fixCount: 0,
        totalLineCount: 0,
        onTimeSubmissions: 0,
        lateSubmissions: 0,
        reliabilityRate: 100,
      });
    });

    let totalRecTimeSum = 0;
    let totalRecTimeCount = 0;
    let overallOnTime = 0;
    let overallSubmissions = 0;

    // Process each episode
    episodes.forEach(episode => {
      const uploads = episode.uploads || [];
      
      // Calculate Recording Times for assignments
      const recStart = getRecordingStartTime(episode);
      const fixesStart = getFixesStartTime(episode);
      
      if (episode.assignments && episode.assignments.length > 0) {
        // Group assignments by unique dubberId for this episode
        const dubberGroup = new Map<string, {
          lineCount: number;
          hasCompletedAssignment: boolean;
        }>();

        episode.assignments.forEach(assign => {
          const dubberId = assign.substituteId || assign.dubberId;
          if (!dubberId) return;

          const isCompletedStatus = ['RECORDED', 'APPROVED', 'REJECTED', 'FIXES_NEEDED'].includes(assign.status);
          
          if (!dubberGroup.has(dubberId)) {
            dubberGroup.set(dubberId, {
              lineCount: 0,
              hasCompletedAssignment: false
            });
          }

          const group = dubberGroup.get(dubberId)!;
          if (assign.lineCount) {
            group.lineCount += assign.lineCount;
          }
          if (isCompletedStatus) {
            group.hasCompletedAssignment = true;
          }
        });

        // Now process each unique dubber in this episode exactly once
        dubberGroup.forEach((groupData, dubberId) => {
          const stats = dubberMap.get(dubberId);
          if (!stats) return;

          // Add line count
          stats.totalLineCount += groupData.lineCount;

          // Check if this dubber completed recording for this episode
          // (either has a completed assignment or uploaded a dubber file)
          const hasUploadedFile = uploads.some(u => u.type === 'DUBBER_FILE' && u.uploadedById === dubberId);
          const isUploaded = groupData.hasCompletedAssignment || hasUploadedFile;

          if (isUploaded) {
            stats.completedAssignments += 1;

            // Find earliest upload as the completion timestamp
            const dubberUploads = uploads.filter(u => u.type === 'DUBBER_FILE' && u.uploadedById === dubberId);
            if (dubberUploads.length > 0) {
              const earliestUploadTime = Math.min(...dubberUploads.map(u => new Date(u.createdAt).getTime()));

              // Recording duration
              const durationMs = earliestUploadTime - recStart;
              if (durationMs > 0) {
                stats.totalRecordingTimeMs += durationMs;
                stats.recordingCount += 1;

                totalRecTimeSum += durationMs;
                totalRecTimeCount += 1;
              }

              // On-time check
              if (episode.deadline) {
                const deadlineTime = new Date(episode.deadline).getTime();
                if (earliestUploadTime <= deadlineTime) {
                  stats.onTimeSubmissions += 1;
                  overallOnTime += 1;
                } else {
                  stats.lateSubmissions += 1;
                }
                overallSubmissions += 1;
              }
            }

            // Fixes duration if there were fixes uploaded
            const fixesUploads = uploads.filter(u => u.type === 'FIXES' && u.uploadedById === dubberId);
            if (fixesUploads.length > 0) {
              const earliestFixTime = Math.min(...fixesUploads.map(u => new Date(u.createdAt).getTime()));
              const fixDurationMs = earliestFixTime - fixesStart;
              if (fixDurationMs > 0) {
                stats.totalFixesTimeMs += fixDurationMs;
                stats.fixCount += 1;
              }
            }
          }
        });
      }
    });

    // 2. Format & Finalize stats list
    const finalDubbers = Array.from(dubberMap.values()).map(d => {
      const avgRec = d.recordingCount > 0 ? (d.totalRecordingTimeMs / d.recordingCount) / (1000 * 60 * 60) : 0;
      const avgFix = d.fixCount > 0 ? (d.totalFixesTimeMs / d.fixCount) / (1000 * 60 * 60) : 0;
      const totalSub = d.onTimeSubmissions + d.lateSubmissions;
      const reliability = totalSub > 0 ? Math.round((d.onTimeSubmissions / totalSub) * 100) : 100;

      return {
        ...d,
        averageRecordingTimeHours: Number(avgRec.toFixed(1)),
        averageFixesTimeHours: Number(avgFix.toFixed(1)),
        reliabilityRate: reliability
      };
    }).filter(d => d.completedAssignments > 0 || d.totalLineCount > 0)
      .sort((a, b) => b.completedAssignments - a.completedAssignments);

    // Global counts
    const avgRecordingGlobal = totalRecTimeCount > 0 ? (totalRecTimeSum / totalRecTimeCount) / (1000 * 60 * 60) : 0;
    const globalOnTimeRate = overallSubmissions > 0 ? Math.round((overallOnTime / overallSubmissions) * 100) : 100;

    setGlobalMetrics({
      totalProjects: totalPr,
      activeProjects: activePr,
      completedProjects: completedPr,
      totalEpisodes: totalEp,
      finishedEpisodes: finishedEp,
      averageRecordingTimeHours: Number(avgRecordingGlobal.toFixed(1)),
      overallOnTimeRate: globalOnTimeRate
    });

    setDubberStats(finalDubbers);

    // 3. Achievements Calculation
    const calculatedAchievements: Achievement[] = [];

    // Speedy badge
    const speedyDubbers = [...finalDubbers]
      .filter(d => d.recordingCount >= 1 && d.averageRecordingTimeHours > 0)
      .sort((a, b) => a.averageRecordingTimeHours - b.averageRecordingTimeHours);
    if (speedyDubbers.length > 0) {
      calculatedAchievements.push({
        id: 'speedy',
        title: 'Шустрый микрофон ⚡',
        description: 'Самая быстрая запись озвучки в среднем на серию',
        icon: '⚡',
        badgeColor: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400',
        winnerName: speedyDubbers[0].nickname,
        valueText: `~${speedyDubbers[0].averageRecordingTimeHours} ч`
      });
    }

    // Reliability star
    const onTimeDubbers = [...finalDubbers]
      .filter(d => (d.onTimeSubmissions + d.lateSubmissions) >= 2)
      .sort((a, b) => b.reliabilityRate - a.reliabilityRate || b.onTimeSubmissions - a.onTimeSubmissions);
    if (onTimeDubbers.length > 0 && onTimeDubbers[0].reliabilityRate > 50) {
      calculatedAchievements.push({
        id: 'discipline',
        title: 'Железная дисциплина 📅',
        description: 'Рекордное соблюдение дедлайнов (сдано вовремя)',
        icon: '📅',
        badgeColor: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
        winnerName: onTimeDubbers[0].nickname,
        valueText: `${onTimeDubbers[0].reliabilityRate}% (${onTimeDubbers[0].onTimeSubmissions} серий)`
      });
    }

    // Lyrical legend
    const lyricalDubbers = [...finalDubbers]
      .sort((a, b) => b.totalLineCount - a.totalLineCount);
    if (lyricalDubbers.length > 0 && lyricalDubbers[0].totalLineCount > 0) {
      calculatedAchievements.push({
        id: 'legend',
        title: 'Легенда текста 🎙️',
        description: 'Лидер по озвученным репликам субтитров',
        icon: '🎙️',
        badgeColor: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-400',
        winnerName: lyricalDubbers[0].nickname,
        valueText: `${lyricalDubbers[0].totalLineCount} строк`
      });
    }

    // Veteran
    const veteranDubbers = [...finalDubbers]
      .sort((a, b) => b.completedAssignments - a.completedAssignments);
    if (veteranDubbers.length > 0 && veteranDubbers[0].completedAssignments >= 2) {
      calculatedAchievements.push({
        id: 'veteran',
        title: 'Ветеран Озвучки 🏆',
        description: 'Наибольшее число озвученных и сданных серий',
        icon: '🏆',
        badgeColor: 'border-amber-500/30 bg-amber-500/10 text-amber-500',
        winnerName: veteranDubbers[0].nickname,
        valueText: `${veteranDubbers[0].completedAssignments} серий`
      });
    }

    // Chronic laggard (only if they actually have late submissions)
    const lateDubbers = [...finalDubbers]
      .filter(d => d.lateSubmissions > 0)
      .sort((a, b) => b.lateSubmissions - a.lateSubmissions || b.averageRecordingTimeHours - a.averageRecordingTimeHours);
    if (lateDubbers.length > 0) {
      calculatedAchievements.push({
        id: 'slow',
        title: 'Философский темп 🐢',
        description: 'Долго запрягает, но озвучивает с чувством',
        icon: '🐢',
        badgeColor: 'border-rose-500/30 bg-rose-500/10 text-rose-400',
        winnerName: lateDubbers[0].nickname,
        valueText: `${lateDubbers[0].lateSubmissions} опозданий`
      });
    }

    setAchievements(calculatedAchievements);
  };

  const handleProjectFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedProjectId(val);
    calculateStatistics(projects, participants, val);
  };

  const copyStatsToClipboard = () => {
    let text = `📊 **СТАТИСТИКА КОМАНДЫ ДАББИНГА** 📊\n`;
    text += `─────────────────────────\n`;
    text += `📁 Проект: ${selectedProjectId === 'all' ? 'Все тайтлы' : projects.find(p => p.id === selectedProjectId)?.title || 'Выбранный проект'}\n`;
    text += `🎬 Выпущено серий: ${globalMetrics.finishedEpisodes} из ${globalMetrics.totalEpisodes}\n`;
    text += `⏱️ Средняя запись серии: ${globalMetrics.averageRecordingTimeHours} ч\n`;
    text += `🎯 Точность дедлайнов: ${globalMetrics.overallOnTimeRate}%\n\n`;
    
    text += `🏆 **ВЫПУСКНЫЕ АЧИВКИ КОМАНДЫ**:\n`;
    achievements.forEach(a => {
      text += `• ${a.title} -> ${a.winnerName} (${a.valueText}) - ${a.description}\n`;
    });

    if (dubberStats.length > 0) {
      text += `\n🎙️ **РЕЙТИНГ ДАББЕРОВ (По сданным сериям)**:\n`;
      dubberStats.slice(0, 5).forEach((d, idx) => {
        text += `${idx + 1}. **${d.nickname}**: ${d.completedAssignments} серий (реплик: ${d.totalLineCount}, среднее время: ${d.averageRecordingTimeHours} ч, вовремя: ${d.reliabilityRate}%)\n`;
      });
    }

    text += `─────────────────────────\n`;
    text += `Сгенерировано в Anime Dub Manager 🎙️✨`;

    navigator.clipboard.writeText(text);
    toast.success('Красивая текстовая статистика скопирована в буфер обмена!');
  };

  const downloadStatsImage = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw stylish card image
    canvas.width = 800;
    canvas.height = 700;

    // Background Gradient (Dark slate cosmic theme)
    const grad = ctx.createLinearGradient(0, 0, 0, 700);
    grad.addColorStop(0, '#0a0a0c');
    grad.addColorStop(1, '#111116');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 800, 700);

    // Grid details / tech accents
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 800; i += 40) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 700);
      ctx.stroke();
    }
    for (let i = 0; i < 700; i += 40) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(800, i);
      ctx.stroke();
    }

    // Outer border glowing effect
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, 780, 680);

    // Decorative Header Logo/Text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText('ANIME DUB STUDIO', 40, 60);

    ctx.fillStyle = '#3b82f6';
    ctx.font = 'bold 15px monospace';
    ctx.fillText('// ТЕХНИЧЕСКАЯ СТАТИСТИКА КОМАНДЫ', 40, 85);

    // Project Name
    const pTitle = selectedProjectId === 'all' 
      ? 'Все активные тайтлы команды' 
      : projects.find(p => p.id === selectedProjectId)?.title || 'Проект';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '16px sans-serif';
    ctx.fillText(`Проект: ${pTitle}`, 40, 120);

    // Stats Grid Layout
    const cardBg = 'rgba(25, 25, 35, 0.6)';
    const cardBorder = 'rgba(255, 255, 255, 0.08)';

    // Function to draw small rounded stats box
    const drawStatBox = (x: number, y: number, w: number, h: number, title: string, value: string, sub: string) => {
      ctx.fillStyle = cardBg;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = cardBorder;
      ctx.strokeRect(x, y, w, h);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '11px sans-serif';
      ctx.fillText(title, x + 15, y + 25);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px monospace';
      ctx.fillText(value, x + 15, y + 55);

      ctx.fillStyle = '#3b82f6';
      ctx.font = '10px monospace';
      ctx.fillText(sub, x + 15, y + 75);
    };

    drawStatBox(40, 150, 224, 90, 'ВЫПУЩЕННЫХ СЕРИЙ', `${globalMetrics.finishedEpisodes}/${globalMetrics.totalEpisodes}`, 'FINISHED EPS');
    drawStatBox(288, 150, 224, 90, 'СРЕДНЯЯ ЗАПИСЬ', `${globalMetrics.averageRecordingTimeHours} ч`, 'RECORDING TIME');
    drawStatBox(536, 150, 224, 90, 'ТОЧНОСТЬ СДАЧИ', `${globalMetrics.overallOnTimeRate}%`, 'ON DEADLINE');

    // Title: Achievements
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('🏆 ГЛАВНЫЕ ДОСТИЖЕНИЯ СЕЗОНА', 40, 280);

    // Draw Achievements Cards
    let achY = 300;
    achievements.slice(0, 4).forEach((ach, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      
      const x = 40 + col * 365;
      const y = 300 + row * 90;

      // Card Box
      ctx.fillStyle = 'rgba(30, 41, 59, 0.4)';
      ctx.fillRect(x, y, 350, 75);
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.2)';
      ctx.strokeRect(x, y, 350, 75);

      // Icon placeholder
      ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
      ctx.fillRect(x + 10, y + 10, 55, 55);

      ctx.fillStyle = '#ffffff';
      ctx.font = '28px sans-serif';
      ctx.fillText(ach.icon.substring(0, 2), x + 23, y + 48);

      // Texts
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText(ach.title, x + 80, y + 25);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '11px sans-serif';
      ctx.fillText(ach.description, x + 80, y + 42);

      // Winner
      ctx.fillStyle = '#60a5fa';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`Победитель: ${ach.winnerName} (${ach.valueText})`, x + 80, y + 60);
    });

    // Leaderboard Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('🎙️ ТОП-3 ДАББЕРОВ ТАЙТЛА', 40, 510);

    // Draw top 3 recorders
    let leadY = 540;
    dubberStats.slice(0, 3).forEach((d, idx) => {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.5)';
      ctx.fillRect(40, leadY, 720, 40);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.strokeRect(40, leadY, 720, 40);

      // Color based on rank
      const colors = ['#f59e0b', '#cbd5e1', '#b45309'];
      ctx.fillStyle = colors[idx] || '#ffffff';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(`#${idx + 1}`, 55, leadY + 25);

      ctx.fillStyle = '#f8fafc';
      ctx.fillText(d.nickname, 100, leadY + 25);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px sans-serif';
      ctx.fillText(`Сдано серий: ${d.completedAssignments}`, 260, leadY + 25);
      ctx.fillText(` строк: ${d.totalLineCount}`, 400, leadY + 25);
      ctx.fillText(`Ср. запись: ${d.averageRecordingTimeHours} ч`, 535, leadY + 25);

      // Reliability rate percentage
      ctx.fillStyle = d.reliabilityRate >= 80 ? '#10b981' : d.reliabilityRate >= 50 ? '#f59e0b' : '#ef4444';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`ОК: ${d.reliabilityRate}%`, 690, leadY + 25);

      leadY += 48;
    });

    // Footer
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.font = '9px monospace';
    ctx.fillText('СГЕНЕРИРОВАНО В СИСТЕМЕ ANIME DUB MANAGER // ДАТА: ' + new Date().toLocaleDateString('ru-RU'), 40, 675);

    // Convert to image URI and download
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `anime-dub-stats-${selectedProjectId}.png`;
    link.href = dataUrl;
    link.click();
    
    toast.success('Изображение статистики успешно сгенерировано и скачано!');
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
