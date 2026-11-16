import { Router } from 'express';
import { z } from 'zod';
import { DeliveryColumn } from '@fulfilliq/shared';
import { DbClient } from '../db/index.ts';
import { requireAuth } from '../middleware/auth.ts';
import { HttpError } from '../middleware/errorHandler.ts';

const WIP_LIMITS: Partial<Record<DeliveryColumn, number>> = {
  'In Progress': 4,
  Review: 2,
  Test: 2,
};

const MoveStorySchema = z.object({
  columnStatus: z.enum(['Ready', 'In Progress', 'Review', 'Test', 'Blocked', 'Done']),
  blockedReason: z.string().trim().max(240).nullable().optional(),
});

export function createDeliveryBoardRouter(db: DbClient): Router {
  const router = Router();

  router.get('/delivery-board', requireAuth, async (_req, res, next) => {
    try {
      const result = await db.query<{
        id: string;
        epic: string;
        title: string;
        priority: string;
        points: number;
        sprint: number;
        owner_role: string;
        column_status: DeliveryColumn;
        dependencies_json: string;
        acceptance_criteria: string;
        blocked_reason: string | null;
        is_deferred: number;
        simulated_note: string;
      }>('SELECT * FROM delivery_stories ORDER BY sprint ASC, id ASC');

      res.json({
        banner: 'SIMULATED PLANNING DATA, not actual team delivery. Separate from operational order lifecycle.',
        wipLimits: WIP_LIMITS,
        stories: result.rows.map((r) => ({
          id: r.id,
          epic: r.epic,
          title: r.title,
          priority: r.priority,
          points: Number(r.points),
          sprint: Number(r.sprint),
          ownerRole: r.owner_role,
          columnStatus: r.column_status,
          dependencies: JSON.parse(r.dependencies_json) as string[],
          acceptanceCriteria: r.acceptance_criteria,
          blockedReason: r.blocked_reason,
          isDeferred: Boolean(r.is_deferred),
          simulatedNote: r.simulated_note,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/delivery-board/:id', requireAuth, async (req, res, next) => {
    try {
      const body = MoveStorySchema.parse(req.body);
      const storyRes = await db.query<{ id: string; column_status: DeliveryColumn }>(
        'SELECT id, column_status FROM delivery_stories WHERE id = $1',
        [req.params.id]
      );
      if (storyRes.rowCount === 0) {
        throw new HttpError(404, 'STORY_NOT_FOUND', 'Delivery story not found');
      }

      const limit = WIP_LIMITS[body.columnStatus];
      if (limit !== undefined && storyRes.rows[0].column_status !== body.columnStatus) {
        const countRes = await db.query<{ cnt: number }>(
          'SELECT COUNT(*) AS cnt FROM delivery_stories WHERE column_status = $1',
          [body.columnStatus]
        );
        if (Number(countRes.rows[0]?.cnt ?? 0) >= limit) {
          throw new HttpError(
            409,
            'WIP_LIMIT_REACHED',
            `Column '${body.columnStatus}' has reached its Lean WIP limit of ${limit}`
          );
        }
      }

      await db.query(
        `UPDATE delivery_stories SET column_status = $1, blocked_reason = $2, updated_at = $3 WHERE id = $4`,
        [body.columnStatus, body.blockedReason ?? null, new Date().toISOString(), req.params.id]
      );

      res.json({ id: req.params.id, columnStatus: body.columnStatus });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
