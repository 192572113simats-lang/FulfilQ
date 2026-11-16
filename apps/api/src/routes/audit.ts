import { Router } from 'express';
import { Role } from '@fulfilliq/shared';
import { DbClient } from '../db/index.ts';
import { requireAuth, requireRole } from '../middleware/auth.ts';

export function createAuditRouter(db: DbClient): Router {
  const router = Router();

  router.get(
    '/audit',
    requireAuth,
    requireRole(Role.FINANCE_REVIEWER, Role.ADMIN, Role.SUPPORT_AGENT),
    async (req, res, next) => {
      try {
        const entityType = typeof req.query.entityType === 'string' ? req.query.entityType.trim() : '';
        const action = typeof req.query.action === 'string' ? req.query.action.trim() : '';
        const entityId = typeof req.query.entityId === 'string' ? req.query.entityId.trim() : '';

        const params: string[] = [];
        let where = 'WHERE 1=1';

        if (entityType) {
          params.push(entityType);
          where += ` AND entity_type = $${params.length}`;
        }
        if (action) {
          params.push(action);
          where += ` AND action = $${params.length}`;
        }
        if (entityId) {
          params.push(`%${entityId}%`);
          where += ` AND entity_id LIKE $${params.length}`;
        }

        const result = await db.query(
          `SELECT id, entity_type AS "entityType", entity_id AS "entityId", action,
                  from_state AS "fromState", to_state AS "toState",
                  actor_id AS "actorId", actor_name AS "actorName", actor_role AS "actorRole",
                  amount_cents AS "amountCents", reason, created_at AS "createdAt"
           FROM audit_logs
           ${where}
           ORDER BY created_at DESC
           LIMIT 200`,
          params
        );

        res.json({ logs: result.rows });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
