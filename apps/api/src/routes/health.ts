import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { DbClient } from '../db/index.ts';

export function createHealthRouter(db: DbClient): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'fulfilliq-api',
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/ready', async (_req, res) => {
    const ok = await db.healthCheck();
    if (!ok) {
      res.status(503).json({ status: 'not_ready', db: 'unreachable' });
      return;
    }
    res.json({
      status: 'ready',
      db: 'connected',
      dialect: db.dialect,
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/api/project.zip', (_req, res) => {
    const zipPath = path.resolve(process.cwd(), 'public', 'fulfilliq-project.zip');
    if (!fs.existsSync(zipPath)) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Project archive not found' });
      return;
    }
    res.download(zipPath, 'fulfilliq-project.zip');
  });

  return router;
}
