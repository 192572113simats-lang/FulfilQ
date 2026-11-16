import crypto from 'crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Role } from '@fulfilliq/shared';
import { DbClient } from '../db/index.ts';
import { requireAuth, signAccessToken } from '../middleware/auth.ts';
import { loginRateLimiter } from '../middleware/rateLimit.ts';
import { writeAuditLog } from '../services/auditService.ts';
import { syncLocalCsvFiles } from '../services/csvService.ts';

const LoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

const RegisterSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  fullName: z.string().trim().min(2, 'Full name is required').max(120),
  phone: z.string().trim().min(6, 'Phone number is required').max(30),
});

export function createAuthRouter(db: DbClient): Router {
  const router = Router();

  router.post('/register', loginRateLimiter, async (req, res, next) => {
    try {
      const parsed = RegisterSchema.parse(req.body);
      const normalizedEmail = parsed.email.toLowerCase();

      const existing = await db.query<{ id: string }>(
        'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
        [normalizedEmail]
      );
      if (existing.rowCount > 0) {
        res.status(409).json({
          error: 'EMAIL_EXISTS',
          message: 'An account with this email already exists',
        });
        return;
      }

      const passwordHash = await bcrypt.hash(parsed.password, 10);
      const userId = `usr-${crypto.randomUUID()}`;
      const now = new Date().toISOString();

      // Self-service registration strictly assigns Role.CUSTOMER server-side
      await db.withTransaction(async (tx) => {
        await tx.query(
          `INSERT INTO users (id, email, password_hash, full_name, phone, role, warehouse_id, is_active, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,NULL,1,$7)`,
          [userId, normalizedEmail, passwordHash, parsed.fullName, parsed.phone, Role.CUSTOMER, now]
        );

        await writeAuditLog(tx, {
          entityType: 'user',
          entityId: userId,
          action: 'USER_REGISTERED',
          toState: Role.CUSTOMER,
          actorId: userId,
          actorName: parsed.fullName,
          actorRole: Role.CUSTOMER,
          reason: 'Self-service account registration stored locally and mirrored to CSV',
          createdAt: now,
        });
      });

      await syncLocalCsvFiles(db);

      const authUser = {
        id: userId,
        email: normalizedEmail,
        fullName: parsed.fullName,
        role: Role.CUSTOMER,
        warehouseId: null,
      };
      const accessToken = signAccessToken(authUser);

      res.status(201).json({
        accessToken,
        user: authUser,
      });
    } catch (err) {
      next(err);
    }
  });

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
