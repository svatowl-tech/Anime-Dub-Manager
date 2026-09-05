const { killAllTrackedProcesses, killAllTrackedProcessesSync } = require('./lib/ProcessTracker.cjs');
const { app, BrowserWindow, ipcMain, dialog, globalShortcut, shell, session, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const { exec } = require('child_process');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');

// Safe IPC handler registration helper: prevents "Attempted to register a second handler" crashes
function safeHandle(channel, handler) {
  try {
    ipcMain.removeHandler(channel);
  } catch (e) {}
  try {
    ipcMain.handle(channel, handler);
  } catch (err) {
    log.error(`Failed to register IPC handle for '${channel}':`, err);
  }
}

// Single-Instance Lock: prevents zombie background processes and multiple fighting instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  log.info('Another instance of Anime Dub Manager is already running. Quitting secondary process.');
  app.quit();
  process.exit(0);
}

// Append Chromium switches for maximum browser compatibility, stealth, and audio/video playback
// Disabling AutomationControlled masks navigator.webdriver at the C++ Chromium engine level
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

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
  if (mainWindow && !mainWindow.isDestroyed()) {
    log.info('Main window already exists. Bringing to front.');
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }

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
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: false
    },
  });

  // Gracefully show window once ready, with safety timeout fallback
  mainWindow.once('ready-to-show', () => {
    log.info('Main window ready-to-show event received.');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Safety fallback in case ready-to-show is delayed by asset loading or Windows display driver
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      log.info('Forcing main window display after safety timeout.');
      mainWindow.show();
      mainWindow.focus();
    }
  }, 2000);

  const isDev = !app.isPackaged || process.env.NODE_ENV === 'development';

  // Failure handling when loading frontend bundle (only for main top frame, not webviews/subframes)
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // Only handle failures for the top-level main window URL, ignoring guest webviews and subframes
    if (isMainFrame === false) {
      return;
    }
    log.error(`Failed to load main frame ${validatedURL}: [${errorCode}] ${errorDescription}`);
    
    if (isDev) {
      // In development mode, retry loading localhost:5173 if Vite hasn't finished booting yet
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          log.info('Retrying loading dev server http://localhost:5173...');
          mainWindow.loadURL('http://localhost:5173').catch(() => {});
        }
      }, 1500);
    } else if (errorCode !== -3 && errorCode !== -102) {
      // Retry loading production dist after brief pause
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          const indexPath = path.join(app.getAppPath(), 'dist', 'index.html');
          log.info(`Retrying loading ${indexPath}...`);
          mainWindow.loadFile(indexPath).catch(() => {});
        }
      }, 1000);
    }
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    log.error('Main window render process gone:', details);
  });

  if (isDev) {
    log.info('Development mode: loading dev server http://localhost:5173');
    mainWindow.loadURL('http://localhost:5173').catch((err) => {
      log.warn('Initial loadURL failed (Vite dev server may still be booting):', err.message);
    });
  } else {
    const candidates = [
      path.join(app.getAppPath(), 'dist', 'index.html'),
      path.join(__dirname, '..', 'dist', 'index.html'),
      path.join(process.resourcesPath || '', 'app.asar', 'dist', 'index.html')
    ];
    let resolvedPath = candidates[0];
    for (const c of candidates) {
      if (fsSync.existsSync(c)) {
        resolvedPath = c;
        break;
      }
    }
    log.info(`Loading production frontend file: ${resolvedPath}`);
    mainWindow.loadFile(resolvedPath).catch(err => {
      log.error('Failed to loadFile production index.html:', err);
    });
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

    const isDev = !app.isPackaged || process.env.NODE_ENV === 'development';
    if (isDev) {
      debugWindow.loadURL('http://localhost:5173/#/debug');
    } else {
      const candidates = [
        path.join(app.getAppPath(), 'dist', 'index.html'),
        path.join(__dirname, '..', 'dist', 'index.html')
      ];
      let p = candidates[0];
      for (const c of candidates) {
        if (fsSync.existsSync(c)) {
          p = c;
          break;
        }
      }
      debugWindow.loadFile(p, { hash: 'debug' });
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
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    try {
      createWindow();
    } catch (err) {
      log.error('Failed to create window on second-instance:', err);
    }
  }
});

app.on('child-process-gone', (event, details) => {
  log.warn(`[Electron] Child process gone: type=${details.type}, reason=${details.reason}, exitCode=${details.exitCode}`);
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

safeHandle('install-update', () => {
  autoUpdater.quitAndInstall();
});

// Main App Initialization
app.whenReady().then(async () => {
  log.info('app.whenReady resolved. Initializing Anime Dub Manager...');

  // 1. Create main application window immediately so UI starts up without delay
  try {
    createWindow();
    createDebugWindow();
  } catch (winErr) {
    log.error('Critical error creating main window:', winErr);
  }

  // 2. Initialize DataManager and TaskQueue
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

  // 3. Register all IPC handlers safely
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

  // 4. Asynchronous background initializations (non-blocking)
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
