import { useEffect } from 'react';
import { Project } from '../types';
import { getAnimeDetails, getAnimeCharacters } from '../services/animeService';
import { ipcSafe } from '../lib/ipcSafe';

export function useProjectAutoUpdate(selectedProject: Project | null, onRefresh: () => void) {
  useEffect(() => {
    if (!selectedProject) return;

    // Background update
    const updateProject = async () => {
      let sourceId: number | null = null;
      let source: string = 'shikimori';

      // Prefer ID from links if exists
      if (selectedProject.links) {
        try {
          const links = JSON.parse(selectedProject.links);
          if (links.shikimori) {
            const match = links.shikimori.match(/\/animes\/(\d+)/);
            if (match) sourceId = parseInt(match[1]);
          }
        } catch (e) {}
      }

      if (!sourceId) return; // No source to sync from

      try {
        // 1. Update Project Details
        const details = await getAnimeDetails(sourceId, source);
        if (details) {
          let hasChanges = false;
          const updatedProject = { ...selectedProject };

          if (details.description && details.description !== selectedProject.synopsis) {
            updatedProject.synopsis = details.description;
            hasChanges = true;
          }
          if (details.episodes && details.episodes !== selectedProject.totalEpisodes) {
            updatedProject.totalEpisodes = details.episodes;
            hasChanges = true;
          }
          if (details.aired_episodes !== undefined && details.aired_episodes !== selectedProject.airedEpisodes) {
            updatedProject.airedEpisodes = details.aired_episodes;
            hasChanges = true;
          }
          if (details.image && details.image !== selectedProject.posterUrl) {
            updatedProject.posterUrl = details.image;
            hasChanges = true;
          }
          if (details.type && details.type !== selectedProject.typeAndSeason) {
            updatedProject.typeAndSeason = details.type;
            hasChanges = true;
          }

          if (hasChanges) {
            console.log(`[AutoUpdate] Found project metadata changes, saving...`);
            await ipcSafe.invoke('save-project', updatedProject);
            // We don't refresh yet, wait for characters
          }
        }

        // 2. Update Characters
        const apiChars = await getAnimeCharacters(sourceId, source);
        if (apiChars && apiChars.length > 0) {
          const project = await ipcSafe.invoke('get-project', selectedProject.id); // Get fresh state
          if (!project) {
            console.error('[AutoUpdate] Failed to get fresh project state');
            return;
          }
          let currentMapping: any[] = [];
          try {
             currentMapping = JSON.parse(project.globalMapping || '[]');
          } catch(e) {}

          let mappingChanged = false;
          const newMapping = [...currentMapping];

          const normalizeName = (name: string) => name.trim().toLowerCase().replace(/[^a-zа-я0-9]/g, '');

          for (const apiChar of apiChars) {
            const apiNameNorm = normalizeName(apiChar.name);
            const apiOrigNorm = normalizeName(apiChar.original_name || '');
            
            // Find existing character by name or original name
            const existingIdx = newMapping.findIndex(m => {
              const mNameNorm = normalizeName(m.characterName);
              const mOrigNorm = normalizeName(m.original_name || '');
              return mNameNorm === apiNameNorm || 
                     mOrigNorm === apiOrigNorm || 
                     mNameNorm === apiOrigNorm || 
                     mOrigNorm === apiNameNorm;
            });

            if (existingIdx !== -1) {
              // Update existing character
              let itemUpdated = false;
              if (apiChar.image && newMapping[existingIdx].photoUrl !== apiChar.image) {
                newMapping[existingIdx].photoUrl = apiChar.image;
                itemUpdated = true;
              }
              if (apiChar.original_name && !newMapping[existingIdx].original_name) {
                newMapping[existingIdx].original_name = apiChar.original_name;
                itemUpdated = true;
              }
              if (itemUpdated) mappingChanged = true;
            } else {
              // Add new character
              newMapping.push({
                characterName: apiChar.name,
                original_name: apiChar.original_name,
                photoUrl: apiChar.image,
                dubberId: ''
              });
              mappingChanged = true;
            }
          }

          if (mappingChanged) {
            console.log(`[AutoUpdate] Found character changes, saving...`);
            await ipcSafe.invoke('save-project', { ...project, globalMapping: JSON.stringify(newMapping) });
          }
        }

        onRefresh();
      } catch (err) {
        console.error('[AutoUpdate] Error during background sync:', err);
      }
    };

    updateProject();
  }, [selectedProject?.id]); // Only run once when project ID changes (opening)
}
