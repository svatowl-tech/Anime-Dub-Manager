import express from 'express';
import type { ServerAuthManager } from './authMiddleware.ts';
import type { ServerUpdateService } from './serverUpdateService.ts';

export function createUpdatesRouter(options: {
  authManager: ServerAuthManager;
  updateService: ServerUpdateService;
}) {
  const router = express.Router();
  const { authManager, updateService } = options;

  router.use(authManager.requireUiAuth);

  router.get('/status', async (_req, res) => {
    try {
      const status = await updateService.getStatus(true);
      res.json({ success: true, data: status });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  router.post('/check', async (_req, res) => {
    try {
      const status = await updateService.checkForUpdates({ notifyInbox: true });
      res.json({ success: true, data: status });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  router.post('/apply', async (req, res) => {
    try {
      const force = Boolean(req.body?.force);
      const status = await updateService.applyUpdate({ force });
      res.json({ success: true, data: status });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message || String(err) });
    }
  });

  router.post('/rollback', async (_req, res) => {
    try {
      const status = await updateService.rollbackUpdate();
      res.json({ success: true, data: status });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message || String(err) });
    }
  });

  return router;
}
