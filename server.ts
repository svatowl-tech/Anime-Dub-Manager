import express from 'express';
import http from 'http';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import dotenv from 'dotenv';
import { createRequire } from 'module';

import { handleWebProxy } from './server/webProxyHandler.ts';
import { resolveServerConfig } from './server/serverConfig.ts';
import { ServerAuthManager, resolveConfinedPath } from './server/authMiddleware.ts';
import { CuratorInboxService } from './server/curatorInboxService.ts';
import { createWebFilesRouter } from './server/webFilesRouter.ts';
import { AgentToolsEngine } from './server/agentToolsEngine.ts';
import { createInboxRouter, createRestAgentRouter } from './server/restAgentRouter.ts';
import { mountMcpRoutes } from './server/mcpServer.ts';
import { ServerUpdateService } from './server/serverUpdateService.ts';
import { createUpdatesRouter } from './server/updatesRouter.ts';

dotenv.config();

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const runtimeConfig = resolveServerConfig(__dirname);

const { killAllTrackedProcesses } = require('./electron/lib/ProcessTracker.cjs');

// Mock Electron Environment State
const mockIpcHandlers = new Map<string, Function>();

// SSE Clients for real-time frontend event dispatch
const sseClients = new Set<express.Response>();
export function broadcastIpcEvent(channel: string, data: any) {
  const payload = JSON.stringify({ channel, data });
  for (const client of sseClients) {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

// Monkey-patch require to mock 'electron' for shared controllers
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
  if (id === 'electron') {
    return {
      ipcMain: {
        handle: (channel: string, fn: Function) => {
          mockIpcHandlers.set(channel, fn);
        },
        on: () => {},
      },
      app: {
        getPath: (name: string) => {
          if (name === 'temp') return require('os').tmpdir();
          return runtimeConfig.dataDir;
        },
        getAppPath: () => __dirname,
        on: () => {},
        whenReady: () => Promise.resolve(),
        isPackaged: false,
      },
      BrowserWindow: class {
        webContents = { send: (channel: string, data: any) => broadcastIpcEvent(channel, data) };
        static fromWebContents() {
          return {
            webContents: { send: (channel: string, data: any) => broadcastIpcEvent(channel, data) },
            isDestroyed: () => false,
          };
        }
        static getFocusedWindow() {
          return null;
        }
        static getAllWindows() {
          return [];
        }
        on() {}
      },
      session: {
        defaultSession: {
          cookies: {
            get: async () => [],
            set: async () => {},
          },
        },
      },
      dialog: {
        showOpenDialog: async () => ({ canceled: true, filePaths: [], needsBrowserPicker: true }),
        showSaveDialog: async (window: any, options: any) => {
          const opts = options || window || {};
          const defaultPath = opts.defaultPath || 'character_subtitles.ass';
          return { canceled: false, filePath: path.join(runtimeConfig.dataDir, defaultPath) };
        },
      },
      shell: {
        openExternal: async () => {},
        openPath: async () => {},
      },
      clipboard: {
        writeText: () => {},
      },
      globalShortcut: { register: () => {} },
    };
  }
  return originalRequire.apply(this, arguments as any);
};

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const PORT = runtimeConfig.port;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  await fs.mkdir(runtimeConfig.dataDir, { recursive: true });

  // Initialize Auth Manager
  const authManager = new ServerAuthManager(runtimeConfig);
  await authManager.init();

  // DataManager Setup
  const DataManager = require('./electron/lib/DataManager.cjs');
  const dataManager = new DataManager(runtimeConfig.dataDir);
  await dataManager.init();

  const getData = (filename: string) => dataManager.getData(filename);
  const saveData = (filename: string, data: any) => dataManager.saveData(filename, data);

  // TaskQueue Setup
  const TaskQueue = require('./electron/lib/TaskQueue.cjs');
  const taskQueue = new TaskQueue();

  console.log(
    `[IPC Server] Booting (mode=${runtimeConfig.isServerMode ? 'UMBREL_SERVER' : 'WEB_PREVIEW'}, dataDir=${runtimeConfig.dataDir}, aiEnvDir=${runtimeConfig.aiEnvDir})`
  );

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
  const AudioAnalysisController = require('./electron/handlers/AudioAnalysisController.cjs');
  const MixingController = require('./electron/handlers/MixingController.cjs');
  const EnvironmentController = require('./electron/handlers/EnvironmentController.cjs');
  const QAActingController = require('./electron/handlers/QAActingController.cjs');
  const { handleWebProxyRequest, handleWebProxyAgentRequest } = require('./electron/services/webProxyService.cjs');

  const getMainWindow = () => ({
    webContents: {
      send: (channel: string, data: any) => broadcastIpcEvent(channel, data),
    },
    isDestroyed: () => false,
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
    if (data.task && data.task.type === 'transcode-video' && data.task.metadata && data.task.metadata.episodeId) {
      try {
        const episodes = await getData('episodes.json');
        let epIndex = episodes.findIndex((e: any) => e.id === data.task.metadata.episodeId);
        if (epIndex === -1 && data.task.metadata.projectId && data.task.metadata.episodeNumber) {
          epIndex = episodes.findIndex(
            (e: any) => e.projectId === data.task.metadata.projectId && e.number === data.task.metadata.episodeNumber
          );
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
        console.error('Failed to update episode in server:', e);
      }
    }
  });
  taskQueue.on('task-failed', (data: any) => {
    broadcastIpcEvent('task-failed', data);
  });

  ProjectController.registerProjectHandlers(getData, saveData, getMainWindow);
  EpisodeHandlers.registerEpisodeHandlers(getData, saveData);
  ApiController.registerApiHandlers(getData, saveData, getMainWindow, taskQueue);
  SyncController.registerSyncHandlers(getData, saveData, runtimeConfig.dataDir);
  MediaController.registerMediaHandlers(getData, getMainWindow, taskQueue, saveData);
  ExportController.registerExportHandlers(getData, getMainWindow);
  SystemController.registerSystemHandlers(getData, saveData, getMainWindow, taskQueue);
  SubtitleController.registerSubtitleHandlers(getData);
  WhisperController.registerWhisperHandlers(getData);
  LocalTranslateController.registerLocalTranslateHandlers();
  DiarizationController.registerDiarizationHandlers(getData);
  YoutubeController.registerYoutubeHandlers(getData, getMainWindow, taskQueue);
  TelegramController.registerTelegramHandlers(getData, saveData, runtimeConfig.dataDir);
  AudioAnalysisController.registerAudioAnalysisHandlers();
  MixingController.registerMixingHandlers(getData, getMainWindow);
  EnvironmentController.registerEnvironmentHandlers();
  QAActingController.registerQAActingHandlers(getData, saveData, getMainWindow);

  const getTelegramService = () => TelegramController.getTelegramService(getData, saveData, runtimeConfig.dataDir);

  const inboxService = new CuratorInboxService({
    getData,
    saveData,
    broadcast: broadcastIpcEvent,
    getTelegramService,
    defaultCuratorChatId: runtimeConfig.curatorTelegramChatId,
  });

  const updateService = new ServerUpdateService({
    config: runtimeConfig,
    inboxService,
    broadcast: broadcastIpcEvent,
    taskQueue,
  });

  inboxService.setOnItemResponded(async (item) => {
    await updateService.handleInboxDecision(item);
  });

  if (runtimeConfig.isServerMode) {
    inboxService.startTelegramBotPoller();
    updateService.startScheduler();
  }

  const invokeIpc = async (channel: string, ...args: any[]) => {
    const handler = mockIpcHandlers.get(channel);
    if (!handler) {
      throw new Error(`Handler for channel "${channel}" is not registered`);
    }
    return await handler(
      {
        sender: {
          send: (evChannel: string, evData: any) => broadcastIpcEvent(evChannel, evData),
        },
      },
      ...args
    );
  };

  const toolsEngine = new AgentToolsEngine({
    config: runtimeConfig,
    getData,
    saveData,
    invokeIpc,
    getAvailableIpcChannels: () => Array.from(mockIpcHandlers.keys()),
    taskQueue,
    inboxService,
    getTelegramService,
    updateService,
  });

  console.log(`[IPC Server] Registered ${mockIpcHandlers.size} handlers.`);

  // Health endpoint for Docker / Umbrel healthchecks
  app.get('/api/health', async (_req, res) => {
    const summary = await inboxService.getUnreadSummary().catch(() => ({ unreadCount: 0, pendingCount: 0, total: 0 }));
    res.json({
      ok: true,
      serverMode: runtimeConfig.isServerMode,
      arch: process.arch,
      platform: process.platform,
      dataDir: runtimeConfig.dataDir,
      inbox: summary,
    });
  });

  // Auth Endpoints for Web/Mobile Thin Client
  app.get('/api/auth/status', (req, res) => {
    res.json({
      success: true,
      data: {
        serverMode: runtimeConfig.isServerMode,
        authRequired: authManager.isUiAuthEnabled(),
        needsSetup: authManager.needsInitialSetup(),
        authenticated: authManager.isRequestAuthenticatedForUi(req),
        dataDir: runtimeConfig.dataDir,
        arch: process.arch,
      },
    });
  });

  app.post('/api/auth/setup', async (req, res) => {
    try {
      if (!authManager.needsInitialSetup()) {
        return res.status(403).json({ success: false, error: 'Сервер уже настроен' });
      }
      const mode = req.body?.mode === 'password' ? 'password' : 'open';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      await authManager.configureAuth(mode, password);
      if (mode === 'password') {
        authManager.setSessionCookie(res);
      }
      res.json({ success: true, data: { mode } });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    const secret = String(req.body?.password || req.body?.token || '').trim();
    if (!authManager.isUiAuthEnabled()) {
      return res.json({ success: true, data: { authenticated: true } });
    }
    if (!authManager.verifyCuratorSecret(secret) && !authManager.verifyAgentToken(secret)) {
      return res.status(401).json({ success: false, error: 'Неверный пароль или токен доступа' });
    }
    authManager.setSessionCookie(res);
    res.json({ success: true, data: { authenticated: true } });
  });

  app.post('/api/auth/logout', (_req, res) => {
    authManager.clearSessionCookie(res);
    res.json({ success: true });
  });

  app.post('/api/auth/configure', authManager.requireUiAuth, async (req, res) => {
    try {
      const mode = req.body?.mode === 'password' ? 'password' : 'open';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      await authManager.configureAuth(mode, password);
      if (mode === 'password') {
        authManager.setSessionCookie(res);
      } else {
        authManager.clearSessionCookie(res);
      }
      res.json({ success: true, data: { authRequired: authManager.isUiAuthEnabled() } });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.get('/api/auth/agent-token', authManager.requireUiAuth, (_req, res) => {
    res.json({
      success: true,
      data: {
        agentToken: authManager.getAgentToken(),
        managedByEnv: authManager.isAgentTokenManagedByEnv(),
        mcpUrl: '/mcp',
        sseUrl: '/sse',
        restBaseUrl: '/api/v1',
        openApiUrl: '/api/v1/openapi.json',
      },
    });
  });

  app.post('/api/auth/regenerate-agent-token', authManager.requireUiAuth, async (_req, res) => {
    try {
      const nextToken = await authManager.regenerateAgentToken();
      res.json({ success: true, data: { agentToken: nextToken } });
    } catch (err: any) {
      res.status(409).json({ success: false, error: err?.message || String(err) });
    }
  });

  // SSE endpoint for web clients to receive IPC & Inbox events in real time
  app.get('/api/ipc/events', authManager.requireUiAuth, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseClients.add(res);
    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  // Web Proxy endpoints (protected in server mode)
  app.get('/api/web-proxy', authManager.requireUiAuth, handleWebProxyRequest);
  app.get('/api/web-proxy/asset', authManager.requireUiAuth, handleWebProxyAgentRequest);

  // Web/Mobile Browser File Bridge (/api/files/browse, /api/files/upload, /api/files/download, /api/files/mkdir)
  app.use('/api/files', authManager.requireUiAuth, createWebFilesRouter({ config: runtimeConfig, getData }));

  // Curator Web Inbox routes (/api/inbox/*)
  app.use('/api/inbox', createInboxRouter({ authManager, inboxService }));

  // Self-Update & AI_env Hot-Swap routes (/api/updates/*)
  app.use('/api/updates', createUpdatesRouter({ authManager, updateService }));

  // REST + OpenAPI v3.1 Agent API (/api/v1/*)
  app.use('/api/v1', createRestAgentRouter({ config: runtimeConfig, authManager, toolsEngine }));

  // MCP Server endpoints (Streamable HTTP /mcp + Legacy SSE /sse & /messages)
  mountMcpRoutes({ app, authManager, toolsEngine });

  // Media file serving endpoint for web/mobile streaming with Range support & path confinement
  async function resolveMediaFilePath(rawPath: string): Promise<string | null> {
    let filePath = rawPath;
    if (filePath.startsWith('file://')) {
      try {
        filePath = fileURLToPath(filePath);
      } catch {
        filePath = filePath.replace(/^file:\/\//, '');
      }
    }

    const appCfg = (await getData('config.json').catch(() => ({}))) || {};
    const baseDir = String(appCfg.baseDir || '').trim() || runtimeConfig.dataDir;
    const allowedRoots = Array.from(new Set([runtimeConfig.dataDir, baseDir]));

    const candidates = [
      filePath,
      path.join(baseDir, filePath),
      path.join(runtimeConfig.dataDir, filePath),
      ...(runtimeConfig.isServerMode ? [] : [path.join(process.cwd(), filePath), path.join(__dirname, filePath)]),
    ];

    for (const cand of candidates) {
      try {
        const resolved = runtimeConfig.isServerMode
          ? resolveConfinedPath(cand, baseDir, allowedRoots)
          : path.resolve(cand);
        const stat = await fs.stat(resolved);
        if (stat.isFile()) {
          return resolved;
        }
      } catch {}
    }
    return null;
  }

  app.get('/api/media-file', authManager.requireUiAuth, async (req, res) => {
    try {
      const rawPath = req.query.path as string;
      if (!rawPath) return res.status(400).send('Missing path parameter');
      const foundPath = await resolveMediaFilePath(rawPath);
      if (!foundPath) return res.status(404).send('File not found');
      res.sendFile(path.resolve(foundPath));
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.head('/api/media-file', authManager.requireUiAuth, async (req, res) => {
    try {
      const rawPath = req.query.path as string;
      if (!rawPath) return res.status(400).end();
      const foundPath = await resolveMediaFilePath(rawPath);
      if (!foundPath) return res.status(404).end();
      res.status(200).end();
    } catch {
      res.status(500).end();
    }
  });

  // API Route to call IPC handlers from the browser frontend
  app.post('/api/ipc/:channel', authManager.requireUiAuth, async (req, res) => {
    const channel = Array.isArray(req.params.channel) ? req.params.channel[0] : String(req.params.channel || '');
    const args = req.body.args || [];
    const handler = mockIpcHandlers.get(channel);

    // In local non-server web-preview mode (e.g. AI Studio dev preview), avoid OOM from heavy ML models
    if (!runtimeConfig.isServerMode) {
      const mockHeavyModels = [
        'load-local-translate-model',
        'translate-local',
        'load-diarization-model',
        'run-diarization',
        'check-local-translate-status',
        'check-diarization-status',
        'ai-process-subtitles',
      ];
      if (mockHeavyModels.includes(channel)) {
        if (channel === 'check-diarization-status') {
          return res.json({
            success: true,
            data: {
              isLoaded: true,
              isLoading: false,
              modelName: 'WhisperX',
              downloadProgress: 100,
              loadingStatus: 'Готова к работе (Эмуляция веб-превью)',
            },
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
              loadingStatus: 'Готова к работе (Эмуляция веб-превью)',
            },
          });
        }
        if (channel === 'run-diarization') {
          const inputData = args[0] || {};
          const lines = inputData.subtitleLines || [];
          const mapping: Record<string, string> = {};
          lines.forEach((line: any, idx: number) => {
            if (line && line.id) mapping[line.id] = `Speaker ${(idx % 2) + 1}`;
          });
          return res.json({
            success: true,
            data: { speakerMapping: mapping, detectedSpeakersCount: 2 },
          });
        }
        if (channel === 'translate-local') {
          const inputData = args[0] || {};
          const text = inputData.text || '';
          const destLang = inputData.destLang || 'ru';
          return res.json({
            success: true,
            data: destLang === 'ru' ? `[Перевод]: ${text}` : `[Translated to ${destLang}]: ${text}`,
          });
        }
        if (channel === 'load-local-translate-model' || channel === 'load-diarization-model') {
          return res.json({ success: true, data: { success: true } });
        }
        return res.json({
          success: true,
          data: { success: true, data: { message: 'Mocked response for web preview' } },
        });
      }

      if (channel === 'get-whisper-system-status') {
        const requestedModel = (args[0] && args[0].model) || 'small';
        return res.json({
          success: true,
          data: {
            isReady: true,
            canLoadModel: true,
            statusText: 'Система Whisper готова к загрузке модели',
            backendType: 'server',
            availableModels: ['small', 'base', 'tiny'],
            activeModel: requestedModel,
            modelsDir: path.join(runtimeConfig.dataDir, 'models', 'whisper'),
            details: `Движок Whisper готов принимать аудиодорожки. Выбранная модель «${requestedModel}» готова к загрузке в память.`,
          },
        });
      }
      if (channel === 'get-downloaded-whisper-models') {
        return res.json({ success: true, data: ['small', 'base', 'tiny'] });
      }
      if (channel === 'qa-whisper-check-lines') {
        const inputData = args[0] || {};
        const lines = inputData.lines || [];
        const results = lines.map((line: any, idx: number) => {
          let recognizedText = line.text;
          if (idx % 6 === 2 && line.text.length > 20) {
            const words = line.text.split(' ');
            if (words.length > 4) recognizedText = words.slice(0, words.length - 2).join(' ') + ' ладно';
          } else if (idx % 8 === 4 && line.text.length > 15) {
            recognizedText = line.text.split(' ')[0] + '... ' + line.text;
          }
          return { lineIndex: line.lineIndex, expectedText: line.text, recognizedText };
        });
        return res.json({ success: true, data: { results } });
      }
    }

    if (channel === 'get-episode-title') {
      let titleRes = '';
      if (handler) {
        try {
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000));
          const resVal = await Promise.race([
            handler({ sender: { send: (ev: string, d: any) => broadcastIpcEvent(ev, d) } }, ...args),
            timeoutPromise,
          ]);
          if (resVal && typeof resVal === 'object' && resVal.data) {
            titleRes = resVal.data;
          } else if (typeof resVal === 'string') {
            titleRes = resVal;
          }
        } catch {}
      }
      return res.json({ success: true, data: titleRes || '' });
    }

    if (handler) {
      const startTime = Date.now();
      try {
        const result = await handler(
          { sender: { send: (ev: string, d: any) => broadcastIpcEvent(ev, d) } },
          ...args
        );
        const elapsed = Date.now() - startTime;
        if (result && typeof result === 'object' && result.success === false) {
          console.error(`[IPC Server Error] channel: ${channel} (${elapsed}ms):`, result.error);
        }
        res.json({ success: true, data: result });
      } catch (error: any) {
        const elapsed = Date.now() - startTime;
        console.error(`[IPC Server Crash] channel: ${channel} (${elapsed}ms):`, error?.stack || error?.message || error);
        res.json({
          success: false,
          error: error?.message || String(error),
          stack: error?.stack || null,
          stderr: error?.stderr || null,
          stdout: error?.stdout || null,
          code: error?.code || null,
        });
      }
    } else {
      res.status(404).json({ success: false, error: `Handler for ${channel} not found` });
    }
  });

  app.get('/api/web-proxy-legacy', authManager.requireUiAuth, handleWebProxy);

  // OAuth Callback Handler
  app.get(['/auth/callback', '/auth/callback/'], async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const safeCodeJson = JSON.stringify(code);
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'YANDEX_AUTH_SUCCESS', code: ${safeCodeJson} }, '*');
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

  // Vite middleware for development or static build in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.ENABLE_HMR === 'true' ? { server: httpServer } : false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.use((_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const shutdown = () => {
    inboxService.stopTelegramBotPoller();
    updateService.stopScheduler();
    killAllTrackedProcesses();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('exit', () => {
    inboxService.stopTelegramBotPoller();
    updateService.stopScheduler();
    killAllTrackedProcesses();
  });

  httpServer.on('error', (err) => {
    console.error('[Server] HTTP listen error:', err);
    process.exit(1);
  });

  httpServer.listen(PORT, runtimeConfig.host, () => {
    console.log(`Anime Dub Manager server running on http://${runtimeConfig.host}:${PORT}`);
    if (runtimeConfig.isServerMode) {
      console.log(`[Umbrel Mode] MCP Streamable HTTP: http://localhost:${PORT}/mcp | SSE: /sse | REST: /api/v1`);
    }
    void updateService.clearBootPendingOnHealthyStartup();
  });
}

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled Rejection:', reason);
});

startServer().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
