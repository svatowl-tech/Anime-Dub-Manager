export const ipcRenderer: {
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  send: (channel: string, ...args: any[]) => void;
  on: (channel: string, callback: (...args: any[]) => void) => () => void;
  removeListener: (channel: string, callback: (...args: any[]) => void) => void;
} = {
  invoke: async (channel: string, ...args: any[]) => {
    // If running inside Electron desktop app, ALWAYS route exclusively via Electron IPC
    if (typeof window !== 'undefined' && (window as any).electronAPI && (window as any).electronAPI.invoke) {
      return await (window as any).electronAPI.invoke(channel, ...args);
    }
    
    // Browser fallback for AI Studio preview - Try calling the server API
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const url = origin && !origin.startsWith('file') ? `${origin}/api/ipc/${channel}` : `/api/ipc/${channel}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args })
      });
      
      if (response.ok) {
        const result = await response.json();
        if (result.success) return result.data;
        const err = new Error(result.error);
        if (result.stack) (err as any).stack = result.stack;
        if (result.stderr) (err as any).stderr = result.stderr;
        if (result.stdout) (err as any).stdout = result.stdout;
        if (result.code) (err as any).code = result.code;
        throw err;
      } else {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        const err = new Error(errorData.error || `Server status ${response.status}`);
        if (errorData.stack) (err as any).stack = errorData.stack;
        if (errorData.stderr) (err as any).stderr = errorData.stderr;
        if (errorData.stdout) (err as any).stdout = errorData.stdout;
        if (errorData.code) (err as any).code = errorData.code;
        throw err;
      }
    } catch (e: any) {
      console.warn(`Server IPC fallback failed for "${channel}":`, e);
      
      // If we are on the web and the server call failed, check if we have a mock in this file
      const mockedResult = handleIpcMock(channel, args);
      if (mockedResult !== undefined) return mockedResult;
      
      throw e;
    }
  },
  send: (channel: string, ...args: any[]) => {
    if (window.electronAPI && window.electronAPI.send) {
      window.electronAPI.send(channel, ...args);
    } else {
      // console.warn(`IPC channel "${channel}" send called in browser environment. Using fallback.`);
    }
  },
  on: (channel: string, callback: (...args: any[]) => void): (() => void) => {
    let cleanup: () => void;
    if (window.electronAPI && window.electronAPI.on) {
      cleanup = window.electronAPI.on(channel, callback);
    } else {
      const handler = (e: any) => {
        if (channel === 'download-progress' && e.type === 'download-progress') {
          callback(e.detail);
        } else if (channel === 'ffmpeg-progress' && e.type === 'ffmpeg-progress') {
          callback(e.detail);
        }
      };
      window.addEventListener(channel, handler);
      cleanup = () => window.removeEventListener(channel, handler);
    }

    if (!listenerCleanups.has(channel)) {
      listenerCleanups.set(channel, new Map());
    }
    listenerCleanups.get(channel)!.set(callback, cleanup);

    return () => {
      if (typeof cleanup === 'function') {
        cleanup();
      }
      const channelMap = listenerCleanups.get(channel);
      if (channelMap) {
        channelMap.delete(callback);
        if (channelMap.size === 0) {
          listenerCleanups.delete(channel);
        }
      }
    };
  },
  removeListener: (channel: string, callback: (...args: any[]) => void) => {
    const channelMap = listenerCleanups.get(channel);
    if (channelMap && channelMap.has(callback)) {
      const cleanup = channelMap.get(callback);
      if (typeof cleanup === 'function') {
        cleanup();
      }
      channelMap.delete(callback);
      if (channelMap.size === 0) {
        listenerCleanups.delete(channel);
      }
    }
  }
};

const listenerCleanups = new Map<string, Map<Function, () => void>>();

function parseMemoryAss(text: string) {
  const lines: any[] = [];
  const actorsSet = new Set<string>();
  const stylesSet = new Set<string>();
  const textLines = text.split(/\r?\n/);
  let isEvents = false;
  let rawLineIndex = 0;
  
  for (const line of textLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[Events]')) {
      isEvents = true;
      continue;
    }
    if (trimmed.startsWith('[')) {
      isEvents = false;
    }
    
    if (isEvents && trimmed.startsWith('Dialogue:')) {
      rawLineIndex++;
      const prefixLength = 'Dialogue:'.length;
      const parts = trimmed.substring(prefixLength).split(',');
      if (parts.length >= 9) {
        const start = parts[1].trim();
        const end = parts[2].trim();
        const style = parts[3].trim();
        const name = parts[4].trim();
        const textVal = parts.slice(9).join(',').trim();
        lines.push({
          rawLineIndex,
          start,
          end,
          style,
          name,
          text: textVal
        });
        if (name) actorsSet.add(name);
        if (style) stylesSet.add(style);
      }
    }
  }
  
  return {
    lines,
    actors: Array.from(actorsSet),
    styles: Array.from(stylesSet)
  };
}

export let isStorageSynced = false;

export async function syncAndLoadFromDir() {
  try {
    const { readFromLocalFolder, writeToLocalFolder } = await import('./webFileSystem');
    
    // We try to read projects.json, episodes.json, participants.json, config.json from the selected folder
    const keys = ['projects', 'episodes', 'participants', 'config'];
    
    for (const key of keys) {
      const filename = `${key}.json`;
      try {
        const fileOrStr = await readFromLocalFolder(filename);
        let folderContentStr = '';
        if (fileOrStr && typeof fileOrStr === 'object' && typeof (fileOrStr as any).text === 'function') {
          folderContentStr = await (fileOrStr as any).text();
        } else if (typeof fileOrStr === 'string') {
          folderContentStr = fileOrStr;
        }
        
        if (folderContentStr) {
          let folderData: any;
          try {
            folderData = JSON.parse(folderContentStr);
          } catch (e) {
            console.warn(`Could not parse ${filename}, setting defaults:`, e);
            continue;
          }
          const localStr = localStorage.getItem(key);
          let localData: any;
          try {
            localData = localStr ? JSON.parse(localStr) : (key === 'config' ? {} : []);
          } catch (e) {
            localData = key === 'config' ? {} : [];
          }
          
          if (key === 'config') {
            // For config, merge objects, preference to newer or non-empty fields
            const mergedConfig = { ...localData, ...folderData };
            localStorage.setItem('config', JSON.stringify(mergedConfig));
          } else {
            // For entities (list of objects with 'id'):
            // Smart Merge to ensure no data is lost!
            const mergedList = Array.isArray(localData) ? [...localData] : [];
            const folderList = Array.isArray(folderData) ? folderData : [];
            
            for (const folderItem of folderList) {
              if (!folderItem || !folderItem.id) continue;
              const existingIndex = mergedList.findIndex((item: any) => item && item.id === folderItem.id);
              if (existingIndex === -1) {
                // If it is only in the folder, add it to mergedList
                mergedList.push(folderItem);
              } else {
                // If it is in both: merge them prioritizing the one with the newer 'updatedAt'
                const localItem = mergedList[existingIndex];
                const localUpdate = localItem && localItem.updatedAt ? new Date(localItem.updatedAt).getTime() : 0;
                const folderUpdate = folderItem.updatedAt ? new Date(folderItem.updatedAt).getTime() : 0;
                
                if (folderUpdate > localUpdate) {
                  mergedList[existingIndex] = { ...localItem, ...folderItem };
                } else {
                  mergedList[existingIndex] = { ...folderItem, ...localItem };
                }
              }
            }
            
            // Save merged list back to localStorage
            localStorage.setItem(key, JSON.stringify(mergedList));
            
            // AND duplicate the complete merged list back to the local folder!
            await writeToLocalFolder(filename, JSON.stringify(mergedList, null, 2));
          }
        }
      } catch (err) {
        // If file doesn't exist in folder, we try to write the current localStorage data there so they align
        const localStr = localStorage.getItem(key);
        if (localStr) {
          try {
            await writeToLocalFolder(filename, localStr);
          } catch (writeErr) {
            console.warn(`Could not sync ${filename} to directory during fallback:`, writeErr);
          }
        }
      }
    }
    console.log('Synchronized all data files with working directory successfully.');
  } catch (e) {
    console.warn('Sync/Load with working directory skipped (no root folder or user denied permission):', e);
  }
}

export async function ensureStorageSynced() {
  if (isStorageSynced) return;
  isStorageSynced = true;
  await syncAndLoadFromDir();
}

/**
 * Fallback mock logic for when running in browser without server
 */
function handleIpcMock(channel: string, args: any[]): any {
  // console.warn(`IPC channel "${channel}" falling back to LocalStorage mock.`);
  
  const getLocalData = (key: string) => {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  };
  
  const saveLocalData = (key: string, data: any) => {
    localStorage.setItem(key, JSON.stringify(data));
  };

  // Seed initial demo/preview data if localStorage is empty
  if (typeof window !== 'undefined' && (!localStorage.getItem('projects') || JSON.parse(localStorage.getItem('projects') || '[]').length === 0)) {
    const demoParticipants = [
      { id: 'p1', nickname: 'Kira', telegram: '@kira_dub', tgChannel: '@kira_channel', vkLink: 'vk.com/kira', roles: ['DUBBER'] },
      { id: 'p2', nickname: 'Anilibria_Enjoyer', telegram: '@ani_enjoyer', tgChannel: '', vkLink: '', roles: ['DUBBER', 'QA'] },
      { id: 'p3', nickname: 'Saber', telegram: '@saber_dub', tgChannel: '@saber_notes', vkLink: 'vk.com/saber', roles: ['DUBBER'] },
      { id: 'p4', nickname: 'OwlSound', telegram: '@owl_sound', tgChannel: '@owl_studio', vkLink: '', roles: ['SOUND_ENGINEER'] },
    ];
    
    const demoProjects = [
      {
        id: 'proj1',
        title: "Sousou no Frieren",
        originalTitle: "Frieren: Beyond Journey's End",
        status: 'ACTIVE',
        lastActiveEpisode: 1,
        totalEpisodes: 28,
        assignedDubberIds: ['p1', 'p2', 'p3'],
        soundEngineerId: 'p4',
        releaseType: 'VOICEOVER',
        emoji: '🧙‍♀️',
        isOngoing: true,
        synopsis: 'История эльфийки Фрирен, которая исследует новые земли и пытается понять человеческие эмоции после победы над Королём демонов.',
        typeAndSeason: 'TV-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    const demoEpisodes = [
      {
        id: 'ep1',
        projectId: 'proj1',
        number: 1,
        status: 'RECORDING',
        deadline: '2026-06-15',
        rawPath: 'Frieren_01_RAW.mp4',
        subPath: 'Frieren_01.ass',
        assignments: [
          { id: 'a1', episodeId: 'ep1', characterName: 'Frieren', dubberId: 'p1', status: 'RECORDED', lineCount: 154, isMain: true },
          { id: 'a2', episodeId: 'ep1', characterName: 'Himmel', dubberId: 'p2', status: 'PENDING', lineCount: 42, isMain: true },
          { id: 'a3', episodeId: 'ep1', characterName: 'Heiter', dubberId: 'p3', status: 'PENDING', lineCount: 28 }
        ],
        uploads: [
          { id: 'u1', episodeId: 'ep1', assignmentId: 'a1', type: 'DUBBER_FILE', path: '/mock/files/frieren_vox.wav', uploadedById: 'p1', createdAt: new Date().toISOString() }
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    localStorage.setItem('participants', JSON.stringify(demoParticipants));
    localStorage.setItem('projects', JSON.stringify(demoProjects));
    localStorage.setItem('episodes', JSON.stringify(demoEpisodes));
  }

  if (channel === 'search-nyaa-torrents') {
    const q = (args[0]?.query || '').toLowerCase();
    return [
      {
        title: `[SubsPlease] Sousou no Frieren - 01 (1080p) [RAW]`,
        name: `[SubsPlease] Sousou no Frieren - 01 (1080p) [RAW]`,
        torrent: `https://nyaa.si/download/mock1.torrent`,
        magnet: `magnet:?xt=urn:btih:mockfrieren01raw1080p&dn=SousouNoFrieren01`,
        size: '1.2 GiB',
        date: '2026-05-20 12:00:00',
        timestamp: '2026-05-20',
        seeders: 245,
        seeds: 245,
        leechers: 12,
        leechs: 12,
        category: 'Anime - Raw'
      },
      {
        title: `[Erai-raws] Sousou no Frieren - 01 [720p] [RAW]`,
        name: `[Erai-raws] Sousou no Frieren - 01 [720p] [RAW]`,
        torrent: `https://nyaa.si/download/mock2.torrent`,
        magnet: `magnet:?xt=urn:btih:mockfrieren01raw720p&dn=SousouNoFrieren01_720`,
        size: '720.5 MiB',
        date: '2026-05-20 12:15:00',
        timestamp: '2026-05-20',
        seeders: 184,
        seeds: 184,
        leechers: 8,
        leechs: 8,
        category: 'Anime - Raw'
      },
      {
        title: `[AnimeTime] Sousou no Frieren - 01 (1080p HEVC x265 10bit) [RAW]`,
        name: `[AnimeTime] Sousou no Frieren - 01 (1080p HEVC x265 10bit) [RAW]`,
        torrent: `https://nyaa.si/download/mock3.torrent`,
        magnet: `magnet:?xt=urn:btih:mockfrieren01hevc&dn=SousouNoFrieren01_HEVC`,
        size: '450.2 MiB',
        date: '2026-05-20 13:40:00',
        timestamp: '2026-05-20',
        seeders: 95,
        seeds: 95,
        leechers: 4,
        leechs: 4,
        category: 'Anime - Raw'
      }
    ];
  }

  if (channel === 'get-torrent-metadata') {
    const rawName = args[0]?.torrentUrl || args[0]?.magnet || 'Sousou no Frieren - 01 (1080p) [RAW]';
    return {
      name: 'Sousou no Frieren - Season 1 [1080p]',
      files: [
        { index: 0, name: '[SubsPlease] Sousou no Frieren - 01 (1080p).mkv', path: '[SubsPlease] Sousou no Frieren - 01 (1080p).mkv', length: 1420000000 },
        { index: 1, name: '[SubsPlease] Sousou no Frieren - 02 (1080p).mkv', path: '[SubsPlease] Sousou no Frieren - 02 (1080p).mkv', length: 1390000000 },
        { index: 2, name: '[SubsPlease] Sousou no Frieren - 03 (1080p).mkv', path: '[SubsPlease] Sousou no Frieren - 03 (1080p).mkv', length: 1410000000 }
      ]
    };
  }

  if (channel === 'start-torrent-download') {
    localStorage.setItem('mock_download_progress', '0');
    localStorage.setItem('mock_download_name', args[0]?.torrentUrl || args[0]?.magnet || 'Sousou no Frieren - 01 (1080p) [RAW]');
    return { downloadId: 'mock-dl-12345' };
  }

  if (channel === 'get-torrent-download-status') {
    const currentProgress = parseInt(localStorage.getItem('mock_download_progress') || '0', 10);
    const downloadName = localStorage.getItem('mock_download_name') || 'Sousou no Frieren - 01 (1080p) [RAW]';
    
    let nextProgress = currentProgress + 20;
    if (nextProgress > 100) nextProgress = 100;
    
    localStorage.setItem('mock_download_progress', nextProgress.toString());
    
    return {
      id: 'mock-dl-12345',
      name: downloadName.substring(0, 60) + (downloadName.length > 60 ? '...' : ''),
      progress: nextProgress,
      downloadSpeed: nextProgress === 100 ? 0 : 8500000 + Math.random() * 2000000,
      numPeers: nextProgress === 100 ? 0 : 38,
      status: nextProgress === 100 ? 'completed' : 'downloading',
      filePath: nextProgress === 100 ? 'Frieren_01_RAW.mp4' : null,
      error: null
    };
  }

  if (channel === 'get-config') {
    return (async () => {
      const config = localStorage.getItem('config');
      return config ? JSON.parse(config) : { baseDir: '' };
    })();
  }
  if (channel === 'save-config') {
    return (async () => {
      const config = args[0] || {};
      localStorage.setItem('config', JSON.stringify(config));
      return { success: true };
    })();
  }
  
  if (channel === 'yandex-get-auth-url' || channel === 'yandex-exchange-token' || channel === 'yandex-disconnect' || channel === 'cloud-sync-status' || channel === 'cloud-push' || channel === 'cloud-pull') {
    // DO NOT mock. Let it fall through to the API fallback or fail.
    return undefined;
  }
  
  const entityMatch = channel.match(/^(get|save|delete)-(project|episode|participant)s?$/);
  if (entityMatch) {
    const action = entityMatch[1];
    const entity = entityMatch[2];
    const key = `${entity}s`;
    
    if (action === 'get') {
      return (async () => {
        if (entity === 'project') {
          // Join logic for projects
          const projects = getLocalData('projects');
          const episodes = getLocalData('episodes');
          const participants = getLocalData('participants');
          
          return projects.map((project: any) => {
            const projectEpisodes = episodes.filter((ep: any) => ep.projectId === project.id).map((ep: any) => {
              const assignments = (ep.assignments || []).map((assignment: any) => {
                const dubber = participants.find((p: any) => p.id === assignment.dubberId);
                return { ...assignment, dubber };
              });
              const uploads = (ep.uploads || []).map((upload: any) => {
                const uploadedBy = participants.find((p: any) => p.id === upload.uploadedById);
                return { ...upload, uploadedBy };
              });
              return { ...ep, assignments, uploads };
            });
            return { ...project, episodes: projectEpisodes };
          });
        }
        return getLocalData(key);
      })();
    }
    
    if (action === 'save') {
      return (async () => {
        const items = getLocalData(key);
        const item = args[0];
        const index = items.findIndex((i: any) => i.id === item.id);
        
        let dataToSave = { ...item };
        if (entity === 'episode') {
          delete dataToSave.project;
          if (dataToSave.assignments) {
            dataToSave.assignments = dataToSave.assignments.map((a: any) => {
              const { dubber, substitute, ...rest } = a;
              return rest;
            });
          }
          if (dataToSave.uploads) {
            dataToSave.uploads = dataToSave.uploads.map((u: any) => {
              const { uploadedBy, ...rest } = u;
              return rest;
            });
          }
        } else if (entity === 'project') {
          delete dataToSave.episodes;
        }

        if (index !== -1) {
          items[index] = dataToSave;
        } else {
          items.push(dataToSave);
        }
        saveLocalData(key, items);
        
        return { success: true };
      })();
    }
    
    if (action === 'delete') {
      return (async () => {
        const items = getLocalData(key);
        const id = args[0];
        const filtered = items.filter((i: any) => i.id !== id);
        saveLocalData(key, filtered);
        
        return { success: true };
      })();
    }
  }

  if (channel === 'get-gpus') {
    return [{ name: 'Mock GPU 0', index: '0' }];
  }

  if (channel === 'import-participants') {
    return (async () => {
      saveLocalData('participants', args[0]);
      return { success: true };
    })();
  }

  if (channel === 'select-directory') {
    return (async () => {
      try {
        const { selectBrowserDirectory } = await import('./webFileSystem');
        const dirName = await selectBrowserDirectory();
        return { canceled: false, filePaths: [dirName] };
      } catch (e: any) {
        console.warn('Select directory canceled or failed:', e);
        return { canceled: false, filePaths: ['/mock/release/directory'] };
      }
    })();
  }

  if (channel === 'select-folder') {
    return (async () => {
      try {
        const { selectBrowserDirectory } = await import('./webFileSystem');
        const dirName = await selectBrowserDirectory();
        return { success: true, data: { path: dirName } };
      } catch (e: any) {
        console.warn('Select folder canceled or failed:', e);
        return { success: true, data: { path: '/mock/path' } };
      }
    })();
  }
  
  if (channel === 'select-file' || channel === 'dialog:openFile' || channel === 'dialog:showOpenDialog') {
    return (async () => {
      try {
        const { selectBrowserFile } = await import('./webFileSystem');
        const fileInfo = await selectBrowserFile();
        return { success: true, path: fileInfo.path, filePath: fileInfo.path, data: { path: fileInfo.path } };
      } catch (e: any) {
        console.warn('Select file canceled or failed, using mock path:', e);
        return { success: true, path: '/mock/selected/file.ass', filePath: '/mock/selected/file.ass', data: { path: '/mock/selected/file.ass' } };
      }
    })();
  }
  
  if (channel === 'get-raw-subtitles') {
    return (async () => {
      const filePath = args[0];
      if (filePath === 'standalone.ass') {
        const { idb } = await import('./idb');
        const text = await idb.get('standalone_sub_text');
        if (text) {
          return parseMemoryAss(text);
        }
      }
      
      if (filePath) {
        try {
          const { readFromLocalFolder } = await import('./webFileSystem');
          const file = await readFromLocalFolder(filePath);
          if (file instanceof File) {
            const text = await file.text();
            
            // Парсинг ASS контента
            const lines: any[] = [];
            const actorsSet = new Set<string>();
            const stylesSet = new Set<string>();
            const textLines = text.split(/\r?\n/);
            let isEvents = false;
            let rawLineIndex = 0;
            
            for (const line of textLines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('[Events]')) {
                isEvents = true;
                continue;
              }
              if (trimmed.startsWith('[')) {
                isEvents = false;
              }
              
              if (isEvents && trimmed.startsWith('Dialogue:')) {
                rawLineIndex++;
                const prefixLength = 'Dialogue:'.length;
                const parts = trimmed.substring(prefixLength).split(',');
                if (parts.length >= 9) {
                  const start = parts[1].trim();
                  const end = parts[2].trim();
                  const style = parts[3].trim();
                  const name = parts[4].trim();
                  const textVal = parts.slice(9).join(',').trim();
                  lines.push({
                    rawLineIndex,
                    start,
                    end,
                    style,
                    name,
                    text: textVal
                  });
                  if (name) actorsSet.add(name);
                  if (style) stylesSet.add(style);
                }
              }
            }
            
            if (lines.length > 0) {
              return {
                lines,
                actors: Array.from(actorsSet),
                styles: Array.from(stylesSet)
              };
            }
          }
        } catch (e) {
          console.warn('Failed to natively parse local .ass sub file, using fallback mock:', e);
        }
      }
      return {
        lines: [
          { rawLineIndex: 1, start: '0:00:00.00', end: '0:00:05.00', style: 'Default', name: 'Actor1', text: 'Hello world' },
          { rawLineIndex: 2, start: '0:00:05.00', end: '0:00:10.00', style: 'Default', name: 'Actor2', text: 'Hi there' },
          { rawLineIndex: 3, start: '0:00:10.00', end: '0:00:15.00', style: 'Default', name: 'Actor3', text: 'Testing' },
          { rawLineIndex: 4, start: '0:00:15.00', end: '0:00:20.00', style: 'Default', name: 'Actor4', text: 'More lines' },
          { rawLineIndex: 5, start: '0:00:20.00', end: '0:00:25.00', style: 'Default', name: 'Actor1', text: 'Another one' }
        ],
        actors: ['Actor1', 'Actor2', 'Actor3', 'Actor4'],
        styles: []
      };
    })();
  }

  if (channel === 'save-raw-subtitles') {
    return (async () => {
      const payload = args[0];
      const filePath = payload.filePath || payload.assFilePath;
      const lines = payload.lines;
      if (filePath && Array.isArray(lines)) {
        try {
          const { writeToLocalFolder } = await import('./webFileSystem');
          const header = `[Script Info]\nTitle: Anime Dub Manager\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
          const eventLines = lines.map(l => {
            return `Dialogue: 0,${l.start},${l.end},${l.style || 'Default'},${l.name || 'Actor'},0,0,0,,${l.text}`;
          }).join('\n');
          await writeToLocalFolder(filePath, header + eventLines);
          return { success: true };
        } catch (e) {
          console.error("Could not write edited subtitles to disk:", e);
        }
      }
      return { success: true };
    })();
  }

  if (channel === 'save-translated-subtitles') {
    return (async () => {
      const { assFilePath, translatedLines } = args[0] || {};
      if (assFilePath && Array.isArray(translatedLines)) {
        try {
          const { writeToLocalFolder } = await import('./webFileSystem');
          const header = `[Script Info]\nTitle: Anime Dub Manager\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
          const eventLines = translatedLines.map(l => {
            return `Dialogue: 0,${l.start},${l.end},${l.style || 'Default'},${l.name || 'Actor'},0,0,0,,${l.text}`;
          }).join('\n');
          await writeToLocalFolder(assFilePath, header + eventLines);
          return { success: true };
        } catch (e) {
          console.error("Could not write translated subtitles to disk:", e);
        }
      }
      return { success: true };
    })();
  }

  if (channel === 'silence-audio-intervals') {
    return { success: true };
  }

  if (channel === 'split-subs-by-dubber') {
    return { success: true, generatedFiles: ['actor1.ass', 'actor2.ass'] };
  }

  if (channel === 'split-subs-by-actor') {
    return { success: true, generatedFiles: ['actor1.ass', 'actor2.ass'] };
  }

  if (channel === 'export-full-ass-with-roles') {
    return { success: true, path: args[0].outputPath };
  }

  if (channel === 'copy-file') {
    return (async () => {
      const { fileName, targetDir } = args[0] || {};
      const pathValue = `${targetDir}/${fileName}`;
      try {
        const { readFromLocalFolder, writeToLocalFolder } = await import('./webFileSystem');
        const file = await readFromLocalFolder(fileName);
        if (file instanceof File) {
          await writeToLocalFolder(pathValue, file);
        }
        return { success: true, data: { path: pathValue } };
      } catch (e) {
        return { success: true, data: { path: pathValue } };
      }
    })();
  }

  if (channel === 'save-file-buffer') {
    return (async () => {
      const { fileName, targetDir, buffer } = args[0] || {};
      const pathValue = `${targetDir}/${fileName}`;
      try {
        const { writeToLocalFolder } = await import('./webFileSystem');
        if (buffer) {
          const blob = new Blob([buffer]);
          await writeToLocalFolder(pathValue, blob);
        }
        return { success: true, data: { path: pathValue } };
      } catch (e) {
        return { success: true, data: { path: pathValue } };
      }
    })();
  }

  if (channel === 'get-debug-stats') {
    return { cpu: 0, ram: 0, ffmpeg: [] };
  }

  if (channel === 'get-tasks') {
    return [];
  }

  if (channel === 'abort-task') {
    return true;
  }

  if (channel === 'clear-task-history') {
    return true;
  }

  // Anime365 Mock fallbacks for web preview
  if (channel === 'anime365-search-series') {
    const q = (args[0]?.query || '').toLowerCase();
    return [
      {
        id: 4242,
        title: "Sousou no Frieren",
        titles: { ru: "Фрирен, провожающая в последний путь", romaji: "Sousou no Frieren", ja: "葬送のフリーレン", en: "Frieren: Beyond Journey's End" },
        posterUrl: "https://shikimori.io/system/animes/original/52991.jpg",
        numberOfEpisodes: 28,
        year: 2023,
        typeTitle: "TV Сериал",
        isAiring: 0
      },
      {
        id: 8484,
        title: "Chainsaw Man",
        titles: { ru: "Человек-бензопила", romaji: "Chainsaw Man", ja: "チェンソーマン", en: "Chainsaw Man" },
        posterUrl: "https://shikimori.io/system/animes/original/44511.jpg",
        numberOfEpisodes: 12,
        year: 2022,
        typeTitle: "TV Сериал",
        isAiring: 0
      }
    ];
  }

  if (channel === 'anime365-get-series-details') {
    const id = args[0]?.id;
    return {
      id: id || 4242,
      title: "Sousou no Frieren",
      titles: { ru: "Фрирен, провожающая в последний путь", romaji: "Sousou no Frieren", ja: "葬送のフリーレン", en: "Frieren: Beyond Journey's End" },
      posterUrl: "https://shikimori.io/system/animes/original/52991.jpg",
      numberOfEpisodes: 28,
      year: 2023,
      typeTitle: "TV Сериал",
      isAiring: 0,
      descriptions: [{ source: "Anime365", value: "История эльфийки Фрирен, которая исследует новые земли и пытается понять человеческие эмоции после победы над Королём демонов." }],
      episodes: Array.from({ length: 28 }).map((_, idx) => ({
        id: 1000 + idx,
        episodeInt: String(idx + 1),
        episodeFull: `Серия ${idx + 1}`,
        episodeTitle: `Начало пути ${idx + 1}`
      }))
    };
  }

  if (channel === 'anime365-get-episode-translations') {
    return [
      {
        id: 5001,
        title: "Оригинал (RAW)",
        type: "raw",
        typeLang: "jpn",
        qualityType: "1080p",
        url: "https://smotret-anime.ru/translations/raw/5001.mp4",
        embedUrl: "https://smotret-anime.ru/translations/embed/5001",
        authorsSummary: "Original Audio",
        duration: "24:00"
      },
      {
        id: 5002,
        title: "Субтитры (Альянс)",
        type: "subtitles",
        typeLang: "rus",
        qualityType: "ass",
        url: "https://smotret-anime.ru/translations/sub/5002.ass",
        embedUrl: "",
        authorsSummary: "Альянс",
        duration: ""
      },
      {
        id: 5003,
        title: "Японские субтитры",
        type: "subtitles",
        typeLang: "jpn",
        qualityType: "ass",
        url: "https://smotret-anime.ru/translations/sub/5003.ass",
        embedUrl: "",
        authorsSummary: "Kitsunekko / Official Ja",
        duration: ""
      },
      {
        id: 5004,
        title: "Субтитры (Anilibria)",
        type: "subtitles",
        typeLang: "rus",
        qualityType: "srt",
        url: "https://smotret-anime.ru/translations/sub/5004.srt",
        embedUrl: "",
        authorsSummary: "Anilibria Subs Team",
        duration: ""
      }
    ];
  }

  if (channel === 'anime365-update-project-data') {
    const projectId = args[0]?.projectId;
    const projects = getLocalData('projects');
    const project = projects.find((p: any) => p.id === projectId);
    if (project) {
      project.synopsis = "История эльфийки Фрирен, которая исследует новые земли и пытается понять человеческие эмоции после победы над Королём демонов. (Обновлено из Anime365!)";
      project.posterUrl = "https://shikimori.io/system/animes/original/52991.jpg";
      project.totalEpisodes = 28;
      project.isOngoing = true;
      project.anime365Id = 4242;
      project.typeAndSeason = "TV-1";
      saveLocalData('projects', projects);
      return project;
    }
    return null;
  }

  if (channel === 'anime365-download-subtitle') {
    return { success: true, subPath: "/mock/user_data/projects/proj1/subs/episode_1_subs.ass" };
  }

  if (channel === 'anime365-check-new-episodes') {
    const projects = getLocalData('projects');
    const project = projects.find((p: any) => p.id === args[0]?.projectId);
    if (project) {
      const currentMax = (project.episodes || []).reduce((max: number, ep: any) => Math.max(max, ep.number), 0) || 0;
      return { maxEpisode: currentMax + 1, source: 'anime365' };
    }
    return { maxEpisode: null, source: 'none' };
  }

  // DIARIZATION, OLLAMA, AND VOICE BASE MOCKS FOR WEB COMPATIBILITY
  if (channel === 'check-diarization-status') {
    return { isLoaded: true, isLoading: false, downloadProgress: 100, loadingStatus: 'Ready' };
  }

  if (channel === 'check-ollama-status') {
    return { success: true, running: true };
  }

  if (channel === 'get-ollama-models') {
    return { success: true, models: ["qwen2.5:7b", "llama3.1:8b", "gemma2:9b", "mistral:7b"] };
  }

  if (channel === 'get-voice-base-characters') {
    const key = `voice_base_${args[0]?.projectName || 'default'}`;
    let saved = getLocalData(key);
    if (!saved || saved.length === 0) {
      saved = ["Танджиро", "Незуко", "Зеницу"];
      saveLocalData(key, saved);
    }
    return { success: true, characters: saved };
  }

  if (channel === 'delete-voice-profile') {
    const key = `voice_base_${args[0]?.projectName || 'default'}`;
    let saved = getLocalData(key) || [];
    saved = saved.filter((c: string) => c !== args[0]?.characterName);
    saveLocalData(key, saved);
    return { success: true };
  }

  if (channel === 'learn-voice-from-interval') {
    const key = `voice_base_${args[0]?.projectName || 'default'}`;
    const saved = getLocalData(key) || [];
    if (!saved.includes(args[0]?.characterName)) {
      saved.push(args[0]?.characterName);
      saveLocalData(key, saved);
    }
    return { success: true, character: args[0]?.characterName };
  }

  if (channel === 'auto-train-voice-base') {
    const key = `voice_base_${args[0]?.projectName || 'default'}`;
    const saved = getLocalData(key) || [];
    const newChars = ["Танджиро", "Незуко", "Иноске", "Зеницу"];
    newChars.forEach(c => {
      if (!saved.includes(c)) saved.push(c);
    });
    saveLocalData(key, saved);
    return { success: true, count: newChars.length };
  }

  if (channel === 'run-advanced-diarization-pipeline') {
    return (async () => {
      // Simulate steps with timeout
      await new Promise(r => setTimeout(r, 1500));
      
      const subLines = args[0]?.subtitleLines || [];
      const speakerMapping: Record<string, string> = {};
      
      // Assign mock speakers
      subLines.forEach((l: any, idx: number) => {
        speakerMapping[l.id] = idx % 2 === 0 ? 'Speaker 1' : 'Speaker 2';
      });

      return {
        success: true,
        speakerMapping,
        characterAssignments: {
          'Speaker 1': 'Незуко',
          'Speaker 2': 'Танджиро'
        },
        detectedSpeakersCount: 2
      };
    })();
  }

  if (channel === 'telegram-mtproto-get-status') {
    return {
      status: 'connected',
      me: { id: '777000', firstName: 'Akane', lastName: 'Studio', username: 'akaneproject_bot', phone: '+79990000000' },
      settings: {
        apiId: 2040,
        apiHash: 'b18441a1ed607e10a39be2731a544f07',
        phoneNumber: '+79990000000',
        defaultChannelId: '@akaneproject',
        autoPin: false,
        autoNotify: true,
        parseMode: 'html',
        headerTemplate: '✨ <b>{title_ru}</b> [{episode_number} СЕРИЯ]',
        footerTemplate: '📌 Смотреть: {site_link}\n💬 Обсуждение: {tg_group}',
        startNoticeTemplate: '🎬 <b>СТАРТ РАБОТЫ НАД СЕРИЕЙ!</b>\n📌 <b>{project_title}</b> — Серия {episode_number}\n\n👥 <b>Состав команды:</b>\n{dubbers_list}\n\n📅 <b>ДЕДЛАЙН:</b> {deadline}\n🔗 <b>Материалы:</b> {source_link}',
        reminderTemplate: '⏰ <b>НАПОМИНАНИЕ О ДЕДЛАЙНЕ!</b>\nРелиз: <b>{project_title}</b> (Серия {episode_number})\n\nКоллеги, ожидаем ваши дорожки:\n{pending_dubbers}\n\nПросьба дописать как можно скорее! 🙏',
        fixNoticeTemplate: '⚠️ <b>СПИСОК ФИКСОВ / ПРАВОК</b>\nКому: {dubber_mention}\nПроект: <b>{project_title}</b> (Серия {episode_number})\n\n{fixes_list}',
        trackReceivedTemplate: '🎙️ <b>ДОРОЖКА ПРИНЯТА!</b>\nДабер: {dubber_name}\nСерия: {episode_number}\nСтатус: ✅ Готово к сведению',
        hasSession: true
      }
    };
  }

  if (channel === 'telegram-mtproto-get-dialogs') {
    return [
      {
        id: '-1001234567890',
        title: 'Akane Project | Официальный канал',
        username: 'akaneproject',
        type: 'channel',
        unreadCount: 0,
        lastMessage: '🎬 Вышла 12-я серия «Истребитель демонов»! Приятного просмотра!',
        date: '14:20'
      },
      {
        id: '-1009876543210',
        title: 'Akane Team | Рабочий чат озвучки',
        username: 'akaneteam_chat',
        type: 'group',
        unreadCount: 3,
        lastMessage: 'Ребята, ждем дорожки Танджиро по 12 серии до 18:00!',
        date: '14:15'
      },
      {
        id: '-1005554443322',
        title: 'Akane Sound Lab | Звукорежиссура и Сведение',
        username: 'akanesound_lab',
        type: 'group',
        unreadCount: 1,
        lastMessage: 'Сведение 5 серии Фрирен завершено, заливаем на сервер.',
        date: '13:50'
      },
      {
        id: '-1001122334455',
        title: 'Фрирен: Рабочая группа 1 сезона',
        username: 'frieren_voice_group',
        type: 'group',
        unreadCount: 0,
        lastMessage: 'Все роли распределены. Дедлайн записи — пятница.',
        date: 'Вчера'
      },
      {
        id: '-1009988776655',
        title: 'Анонсы и Новости Аниме | Akane',
        username: 'akane_announcements',
        type: 'channel',
        unreadCount: 0,
        lastMessage: 'График выходов релизов на текущую неделю обновлен.',
        date: 'Вчера'
      },
      {
        id: '777000',
        title: 'Telegram Service',
        username: 'telegram',
        type: 'user',
        unreadCount: 0,
        lastMessage: 'Код подтверждения для входа: 48291',
        date: '03.08'
      }
    ];
  }

  if (channel === 'telegram-mtproto-send-post' || channel === 'telegram-mtproto-send-automation') {
    return { success: true, messageId: Math.floor(Math.random() * 10000) + 100 };
  }

  if (channel === 'telegram-mtproto-save-settings') {
    return args[0] || {};
  }

  if (channel === 'telegram-mtproto-send-code') {
    return { 
      success: true, 
      phoneCodeHash: 'mock_code_hash_12345', 
      isCodeViaApp: true, 
      deliveryMethod: 'app',
      formattedPhone: args[0]?.phoneNumber || '+79990000000',
      message: 'Код отправлен в приложение Telegram (чат «Telegram» / ID 777000)'
    };
  }

  if (channel === 'telegram-mtproto-resend-code') {
    return { 
      success: true, 
      phoneCodeHash: 'mock_code_hash_12345', 
      isCodeViaApp: false, 
      deliveryMethod: 'sms',
      message: 'Код отправлен по SMS'
    };
  }

  if (channel === 'telegram-mtproto-start-qr') {
    return {
      success: true,
      qrUrl: 'tg://login?token=mock_qr_token_sample',
      qrDataUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="%23ffffff"/><rect x="20" y="20" width="50" height="50" fill="%23000000"/><rect x="130" y="20" width="50" height="50" fill="%23000000"/><rect x="20" y="130" width="50" height="50" fill="%23000000"/><rect x="80" y="80" width="40" height="40" fill="%230088cc"/></svg>',
      expires: Math.floor(Date.now() / 1000) + 30
    };
  }

  if (channel === 'telegram-mtproto-check-qr') {
    return {
      active: true,
      status: 'waiting_scan',
      qrUrl: 'tg://login?token=mock_qr_token_sample',
      qrDataUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="%23ffffff"/><rect x="20" y="20" width="50" height="50" fill="%23000000"/><rect x="130" y="20" width="50" height="50" fill="%23000000"/><rect x="20" y="130" width="50" height="50" fill="%23000000"/><rect x="80" y="80" width="40" height="40" fill="%230088cc"/></svg>',
      expires: Math.floor(Date.now() / 1000) + 30
    };
  }

  if (channel === 'telegram-mtproto-cancel-qr') {
    return { success: true };
  }

  if (channel === 'telegram-mtproto-submit-password') {
    return {
      success: true,
      me: { id: '777000', firstName: 'Akane', lastName: 'Studio', username: 'akaneproject', phone: '+79990000000' }
    };
  }

  if (channel === 'telegram-mtproto-sign-in') {
    return {
      status: 'connected',
      me: { id: '777000', firstName: 'Akane', lastName: 'Studio', username: 'akaneproject_bot', phone: '+79990000000' }
    };
  }

  if (channel === 'telegram-mtproto-get-audio-files') {
    return {
      success: true,
      files: [
        {
          id: 10421,
          date: Math.floor(Date.now() / 1000) - 1800,
          dateFormatted: 'Сегодня, 14:10',
          sender: { id: '112233', name: 'Александр Ветров', username: 'alex_voice' },
          fileName: 'Frieren_05_Himmel_Alex.wav',
          mimeType: 'audio/wav',
          size: 14680000,
          sizeFormatted: '14.00 MB',
          duration: 184,
          durationFormatted: '3:04',
          isVoice: false,
          caption: 'Химмель, реплики с 04:12 по 07:16. Дубль 2 почищен от шумов.'
        },
        {
          id: 10420,
          date: Math.floor(Date.now() / 1000) - 3600,
          dateFormatted: 'Сегодня, 13:40',
          sender: { id: '445566', name: 'Мария Соколова', username: 'masha_dub' },
          fileName: 'Frieren_05_Frieren_Voice_Take1.ogg',
          mimeType: 'audio/ogg',
          size: 4200000,
          sizeFormatted: '4.01 MB',
          duration: 112,
          durationFormatted: '1:52',
          isVoice: true,
          caption: 'Голосовое: Фрирен — сцена на кладбище (добавила дыхание).'
        },
        {
          id: 10418,
          date: Math.floor(Date.now() / 1000) - 7200,
          dateFormatted: 'Сегодня, 12:45',
          sender: { id: '778899', name: 'Дмитрий Кузнецов', username: 'dima_sound' },
          fileName: 'Kimetsu_12_Tanjiro_FullTrack.wav',
          mimeType: 'audio/wav',
          size: 28400000,
          sizeFormatted: '27.08 MB',
          duration: 345,
          durationFormatted: '5:45',
          isVoice: false,
          caption: 'Танджиро, 12 серия целиком с таймкодами.'
        }
      ]
    };
  }

  if (channel === 'telegram-mtproto-search-posts') {
    const query = args[0]?.query || '';
    return {
      success: true,
      posts: [
        {
          id: 842,
          date: Math.floor(Date.now() / 1000) - 86400,
          dateFormatted: 'Вчера, 18:30',
          text: `✨ <b>Провожающая в последний путь Фрирен</b> [5 СЕРИЯ]\n\nОзвучка: Akane Project\nРоли: Александр, Мария, Дмитрий\n\n📌 Смотреть: https://akane.club/frieren/5\n💬 Обсуждение: @akaneteam_chat`,
          views: 3420,
          forwards: 128,
          hasMedia: true,
          link: 'https://t.me/akaneproject/842'
        },
        {
          id: 839,
          date: Math.floor(Date.now() / 1000) - 172800,
          dateFormatted: '02.09.2024, 21:15',
          text: `✨ <b>Клинок, рассекающий демонов</b> [12 СЕРИЯ]\n\nФинальная серия арки!\n\n📌 Смотреть: https://akane.club/kimetsu/12\n💬 Чат: @akaneteam_chat`,
          views: 5120,
          forwards: 254,
          hasMedia: true,
          link: 'https://t.me/akaneproject/839'
        }
      ].filter(p => !query || p.text.toLowerCase().includes(query.toLowerCase()))
    };
  }

  if (channel === 'telegram-mtproto-get-messages') {
    return {
      success: true,
      messages: [
        {
          id: '1',
          senderName: 'Александр Ветров',
          text: 'Всем привет! Дорожки Химмеля по 5 серии готовы и залиты в чат.',
          time: '14:10',
          isMe: false,
          isPinned: false
        },
        {
          id: '2',
          senderName: 'Мария Соколова',
          text: 'Мои реплики Фрирен тоже готовы, прикрепила чуть выше аудио-сообщением 🎙️',
          time: '14:12',
          isMe: false,
          isPinned: false
        },
        {
          id: '3',
          senderName: 'Вы',
          text: 'Супер, забираю в работу на сведение! Пост релиза запланирован на 19:00.',
          time: '14:15',
          isMe: true,
          isPinned: true
        }
      ]
    };
  }

  if (channel === 'telegram-mtproto-download-audio') {
    return {
      success: true,
      filePath: '/downloads/telegram_tracks/track_sample.wav',
      fileName: 'track_sample.wav',
      fileSize: 14680000
    };
  }

  if (channel === 'telegram-bot-test-connection') {
    return {
      success: true,
      bot: {
        id: 777000123,
        username: 'AkaneDubBot',
        firstName: 'Akane Dubbing Bot'
      }
    };
  }

  if (channel === 'telegram-mtproto-logout') {
    return { success: true };
  }

  return { success: true, mocked: true };
}
