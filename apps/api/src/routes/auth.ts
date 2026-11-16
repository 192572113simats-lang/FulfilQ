import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Role } from '@fulfilliq/shared';
import { DbClient } from '../db/index.ts';
import { requireAuth, signAccessToken } from '../middleware/auth.ts';
import { loginRateLimiter } from '../middleware/rateLimit.ts';

const LoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export function createAuthRouter(db: DbClient): Router {
  const router = Router();

  router.post('/login', loginRateLimiter, async (req, res, next) => {
    try {
      const parsed = LoginSchema.parse(req.body);
      const userRes = await db.query<{
        id: string;
        email: string;
        password_hash: string;
        full_name: string;
        role: Role;
        warehouse_id: string | null;
        is_active: number;
      }>(
        `SELECT id, email, password_hash, full_name, role, warehouse_id, is_active
         FROM users WHERE LOWER(email) = LOWER($1)`,
        [parsed.email]
      );

      if (userRes.rowCount === 0) {
        res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
        return;
      }

      const user = userRes.rows[0];
      if (!user.is_active) {
        res.status(403).json({ error: 'ACCOUNT_DISABLED', message: 'User account is disabled' });
        return;
      }

      const valid = await bcrypt.compare(parsed.password, user.password_hash);
      if (!valid) {
        res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
        return;
      }

      const authUser = {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        warehouseId: user.warehouse_id,
      };
      const accessToken = signAccessToken(authUser);

      res.json({
        accessToken,
        user: authUser,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}
