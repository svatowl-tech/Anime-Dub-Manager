import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createRequire } from 'module';
import type { ServerRuntimeConfig } from './serverConfig.ts';
import type { CuratorInboxService, CuratorInboxItem } from './curatorInboxService.ts';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

const GITHUB_OWNER = 'svatowl-tech';
const GITHUB_REPO = 'Anime-Dub-Manager';
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const RESTART_EXIT_CODE = 75;

export interface AiEnvRemoteAsset {
  url: string;
  sha256?: string | null;
  size?: number | null;
}

export interface ReleaseManifestDto {
  schemaVersion?: number;
  version: string;
  tagName: string;
  commitHash?: string;
  releasedAt?: string;
  packageLockHash?: string;
  aiEnvDepsHash?: string;
  serverBundle?: {
    filename?: string;
    sha256?: string;
    size?: number;
    url?: string;
  };
  aiEnv?: {
    aiEnvDepsHash?: string;
    releaseTag?: string;
    assets?: Record<string, AiEnvRemoteAsset>;
  };
}

export interface ServerUpdateStatus {
  mode: 'server';
  hotSwapSupported: boolean;
  status:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'installing'
    | 'restarting'
    | 'error';
  stageMessage: string | null;
  downloadPercent: number;
  currentVersion: string;
  commitHash: string | null;
  buildDate: string | null;
  availableVersion: string | null;
  availableTagName: string | null;
  releaseNotes: string | null;
  releaseUrl: string;
  appUpdateAvailable: boolean;
  aiEnvUpdateAvailable: boolean;
  aiEnvNeedsInstall: boolean;
  activeAppSource: 'hot-swap' | 'image';
  activeAppDir: string;
  canRollback: boolean;
  checkedAt: string | null;
  lastUpdatedAt: string | null;
  rolledBackAt: string | null;
  error: string | null;
  pendingInboxItemId: string | null;
  aiEnv: {
    ready: boolean;
    installed: boolean;
    platformTag: string;
    activeDir: string;
    installedHash: string | null;
    expectedHash: string | null;
    remoteHash: string | null;
    updateAvailable: boolean;
    needsInstall: boolean;
  };
}

function compareSemver(a = '0.0.0', b = '0.0.0'): number {
  const clean = (v: string) =>
    String(v || '0.0.0')
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const pa = clean(a);
  const pb = clean(b);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function readJsonSafe(filePath: string): any {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export class ServerUpdateService {
  private config: ServerRuntimeConfig;
  private inboxService: CuratorInboxService;
  private broadcast: (channel: string, data: any) => void;
  private taskQueue: any;
  private stateFile: string;
  private runtimeDir: string;
  private currentRuntimeDir: string;
  private previousRuntimeDir: string;
  private bootPendingFile: string;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private applyInFlight: Promise<ServerUpdateStatus> | null = null;
  private persisted: Record<string, any> = {};
  private liveStatus: ServerUpdateStatus;
  private latestManifest: ReleaseManifestDto | null = null;
  private latestReleaseHtmlUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
  private latestReleaseBody: string | null = null;
  private latestBundleAssetUrl: string | null = null;

  constructor(options: {
    config: ServerRuntimeConfig;
    inboxService: CuratorInboxService;
    broadcast: (channel: string, data: any) => void;
    taskQueue: any;
  }) {
    this.config = options.config;
    this.inboxService = options.inboxService;
    this.broadcast = options.broadcast;
    this.taskQueue = options.taskQueue;

    this.stateFile = path.join(this.config.dataDir, 'update_state.json');
    this.runtimeDir = path.join(this.config.dataDir, 'runtime');
    this.currentRuntimeDir = path.join(this.runtimeDir, 'current');
    this.previousRuntimeDir = path.join(this.runtimeDir, 'previous');
    this.bootPendingFile = path.join(this.runtimeDir, 'boot_pending.json');

    this.persisted = readJsonSafe(this.stateFile) || {};
    this.liveStatus = this.buildInitialStatus();
  }

  private getBuildInfo(): {
    version: string;
    commitHash: string | null;
    buildDate: string | null;
    packageLockHash: string | null;
    aiEnvDepsHash: string | null;
  } {
    const pkg = readJsonSafe(path.join(this.config.rootDir, 'package.json')) || {};
    const meta = readJsonSafe(path.join(this.config.rootDir, 'src', 'build-metadata.json')) || {};
    return {
      version: pkg.version || meta.version || '1.2.0',
      commitHash: meta.commitHash || null,
      buildDate: meta.buildDate || null,
      packageLockHash: meta.packageLockHash || null,
      aiEnvDepsHash: meta.aiEnvDepsHash || null,
    };
  }

  private buildInitialStatus(): ServerUpdateStatus {
    const build = this.getBuildInfo();
    const isHotSwap = path.resolve(this.config.rootDir) === path.resolve(this.currentRuntimeDir);
    return {
      mode: 'server',
      hotSwapSupported: Boolean(this.config.isServerMode),
      status: this.persisted.rolledBackAt && this.persisted.lastError ? 'error' : 'idle',
      stageMessage: null,
      downloadPercent: 0,
      currentVersion: build.version,
      commitHash: build.commitHash,
      buildDate: build.buildDate,
      availableVersion: this.persisted.availableVersion || null,
      availableTagName: this.persisted.availableTagName || null,
      releaseNotes: this.persisted.releaseNotes || null,
      releaseUrl: this.persisted.releaseUrl || this.latestReleaseHtmlUrl,
      appUpdateAvailable: Boolean(this.persisted.appUpdateAvailable),
      aiEnvUpdateAvailable: Boolean(this.persisted.aiEnvUpdateAvailable),
      aiEnvNeedsInstall: false,
      activeAppSource: isHotSwap ? 'hot-swap' : 'image',
      activeAppDir: this.config.rootDir,
      canRollback: fs.existsSync(path.join(this.previousRuntimeDir, 'package.json')),
      checkedAt: this.persisted.checkedAt || null,
      lastUpdatedAt: this.persisted.lastUpdatedAt || null,
      rolledBackAt: this.persisted.rolledBackAt || null,
      error: this.persisted.lastError || null,
      pendingInboxItemId: this.persisted.pendingInboxItemId || null,
      aiEnv: {
        ready: false,
        installed: false,
        platformTag: process.arch === 'arm64' ? 'linux_arm64' : 'linux_x64',
        activeDir: this.config.aiEnvDir,
        installedHash: null,
        expectedHash: build.aiEnvDepsHash,
        remoteHash: this.persisted.remoteAiEnvHash || null,
        updateAvailable: false,
        needsInstall: false,
      },
    };
  }

  private savePersisted(patch: Record<string, any>): void {
    this.persisted = { ...this.persisted, ...patch };
    try {
      fs.mkdirSync(this.config.dataDir, { recursive: true });
      fs.writeFileSync(this.stateFile, JSON.stringify(this.persisted, null, 2));
    } catch {}
  }

  private emitStatus(patch: Partial<ServerUpdateStatus> = {}): ServerUpdateStatus {
    this.liveStatus = {
      ...this.liveStatus,
      ...patch,
      canRollback: fs.existsSync(path.join(this.previousRuntimeDir, 'package.json')),
    };
    this.broadcast('app-update-status', this.liveStatus);
    return this.liveStatus;
  }

  async clearBootPendingOnHealthyStartup(): Promise<void> {
    if (!fs.existsSync(this.bootPendingFile)) return;
    const pending = readJsonSafe(this.bootPendingFile);
    await fsp.rm(this.bootPendingFile, { force: true }).catch(() => {});
    this.savePersisted({
      lastUpdatedAt: new Date().toISOString(),
      lastError: null,
      rolledBackAt: null,
      pendingInboxItemId: null,
      lastHealthyBootVersion: pending?.version || this.getBuildInfo().version,
    });
    console.log(`[ServerUpdate] Verified healthy boot after update (v${this.getBuildInfo().version}).`);
  }

  startScheduler(): void {
    if (!this.config.isServerMode) return;
    if (this.pollTimer) return;

    // Initial background check 12s after server start
    setTimeout(() => {
      void this.checkForUpdates({ notifyInbox: true }).catch(() => {});
    }, 12000);

    this.pollTimer = setInterval(() => {
      void this.checkForUpdates({ notifyInbox: true }).catch(() => {});
    }, CHECK_INTERVAL_MS);
  }

  stopScheduler(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async getStatus(refreshAiEnv = true): Promise<ServerUpdateStatus> {
    if (refreshAiEnv) {
      try {
        const EnvironmentManager = require('../electron/services/EnvironmentManager.cjs');
        const ai = await EnvironmentManager.getAiEnvStatus(false);
        this.liveStatus.aiEnv = {
          ready: Boolean(ai.ready),
          installed: Boolean(ai.installed),
          platformTag: ai.platformTag,
          activeDir: ai.activeDir,
          installedHash: ai.installedHash,
          expectedHash: ai.expectedHash,
          remoteHash: ai.remoteHash || this.liveStatus.aiEnv.remoteHash,
          updateAvailable: Boolean(ai.updateAvailable),
          needsInstall: Boolean(ai.needsInstall),
        };
        this.liveStatus.aiEnvNeedsInstall = Boolean(ai.needsInstall);
      } catch {}
    }
    return {
      ...this.liveStatus,
      canRollback: fs.existsSync(path.join(this.previousRuntimeDir, 'package.json')),
    };
  }

  async checkForUpdates(options: { notifyInbox?: boolean } = {}): Promise<ServerUpdateStatus> {
    const build = this.getBuildInfo();
    this.emitStatus({
      status: 'checking',
      stageMessage: 'Проверка обновлений на GitHub Releases...',
      error: null,
      currentVersion: build.version,
    });

    try {
      const EnvironmentManager = require('../electron/services/EnvironmentManager.cjs');
      const [releaseRes, aiStatus] = await Promise.all([
        axios.get(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`, {
          timeout: 15000,
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'AnimeDubManager-ServerUpdater',
          },
        }),
        EnvironmentManager.getAiEnvStatus(true).catch(() => null),
      ]);

      const rel = releaseRes.data;
      const assets: any[] = Array.isArray(rel?.assets) ? rel.assets : [];
      const manifestAsset = assets.find((a) => a.name === 'adm-release-manifest.json');
      const bundleAsset = assets.find((a) => a.name === 'adm-server-bundle.tar.gz');

      let manifest: ReleaseManifestDto | null = null;
      if (manifestAsset?.browser_download_url) {
        try {
          const mRes = await axios.get(manifestAsset.browser_download_url, {
            timeout: 12000,
            maxRedirects: 5,
            headers: { 'User-Agent': 'AnimeDubManager-ServerUpdater' },
          });
          if (mRes.data && typeof mRes.data === 'object') {
            manifest = mRes.data;
          }
        } catch (mErr: any) {
          console.warn('[ServerUpdate] Failed fetching adm-release-manifest.json:', mErr?.message || mErr);
        }
      }

      const tagVersion = String(rel?.tag_name || '').replace(/^v/i, '') || build.version;
      const targetVersion = manifest?.version || tagVersion;
      const targetTag = manifest?.tagName || rel?.tag_name || `v${targetVersion}`;
      const appNewer = compareSemver(targetVersion, build.version) > 0 && Boolean(bundleAsset?.browser_download_url);

      const installedAiHash = aiStatus?.installedHash || null;
      const targetAiHash = manifest?.aiEnvDepsHash || aiStatus?.remoteHash || null;
      const aiEnvNeedsInstall = Boolean(aiStatus && !aiStatus.ready);
      const aiEnvChanged = Boolean(
        targetAiHash && (!installedAiHash || installedAiHash !== targetAiHash)
      );

      this.latestManifest = manifest || {
        version: targetVersion,
        tagName: targetTag,
        aiEnvDepsHash: targetAiHash || undefined,
      };
      this.latestReleaseHtmlUrl = rel?.html_url || this.latestReleaseHtmlUrl;
      this.latestReleaseBody = rel?.body || null;
      this.latestBundleAssetUrl = bundleAsset?.browser_download_url || null;

      const checkedAt = new Date().toISOString();
      const anyAvailable = appNewer || (aiStatus ? (aiEnvChanged || aiEnvNeedsInstall) : false);

      let pendingInboxId: string | null = this.persisted.pendingInboxItemId || null;

      if (
        options.notifyInbox !== false &&
        this.config.isServerMode &&
        (appNewer || aiEnvChanged) &&
        !(
          this.persisted.lastNotifiedVersion === targetVersion &&
          this.persisted.lastNotifiedAiHash === (targetAiHash || '')
        )
      ) {
        pendingInboxId = await this.notifyCuratorOfUpdate({
          currentVersion: build.version,
          targetVersion,
          targetTag,
          appNewer,
          aiEnvChanged: aiEnvChanged || aiEnvNeedsInstall,
          targetAiHash,
          releaseBody: rel?.body || '',
        });
        this.savePersisted({
          lastNotifiedVersion: targetVersion,
          lastNotifiedAiHash: targetAiHash || '',
          pendingInboxItemId: pendingInboxId,
        });
      }

      this.savePersisted({
        availableVersion: appNewer ? targetVersion : null,
        availableTagName: appNewer ? targetTag : null,
        releaseNotes: this.latestReleaseBody,
        releaseUrl: this.latestReleaseHtmlUrl,
        appUpdateAvailable: appNewer,
        aiEnvUpdateAvailable: aiEnvChanged,
        remoteAiEnvHash: targetAiHash,
        checkedAt,
        lastError: null,
      });

      return this.emitStatus({
        status: anyAvailable ? 'available' : 'not-available',
        stageMessage: null,
        availableVersion: appNewer ? targetVersion : null,
        availableTagName: appNewer ? targetTag : null,
        releaseNotes: this.latestReleaseBody,
        releaseUrl: this.latestReleaseHtmlUrl,
        appUpdateAvailable: appNewer,
        aiEnvUpdateAvailable: aiEnvChanged,
        aiEnvNeedsInstall,
        checkedAt,
        error: null,
        pendingInboxItemId: pendingInboxId,
        aiEnv: aiStatus
          ? {
              ready: Boolean(aiStatus.ready),
              installed: Boolean(aiStatus.installed),
              platformTag: aiStatus.platformTag,
              activeDir: aiStatus.activeDir,
              installedHash: aiStatus.installedHash,
              expectedHash: aiStatus.expectedHash,
              remoteHash: targetAiHash,
              updateAvailable: aiEnvChanged,
              needsInstall: aiEnvNeedsInstall,
            }
          : this.liveStatus.aiEnv,
      });
    } catch (err: any) {
      const msg = err?.message || String(err);
      return this.emitStatus({
        status: 'error',
        stageMessage: null,
        error: `Ошибка проверки обновлений: ${msg}`,
        checkedAt: new Date().toISOString(),
      });
    }
  }

  private async notifyCuratorOfUpdate(params: {
    currentVersion: string;
    targetVersion: string;
    targetTag: string;
    appNewer: boolean;
    aiEnvChanged: boolean;
    targetAiHash: string | null;
    releaseBody: string;
  }): Promise<string | null> {
    try {
      const parts: string[] = [];
      if (params.appNewer) {
        parts.push(`Код и веб-интерфейс (adm-server-bundle.tar.gz): v${params.currentVersion} -> v${params.targetVersion}`);
      }
      if (params.aiEnvChanged) {
        parts.push('Нейросетевое окружение AI_env: обнаружены изменения зависимостей (будет загружено и обновлено автоматически)');
      } else {
        parts.push('Нейросетевое окружение AI_env: не менялось (остаётся текущее, быстрое обновление за ~10 секунд)');
      }

      const shortNotes = String(params.releaseBody || '')
        .split('\n')
        .slice(0, 6)
        .join('\n')
        .trim();
      if (shortNotes) {
        parts.push('', shortNotes);
      }

      const item = await this.inboxService.create({
        title: `Доступно обновление сервера ADM ${params.targetTag}`,
        message: parts.join('\n'),
        category: 'approval',
        severity: 'action_required',
        targetTab: 'settings',
        proposedAction: `Установить обновление ${params.targetTag}${params.aiEnvChanged ? ' + AI_env' : ''} и перезапустить сервер`,
        metadata: {
          type: 'system_update',
          targetVersion: params.targetVersion,
          targetTag: params.targetTag,
          appUpdate: params.appNewer,
          aiEnvUpdate: params.aiEnvChanged,
          targetAiHash: params.targetAiHash,
        },
        source: 'system',
        notifyTelegram: true,
      });
      return item.id;
    } catch (err) {
      console.warn('[ServerUpdate] Failed creating Curator Inbox notification:', err);
      return null;
    }
  }

  async handleInboxDecision(item: CuratorInboxItem): Promise<void> {
    if (item.metadata?.type !== 'system_update') return;

    if (item.status === 'approved') {
      console.log(`[ServerUpdate] Curator approved server update (${item.id}). Starting update...`);
      void this.applyUpdate({ force: false }).catch((err) => {
        console.error('[ServerUpdate] Apply update after inbox approval failed:', err);
      });
    } else if (item.status === 'rejected') {
      this.savePersisted({ pendingInboxItemId: null });
      this.emitStatus({ pendingInboxItemId: null });
    }
  }

  async applyUpdate(options: { force?: boolean } = {}): Promise<ServerUpdateStatus> {
    if (this.applyInFlight) {
      return this.applyInFlight;
    }

    this.applyInFlight = this._executeApplyUpdate(options).finally(() => {
      this.applyInFlight = null;
    });
    return this.applyInFlight;
  }

  private async _executeApplyUpdate(options: { force?: boolean }): Promise<ServerUpdateStatus> {
    if (!this.config.isServerMode) {
      throw new Error('Горячее серверное обновление доступно только в режиме Umbrel / Docker-сервера (ADM_SERVER_MODE=true)');
    }

    // Check active background tasks unless forced
    if (!options.force && this.taskQueue?.getTasksSummary) {
      const tasks: any[] = this.taskQueue.getTasksSummary() || [];
      const activeCount = tasks.filter((t) => t.status === 'running' || t.status === 'pending').length;
      if (activeCount > 0) {
        const msg = `Нельзя перезапустить сервер: сейчас выполняется активных задач: ${activeCount}. Дождитесь завершения или запустите с принудительным перезапуском.`;
        this.emitStatus({ status: 'error', error: msg });
        throw new Error(msg);
      }
    }

    // Refresh latest release info before applying
    const checked = await this.checkForUpdates({ notifyInbox: false });
    if (checked.status === 'error') {
      throw new Error(checked.error || 'Не удалось проверить релиз');
    }

    const needApp = checked.appUpdateAvailable && Boolean(this.latestBundleAssetUrl);
    const needAiEnv = checked.aiEnvUpdateAvailable || checked.aiEnvNeedsInstall;

    if (!needApp && !needAiEnv && !options.force) {
      return this.emitStatus({
        status: 'not-available',
        stageMessage: 'Сервер уже работает на актуальной версии',
      });
    }

    const EnvironmentManager = require('../electron/services/EnvironmentManager.cjs');
    let swappedApp = false;
    let swappedAiEnv = false;

    try {
      await fsp.mkdir(this.runtimeDir, { recursive: true });
      const stagingDir = path.join(this.runtimeDir, `staging_${Date.now()}`);

      if (needApp || (options.force && this.latestBundleAssetUrl)) {
        const bundleUrl = this.latestBundleAssetUrl!;
        const archivePath = path.join(this.runtimeDir, `adm-server-bundle-${Date.now()}.tar.gz`);

        this.emitStatus({
          status: 'downloading',
          downloadPercent: 0,
          stageMessage: 'Скачивание пакета обновления сервера...',
          error: null,
        });

        await this.downloadFileWithProgress(bundleUrl, archivePath, (pct) => {
          this.emitStatus({
            status: 'downloading',
            downloadPercent: pct,
            stageMessage: `Скачивание пакета сервера: ${pct}%`,
          });
        });

        if (this.latestManifest?.serverBundle?.sha256) {
          this.emitStatus({
            status: 'installing',
            downloadPercent: 100,
            stageMessage: 'Проверка SHA-256 контрольной суммы...',
          });
          await this.verifyFileSha256(archivePath, this.latestManifest.serverBundle.sha256);
        }

        this.emitStatus({
          status: 'installing',
          stageMessage: 'Распаковка обновления в staging...',
        });

        await fsp.rm(stagingDir, { recursive: true, force: true });
        await fsp.mkdir(stagingDir, { recursive: true });
        await execFileAsync('tar', ['-xzf', archivePath, '-C', stagingDir]);
        await fsp.rm(archivePath, { force: true }).catch(() => {});

        // Sync or link node_modules depending on package-lock hash
        const { computePackageLockHash } = require('../scripts/compute-ai-env-hash.cjs');
        const currentLockHash = computePackageLockHash(this.config.rootDir);
        const stagingLockHash = computePackageLockHash(stagingDir);
        const baseNodeModules = fs.existsSync('/app/node_modules')
          ? '/app/node_modules'
          : path.join(this.config.rootDir, 'node_modules');

        const stagingNodeModules = path.join(stagingDir, 'node_modules');
        if (currentLockHash === stagingLockHash && fs.existsSync(baseNodeModules)) {
          this.emitStatus({
            status: 'installing',
            stageMessage: 'Зависимости Node.js не изменились — переиспользуем node_modules...',
          });
          await fsp.rm(stagingNodeModules, { recursive: true, force: true }).catch(() => {});
          await fsp.symlink(baseNodeModules, stagingNodeModules, 'dir');
        } else {
          this.emitStatus({
            status: 'installing',
            stageMessage: 'Установка обновлённых npm-зависимостей...',
          });
          const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
          await execFileAsync(npmBin, ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
            cwd: stagingDir,
            env: {
              ...process.env,
              ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
              YOUTUBE_DL_SKIP_DOWNLOAD: '1',
            },
          });
        }

        // Atomic runtime swap
        this.emitStatus({
          status: 'installing',
          stageMessage: 'Атомарная подмена /data/runtime/current...',
        });

        if (fs.existsSync(this.currentRuntimeDir)) {
          await fsp.rm(this.previousRuntimeDir, { recursive: true, force: true }).catch(() => {});
          await this.moveDirSafe(this.currentRuntimeDir, this.previousRuntimeDir);
        }
        await this.moveDirSafe(stagingDir, this.currentRuntimeDir);
        swappedApp = true;
      }

      if (needAiEnv) {
        this.emitStatus({
          status: 'downloading',
          downloadPercent: 0,
          stageMessage: 'Обновление Python AI_env в /data/ai_env...',
        });
        const aiTargetDir = path.join(this.config.dataDir, 'ai_env');
        const aiBackupDir = path.join(this.config.dataDir, 'ai_env_prev');
        const aiStatus = await EnvironmentManager.getAiEnvStatus(true);
        const remoteAssetUrl = aiStatus.remoteAssetUrl;
        const expectedSha256 = aiStatus.remoteSha256 || null;

        const mockWindow = {
          webContents: {
            send: (channel: string, payload: any) => {
              this.broadcast(channel, payload);
              if (channel === 'env-download-progress' && payload) {
                this.emitStatus({
                  status: payload.status === 'extracting' || payload.status === 'verifying' ? 'installing' : 'downloading',
                  downloadPercent: Number(payload.percent || 0),
                  stageMessage: payload.message || 'Обновление AI_env...',
                });
              }
            },
          },
        };

        await EnvironmentManager.downloadAndInstall(remoteAssetUrl, mockWindow, {
          targetDir: aiTargetDir,
          preserveBackupDir: aiBackupDir,
          expectedSha256,
        });
        swappedAiEnv = true;
      }

      const pendingPayload = {
        version: this.latestManifest?.version || checked.availableVersion || this.getBuildInfo().version,
        commitHash: this.latestManifest?.commitHash || null,
        swappedApp,
        swappedAiEnv,
        createdAt: new Date().toISOString(),
        attempts: 0,
      };
      await fsp.writeFile(this.bootPendingFile, JSON.stringify(pendingPayload, null, 2));

      this.savePersisted({
        availableVersion: null,
        availableTagName: null,
        appUpdateAvailable: false,
        aiEnvUpdateAvailable: false,
        pendingInboxItemId: null,
        lastError: null,
      });

      const restartingStatus = this.emitStatus({
        status: 'restarting',
        downloadPercent: 100,
        stageMessage: 'Обновление установлено. Перезапуск сервера...',
        appUpdateAvailable: false,
        aiEnvUpdateAvailable: false,
      });

      // Allow SSE messages to flush before bootstrap restarts child with exit code 75
      setTimeout(() => {
        console.log('[ServerUpdate] Exiting with code 75 for bootstrap seamless restart...');
        process.exit(RESTART_EXIT_CODE);
      }, 700);

      return restartingStatus;
    } catch (err: any) {
      const msg = err?.message || String(err);
      this.savePersisted({ lastError: msg });
      return this.emitStatus({
        status: 'error',
        stageMessage: null,
        error: `Ошибка установки обновления: ${msg}`,
      });
    }
  }

  async rollbackUpdate(): Promise<ServerUpdateStatus> {
    if (!this.config.isServerMode) {
      throw new Error('Откат доступен только в серверном режиме');
    }
    if (!fs.existsSync(path.join(this.previousRuntimeDir, 'package.json'))) {
      throw new Error('Резервная предыдущая версия в /data/runtime/previous отсутствует');
    }

    const tempBroken = path.join(this.runtimeDir, `rollback_discard_${Date.now()}`);
    if (fs.existsSync(this.currentRuntimeDir)) {
      await this.moveDirSafe(this.currentRuntimeDir, tempBroken);
    }
    await this.moveDirSafe(this.previousRuntimeDir, this.currentRuntimeDir);
    await fsp.rm(tempBroken, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(this.bootPendingFile, { force: true }).catch(() => {});

    const status = this.emitStatus({
      status: 'restarting',
      stageMessage: 'Выполняется откат к предыдущей версии и перезапуск сервера...',
      error: null,
    });

    setTimeout(() => {
      process.exit(RESTART_EXIT_CODE);
    }, 600);

    return status;
  }

  private async downloadFileWithProgress(
    url: string,
    destPath: string,
    onProgress: (percent: number) => void
  ): Promise<void> {
    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream',
      maxRedirects: 8,
      timeout: 60000,
      headers: { 'User-Agent': 'AnimeDubManager-ServerUpdater' },
    });

    const total = parseInt(String(response.headers['content-length'] || '0'), 10);
    let downloaded = 0;
    let lastEmit = 0;
    const writer = fs.createWriteStream(destPath);

    await new Promise<void>((resolve, reject) => {
      response.data.on('data', (chunk: Buffer) => {
        downloaded += chunk.length;
        const now = Date.now();
        if (total > 0 && (now - lastEmit > 250 || downloaded >= total)) {
          lastEmit = now;
          onProgress(Math.min(100, Math.round((downloaded / total) * 100)));
        }
      });
      response.data.pipe(writer);
      writer.on('finish', () => resolve());
      writer.on('error', reject);
      response.data.on('error', reject);
    });
  }

  private async verifyFileSha256(filePath: string, expectedSha256: string): Promise<void> {
    const clean = String(expectedSha256 || '').trim().split(/\s+/)[0].toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(clean)) return;

    const hash = crypto.createHash('sha256');
    await new Promise<void>((resolve, reject) => {
      const s = fs.createReadStream(filePath);
      s.on('data', (chunk) => hash.update(chunk));
      s.on('end', () => resolve());
      s.on('error', reject);
    });
    const actual = hash.digest('hex').toLowerCase();
    if (actual !== clean) {
      throw new Error(`Контрольная сумма пакета сервера не совпала (ожидалось ${clean.slice(0, 12)}, получено ${actual.slice(0, 12)})`);
    }
  }

  private async moveDirSafe(src: string, dst: string): Promise<void> {
    try {
      await fsp.rename(src, dst);
    } catch (err: any) {
      if (err && (err.code === 'EXDEV' || err.code === 'EPERM' || err.code === 'EACCES')) {
        await fsp.cp(src, dst, { recursive: true });
        await fsp.rm(src, { recursive: true, force: true });
      } else {
        throw err;
      }
    }
  }
}
