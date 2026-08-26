import { useCallback } from 'react';
import { ipcSafe } from '../../lib/ipcSafe';
import { Episode, Project } from '../../types';
import { SIGN_KEYWORDS } from '../../constants';

export const useEpisodeSync = (
  currentEpisode: Episode | null,
  selectedProject: Project | undefined,
  onRefresh: () => void
) => {
  const syncEpisodeWithGlobalMapping = useCallback(async () => {
    if (!currentEpisode || !selectedProject) return;
    
    let globalMapping: any[] = [];
    try {
      const parsed = JSON.parse(selectedProject.globalMapping || '[]');
      if (Array.isArray(parsed)) {
        globalMapping = parsed;
      } else if (parsed && typeof parsed === 'object') {
        globalMapping = Object.entries(parsed).map(([k, v]) => ({ characterName: k, dubberId: v as string }));
      }
    } catch (e) {
      console.error("Error parsing global mapping:", e);
      return;
    }

    if (globalMapping.length === 0) return;

    const existingAssignments = Array.isArray(currentEpisode.assignments) ? currentEpisode.assignments : [];
    const updatedAssignments = [...existingAssignments];
    let hasChanges = false;

    const assignedDubbersPerCharacter: Record<string, Set<string>> = {};
    updatedAssignments.forEach(a => {
      if (a.dubberId) {
        if (!assignedDubbersPerCharacter[a.characterName]) {
          assignedDubbersPerCharacter[a.characterName] = new Set();
        }
        assignedDubbersPerCharacter[a.characterName].add(a.dubberId);
      }
    });

    updatedAssignments.forEach((as, idx) => {
      const mappings = globalMapping.filter(m => m.characterName === as.characterName && m.dubberId);
      const assignedSet = assignedDubbersPerCharacter[as.characterName] || new Set();
      
      // Sync dubber if not assigned
      if (!as.dubberId) {
        const availableMapping = mappings.find(m => !assignedSet.has(m.dubberId));
        
        if (availableMapping) {
          updatedAssignments[idx] = { 
            ...as, 
            dubberId: availableMapping.dubberId,
            isMain: availableMapping.isMain !== undefined ? availableMapping.isMain : as.isMain
          };
          assignedSet.add(availableMapping.dubberId);
          assignedDubbersPerCharacter[as.characterName] = assignedSet;
          hasChanges = true;
        }
      } else {
        // Even if assigned, sync isMain status from global mapping if available
        const mapping = mappings.find(m => m.dubberId === as.dubberId);
        if (mapping && mapping.isMain !== undefined && mapping.isMain !== as.isMain) {
          updatedAssignments[idx] = { ...as, isMain: mapping.isMain };
          hasChanges = true;
        }
      }
    });

    // REMOVED: Adding all characters from global mapping to every episode.
    // This was causing "all roles ever assigned" to show up in every episode.
    // We only want to sync dubbers for characters that are actually in this episode.

    if (hasChanges) {
      try {
        await ipcSafe.invoke('save-episode', { 
          ...currentEpisode, 
          assignments: updatedAssignments 
        });
        onRefresh();
      } catch (error) {
        console.error("Failed to auto-sync episode assignments:", error);
      }
    }
  }, [currentEpisode, selectedProject?.globalMapping, onRefresh]);

  return { syncEpisodeWithGlobalMapping };
};
