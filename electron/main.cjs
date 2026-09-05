const { killAllTrackedProcesses, killAllTrackedProcessesSync } = require('./lib/ProcessTracker.cjs');
const { app, BrowserWindow, ipcMain, dialog, globalShortcut, shell, session, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { exec } = require('child_process');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');

// Single-Instance Lock: prevents zombie background processes and multiple fighting instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  log.info('Another instance of Anime Dub Manager is already running. Quitting secondary process.');
  app.quit();
  process.exit(0);
}

// Append Chromium switches for maximum browser compatibility, stealth, and video autoplay
// Disabling AutomationControlled masks navigator.webdriver at the C++ Chromium engine level
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('disable-features', 'CrossOriginOpenerPolicy,CrossOriginEmbedderPolicy');
app.commandLine.appendSwitch('enable-features', 'NetworkService,NetworkServiceInProcess');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-site-isolation-trials');

// Setup safe electron-log path in userData (prevents EPERM errors in C:\Program Files\)
try {
  const logsDir = path.join(app.getPath('userData'), 'logs');
  log.transports.file.resolvePathFn = () => path.join(logsDir, 'main.log');
} catch (e) {
  // Use electron-log standard default
}

log.info('=============================================');
log.info(`Anime Dub Manager v${app.getVersion()} starting...`);
log.info(`Packaged: ${app.isPackaged}, Platform: ${process.platform}, Arch: ${process.arch}`);
log.info('=============================================');

// Auto-updater logging
try {
  autoUpdater.logger = log;
  autoUpdater.logger.transports.file.level = 'info';
} catch (e) {}

process.on('uncaughtException', (error) => {
  log.error('Uncaught Exception in Main Process:', error);
});
process.on('unhandledRejection', (error) => {
  log.error('Unhandled Rejection in Main Process:', error);
});

ipcMain.on('log-error', (event, error) => {
  log.error('Renderer Error:', error);
});

// Lazy or safe imports of core libraries
const DataManager = require('./lib/DataManager.cjs');
const TaskQueue = require('./lib/TaskQueue.cjs');
const { initSharedOnnx } = require('./lib/onnxConfig.cjs');
const { configureWebViewSession, handleWebContentsCreated, openAuthModalWindow } = require('./lib/WebViewSessionManager.cjs');

const { extractHardsub } = require('./services/ocrService.cjs');
const { bakeSubtitles, transcodeToMp4, muxRelease, takeScreenshot, getVideoMetadata, extractSubtitleTrack, setCustomFfmpegPath, getActiveProcesses, killAllProcesses } = require('./services/ffmpegService.cjs');
const { getRawSubtitles, saveRawSubtitles, saveTranslatedSubtitles, splitSubsByActor, splitSubsByDubber, exportFullAssWithRoles, extractSignsAss, cleanAssFile } = require('./services/subtitleService.cjs');
const { translateText } = require('./services/translateService.cjs');
const { searchAnime, getAnimeDetails, getAnimeCharacters, getNextEpisodeDate } = require('./services/animeApiService.cjs');

const { registerEpisodeHandlers } = require('./handlers/episodeHandlers.cjs');
const { registerProjectHandlers } = require('./handlers/ProjectController.cjs');
const { registerMediaHandlers } = require('./handlers/MediaController.cjs');
const { registerExportHandlers } = require('./handlers/ExportController.cjs');
const { registerSubtitleHandlers } = require('./handlers/SubtitleController.cjs');
const { registerSystemHandlers, cleanupSystemHandlers } = require('./handlers/SystemController.cjs');
const { registerApiHandlers } = require('./handlers/ApiController.cjs');
const { registerSyncHandlers } = require('./handlers/SyncController.cjs');
const { registerYoutubeHandlers } = require('./handlers/YoutubeController.cjs');
const { registerTelegramHandlers, cleanupTelegramHandlers } = require('./handlers/TelegramController.cjs');

let WhisperLiveKitService = null;
try {
  WhisperLiveKitService = require('./services/WhisperLiveKitService.cjs');
} catch (e) {}

let OllamaService = null;
try {
  OllamaService = require('./services/OllamaService.cjs');
} catch (e) {}

let registerWhisperHandlers = () => {};
let registerLocalTranslateHandlers = () => {};
let registerDiarizationHandlers = () => {};
let registerEnvironmentHandlers = () => {};

try {
  ({ registerWhisperHandlers } = require('./handlers/WhisperController.cjs'));
  ({ registerLocalTranslateHandlers } = require('./handlers/LocalTranslateController.cjs'));
  ({ registerDiarizationHandlers } = require('./handlers/DiarizationController.cjs'));
  ({ registerEnvironmentHandlers } = require('./handlers/EnvironmentController.cjs'));
} catch (reqErr) {
  log.error('Failed to require optional AI controllers:', reqErr);
}

let dataManager = null;
let taskQueue = null;
let mainWindow = null;
let debugWindow = null;
let isQuitting = false;

async function getData(filename) {
  if (!dataManager) {
    dataManager = new DataManager(app.getPath('userData'));
    await dataManager.init();
  }
  return await dataManager.getData(filename);
}

async function saveData(filename, data) {
  if (!dataManager) {
    dataManager = new DataManager(app.getPath('userData'));
    await dataManager.init();
  }
  await dataManager.saveData(filename, data);
}

function createWindow() {
  log.info('Creating main application window...');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: 'Anime Dub Manager',
    backgroundColor: '#0a0a0a',
    show: false, // Show gracefully when ready
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: false
    },
  });

  // Gracefully show window once ready, with safety timeout fallback
  mainWindow.once('ready-to-show', () => {
    log.info('Main window ready-to-show event received.');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  // Safety fallback in case ready-to-show is delayed by asset loading
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      log.info('Forcing main window display after safety timeout.');
      mainWindow.show();
    }
  }, 1500);

  // Failure handling when loading frontend bundle (only for main top frame, not webviews/subframes)
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // Only handle failures for the top-level main window URL, ignoring guest webviews and subframes
    if (isMainFrame === false) {
      return;
    }
    log.error(`Failed to load main frame ${validatedURL}: [${errorCode}] ${errorDescription}`);
    if (process.env.NODE_ENV !== 'development' && errorCode !== -3 && errorCode !== -102) {
      // Retry loading production dist after brief pause
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          log.info('Retrying loading dist/index.html...');
          mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
        }
      }, 1000);
    }
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    log.error('Main window render process gone:', details);
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html');
    log.info(`Loading production frontend file: ${indexPath}`);
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on('close', () => {
    isQuitting = true;
    if (debugWindow && !debugWindow.isDestroyed()) {
      debugWindow.destroy();
      debugWindow = null;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

function createDebugWindow() {
  try {
    debugWindow = new BrowserWindow({
      width: 650,
      height: 450,
      title: 'Debug Console',
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.cjs'),
      },
    });

    if (process.env.NODE_ENV === 'development') {
      debugWindow.loadURL('http://localhost:5173/#/debug');
    } else {
      debugWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'debug' });
    }

    debugWindow.on('close', (e) => {
      if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
        e.preventDefault();
        debugWindow.hide();
      }
    });
  } catch (err) {
    log.warn('Could not create debug window:', err);
  }
}

// Second instance focus
app.on('second-instance', () => {
  log.info('Second instance launched. Restoring and focusing main window.');
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// Auto-updater handlers
autoUpdater.on('checking-for-update', () => {
  log.info('Checking for update...');
});
autoUpdater.on('update-available', (info) => {
  log.info('Update available.');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-available', info);
  }
});
autoUpdater.on('update-not-available', () => {
  log.info('Update not available.');
});
autoUpdater.on('error', (err) => {
  log.error('Error in auto-updater: ' + err);
});
autoUpdater.on('download-progress', (progressObj) => {
  log.info(`Update download: ${progressObj.percent?.toFixed(1)}% (${progressObj.bytesPerSecond} B/s)`);
});
autoUpdater.on('update-downloaded', () => {
  log.info('Update downloaded.');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-downloaded');
  }
});

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall();
});

app.on('web-contents-created', (event, contents) => {
  handleWebContentsCreated(event, contents);
});

// Main App Initialization
app.whenReady().then(async () => {
  log.info('app.whenReady resolved. Registering IPC handlers and subsystems...');

  // 1. Initialize DataManager and TaskQueue immediately
  try {
    dataManager = new DataManager(app.getPath('userData'));
  } catch (dmErr) {
    log.error('Failed to instantiate DataManager:', dmErr);
  }

  try {
    taskQueue = new TaskQueue(2);
    
    taskQueue.on('queue-updated', (summary) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('task-queue-updated', summary);
    });

    taskQueue.on('task-progress', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('task-progress', data);
    });

    taskQueue.on('task-completed', async (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('task-completed', data);

      // Auto-update episode rawPath when MKV transcoding finishes
      if (data.task && data.task.type === 'transcode-video' && data.task.metadata && data.task.metadata.episodeId) {
        try {
          const episodes = await getData('episodes.json');
          const epIndex = episodes.findIndex(e => e.id === data.task.metadata.episodeId);
          if (epIndex !== -1) {
            const outputPath = data.result || data.task.metadata.outputPath;
            if (outputPath) {
              episodes[epIndex].rawPath = outputPath;
              episodes[epIndex].updatedAt = new Date().toISOString();
              await saveData('episodes.json', episodes);
              log.info(`[main] Auto-updated episode ${data.task.metadata.episodeId} rawPath to ${outputPath}`);
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('episode-updated', episodes[epIndex]);
              }
            }
          }
        } catch (e) {
          log.error('Failed to update episode after transcode completion:', e);
        }
      }
    });

    taskQueue.on('task-failed', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('task-failed', data);
    });
  } catch (tqErr) {
    log.error('TaskQueue initialization error:', tqErr);
  }

  // 2. Register all IPC handlers SYNCHRONOUSLY BEFORE creating any window
  // This guarantees no race conditions when renderer components make initial IPC calls
  try {
    const getMainWindow = () => mainWindow;
    registerProjectHandlers(getData, saveData, getMainWindow);
    registerEpisodeHandlers(getData, saveData);
    registerMediaHandlers(getData, getMainWindow, taskQueue);
    registerExportHandlers(getData, getMainWindow, taskQueue);
    registerSubtitleHandlers(getData, saveData);
    registerSystemHandlers(getData, saveData, getMainWindow, taskQueue);
    registerApiHandlers(getData, saveData, getMainWindow, taskQueue);
    registerSyncHandlers(getData, saveData, app.getPath('userData'));
    registerYoutubeHandlers(getData, getMainWindow, taskQueue);
    registerTelegramHandlers(getData, saveData, app.getPath('userData'));
    
    registerWhisperHandlers(getData);
    registerLocalTranslateHandlers();
    registerDiarizationHandlers(getData);
    registerEnvironmentHandlers();
    log.info('All IPC handlers registered successfully.');
  } catch (ipcErr) {
    log.error('Fatal error registering IPC handlers:', ipcErr);
  }

  // 3. Configure webview sessions
  try {
    if (session && session.defaultSession) {
      configureWebViewSession(session.defaultSession);
    }
    if (session && typeof session.fromPartition === 'function') {
      configureWebViewSession(session.fromPartition('persist:publisher'));
    }
  } catch (err) {
    log.error('Failed to configure webview sessions:', err);
  }

  // Register Browser Engine IPC handlers for Uploader and embedded WebViews
  ipcMain.handle('get-browser-preload-path', () => {
    return path.join(__dirname, 'lib', 'browser-preload.cjs');
  });

  ipcMain.handle('browser-open-auth-window', async (event, { url, title }) => {
    log.info(`[Main] Opening auth modal window for: ${url}`);
    return await openAuthModalWindow(url, title);
  });

  ipcMain.handle('browser-clear-session-data', async () => {
    try {
      if (session && typeof session.fromPartition === 'function') {
        const pubSession = session.fromPartition('persist:publisher');
        await pubSession.clearStorageData({
          storages: ['cookies', 'localstorage', 'caches', 'indexdb', 'serviceworkers']
        });
        log.info('[Main] Cleared persist:publisher session data');
        return { success: true };
      }
      return { success: false, error: 'Session not available' };
    } catch (e) {
      log.error('[Main] Failed to clear session data:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('browser-copy-image-to-clipboard', async (event, imagePathOrUrl) => {
    try {
      if (!imagePathOrUrl) return { success: false, error: 'No image provided' };
      
      let img = null;
      if (imagePathOrUrl.startsWith('http://') || imagePathOrUrl.startsWith('https://')) {
        const res = await fetch(imagePathOrUrl);
        const arrayBuf = await res.arrayBuffer();
        img = nativeImage.createFromBuffer(Buffer.from(arrayBuf));
      } else {
        img = nativeImage.createFromPath(imagePathOrUrl);
      }

      if (img && !img.isEmpty()) {
        clipboard.writeImage(img);
        log.info('[Main] Successfully copied image to system clipboard');
        return { success: true };
      } else {
        return { success: false, error: 'Failed to create image object' };
      }
    } catch (e) {
      log.error('[Main] Failed to copy image to clipboard:', e);
      return { success: false, error: e.message };
    }
  });

  // 4. Create application windows
  createWindow();
  createDebugWindow();

  // 5. Asynchronous background initializations (non-blocking)
  (async () => {
    try {
      if (dataManager) {
        await dataManager.init();
        log.info('DataManager background sync completed.');
      }
    } catch (dmInitErr) {
      log.error('DataManager async init error:', dmInitErr);
    }

    try {
      const config = await getData('config.json');
      if (config && config.ffmpegPath) {
        setCustomFfmpegPath(config.ffmpegPath);
      }
    } catch (ffErr) {
      log.warn('Could not load ffmpegPath from config:', ffErr.message);
    }

    try {
      initSharedOnnx();
    } catch (onnxErr) {
      log.error('Failed to initialize shared ONNX:', onnxErr);
    }

    try {
      if (process.env.NODE_ENV !== 'development' && app.isPackaged) {
        autoUpdater.checkForUpdatesAndNotify().catch((uErr) => {
          log.warn('AutoUpdater check error:', uErr.message);
        });
      }
    } catch (updaterErr) {
      log.warn('Failed to check for updates:', updaterErr);
    }
  })();

  // 6. Register Global Shortcuts
  try {
    globalShortcut.register('CommandOrControl+Shift+D', () => {
      if (debugWindow && !debugWindow.isDestroyed()) {
        if (debugWindow.isVisible()) {
          debugWindow.hide();
        } else {
          debugWindow.show();
        }
      }
    });
  } catch (err) {
    log.warn('Failed to register global shortcuts:', err);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

async function performFullShutdownCleanup() {
  log.info('[App Shutdown] Performing full resource, socket, and process cleanup...');
  
  if (taskQueue) {
    try {
      taskQueue.abortAll();
    } catch (e) {}
  }

  try {
    if (WhisperLiveKitService && typeof WhisperLiveKitService.stopServer === 'function') {
      await WhisperLiveKitService.stopServer().catch(() => {});
    }
  } catch (e) {}

  try {
    if (OllamaService && typeof OllamaService.stopOllama === 'function') {
      OllamaService.stopOllama();
    }
  } catch (e) {}

  try {
    await cleanupTelegramHandlers().catch(() => {});
  } catch (e) {}

  try {
    cleanupSystemHandlers();
  } catch (e) {}

  try {
    killAllProcesses();
  } catch (e) {}

  try {
    await killAllTrackedProcesses();
  } catch (e) {}
}

app.on('before-quit', async (event) => {
  if (app.isSyncingBeforeQuit) return;
  
  event.preventDefault();
  app.isSyncingBeforeQuit = true;
  isQuitting = true;

  log.info('Application quitting, syncing data to cloud and cleaning processes...');
  try {
    if (app.doCloudPush) {
      await Promise.race([
        app.doCloudPush(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Cloud sync timeout on quit')), 2500))
      ]);
      log.info('Cloud sync on quit successful.');
    }
  } catch (e) {
    log.error('Cloud sync on quit failed or timed out:', e);
  }

  try {
    await performFullShutdownCleanup();
  } catch (e) {
    log.error('Error during shutdown cleanup:', e);
  }

  // Destroy all remaining browser windows
  try {
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) {
        w.destroy();
      }
    });
  } catch (e) {}

  app.quit();
});

app.on('will-quit', () => {
  log.info('Application will-quit: final shutdown sweep...');
  if (taskQueue) {
    try {
      taskQueue.abortAll();
    } catch (e) {}
  }
  try {
    cleanupSystemHandlers();
    killAllProcesses();
    killAllTrackedProcessesSync();
  } catch (e) {}
  
  // Clean final exit to ensure no background threads or processes linger
  setTimeout(() => {
    log.info('Terminating app process cleanly.');
    killAllTrackedProcessesSync();
    app.exit(0);
    process.exit(0);
  }, 100);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
