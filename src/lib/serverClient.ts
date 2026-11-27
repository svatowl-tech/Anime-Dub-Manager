export interface ServerAuthStatus {
  reachable: boolean;
  serverMode: boolean;
  authRequired: boolean;
  needsSetup: boolean;
  authenticated: boolean;
  dataDir?: string;
  arch?: string;
}

export interface AgentConnectionInfo {
  agentToken: string;
  managedByEnv?: boolean;
  mcpUrl: string;
  sseUrl: string;
  restBaseUrl: string;
  openApiUrl: string;
}

export type InboxCategory =
  | 'approval'
  | 'qa_alert'
  | 'assignment_review'
  | 'download_issue'
  | 'release_ready'
  | 'note'
  | 'info';

export type InboxSeverity = 'info' | 'warning' | 'action_required' | 'critical';
export type InboxStatus = 'pending' | 'approved' | 'rejected' | 'noted' | 'resolved';

export interface CuratorInboxItem {
  id: string;
  title: string;
  message: string;
  category: InboxCategory;
  severity: InboxSeverity;
  status: InboxStatus;
  read: boolean;
  projectId?: string;
  projectTitle?: string;
  episodeId?: string;
  episodeNumber?: number;
  targetTab?: string;
  proposedAction?: string;
  metadata?: Record<string, any>;
  curatorNote?: string;
  source: 'ai_agent' | 'system' | 'telegram';
  telegramMessageId?: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface InboxSummary {
  unreadCount: number;
  pendingCount: number;
  total: number;
}

export interface ServerFileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  mtime: string;
  ext: string;
}

export interface BrowseServerResult {
  rootDir: string;
  currentDir: string;
  parentDir: string | null;
  items: ServerFileItem[];
}

let cachedServerProbe: { checked: boolean; liveServer: boolean; serverMode: boolean } = {
  checked: false,
  liveServer: false,
  serverMode: false,
};

export function markLiveServerState(liveServer: boolean, serverMode: boolean) {
  cachedServerProbe = { checked: true, liveServer, serverMode };
}

export function isCachedServerMode(): boolean {
  return cachedServerProbe.serverMode;
}

export async function probeServerCapabilities(): Promise<{ liveServer: boolean; serverMode: boolean }> {
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    return { liveServer: false, serverMode: false };
  }
  if (cachedServerProbe.checked) {
    return { liveServer: cachedServerProbe.liveServer, serverMode: cachedServerProbe.serverMode };
  }
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 3000) : null;
    const res = await fetch('/api/health', {
      credentials: 'include',
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (timer) clearTimeout(timer);
    if (res.ok) {
      const json = await res.json();
      cachedServerProbe = {
        checked: true,
        liveServer: Boolean(json?.ok),
        serverMode: Boolean(json?.serverMode),
      };
      return { liveServer: cachedServerProbe.liveServer, serverMode: cachedServerProbe.serverMode };
    }
  } catch {
    // Offline static preview
  }
  cachedServerProbe = { checked: true, liveServer: false, serverMode: false };
  return { liveServer: false, serverMode: false };
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.success === false) {
    throw new Error(payload?.error || `HTTP ${res.status}`);
  }
  return (payload?.data !== undefined ? payload.data : payload) as T;
}

export async function getServerAuthStatus(): Promise<ServerAuthStatus> {
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    return {
      reachable: false,
      serverMode: false,
      authRequired: false,
      needsSetup: false,
      authenticated: true,
    };
  }
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 4000) : null;
    const res = await fetch('/api/auth/status', {
      credentials: 'include',
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (timer) clearTimeout(timer);
    if (!res.ok) {
      return {
        reachable: false,
        serverMode: false,
        authRequired: false,
        needsSetup: false,
        authenticated: true,
      };
    }
    const json = await res.json();
    const data = json?.data || {};
    const status: ServerAuthStatus = {
      reachable: true,
      serverMode: Boolean(data.serverMode),
      authRequired: Boolean(data.authRequired),
      needsSetup: Boolean(data.needsSetup),
      authenticated: Boolean(data.authenticated),
      dataDir: data.dataDir,
      arch: data.arch,
    };
    markLiveServerState(true, status.serverMode);
    return status;
  } catch {
    return {
      reachable: false,
      serverMode: false,
      authRequired: false,
      needsSetup: false,
      authenticated: true,
    };
  }
}

export async function setupServerAuth(mode: 'password' | 'open', password = ''): Promise<{ mode: string }> {
  const res = await fetch('/api/auth/setup', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, password }),
  });
  const data = await parseJsonResponse<{ mode: string }>(res);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('adm-auth-authenticated'));
  }
  return data;
}

export async function loginServerAuth(passwordOrToken: string): Promise<{ authenticated: boolean }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: passwordOrToken }),
  });
  const data = await parseJsonResponse<{ authenticated: boolean }>(res);
  if (typeof window !== 'undefined' && data?.authenticated) {
    window.dispatchEvent(new Event('adm-auth-authenticated'));
  }
  return data;
}

export async function logoutServerAuth(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('adm-auth-logout'));
  }
}

export async function configureServerAuth(mode: 'password' | 'open', password = ''): Promise<{ authRequired: boolean }> {
  const res = await fetch('/api/auth/configure', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, password }),
  });
  const data = await parseJsonResponse<{ authRequired: boolean }>(res);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('adm-auth-authenticated'));
  }
  return data;
}

export async function getAgentConnectionInfo(): Promise<AgentConnectionInfo> {
  const res = await fetch('/api/auth/agent-token', { credentials: 'include' });
  return parseJsonResponse(res);
}

export async function regenerateAgentToken(): Promise<{ agentToken: string }> {
  const res = await fetch('/api/auth/regenerate-agent-token', {
    method: 'POST',
    credentials: 'include',
  });
  return parseJsonResponse(res);
}

export async function fetchCuratorInbox(params?: {
  status?: string;
  projectId?: string;
  limit?: number;
}): Promise<{ items: CuratorInboxItem[]; summary: InboxSummary }> {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.projectId) q.set('projectId', params.projectId);
  if (params?.limit) q.set('limit', String(params.limit));
  const qs = q.toString();
  const res = await fetch(`/api/inbox${qs ? `?${qs}` : ''}`, { credentials: 'include' });
  return parseJsonResponse(res);
}

export async function respondCuratorInbox(
  id: string,
  payload: { status?: InboxStatus; curatorNote?: string; read?: boolean }
): Promise<CuratorInboxItem> {
  const res = await fetch(`/api/inbox/${encodeURIComponent(id)}/respond`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(res);
}

export async function markAllInboxRead(): Promise<void> {
  const res = await fetch('/api/inbox/mark-all-read', {
    method: 'POST',
    credentials: 'include',
  });
  await parseJsonResponse(res);
}

export async function clearResolvedInbox(): Promise<{ removed: number }> {
  const res = await fetch('/api/inbox/clear-resolved', {
    method: 'POST',
    credentials: 'include',
  });
  return parseJsonResponse(res);
}

export async function deleteInboxItem(id: string): Promise<void> {
  const res = await fetch(`/api/inbox/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  await parseJsonResponse(res);
}

export async function browseServerFiles(dir?: string): Promise<BrowseServerResult> {
  const qs = dir ? `?dir=${encodeURIComponent(dir)}` : '';
  const res = await fetch(`/api/files/browse${qs}`, { credentials: 'include' });
  return parseJsonResponse(res);
}

export async function createServerDirectory(dir: string): Promise<{ path: string }> {
  const res = await fetch('/api/files/mkdir', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dir }),
  });
  return parseJsonResponse(res);
}

export function getServerDownloadUrl(filePath: string): string {
  return `/api/files/download?path=${encodeURIComponent(filePath)}`;
}

export function uploadFileToServer(
  file: File,
  options: { targetDir?: string; fileName?: string; convertSubtitles?: boolean },
  onProgress?: (percent: number) => void
): Promise<{ path: string; filePath: string; fileName: string; size: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files/upload', true);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) {
        onProgress(Math.min(99, Math.round((ev.loaded / ev.total) * 100)));
      }
    };

    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300 && json?.success) {
          if (onProgress) onProgress(100);
          resolve(json.data);
        } else {
          reject(new Error(json?.error || `Upload failed (${xhr.status})`));
        }
      } catch {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error('Сетевая ошибка при загрузке файла на сервер'));

    const form = new FormData();
    form.append('file', file);
    if (options.targetDir) form.append('targetDir', options.targetDir);
    if (options.fileName) form.append('fileName', options.fileName);
    if (options.convertSubtitles) form.append('convertSubtitles', 'true');
    xhr.send(form);
  });
}
