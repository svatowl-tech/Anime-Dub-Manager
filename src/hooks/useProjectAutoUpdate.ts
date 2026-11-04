import { useEffect, useRef } from 'react';
import { Project } from '../types';
import { getAnimeDetails, getAnimeCharacters } from '../services/animeService';
import { ipcSafe } from '../lib/ipcSafe';

const PROJECT_SYNC_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

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
    const sessionKey = 'anime_synced_' + projectId;
    const persistKey = 'anime_synced_ts_' + projectId;

    if (syncedProjectIds.current.has(projectId) || sessionStorage.getItem(sessionKey)) {
      return;
    }

    try {
      const lastSyncTs = Number(localStorage.getItem(persistKey) || 0);
      if (lastSyncTs > 0 && Date.now() - lastSyncTs < PROJECT_SYNC_TTL_MS) {
        syncedProjectIds.current.add(projectId);
        sessionStorage.setItem(sessionKey, '1');
        return;
      }
    } catch (e) {
      // Ignore storage access errors
    }

    syncedProjectIds.current.add(projectId);
    try {
      sessionStorage.setItem(sessionKey, '1');
    } catch (e) {
      // Ignore storage access errors
    }

    const updateProject = async () => {
      let sourceId: number | null = null;
      const source: string = 'shikimori';

      if (selectedProject.links) {
        try {
          const links = JSON.parse(selectedProject.links);
          if (links.shikimori) {
            const match = links.shikimori.match(/\/animes\/(\d+)/);
            if (match) sourceId = parseInt(match[1], 10);
          }
        } catch (e) {
          // Ignore malformed JSON
        }
      }

      if (!sourceId) {
        return;
      }

      try {
        let currentMapping: Array<{
          characterName: string;
          original_name?: string;
          photoUrl?: string;
          dubberId?: string;
          isMain?: boolean;
        }> = [];
        try {
          currentMapping = JSON.parse(selectedProject.globalMapping || '[]');
        } catch (e) {
          currentMapping = [];
        }

        const hasCompleteMeta = Boolean(
          selectedProject.synopsis &&
          selectedProject.posterUrl &&
          selectedProject.totalEpisodes &&
          selectedProject.typeAndSeason
        );
        const isFinishedAiring =
          selectedProject.status === 'COMPLETED' ||
          selectedProject.isOngoing === false ||
          (Boolean(selectedProject.totalEpisodes) &&
            (selectedProject.airedEpisodes || 0) >= (selectedProject.totalEpisodes || 0));

        const hasCompleteCharacters =
          currentMapping.length > 0 &&
          currentMapping.some(m => Boolean(m.photoUrl));

        // If metadata and character list are already populated and anime finished airing, skip network scraping
        if (hasCompleteMeta && isFinishedAiring && hasCompleteCharacters) {
          try {
            localStorage.setItem(persistKey, String(Date.now()));
          } catch (e) {}
          return;
        }

        let metaChanged = false;
        let mappingChanged = false;
        const updatedProject: Project = { ...selectedProject };

        // 1. Check Project Details (only if missing fields or ongoing)
        if (!hasCompleteMeta || !isFinishedAiring) {
          const details = await getAnimeDetails(sourceId, source);
          if (details) {
            if (details.description && details.description !== selectedProject.synopsis) {
              updatedProject.synopsis = details.description;
              metaChanged = true;
            }
            if (details.episodes && details.episodes !== selectedProject.totalEpisodes) {
              updatedProject.totalEpisodes = details.episodes;
              metaChanged = true;
            }
            if (details.aired_episodes !== undefined && details.aired_episodes !== selectedProject.airedEpisodes) {
              updatedProject.airedEpisodes = details.aired_episodes;
              metaChanged = true;
            }
            if (details.image && !isSameUrl(details.image, selectedProject.posterUrl)) {
              updatedProject.posterUrl = details.image;
              metaChanged = true;
            }
            if (details.type && details.type !== selectedProject.typeAndSeason) {
              updatedProject.typeAndSeason = details.type;
              metaChanged = true;
            }
          }
        }

        // 2. Check Characters (only if characters are not yet populated with images)
        if (!hasCompleteCharacters) {
          const apiChars = await getAnimeCharacters(sourceId, source);
          if (apiChars && apiChars.length > 0) {
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
        }

        try {
          localStorage.setItem(persistKey, String(Date.now()));
        } catch (e) {}

        if (metaChanged || mappingChanged) {
          console.log(`[AutoUpdate] Found project updates (meta: ${metaChanged}, chars: ${mappingChanged}), saving...`);
          const { episodes: _eps, soundEngineer: _se, assignedDubbers: _ad, ...cleanProject } = updatedProject;
          await ipcSafe.invoke('save-project', cleanProject);
          onRefresh();
        }
      } catch (err) {
        console.error('[AutoUpdate] Error during background sync:', err);
      }
    };

    const timer = setTimeout(updateProject, 400);
    return () => clearTimeout(timer);
  }, [selectedProject?.id]);
}

