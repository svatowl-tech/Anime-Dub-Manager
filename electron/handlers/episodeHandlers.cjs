const { ipcMain } = require('electron');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');

function registerEpisodeHandlers(getData, saveData) {
  ipcMain.handle('save-episode', wrapIpcHandler(async (event, item) => {
    if (!item || !item.id) throw new Error('Invalid episode data');
    
    const items = await getData('episodes.json');
    const index = items.findIndex((i) => i.id === item.id);
    
    const { project, ...dataToSave } = item;
    if (dataToSave.assignments) {
      dataToSave.assignments = dataToSave.assignments.map(a => {
        const { dubber, substitute, ...rest } = a;
        return rest;
      });
    }
    if (dataToSave.uploads) {
      dataToSave.uploads = dataToSave.uploads.map(u => {
        const { uploadedBy, ...rest } = u;
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

    if (isTransitioningToRecording) {
      try {
        const projectList = await getData('projects.json');
        const associatedProject = projectList.find(p => p.id === dataToSave.projectId);
        if (associatedProject) {
          const now = new Date();
          let daysToAdd = 7; // Default for offgoing (isOngoing === false)

          if (associatedProject.isOngoing) {
            if (associatedProject.releaseType === 'VOICEOVER') {
              daysToAdd = 2;
            } else if (associatedProject.releaseType === 'RECAST' || associatedProject.releaseType === 'REDUB') {
              daysToAdd = 3;
            }
          }

          const deadlineDate = new Date(now);
          deadlineDate.setDate(now.getDate() + daysToAdd);
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
    await saveData('episodes.json', items);

    // Save individual episode.json on disk inside episode folder
    try {
      const config = await getData('config.json');
      const baseDir = config?.baseDir || require('electron').app.getPath('userData');
      const projects = await getData('projects.json');
      const associatedProject = projects.find(p => p.id === dataToSave.projectId);
      if (associatedProject) {
        const ProjectScanner = require('../lib/ProjectScanner.cjs');
        await ProjectScanner.saveEpisodeJsonOnDisk(baseDir, associatedProject, items[index] || dataToSave);
      }
    } catch (e) {
      console.error('[save-episode] Error saving individual episode.json on disk:', e.message);
    }

    return true;
  }));
  
  ipcMain.handle('delete-episode', wrapIpcHandler(async (event, id) => {
    if (!id) throw new Error('Invalid episode ID');
    const items = await getData('episodes.json');
    const filtered = items.filter((i) => i.id !== id);
    await saveData('episodes.json', filtered);
    return true;
  }));
}

module.exports = { registerEpisodeHandlers };
