const { ipcMain, BrowserWindow } = require('electron');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');
const EnvironmentManager = require('../services/EnvironmentManager.cjs');
const log = require('electron-log');

const AI_ENV_RUNTIME_BASE =
  'https://github.com/svatowl-tech/Anime-Dub-Manager/releases/download/ai-env-runtime';

function resolveSenderWindow(event) {
  return (
    (event?.sender ? BrowserWindow.fromWebContents(event.sender) : null) || {
      webContents: { send: (ch, data) => event?.sender?.send?.(ch, data) },
    }
  );
}

function registerEnvironmentHandlers() {
  ipcMain.handle('get-ai-env-status', wrapIpcHandler(async (_event, { checkRemote = false } = {}) => {
    return await EnvironmentManager.getAiEnvStatus(Boolean(checkRemote));
  }));

  ipcMain.handle('install-or-update-ai-env', wrapIpcHandler(async (event, { customUrl = null, force = false } = {}) => {
    const window = resolveSenderWindow(event);
    log.info(`[EnvironmentController] Installing/updating AI_env (force=${Boolean(force)}, customUrl=${customUrl || 'manifest'})`);
    const status = await EnvironmentManager.installOrUpdateFromManifest(window, { customUrl, force });
    return { success: true, status };
  }));

  ipcMain.handle('download-ai-environment', wrapIpcHandler(async (event, customUrl) => {
    let targetUrl = customUrl;
    let expectedSha256 = null;

    const isLegacyUrl =
      !targetUrl ||
      targetUrl.includes('releases/download/ai-env-v1/ai_env') ||
      targetUrl.includes('SvatOwl/anime-dub-manager');

    if (isLegacyUrl) {
      const status = await EnvironmentManager.getAiEnvStatus(true);
      targetUrl = status.remoteAssetUrl || `${AI_ENV_RUNTIME_BASE}/ai_env_${EnvironmentManager.getPlatformAssetTag()}.zip`;
      expectedSha256 = status.remoteSha256 || null;
    }

    log.info(`[EnvironmentController] IPC requesting AI environment download from: ${targetUrl}`);
    const window = resolveSenderWindow(event);

    await EnvironmentManager.downloadAndInstall(targetUrl, window, { expectedSha256 });
    const nextStatus = await EnvironmentManager.getAiEnvStatus(false);
    return { success: true, url: targetUrl, status: nextStatus };
  }));

  ipcMain.handle('check-diarization-status', wrapIpcHandler(async () => {
    const status = await EnvironmentManager.getAiEnvStatus(false);
    return {
      isLoaded: status.ready,
      isLoading: status.installing,
      status,
    };
  }));
}

module.exports = { registerEnvironmentHandlers };
