import { Router } from 'express';
import { CONTRACT_VERSION } from '@fulfilliq/shared';

export function getOpenApiSpec() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'FulfillIQ Omnichannel Order Fulfilment API',
      version: CONTRACT_VERSION,
      description:
        'Versioned REST JSON API for FulfillIQ: RBAC auth, atomic stock reservations, idempotent payments with gateway resilience, barcode picking, strict order state machine, regional policies, returns & auditable refunds.',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/health': { get: { summary: 'Liveness probe', security: [], responses: { '200': { description: 'OK' } } } },
      '/ready': { get: { summary: 'Readiness probe (DB connectivity)', security: [], responses: { '200': { description: 'Ready' }, '503': { description: 'Not ready' } } } },
      '/api/auth/register': {
        post: {
          summary: 'Create a new customer account (stored locally in SQLite + users.csv)',
          security: [],
          responses: { '201': { description: 'Account created + JWT' }, '409': { description: 'Email already exists' } },
        },
      },
      '/api/auth/login': {
        post: {
          summary: 'Login with email & password (rate-limited)',
          security: [],
          responses: { '200': { description: 'JWT + User' }, '401': { description: 'Invalid credentials' } },
        },
      },
      '/api/auth/me': { get: { summary: 'Get authenticated user profile', responses: { '200': { description: 'User' } } } },
      '/api/csv/status': { get: { summary: 'Inspect local SQLite & CSV mirror file status', responses: { '200': { description: 'Local CSV files status' } } } },
      '/api/csv/sync': { post: { summary: 'Force sync local SQLite tables to ./data/csv/*.csv', responses: { '200': { description: 'Synced file summary' } } } },
      '/api/csv/template/{dataset}': { get: { summary: 'Download sample CSV template (users, inventory, orders)', responses: { '200': { description: 'CSV file' } } } },
      '/api/csv/export/{dataset}': { get: { summary: 'Export RBAC-masked CSV (users, inventory, orders, returns, audit)', responses: { '200': { description: 'CSV file' } } } },
      '/api/csv/import/{dataset}': { post: { summary: 'Import CSV records into local DB & refresh CSV mirrors (users, inventory, orders)', responses: { '200': { description: 'Import report' } } } },
      '/api/regions': { get: { summary: 'List regional policy configurations', security: [], responses: { '200': { description: 'Regions' } } } },
      '/api/warehouses': { get: { summary: 'List active regional warehouses', security: [], responses: { '200': { description: 'Warehouses' } } } },
      '/api/products': { get: { summary: 'Browse catalog with warehouse stock levels', security: [], responses: { '200': { description: 'Products' } } } },
      '/api/orders': {
        post: { summary: 'Place order with atomic stock reservation (S02)', responses: { '201': { description: 'Order Reserved' }, '409': { description: 'Out of Stock' } } },
        get: { summary: 'List orders scoped by RBAC role', responses: { '200': { description: 'Orders' } } },
      },
      '/api/orders/{id}': { get: { summary: 'Get order detail (owner/role enforced, PII masked)', responses: { '200': { description: 'Order detail' }, '403': { description: 'Forbidden' } } } },
      '/api/orders/{id}/status': { patch: { summary: 'Transition order state (strict state machine, 409 on invalid)', responses: { '200': { description: 'Updated' }, '409': { description: 'Invalid state transition' } } } },
      '/api/orders/{id}/tracking': { get: { summary: 'Customer-permitted milestones (no internal notes)', responses: { '200': { description: 'Milestones' } } } },
      '/api/payments': { post: { summary: 'Idempotent payment request (requires Idempotency-Key header)', responses: { '200': { description: 'Paid' }, '202': { description: 'Queued PAYMENT_PENDING on gateway outage' } } } },
      '/api/payments/{orderId}/retry': { post: { summary: 'Safely retry PAYMENT_PENDING order without double charge', responses: { '200': { description: 'Paid' }, '202': { description: 'Still pending' } } } },
      '/api/finance/reconciliation': { get: { summary: 'Payment vs order reconciliation report (finance_reviewer/admin)', responses: { '200': { description: 'Reconciliation rows' } } } },
      '/api/picking/queue': { get: { summary: 'Paid & reserved pick lists for assigned warehouse (picker/admin)', responses: { '200': { description: 'Pick queue' } } } },
      '/api/picking/{orderId}/scan': { post: { summary: 'Confirm item pick via barcode or manual SKU fallback', responses: { '200': { description: 'Item confirmed' }, '422': { description: 'Wrong barcode/SKU' } } } },
      '/api/picking/{orderId}/pack': { post: { summary: 'Mark order PACKED once all items scanned', responses: { '200': { description: 'Packed' }, '409': { description: 'Unpicked items remain' } } } },
      '/api/orders/{id}/return': { post: { summary: 'Owner-only return request within regional return window', responses: { '201': { description: 'Return requested' }, '422': { description: 'Window expired' } } } },
      '/api/returns': { get: { summary: 'List return requests', responses: { '200': { description: 'Returns' } } } },
      '/api/returns/{id}/queue-refund': { post: { summary: 'Move RETURN_REQUESTED -> REFUND_PENDING', responses: { '200': { description: 'Queued' } } } },
      '/api/returns/{id}/decision': { post: { summary: 'Approve/reject refund (finance_reviewer within limit; admin above limit)', responses: { '200': { description: 'Decision logged' }, '403': { description: 'Role or region limit exceeded' } } } },
      '/api/support/orders': { get: { summary: 'Support lookup by order ID, email, or phone fragment', responses: { '200': { description: 'Matching orders' } } } },
      '/api/alerts/low-stock': { get: { summary: 'Deterministic fixed-threshold low-stock alerts', responses: { '200': { description: 'Alerts' } } } },
      '/api/alerts/low-stock/{id}/resolve': { post: { summary: 'Resolve low-stock alert', responses: { '200': { description: 'Resolved' } } } },
      '/api/inventory/corrections': { post: { summary: 'Human-authorized, audited stock correction', responses: { '201': { description: 'Corrected' } } } },
      '/api/audit': { get: { summary: 'Query append-only audit log', responses: { '200': { description: 'Audit entries' } } } },
      '/api/admin/regions': { post: { summary: 'Create region policy & optional warehouse without code changes', responses: { '201': { description: 'Created' } } } },
      '/api/admin/regions/{regionId}': { patch: { summary: 'Update region tax, shipping, refund limit, return window', responses: { '200': { description: 'Updated' } } } },
      '/api/admin/users': { get: { summary: 'List users & roles', responses: { '200': { description: 'Users' } } } },
      '/api/admin/gateway': { get: { summary: 'Get payment gateway status', responses: { '200': { description: 'Gateway status' } } }, patch: { summary: 'Configure payment gateway mode or outage simulation', responses: { '200': { description: 'Updated' } } } },
      '/api/delivery-board': { get: { summary: 'Simulated Scrum/Kanban planning board (S01-S13)', responses: { '200': { description: 'Board' } } } },
    },
  };
}

export function createDocsRouter(): Router {
  const router = Router();
  const spec = getOpenApiSpec();

  router.get('/docs.json', (_req, res) => {
    res.json(spec);
  });

  router.get('/docs', (_req, res) => {
    const pathsHtml = Object.entries(spec.paths)
      .map(([p, methods]) => {
        const items = Object.entries(methods as Record<string, { summary: string }>)
          .map(
            ([m, info]) =>
              `<tr><td style="padding:8px 12px;font-family:monospace;font-weight:600;text-transform:uppercase;color:#1d4ed8;">${m}</td><td style="padding:8px 12px;font-family:monospace;">${p}</td><td style="padding:8px 12px;">${info.summary}</td></tr>`
          )
          .join('');
        return items;
      })
      .join('');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>FulfillIQ API Documentation (OpenAPI ${spec.openapi})</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 1040px; margin: 40px auto; padding: 0 24px; color: #0f172a; background: #f8fafc; }
    h1 { font-size: 24px; margin-bottom: 4px; }
    p { color: #475569; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e8f0; }
    th { text-align: left; padding: 10px 12px; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
    td { border-bottom: 1px solid #f1f5f9; font-size: 14px; }
    a { color: #1d4ed8; }
  </style>
</head>
<body>
  <h1>FulfillIQ REST API (v${spec.info.version})</h1>
  <p>${spec.info.description} &mdash; <a href="/api/docs.json">Download OpenAPI JSON</a></p>
  <table>
    <thead><tr><th>Method</th><th>Path</th><th>Summary</th></tr></thead>
    <tbody>${pathsHtml}</tbody>
  </table>
</body>
</html>`);
  });

  return router;
}
