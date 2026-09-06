import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import dotenv from 'dotenv';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import { handleWebProxy } from './server/webProxyHandler.ts';

const { killAllTrackedProcesses } = require('./electron/lib/ProcessTracker.cjs');

// Handle server shutdown gracefully
process.on('SIGINT', () => {
  killAllTrackedProcesses();
  process.exit(0);
});
process.on('SIGTERM', () => {
  killAllTrackedProcesses();
  process.exit(0);
});
process.on('exit', () => {
  killAllTrackedProcesses();
});

// Mock Electron Environment State
const mockIpcHandlers = new Map<string, Function>();

// Monkey-patch require to mock 'electron'
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id: string) {
  if (id === 'electron') {
    // console.log('[MonkeyPatch] Providing mock electron to:', this.filename || 'unknown');
    return {
      ipcMain: {
        handle: (channel: string, fn: Function) => {
          console.log(`[MonkeyPatch] Registering handler for: ${channel}`);
          mockIpcHandlers.set(channel, fn);
        },
        on: (channel: string, fn: Function) => {}
      },
      app: {
        getPath: (name: string) => path.join(__dirname, 'mock_user_data'),
        getAppPath: () => __dirname,
        on: () => {},
        whenReady: () => Promise.resolve(),
        isPackaged: false,
      },
      BrowserWindow: class { 
        webContents = { send: () => {} };
        on() {}
      },
      session: {
        defaultSession: {
          cookies: {
            get: async () => []
          }
        }
      },
      dialog: {
        showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
        showSaveDialog: async (window: any, options: any) => {
          const opts = options || window || {};
          const defaultPath = opts.defaultPath || 'character_subtitles.ass';
          return { canceled: false, filePath: path.join(process.cwd(), 'mock_user_data', defaultPath) };
        }
      },
      globalShortcut: { register: () => {} }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Mock Electron Object for registration calls
  const mockElectron = {
    ipcMain: {
      handle: (channel: string, fn: Function) => mockIpcHandlers.set(channel, fn),
      on: (channel: string, fn: Function) => {}
    },
    app: {
      getPath: (name: string) => path.join(__dirname, 'mock_user_data'),
      getAppPath: () => __dirname,
      on: () => {},
      whenReady: () => Promise.resolve(),
      isPackaged: false,
    },
    BrowserWindow: class { 
      webContents = { send: () => {} };
      on() {}
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async (window: any, options: any) => {
        const opts = options || window || {};
        const defaultPath = opts.defaultPath || 'character_subtitles.ass';
        return { canceled: false, filePath: path.join(process.cwd(), 'mock_user_data', defaultPath) };
      }
    },
    globalShortcut: { register: () => {} }
  };

  // Create mock user data dir
  const userDataPath = path.join(__dirname, 'mock_user_data');
  await fs.mkdir(userDataPath, { recursive: true });

  // DataManager Setup
  const DataManager = require('./electron/lib/DataManager.cjs');
  const dataManager = new DataManager(userDataPath);
  await dataManager.init();

  const getData = (filename: string) => {
    // console.log(`[DataManager] Reading: ${filename}`);
    return dataManager.getData(filename);
  };
  const saveData = (filename: string, data: any) => {
    // console.log(`[DataManager] Writing: ${filename}`);
    return dataManager.saveData(filename, data);
  };

  // TaskQueue Setup
  const TaskQueue = require('./electron/lib/TaskQueue.cjs');
  const taskQueue = new TaskQueue();

  // Register Handlers
  console.log('[IPC Server] Starting handler registration...');
  
  const ProjectController = require('./electron/handlers/ProjectController.cjs');
  const EpisodeHandlers = require('./electron/handlers/episodeHandlers.cjs');
  const ApiController = require('./electron/handlers/ApiController.cjs');
  const SyncController = require('./electron/handlers/SyncController.cjs');
  const SystemController = require('./electron/handlers/SystemController.cjs');
  const SubtitleController = require('./electron/handlers/SubtitleController.cjs');
  const MediaController = require('./electron/handlers/MediaController.cjs');
  const ExportController = require('./electron/handlers/ExportController.cjs');
  const WhisperController = require('./electron/handlers/WhisperController.cjs');
  const LocalTranslateController = require('./electron/handlers/LocalTranslateController.cjs');
  const DiarizationController = require('./electron/handlers/DiarizationController.cjs');
  const YoutubeController = require('./electron/handlers/YoutubeController.cjs');
  const TelegramController = require('./electron/handlers/TelegramController.cjs');
  const { handleWebProxyRequest, handleWebProxyAgentRequest } = require('./electron/services/webProxyService.cjs');

  ProjectController.registerProjectHandlers(getData, saveData, null);
  EpisodeHandlers.registerEpisodeHandlers(getData, saveData);
  ApiController.registerApiHandlers(getData, saveData);
  SyncController.registerSyncHandlers(getData, saveData, userDataPath);
  MediaController.registerMediaHandlers(getData, null, taskQueue);
  ExportController.registerExportHandlers(getData, null);
  SystemController.registerSystemHandlers(getData, saveData, null, taskQueue);
  SubtitleController.registerSubtitleHandlers(getData);
  WhisperController.registerWhisperHandlers();
  LocalTranslateController.registerLocalTranslateHandlers();
  DiarizationController.registerDiarizationHandlers(getData);
  YoutubeController.registerYoutubeHandlers(getData, null, taskQueue);
  TelegramController.registerTelegramHandlers(getData, saveData, userDataPath);
  
  console.log('[IPC Server] Handler registration complete.');

  // Proxy endpoint for web preview to bypass iframe restrictions
  app.get('/api/web-proxy', handleWebProxyRequest);
  app.get('/api/web-proxy/asset', handleWebProxyAgentRequest);

  // API Route to call IPC handlers from the browser frontend
  app.post('/api/ipc/:channel', async (req, res) => {
    const { channel } = req.params;
    const args = req.body.args || [];
    const handler = mockIpcHandlers.get(channel);

    console.log(`[IPC Server] Called channel: ${channel}, handler found: ${!!handler}`);

    // Intercept heavy ML models to prevent dev server OOM crashes
    const mockHeavyModels = ['load-local-translate-model', 'translate-local', 'load-diarization-model', 'run-diarization', 'check-local-translate-status', 'check-diarization-status', 'ai-process-subtitles'];
    if (mockHeavyModels.includes(channel)) {
      console.log(`[IPC Server] Intercepted heavy ML call "${channel}" to prevent OOM crash.`);
      
      if (channel === 'check-diarization-status') {
        return res.json({
          success: true,
          data: {
            isLoaded: true,
            isLoading: false,
            modelName: 'WhisperX',
            downloadProgress: 100,
            loadingStatus: 'Готова к работе (Эмуляция веб-превью)'
          }
        });
      }
      
      if (channel === 'check-local-translate-status') {
        return res.json({
          success: true,
          data: {
            isLoaded: true,
            isLoading: false,
            modelName: 'Xenova/m2m100_418m',
            downloadProgress: 100,
            loadingStatus: 'Готова к работе (Эмуляция веб-превью)'
          }
        });
      }

      if (channel === 'run-diarization') {
        // Dynamically assign subtitle lines to mock speakers so user can test assignments
        const inputData = args[0] || {};
        const lines = inputData.subtitleLines || [];
        const mapping: Record<string, string> = {};
        
        lines.forEach((line: any, idx: number) => {
          if (line && line.id) {
            // Alternate speakers
            mapping[line.id] = `Speaker ${(idx % 2) + 1}`;
          }
        });

        return res.json({
          success: true,
          data: {
            speakerMapping: mapping,
            detectedSpeakersCount: 2
          }
        });
      }

      if (channel === 'translate-local') {
        const inputData = args[0] || {};
        const text = inputData.text || '';
        const destLang = inputData.destLang || 'ru';
        
        let translatedText = text;
        if (destLang === 'ru') {
          translatedText = `[Перевод]: ${text}`;
        } else {
          translatedText = `[Translated to ${destLang}]: ${text}`;
        }

        return res.json({
          success: true,
          data: translatedText
        });
      }

      if (channel === 'load-local-translate-model' || channel === 'load-diarization-model') {
        return res.json({
          success: true,
          data: { success: true }
        });
      }

      return res.json({
        success: true,
        data: {
          success: true,
          data: { message: "Mocked response for web preview" }
        }
      });
    }

    if (channel === 'qa-whisper-check-lines') {
      const inputData = args[0] || {};
      const lines = inputData.lines || [];
      const model = inputData.model || 'small';
      console.log(`[IPC Server] Whisper QA check requested for ${lines.length} lines with model ${model}`);

      const results = lines.map((line: any, idx: number) => {
        let recognizedText = line.text;
        if (idx % 6 === 2 && line.text.length > 20) {
          const words = line.text.split(' ');
          if (words.length > 4) {
            recognizedText = words.slice(0, words.length - 2).join(' ') + ' ладно';
          }
        } else if (idx % 8 === 4 && line.text.length > 15) {
          recognizedText = line.text.split(' ')[0] + '... ' + line.text;
        }
        return {
          lineIndex: line.lineIndex,
          expectedText: line.text,
          recognizedText
        };
      });

      return res.json({
        success: true,
        data: { results }
      });
    }

    if (handler) {
      try {
        console.log(`[IPC Server] Executing channel "${channel}" with args:`, JSON.stringify(args));
        const result = await handler({ sender: { send: () => {} } }, ...args);
        
        // If the response is wrapped by wrapIpcHandler and has success === false, log details
        if (result && typeof result === 'object' && result.success === false) {
          console.error(`[IPC Server Error Response] channel: ${channel}, error:`, result.error);
          if (result.stderr) console.error(`[IPC Server Error stderr]:`, result.stderr);
          if (result.stdout) console.error(`[IPC Server Error stdout]:`, result.stdout);
          if (result.stack) console.error(`[IPC Server Error stack]:`, result.stack);
        } else {
          console.log(`[IPC Server Success] channel: ${channel}`);
        }
        
        res.json({ success: true, data: result });
      } catch (error: any) {
        console.error(`[IPC Server Crash] channel: ${channel}, crash error:`, error.stack || error.message || error);
        res.json({ 
          success: false, 
          error: error.message || String(error),
          stack: error.stack || null,
          stderr: error.stderr || null,
          stdout: error.stdout || null,
          code: error.code || null
        });
      }
    } else {
      console.warn(`[IPC Server 404] channel: ${channel} not found in registered handlers. Available:`, Array.from(mockIpcHandlers.keys()));
      res.status(404).json({ success: false, error: `Handler for ${channel} not found` });
    }
  });

  // Smart Web Proxy Route for Web Preview Mode
  app.get('/api/web-proxy', handleWebProxy);

  // OAuth Callback Handler
  app.get(['/auth/callback', '/auth/callback/'], async (req, res) => {
    const { code } = req.query;
    
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'YANDEX_AUTH_SUCCESS', code: '${code}' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. You can close this window.</p>
        </body>
      </html>
    `);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
