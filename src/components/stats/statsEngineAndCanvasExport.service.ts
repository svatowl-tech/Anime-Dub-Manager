import { Project, Episode, Participant } from '../../types';

export interface ParticipantStats {
  id: string;
  nickname: string;
  roles: string[];
  completedAssignments: number;
  totalRecordingTimeMs: number;
  averageRecordingTimeHours: number;
  recordingCount: number;
  
  totalFixesTimeMs: number;
  averageFixesTimeHours: number;
  fixCount: number;
  
  totalLineCount: number;
  onTimeSubmissions: number;
  lateSubmissions: number;
  reliabilityRate: number;
}

export interface GlobalMetrics {
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  totalEpisodes: number;
  finishedEpisodes: number;
  averageRecordingTimeHours: number;
  overallOnTimeRate: number;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  badgeColor: string;
  winnerName: string;
  valueText: string;
}

export function calculateStudioStatistics(
  allProjects: Project[],
  allParticipants: Participant[],
  projectId: string
): {
  globalMetrics: GlobalMetrics;
  dubberStats: ParticipantStats[];
  achievements: Achievement[];
} {
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
      const estimatedStart = minUpload - (3 * 24 * 60 * 60 * 1000);
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
      return minFix - (1 * 24 * 60 * 60 * 1000);
    }
    return new Date(episode.createdAt).getTime() + (5 * 24 * 60 * 60 * 1000);
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
    
    const recStart = getRecordingStartTime(episode);
    const fixesStart = getFixesStartTime(episode);
    
    if (episode.assignments && episode.assignments.length > 0) {
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

      dubberGroup.forEach((groupData, dubberId) => {
        const stats = dubberMap.get(dubberId);
        if (!stats) return;

        stats.totalLineCount += groupData.lineCount;

        const hasUploadedFile = uploads.some(u => u.type === 'DUBBER_FILE' && u.uploadedById === dubberId);
        const isUploaded = groupData.hasCompletedAssignment || hasUploadedFile;

        if (isUploaded) {
          stats.completedAssignments += 1;

          const dubberUploads = uploads.filter(u => u.type === 'DUBBER_FILE' && u.uploadedById === dubberId);
          if (dubberUploads.length > 0) {
            const earliestUploadTime = Math.min(...dubberUploads.map(u => new Date(u.createdAt).getTime()));

            const durationMs = earliestUploadTime - recStart;
            if (durationMs > 0) {
              stats.totalRecordingTimeMs += durationMs;
              stats.recordingCount += 1;

              totalRecTimeSum += durationMs;
              totalRecTimeCount += 1;
            }

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

  const globalMetrics: GlobalMetrics = {
    totalProjects: totalPr,
    activeProjects: activePr,
    completedProjects: completedPr,
    totalEpisodes: totalEp,
    finishedEpisodes: finishedEp,
    averageRecordingTimeHours: Number(avgRecordingGlobal.toFixed(1)),
    overallOnTimeRate: globalOnTimeRate
  };

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

  // Chronic laggard
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

  return {
    globalMetrics,
    dubberStats: finalDubbers,
    achievements: calculatedAchievements
  };
}

export function formatStatsClipboardText(
  selectedProjectId: string,
  projects: Project[],
  globalMetrics: GlobalMetrics,
  achievements: Achievement[],
  dubberStats: ParticipantStats[]
): string {
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
  return text;
}

export function renderStatsCanvasAndDownload(
  canvas: HTMLCanvasElement,
  selectedProjectId: string,
  projects: Project[],
  globalMetrics: GlobalMetrics,
  achievements: Achievement[],
  dubberStats: ParticipantStats[]
): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

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
  achievements.slice(0, 4).forEach((ach, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    
    const x = 40 + col * 365;
    const y = 300 + row * 90;

    ctx.fillStyle = 'rgba(30, 41, 59, 0.4)';
    ctx.fillRect(x, y, 350, 75);
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.2)';
    ctx.strokeRect(x, y, 350, 75);

    ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
    ctx.fillRect(x + 10, y + 10, 55, 55);

    ctx.fillStyle = '#ffffff';
    ctx.font = '28px sans-serif';
    ctx.fillText(ach.icon.substring(0, 2), x + 23, y + 48);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(ach.title, x + 80, y + 25);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px sans-serif';
    ctx.fillText(ach.description, x + 80, y + 42);

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

    ctx.fillStyle = d.reliabilityRate >= 80 ? '#10b981' : d.reliabilityRate >= 50 ? '#f59e0b' : '#ef4444';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(`ОК: ${d.reliabilityRate}%`, 690, leadY + 25);

    leadY += 48;
  });

  // Footer
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.font = '9px monospace';
  ctx.fillText('СГЕНЕРИРОВАНО В СИСТЕМЕ ANIME DUB MANAGER // ДАТА: ' + new Date().toLocaleDateString('ru-RU'), 40, 675);

  const dataUrl = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.download = `anime-dub-stats-${selectedProjectId}.png`;
  link.href = dataUrl;
  link.click();

  return true;
}
