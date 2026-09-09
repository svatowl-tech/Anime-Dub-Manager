const { ipcMain, dialog } = require('electron');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');

function registerProjectHandlers(getData, saveData, mainWindow) {
  // Generic CRUD handlers
  const entities = [
    { name: 'participant', filename: 'participants.json' },
    { name: 'project', filename: 'projects.json' }
  ];

  for (const { name, filename } of entities) {
    if (name !== 'project') {
      ipcMain.handle(`get-${name}s`, wrapIpcHandler(async () => {
        return await getData(filename);
      }));
    }

    ipcMain.handle(`save-${name}`, wrapIpcHandler(async (event, item) => {
      if (!item || !item.id) throw new Error(`Invalid ${name} data`);
      
      const items = await getData(filename);
      const index = items.findIndex((i) => i.id === item.id);
      
      let dataToSave = { ...item };
      dataToSave.updatedAt = new Date().toISOString();
      if (!dataToSave.createdAt) {
        dataToSave.createdAt = index !== -1 && items[index].createdAt ? items[index].createdAt : new Date().toISOString();
      }

      if (name === 'project') {
        const { episodes, soundEngineer, assignedDubbers, ...projectData } = item;
        dataToSave = {
          ...(index !== -1 ? items[index] : {}),
          ...projectData,
          updatedAt: new Date().toISOString(),
          createdAt: index !== -1 && items[index].createdAt ? items[index].createdAt : (projectData.createdAt || new Date().toISOString())
        };

        // If episodes were passed inside project, only persist new episodes that do not exist yet.
        // Existing episodes are authoritative and managed exclusively by save-episode.
        if (Array.isArray(episodes) && episodes.length > 0) {
          try {
            const allEpisodes = await getData('episodes.json');
            let episodesModified = false;
            for (const ep of episodes) {
              if (!ep || !ep.id) continue;
              const epIdx = allEpisodes.findIndex(e => e.id === ep.id);
              if (epIdx === -1) {
                allEpisodes.push({ ...ep, projectId: item.id, updatedAt: new Date().toISOString() });
                episodesModified = true;
              }
            }
            if (episodesModified) {
              await saveData('episodes.json', allEpisodes);
            }
          } catch (e) {
            console.error('Error persisting episodes from save-project:', e);
          }
        }

        // Keep assignedDubberIds in sync with any dubbers assigned in globalMapping or episodes
        if (Array.isArray(dataToSave.assignedDubberIds)) {
          const currentDubbers = new Set(dataToSave.assignedDubberIds);

          // 1. Sync globalMapping dubbers into assignedDubberIds
          if (dataToSave.globalMapping) {
            try {
              const mapping = typeof dataToSave.globalMapping === 'string' ? JSON.parse(dataToSave.globalMapping) : dataToSave.globalMapping;
              if (Array.isArray(mapping)) {
                mapping.forEach(m => {
                  if (m.dubberId && !currentDubbers.has(m.dubberId)) {
                    currentDubbers.add(m.dubberId);
                    dataToSave.assignedDubberIds.push(m.dubberId);
                  }
                });
              }
            } catch (e) {
              console.error('Error syncing globalMapping dubbers into assignedDubberIds:', e);
            }
          }

          // 2. Sync episode assignments into assignedDubberIds
          try {
            const allEpisodes = await getData('episodes.json');
            for (const ep of allEpisodes) {
              if (ep.projectId === item.id && Array.isArray(ep.assignments)) {
                for (const a of ep.assignments) {
                  if (a.dubberId && !currentDubbers.has(a.dubberId)) {
                    currentDubbers.add(a.dubberId);
                    dataToSave.assignedDubberIds.push(a.dubberId);
                  }
                  if (a.substituteId && !currentDubbers.has(a.substituteId)) {
                    currentDubbers.add(a.substituteId);
                    dataToSave.assignedDubberIds.push(a.substituteId);
                  }
                }
              }
            }
          } catch (e) {
            console.error('Error syncing episode dubbers into assignedDubberIds:', e);
          }
        }
      } else if (name === 'participant') {
        dataToSave = {
          ...(index !== -1 ? items[index] : {}),
          ...item,
          updatedAt: new Date().toISOString(),
          createdAt: index !== -1 && items[index].createdAt ? items[index].createdAt : (item.createdAt || new Date().toISOString())
        };
      }

      if (index !== -1) {
        items[index] = dataToSave;
      } else {
        items.push(dataToSave);
      }
      await saveData(filename, items);
      return items;
    }));

    ipcMain.handle(`delete-${name}`, wrapIpcHandler(async (event, id) => {
      if (!id) throw new Error(`Invalid ${name} ID`);
      const items = await getData(filename);
      const filtered = items.filter((i) => i.id !== id);
      await saveData(filename, filtered);
      return filtered;
    }));
  }

  // Custom get-projects handler
  ipcMain.handle('get-projects', wrapIpcHandler(async () => {
    const projects = await getData('projects.json');
    const episodes = await getData('episodes.json');
    const participants = await getData('participants.json');

    return projects.map(project => {
      const projectEpisodes = episodes.filter(ep => ep.projectId === project.id).map(ep => {
        const assignments = (ep.assignments || []).map(assignment => {
          const dubber = participants.find(p => p.id === assignment.dubberId);
          const substitute = assignment.substituteId ? participants.find(p => p.id === assignment.substituteId) : undefined;
          return { ...assignment, dubber, substitute };
        });
        const uploads = (ep.uploads || []).map(upload => {
          const uploadedBy = participants.find(p => p.id === upload.uploadedById);
          return { ...upload, uploadedBy };
        });
        return { ...ep, assignments, uploads };
      });
      const soundEngineer = project.soundEngineerId ? participants.find(p => p.id === project.soundEngineerId) : undefined;
      const assignedDubbers = (project.assignedDubberIds || []).map(id => participants.find(p => p.id === id)).filter(Boolean);
      return { ...project, episodes: projectEpisodes, soundEngineer, assignedDubbers };
    });
  }));

  // Dedicated scan-projects handler
  ipcMain.handle('scan-projects', wrapIpcHandler(async () => {
    const ProjectScanner = require('../lib/ProjectScanner.cjs');
    const config = await getData('config.json');
    const userDataPath = require('electron').app.getPath('userData');
    const baseDir = config?.baseDir || userDataPath;
    await ProjectScanner.scanAndRecoverAllProjects(getData, saveData, userDataPath, baseDir);
    return true;
  }));

  // Custom get-project handler by ID
  ipcMain.handle('get-project', wrapIpcHandler(async (event, projectId) => {
    const projects = await getData('projects.json');
    const project = projects.find(p => p.id === projectId);
    if (!project) throw new Error('Project not found');

    const episodes = await getData('episodes.json');
    const participants = await getData('participants.json');

    const projectEpisodes = episodes.filter(ep => ep.projectId === project.id).map(ep => {
      const assignments = (ep.assignments || []).map(assignment => {
        const dubber = participants.find(p => p.id === assignment.dubberId);
        const substitute = assignment.substituteId ? participants.find(p => p.id === assignment.substituteId) : undefined;
        return { ...assignment, dubber, substitute };
      });
      const uploads = (ep.uploads || []).map(upload => {
        const uploadedBy = participants.find(p => p.id === upload.uploadedById);
        return { ...upload, uploadedBy };
      });
      return { ...ep, assignments, uploads };
    });
    const soundEngineer = project.soundEngineerId ? participants.find(p => p.id === project.soundEngineerId) : undefined;
    const assignedDubbers = (project.assignedDubberIds || []).map(id => participants.find(p => p.id === id)).filter(Boolean);
    return { ...project, episodes: projectEpisodes, soundEngineer, assignedDubbers };
  }));

  // Import participants
  ipcMain.handle('import-participants', wrapIpcHandler(async (event, imported) => {
    if (!Array.isArray(imported)) throw new Error('Invalid participants data');
    await saveData('participants.json', imported);
    return true;
  }));
}

module.exports = { registerProjectHandlers };
