const path = require('path');
const fs = require('fs');
const axios = require('axios');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const EnvironmentManager = require('./EnvironmentManager.cjs');

const GITHUB_OWNER = 'svatowl-tech';
const GITHUB_REPO = 'Anime-Dub-Manager';

class DesktopUpdaterService {
  constructor() {
    this._app = null;
    this._getMainWindow = () => null;
    this._initialized = false;
    this._state = {
      mode: 'desktop',
      status: 'idle',
      currentVersion: '1.2.0',
      commitHash: null,
      buildDate: null,
      availableVersion: null,
      releaseNotes: null,
      releaseDate: null,
      releaseUrl: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`,
      downloadPercent: 0,
      bytesPerSecond: 0,
      transferredBytes: 0,
      totalBytes: 0,
      error: null,
      checkedAt: null,
      aiEnv: null,
    };
  }

  _readBuildMetadata() {
    try {
      const candidates = [
        path.resolve(__dirname, '..', '..', 'src', 'build-metadata.json'),
        this._app?.getAppPath ? path.join(this._app.getAppPath(), 'src', 'build-metadata.json') : null,
      ].filter(Boolean);
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          return JSON.parse(fs.readFileSync(p, 'utf8'));
        }
      }
    } catch {}
    return {};
  }

  _broadcast() {
    const win = this._getMainWindow?.();
    if (win && !win.isDestroyed()) {
      win.webContents.send('app-update-status', { ...this._state });
    }
  }

  _setState(patch) {
    this._state = { ...this._state, ...patch };
    this._broadcast();
  }

  init({ app, getMainWindow, safeHandle }) {
    if (this._initialized) return;
    this._initialized = true;
    this._app = app;
    this._getMainWindow = getMainWindow;

    const meta = this._readBuildMetadata();
    this._state.currentVersion = (app && app.getVersion ? app.getVersion() : null) || meta.version || '1.2.0';
    this._state.commitHash = meta.commitHash || null;
    this._state.buildDate = meta.buildDate || null;

    // Crucial: never download desktop updates silently without user action
    try {
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = false;
      autoUpdater.allowPrerelease = false;
      autoUpdater.logger = log;
      if (autoUpdater.logger?.transports?.file) {
        autoUpdater.logger.transports.file.level = 'info';
      }
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
      });
    } catch (err) {
      log.warn('[DesktopUpdater] Failed configuring autoUpdater:', err?.message || err);
    }

    autoUpdater.on('checking-for-update', () => {
      log.info('[DesktopUpdater] Checking for update...');
      this._setState({ status: 'checking', error: null });
    });

    autoUpdater.on('update-available', (info) => {
      log.info(`[DesktopUpdater] Update available: v${info?.version}`);
      const notes = Array.isArray(info?.releaseNotes)
        ? info.releaseNotes.map((n) => (typeof n === 'string' ? n : n?.note || '')).filter(Boolean).join('\n')
        : typeof info?.releaseNotes === 'string'
          ? info.releaseNotes
          : null;

      this._setState({
        status: 'available',
        availableVersion: info?.version || null,
        releaseNotes: notes,
        releaseDate: info?.releaseDate || null,
        downloadPercent: 0,
        error: null,
        checkedAt: new Date().toISOString(),
      });

      const win = this._getMainWindow?.();
      if (win && !win.isDestroyed()) {
        win.webContents.send('update-available', info);
      }
    });

    autoUpdater.on('update-not-available', () => {
      log.info('[DesktopUpdater] Update not available.');
      this._setState({
        status: 'not-available',
        availableVersion: null,
        error: null,
        checkedAt: new Date().toISOString(),
      });
    });

    autoUpdater.on('download-progress', (progressObj) => {
      const pct = Math.min(100, Math.round(Number(progressObj?.percent || 0)));
      this._setState({
        status: 'downloading',
        downloadPercent: pct,
        bytesPerSecond: Number(progressObj?.bytesPerSecond || 0),
        transferredBytes: Number(progressObj?.transferred || 0),
        totalBytes: Number(progressObj?.total || 0),
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      log.info('[DesktopUpdater] Update downloaded and ready to install.');
      this._setState({
        status: 'downloaded',
        availableVersion: info?.version || this._state.availableVersion,
        downloadPercent: 100,
      });
      const win = this._getMainWindow?.();
      if (win && !win.isDestroyed()) {
        win.webContents.send('update-downloaded', info);
      }
    });

    autoUpdater.on('error', (err) => {
      const msg = err?.message || String(err);
      log.error('[DesktopUpdater] Error:', msg);
      this._setState({
        status: 'error',
        error: msg,
        checkedAt: new Date().toISOString(),
      });
    });

    if (safeHandle) {
      safeHandle('app-get-version', async () => {
        const currentMeta = this._readBuildMetadata();
        return {
          version: this._state.currentVersion,
          commitHash: currentMeta.commitHash || null,
          buildDate: currentMeta.buildDate || null,
          aiEnvDepsHash: currentMeta.aiEnvDepsHash || EnvironmentManager.getExpectedAiEnvDepsHash(),
        };
      });

      safeHandle('app-get-update-status', async () => {
        const aiEnv = await EnvironmentManager.getAiEnvStatus(false).catch(() => null);
        this._state.aiEnv = aiEnv;
        return { ...this._state };
      });

      safeHandle('app-check-updates', async () => {
        return await this.checkForUpdates();
      });

      safeHandle('app-download-update', async () => {
        if (!this._app?.isPackaged) {
          throw new Error('Автозагрузка бинарного установщика доступна только в собранном desktop-приложении');
        }
        this._setState({ status: 'downloading', downloadPercent: 0, error: null });
        await autoUpdater.downloadUpdate();
        return { success: true, state: { ...this._state } };
      });

      safeHandle('app-install-update', async () => {
        autoUpdater.quitAndInstall(false, true);
        return { success: true };
      });

      safeHandle('install-update', async () => {
        autoUpdater.quitAndInstall(false, true);
        return { success: true };
      });
    }
  }

  _compareSemver(a = '0.0.0', b = '0.0.0') {
    const clean = (v) => String(v || '0.0.0').replace(/^v/i, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
    const pa = clean(a);
    const pb = clean(b);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) > (pb[i] || 0)) return 1;
      if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    }
    return 0;
  }

  async _fallbackGithubLatestCheck() {
    const res = await axios.get(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`, {
      timeout: 12000,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'AnimeDubManager-Desktop',
      },
    });
    const rel = res.data;
    const latestVersion = String(rel?.tag_name || '').replace(/^v/i, '');
    const newer = this._compareSemver(latestVersion, this._state.currentVersion) > 0;
    this._setState({
      status: newer ? 'available' : 'not-available',
      availableVersion: newer ? latestVersion : null,
      releaseNotes: rel?.body || null,
      releaseDate: rel?.published_at || null,
      releaseUrl: rel?.html_url || this._state.releaseUrl,
      error: null,
      checkedAt: new Date().toISOString(),
    });
  }

  async checkForUpdates() {
    this._setState({ status: 'checking', error: null });
    const aiEnvPromise = EnvironmentManager.getAiEnvStatus(true).catch((e) => {
      log.warn('[DesktopUpdater] AI_env manifest check warning:', e?.message || e);
      return null;
    });

    try {
      if (this._app?.isPackaged) {
        await autoUpdater.checkForUpdates();
      } else {
        await this._fallbackGithubLatestCheck();
      }
    } catch (err) {
      const msg = err?.message || String(err);
      log.warn('[DesktopUpdater] checkForUpdates failed, trying GitHub API fallback:', msg);
      try {
        await this._fallbackGithubLatestCheck();
      } catch (fallbackErr) {
        this._setState({
          status: 'error',
          error: fallbackErr?.message || msg,
          checkedAt: new Date().toISOString(),
        });
      }
    }

    const aiEnv = await aiEnvPromise;
    this._setState({ aiEnv });
    return { ...this._state };
  }
}

module.exports = new DesktopUpdaterService();
