import { Project } from '../types';

export const getDefaultDaysForProject = (project?: Project | null): number => {
  if (!project) return 7;
  if (typeof project.defaultEpisodeDeadlineDays === 'number' && !isNaN(project.defaultEpisodeDeadlineDays) && project.defaultEpisodeDeadlineDays > 0) {
    return project.defaultEpisodeDeadlineDays;
  }
  if (project.isOngoing) {
    if (project.releaseType === 'VOICEOVER') {
      return 2;
    } else if (project.releaseType === 'RECAST' || project.releaseType === 'REDUB') {
      return 3;
    }
  }
  return 7;
};

export const getDefaultHourForProject = (project?: Project | null): number => {
  if (project && typeof project.defaultEpisodeDeadlineHour === 'number' && !isNaN(project.defaultEpisodeDeadlineHour)) {
    return Math.max(0, Math.min(23, project.defaultEpisodeDeadlineHour));
  }
  return 20; // Default 20:00
};

export const calculateDeadline = (project: Project, baseDate: Date = new Date()): string => {
  const daysToAdd = getDefaultDaysForProject(project);
  const targetHour = getDefaultHourForProject(project);
  const targetMinute = typeof project?.defaultEpisodeDeadlineMinute === 'number' ? project.defaultEpisodeDeadlineMinute : 0;

  const deadlineDate = new Date(baseDate);
  deadlineDate.setDate(deadlineDate.getDate() + daysToAdd);
  deadlineDate.setHours(targetHour, targetMinute, 0, 0);
  
  return deadlineDate.toISOString();
};
