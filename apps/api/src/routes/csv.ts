import fs from 'fs';
import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@fulfilliq/shared';
import { getConfig } from '../config.ts';
import { DbClient } from '../db/index.ts';
import { requireAuth, requireRole } from '../middleware/auth.ts';
import { HttpError } from '../middleware/errorHandler.ts';
import {
  CsvDataset,
  exportDatasetCsv,
  getCsvFileMap,
  getSampleCsvTemplate,
  importCsvDataset,
  syncLocalCsvFiles,
} from '../services/csvService.ts';

const ImportBodySchema = z.object({
  csvText: z.string().min(1, 'CSV content is required').max(2_000_000),
});

const EXPORT_ROLES: Record<CsvDataset, Role[]> = {
  users: [Role.ADMIN],
  inventory: [Role.ADMIN, Role.STORE_MANAGER, Role.PICKER],
  orders: [Role.ADMIN, Role.STORE_MANAGER, Role.FINANCE_REVIEWER, Role.SUPPORT_AGENT],
  returns: [Role.ADMIN, Role.FINANCE_REVIEWER, Role.SUPPORT_AGENT],
  audit: [Role.ADMIN, Role.FINANCE_REVIEWER, Role.SUPPORT_AGENT],
};

const IMPORT_ROLES: Record<'users' | 'inventory' | 'orders', Role[]> = {
  users: [Role.ADMIN],
  inventory: [Role.ADMIN, Role.STORE_MANAGER],
  orders: [Role.ADMIN, Role.STORE_MANAGER, Role.CUSTOMER],
};

export function createCsvRouter(db: DbClient): Router {
  const router = Router();

  router.get(
    '/csv/status',
    requireAuth,
    async (req, res, next) => {
      try {
        const cfg = getConfig();
        const user = req.user!;
        const fileMap = getCsvFileMap();
        const files = (Object.entries(fileMap) as Array<[CsvDataset, string]>).map(
          ([dataset, filePath]) => {
            const exists = fs.existsSync(filePath);
            const stat = exists ? fs.statSync(filePath) : null;
            return {
              dataset,
              fileName: filePath.split(/[\\/]/).pop(),
              exists,
              sizeBytes: stat ? stat.size : 0,
              updatedAt: stat ? stat.mtime.toISOString() : null,
            };
          }
        );

        res.json({
          storageMode: 'local_sqlite_plus_csv',
          sqlitePath: user.role === Role.CUSTOMER ? 'local-sqlite-db' : cfg.sqlitePath,
          csvDir: user.role === Role.CUSTOMER ? 'local-csv-store' : cfg.csvDir,
          files,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    '/csv/sync',
    requireAuth,
    requireRole(Role.ADMIN, Role.STORE_MANAGER, Role.FINANCE_REVIEWER),
    async (_req, res, next) => {
      try {
        const synced = await syncLocalCsvFiles(db);
        res.json({ synced });
      } catch (err) {
        next(err);
      }
    }
  );

  router.get('/csv/template/:dataset', requireAuth, (req, res, next) => {
    try {
      const ds = req.params.dataset;
      if (ds !== 'users' && ds !== 'inventory' && ds !== 'orders') {
        throw new HttpError(400, 'INVALID_DATASET', 'Template available for users, inventory, or orders');
      }
      const csv = getSampleCsvTemplate(ds);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="template_${ds}.csv"`);
      res.send(csv);
    } catch (err) {
      next(err);
    }
  });

  router.get('/csv/export/:dataset', requireAuth, async (req, res, next) => {
    try {
      const ds = req.params.dataset as CsvDataset;
      if (!EXPORT_ROLES[ds]) {
        throw new HttpError(400, 'INVALID_DATASET', 'Dataset must be users, inventory, orders, returns, or audit');
      }
      const user = req.user!;
      if (!EXPORT_ROLES[ds].includes(user.role)) {
        throw new HttpError(403, 'FORBIDDEN', `Role '${user.role}' cannot export '${ds}' CSV`);
      }

      const exported = await exportDatasetCsv(db, ds, user.role);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
      res.send(exported.csv);
    } catch (err) {
      next(err);
    }
  });

  router.post('/csv/import/:dataset', requireAuth, async (req, res, next) => {
    try {
      const ds = req.params.dataset;
      if (ds !== 'users' && ds !== 'inventory' && ds !== 'orders') {
        throw new HttpError(400, 'INVALID_DATASET', 'Import supported for users, inventory, or orders');
      }
      const user = req.user!;
      if (!IMPORT_ROLES[ds].includes(user.role)) {
        throw new HttpError(403, 'FORBIDDEN', `Role '${user.role}' cannot import '${ds}' CSV`);
      }

      const body = ImportBodySchema.parse(req.body);
      const report = await importCsvDataset(db, ds, body.csvText, user);
      res.json({ report });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
