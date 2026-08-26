import { isWeb, ipcSafe } from './ipcSafe';

let cachedPreloadPath: string | undefined =
  typeof window !== 'undefined' ? (window as any).electronAPI?.browserPreloadPath : undefined;

export function getBrowserPreloadPath(): string | undefined {
  if (isWeb) return undefined;
  if (cachedPreloadPath) return cachedPreloadPath;
  if (typeof window !== 'undefined' && (window as any).electronAPI?.browserPreloadPath) {
    cachedPreloadPath = (window as any).electronAPI.browserPreloadPath;
    return cachedPreloadPath;
  }
  return undefined;
}

export async function fetchBrowserPreloadPath(): Promise<string | undefined> {
  if (isWeb) return undefined;
  const syncPath = getBrowserPreloadPath();
  if (syncPath) return syncPath;
  try {
    const res = await ipcSafe.invoke('get-browser-preload-path');
    if (res && typeof res === 'string') {
      cachedPreloadPath = res;
      return res;
    }
  } catch (e) {}
  return undefined;
}
