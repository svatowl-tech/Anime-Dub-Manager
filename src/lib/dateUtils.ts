import { Project } from '../types';

export const calculateDeadline = (project: Project): string => {
  const now = new Date();
  let daysToAdd = 7; // Default for offgoing (isOngoing === false)

  if (project.isOngoing) {
    if (project.releaseType === 'VOICEOVER') {
      daysToAdd = 2;
    } else if (project.releaseType === 'RECAST' || project.releaseType === 'REDUB') {
      daysToAdd = 3;
    }
  }

  const deadlineDate = new Date(now);
  deadlineDate.setDate(now.getDate() + daysToAdd);
  
  return deadlineDate.toISOString();
};
