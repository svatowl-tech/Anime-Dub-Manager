import express from 'express';
import type { ServerAuthManager } from './authMiddleware.ts';
import type { CuratorInboxService } from './curatorInboxService.ts';
import type { AgentToolsEngine } from './agentToolsEngine.ts';
import { createDirectToolExecutor } from './mcpToolsRegistry.ts';
import type { ServerRuntimeConfig } from './serverConfig.ts';

export function createInboxRouter(options: {
  authManager: ServerAuthManager;
  inboxService: CuratorInboxService;
}) {
  const router = express.Router();
  const { authManager, inboxService } = options;

  router.use(authManager.requireUiAuth);

  router.get('/', async (req, res) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const [items, summary] = await Promise.all([
        inboxService.list({ status, projectId, limit }),
        inboxService.getUnreadSummary(),
      ]);
      res.json({ success: true, data: { items, summary } });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const created = await inboxService.create(req.body);
      res.json({ success: true, data: created });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message || String(err) });
    }
  });

  const paramStr = (val: string | string[] | undefined): string =>
    Array.isArray(val) ? String(val[0] || '') : String(val || '');

  router.post('/:id/respond', async (req, res) => {
    try {
      const updated = await inboxService.respond(paramStr(req.params.id), {
        status: req.body?.status,
        curatorNote: req.body?.curatorNote,
        read: req.body?.read,
      });
      res.json({ success: true, data: updated });
    } catch (err: any) {
      res.status(404).json({ success: false, error: err?.message || String(err) });
    }
  });

  router.post('/mark-all-read', async (_req, res) => {
    try {
      await inboxService.markAllRead();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  router.post('/clear-resolved', async (_req, res) => {
    try {
      const removed = await inboxService.clearResolved();
      res.json({ success: true, data: { removed } });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const ok = await inboxService.deleteItem(paramStr(req.params.id));
      res.json({ success: ok });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  return router;
}

export function createRestAgentRouter(options: {
  config: ServerRuntimeConfig;
  authManager: ServerAuthManager;
  toolsEngine: AgentToolsEngine;
}) {
  const router = express.Router();
  const { config, authManager, toolsEngine } = options;
  const executor = createDirectToolExecutor(toolsEngine);

  // Public OpenAPI 3.1 schema for agent frameworks / OpenWebUI / Dify
  router.get('/openapi.json', (req, res) => {
    const serverUrl = `${req.protocol}://${req.get('host') || `localhost:${config.port}`}/api/v1`;
    res.json({
      openapi: '3.1.0',
      info: {
        title: 'Anime Dub Manager Curator API',
        version: '1.2.0',
        description:
          'REST & Tool API for autonomous AI curator agents controlling Anime Dub Manager on Umbrel OS.',
      },
      servers: [{ url: serverUrl }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
        },
      },
      security: [{ bearerAuth: [] }],
      paths: {
        '/overview': { get: { summary: 'Get server, AI_env, queue and inbox overview' } },
        '/playbook': { get: { summary: 'Get Markdown curator playbook for LLM instructions' } },
        '/projects': {
          get: { summary: 'List studio projects' },
          post: { summary: 'Create or update a project' },
        },
        '/projects/{projectId}': { get: { summary: 'Get project details with episodes' } },
        '/episodes': {
          get: { summary: 'List episodes' },
          post: { summary: 'Create or update an episode' },
        },
        '/episodes/{episodeId}': { get: { summary: 'Get episode details' } },
        '/episodes/{episodeId}/assign-dubbers': { post: { summary: 'Assign dubbers to episode characters' } },
        '/episodes/{episodeId}/auto-timing': { post: { summary: 'Run auto-timing analysis' } },
        '/episodes/{episodeId}/export-sound-engineer': { post: { summary: 'Export tracks and subs for sound engineer' } },
        '/episodes/{episodeId}/build-release': { post: { summary: 'Build final episode release' } },
        '/participants': {
          get: { summary: 'List studio participants' },
          post: { summary: 'Save participant' },
        },
        '/downloads': { post: { summary: 'Start Anime365, Torrent or YouTube media download' } },
        '/tasks': { get: { summary: 'List background tasks & downloads' } },
        '/tasks/{taskId}': { get: { summary: 'Get task status' } },
        '/inbox': {
          get: { summary: 'List curator inbox notifications' },
          post: { summary: 'Send notification or approval request to curator' },
        },
        '/inbox/{id}': { get: { summary: 'Get specific inbox item and curator verdict' } },
        '/tools': { get: { summary: 'List all registered ADM agent tools' } },
        '/tools/{toolName}': { post: { summary: 'Invoke any registered ADM MCP tool by name via JSON' } },
      },
    });
  });

  router.use(authManager.requireAgentAuth);

  const wrap = (fn: (req: express.Request) => Promise<any>) => async (req: express.Request, res: express.Response) => {
    try {
      const data = await fn(req);
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message || String(err) });
    }
  };

  const paramStr = (val: string | string[] | undefined): string =>
    Array.isArray(val) ? String(val[0] || '') : String(val || '');

  router.get('/overview', wrap(() => toolsEngine.getOverview()));
  router.get('/playbook', (_req, res) => {
    res.type('text/markdown; charset=utf-8').send(toolsEngine.getCuratorPlaybookMarkdown());
  });

  router.get('/projects', wrap((req) => toolsEngine.listProjects({ includeArchived: req.query.includeArchived === 'true' })));
  router.get('/projects/:projectId', wrap((req) => toolsEngine.getProject(paramStr(req.params.projectId))));
  router.post('/projects', wrap((req) => toolsEngine.saveProject(req.body?.project || req.body)));
  router.post('/projects/:projectId/sync-anime365', wrap((req) => toolsEngine.syncProjectAnime365(paramStr(req.params.projectId))));

  router.get('/episodes', wrap((req) => toolsEngine.listEpisodes(typeof req.query.projectId === 'string' ? req.query.projectId : undefined)));
  router.get('/episodes/:episodeId', wrap((req) => toolsEngine.getEpisode({ episodeId: paramStr(req.params.episodeId) })));
  router.post('/episodes', wrap((req) => toolsEngine.saveEpisode(req.body?.episode || req.body)));
  router.post('/episodes/:episodeId/assign-dubbers', wrap((req) => toolsEngine.assignDubbers({ ...req.body, episodeId: paramStr(req.params.episodeId) })));
  router.post('/episodes/:episodeId/split-subtitles', wrap((req) => toolsEngine.splitSubtitlesByDubber({ ...req.body, episodeId: paramStr(req.params.episodeId) })));
  router.post('/episodes/:episodeId/qa', wrap((req) => toolsEngine.runQaCheck({ ...req.body, episodeId: paramStr(req.params.episodeId) })));
  router.post('/episodes/:episodeId/auto-timing', wrap((req) => toolsEngine.runAutoTiming({ ...req.body, episodeId: paramStr(req.params.episodeId) })));
  router.post('/episodes/:episodeId/export-sound-engineer', wrap((req) => toolsEngine.exportForSoundEngineer({ ...req.body, episodeId: paramStr(req.params.episodeId) })));
  router.post('/episodes/:episodeId/build-release', wrap((req) => toolsEngine.buildRelease({ ...req.body, episodeId: paramStr(req.params.episodeId) })));

  router.get('/participants', wrap(() => toolsEngine.listParticipants()));
  router.post('/participants', wrap((req) => toolsEngine.saveParticipant(req.body?.participant || req.body)));

  router.get('/search/anime', wrap((req) => toolsEngine.searchAnime(String(req.query.q || ''), req.query.source === 'all' ? 'all' : 'anime365')));
  router.get('/search/torrents', wrap((req) => toolsEngine.searchTorrents({ query: String(req.query.q || '') })));
  router.post('/downloads', wrap((req) => toolsEngine.downloadEpisodeMedia(req.body)));

  router.get('/tasks', wrap(() => toolsEngine.listTasks()));
  router.get('/tasks/:taskId', wrap((req) => toolsEngine.getTaskStatus(paramStr(req.params.taskId))));
  router.delete('/tasks/:taskId', wrap((req) => toolsEngine.abortTask(paramStr(req.params.taskId))));

  router.get('/inbox', wrap((req) => toolsEngine.listCuratorInbox({
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    projectId: typeof req.query.projectId === 'string' ? req.query.projectId : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  })));
  router.get('/inbox/:id', wrap((req) => toolsEngine.getInboxItem(paramStr(req.params.id))));
  router.post('/inbox', wrap((req) => toolsEngine.notifyCurator(req.body)));
  router.post('/inbox/:id/respond', wrap((req) => toolsEngine.respondCuratorInbox({ id: paramStr(req.params.id), ...req.body })));

  router.get('/tools', wrap(async () => executor.listTools()));
  router.post('/tools/:toolName', wrap((req) => executor.execute(paramStr(req.params.toolName), req.body || {})));

  return router;
}
