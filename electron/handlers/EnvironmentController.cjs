const { ipcMain, BrowserWindow } = require('electron');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');
const EnvironmentManager = require('../services/EnvironmentManager.cjs');
const log = require('electron-log');

function registerEnvironmentHandlers() {
  ipcMain.handle('download-ai-environment', wrapIpcHandler(async (event, url) => {
    let targetUrl = url;
    
    // Automatically determine OS specific URL if default Windows url is provided or no url
    if (!url || url === 'https://github.com/svatowl-tech/DubStudio/releases/download/ai-env-v1/ai_env.zip') {
      const isMac = process.platform === 'darwin';
      const isArm = process.arch === 'arm64';
      if (isMac && isArm) {
        targetUrl = 'https://github.com/svatowl-tech/DubStudio/releases/download/ai-env-v1/ai_env_mac_arm64.zip';
      } else if (isMac) {
        targetUrl = 'https://github.com/svatowl-tech/DubStudio/releases/download/ai-env-v1/ai_env_mac_x64.zip';
      } else {
        targetUrl = 'https://github.com/svatowl-tech/DubStudio/releases/download/ai-env-v1/ai_env.zip'; // win32
      }
    }

    log.info(`IPC: requesting AI environment download from ${targetUrl}`);
    
    // Получаем BrowserWindow по sender (отправителю IPC-сообщения)
    const window = BrowserWindow.fromWebContents(event.sender);
    
    if (!window) {
      throw new Error('Не удалось определить целевое окно для отправки событий.');
    }

    // Запускаем процесс скачивания и распаковки
    await EnvironmentManager.downloadAndInstall(targetUrl, window);
    
    return { success: true };
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
