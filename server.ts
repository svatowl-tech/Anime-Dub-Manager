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

// SSE Clients for real-time frontend event dispatch
const sseClients = new Set<express.Response>();
export function broadcastIpcEvent(channel: string, data: any) {
  const payload = JSON.stringify({ channel, data });
  for (const client of sseClients) {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

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
        webContents = { send: (channel: string, data: any) => broadcastIpcEvent(channel, data) };
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

  const getMainWindow = () => ({
    webContents: {
      send: (channel: string, data: any) => broadcastIpcEvent(channel, data)
    },
    isDestroyed: () => false
  });

  taskQueue.on('queue-updated', (summary: any) => {
    broadcastIpcEvent('task-queue-updated', summary);
  });

  taskQueue.on('task-progress', (data: any) => {
    broadcastIpcEvent('task-progress', data);
    broadcastIpcEvent('ffmpeg-progress', data.progress);
  });

  taskQueue.on('task-completed', async (data: any) => {
    broadcastIpcEvent('task-completed', data);

    // Auto-update episode rawPath when MKV transcoding finishes
    if (data.task && data.task.type === 'transcode-video' && data.task.metadata && data.task.metadata.episodeId) {
      try {
        const episodes = await getData('episodes.json');
        let epIndex = episodes.findIndex((e: any) => e.id === data.task.metadata.episodeId);
        if (epIndex === -1 && data.task.metadata.projectId && data.task.metadata.episodeNumber) {
          epIndex = episodes.findIndex((e: any) => e.projectId === data.task.metadata.projectId && e.number === data.task.metadata.episodeNumber);
        }
        if (epIndex !== -1) {
          const outputPath = data.result || data.task.metadata.outputPath;
          if (outputPath) {
            episodes[epIndex].rawPath = outputPath;
            episodes[epIndex].updatedAt = new Date().toISOString();
            await saveData('episodes.json', episodes);
            broadcastIpcEvent('episode-updated', episodes[epIndex]);
          }
        }
      } catch (e) {
        console.error('Failed to update episode in web server:', e);
      }
    }
  });

  taskQueue.on('task-failed', (data: any) => {
    broadcastIpcEvent('task-failed', data);
  });

  ProjectController.registerProjectHandlers(getData, saveData, getMainWindow);
  EpisodeHandlers.registerEpisodeHandlers(getData, saveData);
  ApiController.registerApiHandlers(getData, saveData);
  SyncController.registerSyncHandlers(getData, saveData, userDataPath);
  MediaController.registerMediaHandlers(getData, getMainWindow, taskQueue);
  ExportController.registerExportHandlers(getData, getMainWindow);
  SystemController.registerSystemHandlers(getData, saveData, getMainWindow, taskQueue);
  SubtitleController.registerSubtitleHandlers(getData);
  WhisperController.registerWhisperHandlers();
  LocalTranslateController.registerLocalTranslateHandlers();
  DiarizationController.registerDiarizationHandlers(getData);
  YoutubeController.registerYoutubeHandlers(getData, getMainWindow, taskQueue);
  TelegramController.registerTelegramHandlers(getData, saveData, userDataPath);
  
  console.log('[IPC Server] Handler registration complete.');

  // SSE endpoint for web clients to receive IPC events in real time
  app.get('/api/ipc/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseClients.add(res);
    req.on('close', () => {
      sseClients.delete(res);
    });
  });

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

    if (channel === 'get-whisper-system-status') {
      const requestedModel = (args[0] && args[0].model) || 'small';
      console.log(`[IPC Server] Whisper system status check requested (model: ${requestedModel})`);
      return res.json({
        success: true,
        data: {
          isReady: true,
          canLoadModel: true,
          statusText: 'Система Whisper готова к загрузке модели',
          backendType: 'server',
          availableModels: ['small', 'base', 'tiny'],
          activeModel: requestedModel,
          modelsDir: path.join(__dirname, 'mock_user_data', 'models', 'whisper'),
          details: `Движок Whisper готов принимать аудиодорожки. Выбранная модель «${requestedModel}» готова к загрузке в память.`
        }
      });
    }

    if (channel === 'get-downloaded-whisper-models') {
      return res.json({
        success: true,
        data: ['small', 'base', 'tiny']
      });
    }

    if (channel === 'transcribe-whisper-snippet') {
      const input = args[0] || {};
      const { videoPath, startSec, endSec, language = 'ja', model = 'small' } = input;
      console.log(`[IPC Server] Whisper snippet requested: ${startSec}s - ${endSec}s (${language})`);
      
      let resText = '';
      if (handler) {
        try {
          const handlerResult = await handler({ sender: { send: () => {} } }, ...args);
          if (handlerResult && handlerResult.text) {
            resText = handlerResult.text;
          }
        } catch (e: any) {
          console.warn('[IPC Server] transcribe-whisper-snippet handler error:', e?.message || e);
        }
      }

      // If video file wasn't present on disk or returned empty in web container preview:
      if (!resText) {
        const samplePhrases: Record<string, string[]> = {
          'ja': [
            '何これ？信じられない...',
            'ちょっと待って、本当にそれでいいの？',
            '大丈夫、俺が何とかしてみせるよ。',
            'そんなはずはない！確かめてみよう。',
            'ありがとう、助かったよ。',
            '今すぐ行かないと間に合わない！'
          ],
          'en': [
            'Wait, what did you just say?',
            'I cannot believe this is happening right now.',
            'Don\'t worry, I will handle this.',
            'Are you sure that is going to work?',
            'Thank you so much for your help.'
          ],
          'ru': [
            'Подожди, что ты только что сказал?',
            'Не могу поверить, что это происходит сейчас.',
            'Не переживай, я со всем разберусь.',
            'Ты уверен, что это сработает?'
          ]
        };
        const pool = samplePhrases[language] || samplePhrases['ja'];
        const hash = Math.abs(Math.round((Number(startSec) || 1) * 7)) % pool.length;
        resText = pool[hash];
      }

      return res.json({
        success: true,
        data: {
          text: resText,
          startSec: Number(startSec),
          endSec: Number(endSec),
          language,
          model
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
