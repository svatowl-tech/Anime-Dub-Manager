const { ipcMain, BrowserWindow } = require('electron');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');
const EnvironmentManager = require('../services/EnvironmentManager.cjs');
const log = require('electron-log');

function registerEnvironmentHandlers() {
  ipcMain.handle('download-ai-environment', wrapIpcHandler(async (event, customUrl) => {
    let targetUrl = customUrl;
    
    // Automatically determine OS and architecture specific URL from GitHub Releases if not provided
    if (!targetUrl || targetUrl.includes('releases/download/ai-env-v1/ai_env')) {
      const isMac = process.platform === 'darwin';
      const isLinux = process.platform === 'linux';
      const isArm = process.arch === 'arm64';
      
      const repoBase = 'https://github.com/SvatOwl/anime-dub-manager/releases/latest/download';
      
      if (isMac) {
        targetUrl = isArm
          ? `${repoBase}/ai_env_macos_arm64.zip`
          : `${repoBase}/ai_env_macos_x64.zip`;
      } else if (isLinux) {
        targetUrl = `${repoBase}/ai_env_linux_x64.zip`;
      } else {
        // Windows (x64)
        targetUrl = `${repoBase}/ai_env_windows_x64.zip`;
      }
    }

    log.info(`[EnvironmentController] IPC requesting AI environment download from: ${targetUrl}`);
    
    // Получаем BrowserWindow по sender (отправителю IPC-сообщения)
    const window = BrowserWindow.fromWebContents(event.sender);
    
    if (!window) {
      throw new Error('Не удалось определить целевое окно для отправки прогресса загрузки.');
    }

    // Запускаем процесс скачивания и распаковки
    await EnvironmentManager.downloadAndInstall(targetUrl, window);
    
    return { success: true, url: targetUrl };
  }));

  ipcMain.handle('check-diarization-status', wrapIpcHandler(async () => {
    const isLoaded = await EnvironmentManager.isEnvironmentReady();
    return {
      isLoaded,
      isLoading: false
    };
  }));
}

module.exports = { registerEnvironmentHandlers };
