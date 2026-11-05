import { readFromLocalFolder, writeToLocalFolder } from './webFileSystem';
import { handleProjectsAndMediaIpcMock } from './ipc/ipcProjectsAndMediaMock.service';
import { handleIntegrationsIpcMock } from './ipc/ipcIntegrationsMock.service';

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

    // Browser fallback for AI Studio preview - Try calling the server API with AbortController timeout
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const isLongRunning =
      channel.includes('vst3') ||
      channel.includes('render') ||
      channel.includes('export') ||
      channel.includes('timing') ||
      channel.includes('whisper') ||
      channel.includes('diarization') ||
      channel.includes('download') ||
      channel.includes('ai-');
    const timeoutMs = isLongRunning ? 120000 : 25000;
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const url = origin && !origin.startsWith('file') ? `${origin}/api/ipc/${channel}` : `/api/ipc/${channel}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args }),
        ...(controller ? { signal: controller.signal } : {})
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) return result.data;
        const err = new Error(result.error || `IPC error on ${channel}`);
        (err as any)._fromServer = true;
        if (result.stack) (err as any).stack = result.stack;
        if (result.stderr) (err as any).stderr = result.stderr;
        if (result.stdout) (err as any).stdout = result.stdout;
        if (result.code) (err as any).code = result.code;
        throw err;
      } else {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        const err = new Error(errorData.error || `Server status ${response.status}`);
        (err as any)._fromServer = true;
        if (errorData.stack) (err as any).stack = errorData.stack;
        if (errorData.stderr) (err as any).stderr = errorData.stderr;
        if (errorData.stdout) (err as any).stdout = errorData.stdout;
        if (errorData.code) (err as any).code = errorData.code;
        throw err;
      }
    } catch (e: any) {
      if (e && e._fromServer) {
        throw e;
      }
      if (channel.startsWith('telegram-')) {
        throw e;
      }
      if (e && e.name === 'AbortError') {
        console.warn(`Server IPC fallback timed out after ${timeoutMs}ms for "${channel}"`);
      } else {
        console.warn(`Server IPC fallback failed for "${channel}":`, e);
      }

      // If we are on the web and the server call failed (offline static preview), check mock services
      const mockedResult = handleIpcMock(channel, args);
      if (mockedResult !== undefined) return mockedResult;

      throw e;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  },
  send: (channel: string, ...args: any[]) => {
    if (window.electronAPI && window.electronAPI.send) {
      window.electronAPI.send(channel, ...args);
    }
  },
  on: (channel: string, callback: (...args: any[]) => void): (() => void) => {
    let cleanup: () => void;
    if (window.electronAPI && window.electronAPI.on) {
      cleanup = window.electronAPI.on(channel, callback);
    } else {
      const handler = (e: any) => {
        if (e && e.detail !== undefined) {
          callback(e.detail);
        } else {
          callback(e);
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

if (typeof window !== 'undefined' && !(window as any).electronAPI && typeof EventSource !== 'undefined') {
  try {
    const sse = new EventSource('/api/ipc/events');
    sse.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload && payload.channel) {
          window.dispatchEvent(new CustomEvent(payload.channel, { detail: payload.data }));
        }
      } catch (err) {
        console.debug('[IPC SSE] Malformed event payload:', err);
      }
    };
  } catch (err) {
    console.debug('[IPC SSE] EventSource initialization skipped:', err);
  }
}

export let isStorageSynced = false;

export async function syncAndLoadFromDir() {
  try {
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
                mergedList.push(folderItem);
              } else {
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
  const projMediaRes = handleProjectsAndMediaIpcMock(channel, args);
  if (projMediaRes.handled) {
    return projMediaRes.result;
  }

  const integrationsRes = handleIntegrationsIpcMock(channel, args);
  if (integrationsRes.handled) {
    return integrationsRes.result;
  }

  return { success: true, mocked: true };
}
