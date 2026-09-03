import { useEffect, useRef } from 'react';
import { Project } from '../types';
import { getAnimeDetails, getAnimeCharacters } from '../services/animeService';
import { ipcSafe } from '../lib/ipcSafe';

function isSameUrl(url1?: string, url2?: string): boolean {
  if (!url1 && !url2) return true;
  if (!url1 || !url2) return false;
  if (url1 === url2) return true;
  const clean1 = url1.replace(/^https?:\/\/[^\/]+/, '');
  const clean2 = url2.replace(/^https?:\/\/[^\/]+/, '');
  return clean1 === clean2;
}

export function useProjectAutoUpdate(selectedProject: Project | null, onRefresh: () => void) {
  const syncedProjectIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!selectedProject || !selectedProject.id) return;
    
    const projectId = selectedProject.id;
    if (syncedProjectIds.current.has(projectId)) {
      return; // Already synced this project in current session
    }

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

      if (!sourceId) {
        syncedProjectIds.current.add(projectId);
        return; // No source to sync from
      }

      try {
        let metaChanged = false;
        let mappingChanged = false;
        const freshProject = (await ipcSafe.invoke('get-project', projectId)) || selectedProject;
        const updatedProject = { ...freshProject };

        // 1. Check Project Details
        const details = await getAnimeDetails(sourceId, source);
        if (details) {
          if (details.description && details.description !== freshProject.synopsis) {
            updatedProject.synopsis = details.description;
            metaChanged = true;
          }
          if (details.episodes && details.episodes !== freshProject.totalEpisodes) {
            updatedProject.totalEpisodes = details.episodes;
            metaChanged = true;
          }
          if (details.aired_episodes !== undefined && details.aired_episodes !== freshProject.airedEpisodes) {
            updatedProject.airedEpisodes = details.aired_episodes;
            metaChanged = true;
          }
          if (details.image && !isSameUrl(details.image, freshProject.posterUrl)) {
            updatedProject.posterUrl = details.image;
            metaChanged = true;
          }
          if (details.type && details.type !== freshProject.typeAndSeason) {
            updatedProject.typeAndSeason = details.type;
            metaChanged = true;
          }
        }

        // 2. Check Characters
        const apiChars = await getAnimeCharacters(sourceId, source);
        if (apiChars && apiChars.length > 0) {
          let currentMapping: any[] = [];
          try {
             currentMapping = JSON.parse(freshProject.globalMapping || '[]');
          } catch(e) {}

          const newMapping = [...currentMapping];
          const normalizeName = (name: string) => name.trim().toLowerCase().replace(/[^a-zа-я0-9]/g, '');

          for (const apiChar of apiChars) {
            const apiNameNorm = normalizeName(apiChar.name);
            const apiOrigNorm = normalizeName(apiChar.original_name || '');
            
            const existingIdx = newMapping.findIndex(m => {
              const mNameNorm = normalizeName(m.characterName);
              const mOrigNorm = normalizeName(m.original_name || '');
              return mNameNorm === apiNameNorm || 
                     mOrigNorm === apiOrigNorm || 
                     mNameNorm === apiOrigNorm || 
                     mOrigNorm === apiNameNorm;
            });

            if (existingIdx !== -1) {
              let itemUpdated = false;
              if (apiChar.image && !isSameUrl(apiChar.image, newMapping[existingIdx].photoUrl)) {
                newMapping[existingIdx].photoUrl = apiChar.image;
                itemUpdated = true;
              }
              if (apiChar.original_name && !newMapping[existingIdx].original_name) {
                newMapping[existingIdx].original_name = apiChar.original_name;
                itemUpdated = true;
              }
              if (itemUpdated) mappingChanged = true;
            } else {
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
            updatedProject.globalMapping = JSON.stringify(newMapping);
          }
        }

        // Mark as synced before saving so callbacks don't loop
        syncedProjectIds.current.add(projectId);

        if (metaChanged || mappingChanged) {
          console.log(`[AutoUpdate] Found project updates (meta: ${metaChanged}, chars: ${mappingChanged}), saving...`);
          await ipcSafe.invoke('save-project', updatedProject);
          onRefresh();
        }
      } catch (err) {
        syncedProjectIds.current.add(projectId);
        console.error('[AutoUpdate] Error during background sync:', err);
      }
    };

    updateProject();
  }, [selectedProject?.id]);
}
