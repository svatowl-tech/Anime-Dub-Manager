import { useCallback, useRef } from 'react';
import { ipcSafe } from '../../lib/ipcSafe';
import { Episode, Project } from '../../types';

export const useEpisodeSync = (
  currentEpisode: Episode | null,
  selectedProject: Project | undefined,
  onRefresh: () => void
) => {
  const syncedSignatureRef = useRef<string>('');
  const isSyncingRef = useRef<boolean>(false);
  const currentEpisodeRef = useRef<Episode | null>(currentEpisode);
  currentEpisodeRef.current = currentEpisode;
  const selectedProjectRef = useRef<Project | undefined>(selectedProject);
  selectedProjectRef.current = selectedProject;
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const syncEpisodeWithGlobalMapping = useCallback(async () => {
    const ep = currentEpisodeRef.current;
    const proj = selectedProjectRef.current;
    if (!ep || !proj || isSyncingRef.current) return;
    
    // Create detailed signature including assignments state
    const assignmentsSummary = (ep.assignments || [])
      .map(a => `${a.characterName}:${a.dubberId || ''}:${a.isMain ? 1 : 0}`)
      .join(';');
    const syncSignature = `${ep.id}_${proj.globalMapping || ''}_${assignmentsSummary}`;
    if (syncedSignatureRef.current === syncSignature) {
      return; // Already synced for this exact state
    }

    if (!proj.globalMapping || proj.globalMapping === '[]' || proj.globalMapping === '{}') {
      syncedSignatureRef.current = syncSignature;
      return;
    }

    let globalMapping: any[] = [];
    try {
      const parsed = JSON.parse(proj.globalMapping);
      if (Array.isArray(parsed)) {
        globalMapping = parsed;
      } else if (parsed && typeof parsed === 'object') {
        globalMapping = Object.entries(parsed).map(([k, v]) => ({ characterName: k, dubberId: v as string }));
      }
    } catch (e) {
      console.error("Error parsing global mapping:", e);
      syncedSignatureRef.current = syncSignature;
      return;
    }

    if (globalMapping.length === 0) {
      syncedSignatureRef.current = syncSignature;
      return;
    }

    const existingAssignments = Array.isArray(ep.assignments) ? ep.assignments : [];
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

    // Mark as checked to prevent re-entering while async call is underway
    syncedSignatureRef.current = syncSignature;

    if (hasChanges) {
      isSyncingRef.current = true;
      try {
        await ipcSafe.invoke('save-episode', { 
          ...ep, 
          assignments: updatedAssignments 
        });
        // Also update signature for new state so onRefresh doesn't bounce back
        const newSummary = updatedAssignments
          .map(a => `${a.characterName}:${a.dubberId || ''}:${a.isMain ? 1 : 0}`)
          .join(';');
        syncedSignatureRef.current = `${ep.id}_${proj.globalMapping || ''}_${newSummary}`;
        onRefreshRef.current();
      } catch (error) {
        console.error("Failed to auto-sync episode assignments:", error);
      } finally {
        isSyncingRef.current = false;
      }
    }
  }, []);

  return { syncEpisodeWithGlobalMapping };
};
