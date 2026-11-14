const { ipcMain } = require('electron');
const fs = require('fs');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');
const AudioAnalysisService = require('../services/AudioAnalysisService.cjs');

function registerEpisodeHandlers(getData, saveData) {
  ipcMain.handle('save-episode', wrapIpcHandler(async (event, item) => {
    if (!item || !item.id) throw new Error('Invalid episode data');
    
    const items = await getData('episodes.json');
    const existingByIdIndex = items.findIndex((i) => i.id === item.id);
    const existingByNumIndex = existingByIdIndex === -1 && item.projectId && typeof item.number === 'number'
      ? items.findIndex((i) => i.projectId === item.projectId && i.number === item.number)
      : -1;
    const index = existingByIdIndex !== -1 ? existingByIdIndex : existingByNumIndex;
    
    const { project, ...dataToSave } = item;
    if (existingByNumIndex !== -1 && items[existingByNumIndex]?.id) {
      dataToSave.id = items[existingByNumIndex].id;
    }
    if (dataToSave.assignments) {
      dataToSave.assignments = dataToSave.assignments.map(a => {
        const { dubber, substitute, ...rest } = a;
        return rest;
      });
    }
    if (dataToSave.uploads) {
      dataToSave.uploads = dataToSave.uploads.map(u => {
        const { uploadedBy, ...rest } = u;
        if (!rest.size && rest.path) {
          try {
            if (fs.existsSync(rest.path)) {
              rest.size = fs.statSync(rest.path).size;
            }
          } catch (_) {}
        }
        if (rest.path && (rest.type === 'DUBBER_FILE' || rest.type === 'FIXES')) {
          AudioAnalysisService.getOrRunAnalysis(rest.path, false, {
            subPath: dataToSave.subPath,
            isFix: rest.type === 'FIXES'
          }).catch(() => {});
        }
        return rest;
      });
    }

    // Recalculate deadline if transitioning to RECORDING status (issued to dubbers)
    const previousItem = index !== -1 ? items[index] : null;

    // Server-authoritative status history tracking
    let mergedHistory = previousItem && previousItem.statusHistory ? [...previousItem.statusHistory] : [];
    if (mergedHistory.length === 0) {
      mergedHistory.push({
        status: previousItem ? previousItem.status : dataToSave.status,
        timestamp: previousItem ? previousItem.createdAt : (dataToSave.createdAt || new Date().toISOString())
      });
    }
    
    const lastLoggedStatus = mergedHistory[mergedHistory.length - 1]?.status;
    if (lastLoggedStatus !== dataToSave.status) {
      mergedHistory.push({
        status: dataToSave.status,
        timestamp: new Date().toISOString()
      });
    }
    dataToSave.statusHistory = mergedHistory;

    const isTransitioningToRecording = dataToSave.status === 'RECORDING' && (!previousItem || previousItem.status !== 'RECORDING');

    if (isTransitioningToRecording && !dataToSave.deadline && (!previousItem || !previousItem.deadline)) {
      try {
        const projectList = await getData('projects.json');
        const associatedProject = projectList.find(p => p.id === dataToSave.projectId);
        if (associatedProject) {
          const now = new Date();
          let daysToAdd = associatedProject.defaultEpisodeDeadlineDays;
          if (typeof daysToAdd !== 'number' || isNaN(daysToAdd) || daysToAdd < 1) {
            daysToAdd = 7; // Default for offgoing (isOngoing === false)
            if (associatedProject.isOngoing) {
              if (associatedProject.releaseType === 'VOICEOVER') {
                daysToAdd = 2;
              } else if (associatedProject.releaseType === 'RECAST' || associatedProject.releaseType === 'REDUB') {
                daysToAdd = 3;
              }
            }
          }

          const targetHour = typeof associatedProject.defaultEpisodeDeadlineHour === 'number' ? associatedProject.defaultEpisodeDeadlineHour : 20;
          const targetMinute = typeof associatedProject.defaultEpisodeDeadlineMinute === 'number' ? associatedProject.defaultEpisodeDeadlineMinute : 0;

          const deadlineDate = new Date(now);
          deadlineDate.setDate(now.getDate() + daysToAdd);
          deadlineDate.setHours(targetHour, targetMinute, 0, 0);
          dataToSave.deadline = deadlineDate.toISOString();
        }
      } catch (err) {
        console.error('[save-episode] Error calculating deadline on transition:', err.message);
      }
    }

    dataToSave.updatedAt = new Date().toISOString();
    if (!dataToSave.createdAt) {
      dataToSave.createdAt = previousItem && previousItem.createdAt ? previousItem.createdAt : new Date().toISOString();
    }

    if (index !== -1) {
      const existing = items[index];
      const merged = { ...existing };
      for (const key of Object.keys(dataToSave)) {
        if (dataToSave[key] !== undefined) {
          // Protection against wiping out newer data with stale client state
          if (key === 'rawPath' && !dataToSave.rawPath && existing.rawPath) {
            continue;
          }
          if (key === 'subPath' && !dataToSave.subPath && existing.subPath) {
            continue;
          }
          if (key === 'assignments' && Array.isArray(dataToSave.assignments) && dataToSave.assignments.length === 0 && Array.isArray(existing.assignments) && existing.assignments.length > 0) {
            continue;
          }
          if (key === 'uploads' && Array.isArray(dataToSave.uploads) && dataToSave.uploads.length === 0 && Array.isArray(existing.uploads) && existing.uploads.length > 0) {
            continue;
          }
          merged[key] = dataToSave[key];
        }
      }
      items[index] = merged;
    } else {
      items.push(dataToSave);
    }
    const savedEpisode = index !== -1 ? items[index] : dataToSave;
    await saveData('episodes.json', items);

    // Clear any matching deletion tombstone when an episode is explicitly created/saved
    try {
      const deletedList = await getData('deleted_episodes.json');
      if (Array.isArray(deletedList) && deletedList.length > 0) {
        const filteredDeleted = deletedList.filter((d) => {
          if (!d) return false;
          if (d.id === savedEpisode.id) return false;
          if (d.projectId === savedEpisode.projectId && d.number === savedEpisode.number) return false;
          return true;
        });
        if (filteredDeleted.length !== deletedList.length) {
          await saveData('deleted_episodes.json', filteredDeleted);
        }
      }
    } catch (_) {}

    // Save individual episode.json on disk inside episode folder
    try {
      const config = await getData('config.json');
      const baseDir = config?.baseDir || require('electron').app.getPath('userData');
      const projects = await getData('projects.json');
      const associatedProject = projects.find(p => p.id === savedEpisode.projectId);
      if (associatedProject) {
        const ProjectScanner = require('../lib/ProjectScanner.cjs');
        await ProjectScanner.saveEpisodeJsonOnDisk(baseDir, associatedProject, savedEpisode);
      }
    } catch (e) {
      console.error('[save-episode] Error saving individual episode.json on disk:', e.message);
    }

    return savedEpisode;
  }));
  
  ipcMain.handle('delete-episode', wrapIpcHandler(async (event, id) => {
    if (!id) throw new Error('Invalid episode ID');
    const items = await getData('episodes.json');
    const targetEp = items.find((i) => i.id === id) || null;
    const filtered = items.filter((i) => i.id !== id);
    await saveData('episodes.json', filtered);

    if (targetEp) {
      const deletedAt = new Date().toISOString();
      try {
        const deletedList = await getData('deleted_episodes.json');
        const nextDeleted = Array.isArray(deletedList) ? deletedList.filter((d) => d && d.id !== id) : [];
        nextDeleted.push({
          id: targetEp.id,
          projectId: targetEp.projectId,
          number: targetEp.number,
          deletedAt,
        });
        // Keep last 500 tombstones
        await saveData('deleted_episodes.json', nextDeleted.slice(-500));
      } catch (e) {
        console.error('[delete-episode] Error recording deletion tombstone:', e.message);
      }

      try {
        const config = await getData('config.json');
        const baseDir = config?.baseDir || require('electron').app.getPath('userData');
        const projects = await getData('projects.json');
        const projIdx = projects.findIndex((p) => p.id === targetEp.projectId);
        const associatedProject = projIdx !== -1 ? projects[projIdx] : null;
        if (associatedProject) {
          const ProjectScanner = require('../lib/ProjectScanner.cjs');
          await ProjectScanner.removeEpisodeOnDisk(baseDir, associatedProject, targetEp);

          if (associatedProject.lastActiveEpisode === targetEp.number) {
            const remainingEps = filtered
              .filter((e) => e.projectId === associatedProject.id)
              .sort((a, b) => (a.number || 0) - (b.number || 0));
            projects[projIdx] = {
              ...associatedProject,
              lastActiveEpisode: remainingEps.length > 0 ? remainingEps[0].number : 1,
              updatedAt: deletedAt,
            };
            await saveData('projects.json', projects);
          }
        }
      } catch (e) {
        console.error('[delete-episode] Error cleaning up episode on disk:', e.message);
      }
    }

    return true;
  }));
}

module.exports = { registerEpisodeHandlers };
