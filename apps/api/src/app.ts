import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { getConfig } from './config.ts';
import { DbClient } from './db/index.ts';
import { errorHandler } from './middleware/errorHandler.ts';
import { createDocsRouter } from './openapi.ts';
import { createAdminRouter } from './routes/admin.ts';
import { createAlertsRouter } from './routes/alerts.ts';
import { createAuditRouter } from './routes/audit.ts';
import { createAuthRouter } from './routes/auth.ts';
import { createCatalogRouter } from './routes/catalog.ts';
import { createDeliveryBoardRouter } from './routes/deliveryBoard.ts';
import { createHealthRouter } from './routes/health.ts';
import { createOrdersRouter } from './routes/orders.ts';
import { createPaymentsRouter } from './routes/payments.ts';
import { createPickingRouter } from './routes/picking.ts';
import { createReturnsRouter } from './routes/returns.ts';

export function createApiApp(db: DbClient): Express {
  const app = express();
  const cfg = getConfig();

  app.use(
    helmet({
      contentSecurityPolicy: false,
    })
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        if (
          cfg.corsOrigins.includes('*') ||
          cfg.corsOrigins.includes(origin) ||
          origin.endsWith('.run.app')
        ) {
          callback(null, true);
          return;
        }
        callback(null, true);
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: '1mb' }));

  app.use(createHealthRouter(db));
  app.use('/api', createDocsRouter());
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api', createCatalogRouter(db));
  app.use('/api', createOrdersRouter(db));
  app.use('/api', createPaymentsRouter(db));
  app.use('/api', createPickingRouter(db));
  app.use('/api', createReturnsRouter(db));
  app.use('/api', createAlertsRouter(db));
  app.use('/api', createAuditRouter(db));
  app.use('/api', createAdminRouter(db));
  app.use('/api', createDeliveryBoardRouter(db));

  app.use(errorHandler);
  return app;
}
