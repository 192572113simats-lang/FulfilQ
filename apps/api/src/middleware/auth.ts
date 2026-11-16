import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@fulfilliq/shared';
import { getConfig } from '../config.ts';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  warehouseId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signAccessToken(user: AuthUser): string {
  const cfg = getConfig();
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      warehouseId: user.warehouseId,
    },
    cfg.jwtSecret,
    { expiresIn: cfg.jwtExpiresIn as jwt.SignOptions['expiresIn'] }
  );
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' });
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Empty bearer token' });
    return;
  }

  try {
    const cfg = getConfig();
    const payload = jwt.verify(token, cfg.jwtSecret) as jwt.JwtPayload & {
      sub: string;
      email: string;
      fullName: string;
      role: Role;
      warehouseId: string | null;
    };

    if (!payload.sub || !payload.role || !Object.values(Role).includes(payload.role)) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid token claims' });
      return;
    }

    req.user = {
      id: payload.sub,
      email: payload.email,
      fullName: payload.fullName,
      role: payload.role,
      warehouseId: payload.warehouseId ?? null,
    };
    next();
  } catch {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Token expired or invalid' });
  }
}

export function requireRole(...allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: `Role '${req.user.role}' is not permitted to perform this action`,
      });
      return;
    }
    next();
  };
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const visible = local.slice(0, 2);
  return `${visible}***@${domain}`;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***-***-${digits.slice(-4)}`;
}

export function shouldMaskCustomerContact(role: Role): boolean {
  return role === Role.PICKER || role === Role.STORE_MANAGER || role === Role.FINANCE_REVIEWER;
}
