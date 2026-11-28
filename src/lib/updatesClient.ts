import { ipcRenderer } from './ipc';
import { isWeb } from './ipcSafe';

export interface AiEnvStatusDto {
  installed: boolean;
  ready: boolean;
  installing?: boolean;
  platformTag: string;
  activeDir: string;
  pythonPath?: string | null;
  installedHash: string | null;
  expectedHash: string | null;
  remoteHash: string | null;
  remoteAssetUrl?: string | null;
  remoteSha256?: string | null;
  remoteSize?: number | null;
  needsInstall: boolean;
  updateAvailable: boolean;
  hashMismatch?: boolean;
}

export interface UnifiedUpdateStatus {
  mode: 'desktop' | 'server';
  hotSwapSupported?: boolean;
  status:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'installing'
    | 'restarting'
    | 'error';
  stageMessage?: string | null;
  currentVersion: string;
  commitHash?: string | null;
  buildDate?: string | null;
  availableVersion?: string | null;
  availableTagName?: string | null;
  releaseNotes?: string | null;
  releaseUrl?: string;
  downloadPercent?: number;
  bytesPerSecond?: number;
  appUpdateAvailable?: boolean;
  aiEnvUpdateAvailable?: boolean;
  aiEnvNeedsInstall?: boolean;
  activeAppSource?: 'hot-swap' | 'image';
  canRollback?: boolean;
  checkedAt?: string | null;
  lastUpdatedAt?: string | null;
  rolledBackAt?: string | null;
  error?: string | null;
  pendingInboxItemId?: string | null;
  aiEnv?: AiEnvStatusDto | null;
}

export interface EnvDownloadProgressDto {
  status: 'downloading' | 'verifying' | 'extracting' | 'ready' | 'error';
  percent: number;
  message: string;
  downloadedBytes?: number;
  totalBytes?: number;
}

function unwrapIpc(res: any) {
  if (res && typeof res === 'object' && 'success' in res) {
    if (!res.success) throw new Error(res.error || 'IPC error');
    return res.data !== undefined ? res.data : res;
  }
  return res;
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || (body && body.success === false)) {
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  return body?.data ?? body;
}

export async function getUpdateStatus(): Promise<UnifiedUpdateStatus> {
  if (!isWeb) {
    const res = unwrapIpc(await ipcRenderer.invoke('app-get-update-status'));
    return {
      ...res,
      appUpdateAvailable: res.status === 'available' || res.status === 'downloading' || res.status === 'downloaded',
      aiEnvUpdateAvailable: Boolean(res.aiEnv?.updateAvailable),
      aiEnvNeedsInstall: Boolean(res.aiEnv?.needsInstall),
    };
  }
  return await fetchJson('/api/updates/status');
}

export async function checkForSystemUpdates(): Promise<UnifiedUpdateStatus> {
  if (!isWeb) {
    const res = unwrapIpc(await ipcRenderer.invoke('app-check-updates'));
    return {
      ...res,
      appUpdateAvailable: res.status === 'available' || res.status === 'downloading' || res.status === 'downloaded',
      aiEnvUpdateAvailable: Boolean(res.aiEnv?.updateAvailable),
      aiEnvNeedsInstall: Boolean(res.aiEnv?.needsInstall),
    };
  }
  return await fetchJson('/api/updates/check', { method: 'POST' });
}

export async function downloadDesktopUpdate(): Promise<void> {
  unwrapIpc(await ipcRenderer.invoke('app-download-update'));
}

export async function installDesktopUpdate(): Promise<void> {
  unwrapIpc(await ipcRenderer.invoke('app-install-update'));
}

export async function applyServerUpdate(force = false): Promise<UnifiedUpdateStatus> {
  return await fetchJson('/api/updates/apply', {
    method: 'POST',
    body: JSON.stringify({ force }),
  });
}

export async function rollbackServerUpdate(): Promise<UnifiedUpdateStatus> {
  return await fetchJson('/api/updates/rollback', { method: 'POST' });
}

export async function getAiEnvStatus(checkRemote = false): Promise<AiEnvStatusDto> {
  const res = unwrapIpc(await ipcRenderer.invoke('get-ai-env-status', { checkRemote }));
  return res;
}

export async function installOrUpdateAiEnv(force = false): Promise<{ success: boolean; status: AiEnvStatusDto }> {
  const res = unwrapIpc(await ipcRenderer.invoke('install-or-update-ai-env', { force }));
  return res;
}

export function subscribeUpdateStatus(cb: (status: UnifiedUpdateStatus) => void): () => void {
  return ipcRenderer.on('app-update-status', (payload: any) => {
    if (payload) {
      cb({
        ...payload,
        appUpdateAvailable:
          payload.appUpdateAvailable ??
          (payload.status === 'available' || payload.status === 'downloading' || payload.status === 'downloaded'),
        aiEnvUpdateAvailable: payload.aiEnvUpdateAvailable ?? Boolean(payload.aiEnv?.updateAvailable),
        aiEnvNeedsInstall: payload.aiEnvNeedsInstall ?? Boolean(payload.aiEnv?.needsInstall),
      });
    }
  });
}

export function subscribeAiEnvProgress(cb: (progress: EnvDownloadProgressDto) => void): () => void {
  return ipcRenderer.on('env-download-progress', (payload: any) => {
    if (payload) cb(payload);
  });
}
