import express from 'express';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import multer from 'multer';
import { createRequire } from 'module';
import { resolveConfinedPath } from './authMiddleware.ts';
import type { ServerRuntimeConfig } from './serverConfig.ts';

const require = createRequire(import.meta.url);
const { sanitizeFileNamePart } = require('../electron/lib/pathSanitizer.cjs');

export function createWebFilesRouter(options: {
  config: ServerRuntimeConfig;
  getData: (filename: string) => Promise<any>;
}) {
  const router = express.Router();
  const { config, getData } = options;

  async function resolveStorageRoots(): Promise<{ baseDir: string; allowedRoots: string[] }> {
    const appCfg = (await getData('config.json').catch(() => ({}))) || {};
    const configuredBase = String(appCfg.baseDir || '').trim();
    const baseDir = configuredBase
      ? path.resolve(configuredBase)
      : config.dataDir;
    const allowedRoots = Array.from(new Set([config.dataDir, baseDir]));
    return { baseDir, allowedRoots };
  }

  const tmpUploadDir = path.join(config.dataDir, '.tmp_uploads');
  const upload = multer({
    storage: multer.diskStorage({
      destination: async (_req, _file, cb) => {
        try {
          await fs.mkdir(tmpUploadDir, { recursive: true });
          cb(null, tmpUploadDir);
        } catch (err: any) {
          cb(err, tmpUploadDir);
        }
      },
      filename: (_req, file, cb) => {
        const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        cb(null, `${unique}_${path.basename(file.originalname || 'upload.bin')}`);
      },
    }),
    limits: {
      fileSize: 8 * 1024 * 1024 * 1024, // 8 GB max for raw episodes
    },
  });

  // Browse server directories & files safely inside dataDir / baseDir
  router.get('/browse', async (req, res) => {
    try {
      const { baseDir, allowedRoots } = await resolveStorageRoots();
      const requestedDir = typeof req.query.dir === 'string' && req.query.dir.trim()
        ? req.query.dir.trim()
        : baseDir;

      const resolvedDir = resolveConfinedPath(requestedDir, baseDir, allowedRoots);
      await fs.mkdir(resolvedDir, { recursive: true });

      const entries = await fs.readdir(resolvedDir, { withFileTypes: true });
      const items = await Promise.all(
        entries
          .filter((entry) => !entry.name.startsWith('.tmp_'))
          .map(async (entry) => {
            const fullPath = path.join(resolvedDir, entry.name);
            let size = 0;
            let mtime = '';
            try {
              const st = await fs.stat(fullPath);
              size = st.size;
              mtime = st.mtime.toISOString();
            } catch {}
            return {
              name: entry.name,
              path: fullPath,
              isDirectory: entry.isDirectory(),
              size,
              mtime,
              ext: entry.isDirectory() ? '' : path.extname(entry.name).toLowerCase(),
            };
          })
      );

      items.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name, 'ru');
      });

      const parentCandidate = path.dirname(resolvedDir);
      let parentDir: string | null = null;
      try {
        resolveConfinedPath(parentCandidate, baseDir, allowedRoots);
        if (parentCandidate !== resolvedDir) {
          parentDir = parentCandidate;
        }
      } catch {
        parentDir = null;
      }

      res.json({
        success: true,
        data: {
          rootDir: baseDir,
          currentDir: resolvedDir,
          parentDir,
          items,
        },
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message || String(err) });
    }
  });

  // Create directory inside server storage
  router.post('/mkdir', async (req, res) => {
    try {
      const { baseDir, allowedRoots } = await resolveStorageRoots();
      const dirInput = String(req.body?.dir || '').trim();
      if (!dirInput) {
        return res.status(400).json({ success: false, error: 'Не указан путь папки' });
      }
      const targetDir = resolveConfinedPath(dirInput, baseDir, allowedRoots);
      await fs.mkdir(targetDir, { recursive: true });
      res.json({ success: true, data: { path: targetDir } });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message || String(err) });
    }
  });

  // Upload file from PC or Phone browser straight onto the server
  router.post('/upload', upload.single('file'), async (req, res) => {
    const tempFilePath = req.file?.path;
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'Файл не передан' });
      }

      const { baseDir, allowedRoots } = await resolveStorageRoots();
      const rawTargetDir = String(req.body?.targetDir || 'uploads').trim() || 'uploads';
      const targetDir = resolveConfinedPath(rawTargetDir, baseDir, allowedRoots);
      await fs.mkdir(targetDir, { recursive: true });

      const requestedName = String(req.body?.fileName || req.file.originalname || 'file.bin').trim();
      const rawExt = path.extname(requestedName);
      const rawBase = path.basename(requestedName, rawExt);
      const safeBase = sanitizeFileNamePart(rawBase, 'file');
      let finalFileName = `${safeBase}${rawExt.toLowerCase()}`;

      const shouldConvertSub =
        req.body?.convertSubtitles === 'true' ||
        finalFileName.startsWith('subtitles');
      const extLower = rawExt.toLowerCase();

      if (shouldConvertSub && (extLower === '.srt' || extLower === '.vtt' || extLower === '.ssa')) {
        finalFileName = `${safeBase}.ass`;
      }

      const finalPath = resolveConfinedPath(path.join(targetDir, finalFileName), baseDir, allowedRoots);

      if (shouldConvertSub && (extLower === '.srt' || extLower === '.vtt')) {
        const { convertSrtToAss } = require('../electron/services/subtitleService.cjs');
        await convertSrtToAss(req.file.path, finalPath);
        await fs.unlink(req.file.path).catch(() => {});
      } else {
        try {
          await fs.rename(req.file.path, finalPath);
        } catch {
          await fs.copyFile(req.file.path, finalPath);
          await fs.unlink(req.file.path).catch(() => {});
        }
        if (finalPath.toLowerCase().endsWith('.ass')) {
          const { cleanAssFile } = require('../electron/services/subtitleService.cjs');
          await cleanAssFile(finalPath).catch(() => {});
        }
      }

      const st = await fs.stat(finalPath);
      res.json({
        success: true,
        data: {
          path: finalPath,
          filePath: finalPath,
          fileName: path.basename(finalPath),
          size: st.size,
        },
      });
    } catch (err: any) {
      if (tempFilePath && fsSync.existsSync(tempFilePath)) {
        await fs.unlink(tempFilePath).catch(() => {});
      }
      res.status(400).json({ success: false, error: err?.message || String(err) });
    }
  });

  // Stream any file inside allowed server storage as a browser download
  router.get('/download', async (req, res) => {
    try {
      const rawPath = typeof req.query.path === 'string' ? req.query.path.trim() : '';
      if (!rawPath) {
        return res.status(400).json({ success: false, error: 'Missing path parameter' });
      }
      const { baseDir, allowedRoots } = await resolveStorageRoots();
      const safePath = resolveConfinedPath(rawPath, baseDir, allowedRoots);
      const stat = await fs.stat(safePath);
      if (!stat.isFile()) {
        return res.status(404).json({ success: false, error: 'File not found' });
      }
      res.download(safePath, path.basename(safePath));
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message || String(err) });
    }
  });

  return router;
}
