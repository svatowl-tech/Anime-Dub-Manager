import crypto from 'crypto';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import type { Request, Response, NextFunction } from 'express';
import type { ServerRuntimeConfig } from './serverConfig.ts';

export interface ServerAuthState {
  initialized: boolean;
  uiAuthMode: 'open' | 'password';
  passwordHash: string;
  passwordSalt: string;
  sessionSecret: string;
  agentToken: string;
  updatedAt: string;
}

const SESSION_COOKIE_NAME = 'adm_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    if (key) out[key] = val;
  }
  return out;
}

export function isPathWithinRoots(targetPath: string, allowedRoots: string[]): boolean {
  const resolvedTarget = path.resolve(targetPath);
  for (const root of allowedRoots) {
    if (!root) continue;
    const resolvedRoot = path.resolve(root);
    if (resolvedTarget === resolvedRoot) return true;
    const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
    if (resolvedTarget.startsWith(prefix)) return true;
  }
  return false;
}

export function resolveConfinedPath(rawPath: string, baseDir: string, extraRoots: string[] = []): string {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error('Path is required');
  }
  const clean = rawPath.trim().replace(/\0/g, '');
  const resolved = path.isAbsolute(clean) ? path.resolve(clean) : path.resolve(baseDir, clean);
  const allowed = [baseDir, ...extraRoots].filter(Boolean);
  if (!isPathWithinRoots(resolved, allowed)) {
    throw new Error(`Access denied: path escapes allowed server storage (${resolved})`);
  }
  return resolved;
}

export class ServerAuthManager {
  private config: ServerRuntimeConfig;
  private authFilePath: string;
  private state: ServerAuthState | null = null;

  constructor(config: ServerRuntimeConfig) {
    this.config = config;
    this.authFilePath = path.join(config.dataDir, 'server_auth.json');
  }

  async init(): Promise<ServerAuthState> {
    await fs.mkdir(this.config.dataDir, { recursive: true });
    let loaded: Partial<ServerAuthState> | null = null;
    try {
      if (fsSync.existsSync(this.authFilePath)) {
        const raw = await fs.readFile(this.authFilePath, 'utf8');
        loaded = JSON.parse(raw);
      }
    } catch {
      loaded = null;
    }

    const sessionSecret = loaded?.sessionSecret || crypto.randomBytes(32).toString('hex');
    const agentToken =
      this.config.agentToken ||
      loaded?.agentToken ||
      `adm_agent_${crypto.randomBytes(24).toString('hex')}`;

    let uiAuthMode: 'open' | 'password' = loaded?.uiAuthMode === 'password' ? 'password' : 'open';
    let passwordHash = loaded?.passwordHash || '';
    let passwordSalt = loaded?.passwordSalt || '';
    let initialized = Boolean(loaded?.initialized);

    if (this.config.accessToken) {
      uiAuthMode = 'password';
      passwordSalt = passwordSalt || crypto.randomBytes(16).toString('hex');
      passwordHash = hashPassword(this.config.accessToken, passwordSalt);
      initialized = true;
    }

    this.state = {
      initialized,
      uiAuthMode,
      passwordHash,
      passwordSalt,
      sessionSecret,
      agentToken,
      updatedAt: new Date().toISOString(),
    };

    await this.persist();
    return this.state;
  }

  private async persist(): Promise<void> {
    if (!this.state) return;
    await fs.writeFile(this.authFilePath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  getState(): ServerAuthState {
    if (!this.state) {
      throw new Error('ServerAuthManager is not initialized');
    }
    return this.state;
  }

  isAgentTokenManagedByEnv(): boolean {
    return Boolean(this.config.agentToken);
  }

  getAgentToken(): string {
    return this.config.agentToken || this.getState().agentToken;
  }

  async regenerateAgentToken(): Promise<string> {
    if (this.config.agentToken) {
      throw new Error('Токен агента задан через переменную окружения ADM_AGENT_TOKEN и не может быть перевыпущен из интерфейса');
    }
    const state = this.getState();
    state.agentToken = `adm_agent_${crypto.randomBytes(24).toString('hex')}`;
    state.updatedAt = new Date().toISOString();
    await this.persist();
    return state.agentToken;
  }

  isUiAuthEnabled(): boolean {
    if (!this.config.isServerMode && !this.config.accessToken && process.env.ADM_REQUIRE_AUTH !== 'true') {
      return false;
    }
    const state = this.getState();
    return state.uiAuthMode === 'password' && Boolean(state.passwordHash);
  }

  needsInitialSetup(): boolean {
    if (!this.config.isServerMode) return false;
    if (this.config.accessToken) return false;
    return !this.getState().initialized;
  }

  private signSessionToken(role: 'curator'): string {
    const state = this.getState();
    const exp = Date.now() + SESSION_TTL_MS;
    const payload = `${role}.${exp}`;
    const sig = crypto.createHmac('sha256', state.sessionSecret).update(payload).digest('hex');
    return `${payload}.${sig}`;
  }

  verifySessionToken(token?: string): boolean {
    if (!token) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [role, expStr, sig] = parts;
    if (role !== 'curator') return false;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || Date.now() > exp) return false;
    const state = this.getState();
    const expectedSig = crypto
      .createHmac('sha256', state.sessionSecret)
      .update(`${role}.${expStr}`)
      .digest('hex');
    return timingSafeStringEqual(sig, expectedSig);
  }

  verifyCuratorSecret(secret: string): boolean {
    if (!secret) return false;
    if (this.config.accessToken && timingSafeStringEqual(secret, this.config.accessToken)) {
      return true;
    }
    const state = this.getState();
    if (!state.passwordHash || !state.passwordSalt) return false;
    const computed = hashPassword(secret, state.passwordSalt);
    return timingSafeStringEqual(computed, state.passwordHash);
  }

  verifyAgentToken(token?: string): boolean {
    if (!token) return false;
    const expected = this.getAgentToken();
    return Boolean(expected) && timingSafeStringEqual(token, expected);
  }

  async configureAuth(mode: 'open' | 'password', password?: string): Promise<void> {
    const state = this.getState();
    if (mode === 'password') {
      if (!password || password.trim().length < 4) {
        throw new Error('Пароль или PIN должен содержать минимум 4 символа');
      }
      const salt = crypto.randomBytes(16).toString('hex');
      state.uiAuthMode = 'password';
      state.passwordSalt = salt;
      state.passwordHash = hashPassword(password.trim(), salt);
    } else {
      state.uiAuthMode = 'open';
      state.passwordHash = '';
      state.passwordSalt = '';
    }
    state.initialized = true;
    state.updatedAt = new Date().toISOString();
    await this.persist();
  }

  isRequestAuthenticatedForUi(req: Request): boolean {
    if (!this.isUiAuthEnabled()) return true;
    const cookies = parseCookies(req.headers.cookie);
    if (this.verifySessionToken(cookies[SESSION_COOKIE_NAME])) return true;

    const authHeader = req.headers.authorization || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    const candidate = bearer || queryToken;
    if (!candidate) return false;
    return this.verifyCuratorSecret(candidate) || this.verifyAgentToken(candidate);
  }

  isRequestAuthenticatedForAgent(req: Request): boolean {
    if (process.env.ADM_ALLOW_OPEN_AGENT === 'true') return true;
    const authHeader = req.headers.authorization || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const headerToken =
      (typeof req.headers['x-adm-agent-token'] === 'string' ? req.headers['x-adm-agent-token'].trim() : '') ||
      (typeof req.headers['x-agent-token'] === 'string' ? req.headers['x-agent-token'].trim() : '');
    const queryToken = typeof req.query.agentToken === 'string' ? req.query.agentToken.trim() : '';
    const candidate = bearer || headerToken || queryToken;
    if (this.verifyAgentToken(candidate)) return true;
    // Also allow logged-in curator UI session
    if (this.isUiAuthEnabled()) {
      const cookies = parseCookies(req.headers.cookie);
      if (this.verifySessionToken(cookies[SESSION_COOKIE_NAME])) return true;
    } else if (!this.config.isServerMode) {
      return true;
    }
    return false;
  }

  setSessionCookie(res: Response): void {
    const token = this.signSessionToken('curator');
    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_MS,
    });
  }

  clearSessionCookie(res: Response): void {
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  }

  requireUiAuth = (req: Request, res: Response, next: NextFunction): void => {
    if (this.isRequestAuthenticatedForUi(req)) {
      next();
      return;
    }
    res.status(401).json({
      success: false,
      error: 'Требуется авторизация на сервере',
      authRequired: true,
    });
  };

  requireAgentAuth = (req: Request, res: Response, next: NextFunction): void => {
    if (this.isRequestAuthenticatedForAgent(req)) {
      next();
      return;
    }
    res.status(401).json({
      success: false,
      error: 'Invalid or missing agent Bearer token',
    });
  };
}
