import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Role } from '@fulfilliq/shared';
import { apiFetch, getStoredToken, setStoredToken } from './api.ts';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  warehouseId: string | null;
}

export interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
  phone: string;
}

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  register: (input: RegisterInput) => Promise<SessionUser>;
  logout: () => void;
  announce: (message: string) => void;
  liveMessage: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveMessage, setLiveMessage] = useState('');

  const announce = useCallback((message: string) => {
    setLiveMessage('');
    requestAnimationFrame(() => setLiveMessage(message));
  }, []);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setLoading(false);
      return;
    }
    apiFetch<{ user: SessionUser }>('/api/auth/me')
      .then((res) => setUser(res.user))
      .catch(() => {
        setStoredToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiFetch<{ accessToken: string; user: SessionUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setStoredToken(res.accessToken);
    setUser(res.user);
    announce(`Signed in as ${res.user.fullName} (${res.user.role})`);
    return res.user;
  }, [announce]);

  const register = useCallback(async (input: RegisterInput) => {
    const res = await apiFetch<{ accessToken: string; user: SessionUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    setStoredToken(res.accessToken);
    setUser(res.user);
    announce(`Account created for ${res.user.fullName} and stored locally`);
    return res.user;
  }, [announce]);

  const logout = useCallback(() => {
    setStoredToken(null);
    setUser(null);
    announce('Signed out');
  }, [announce]);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, announce, liveMessage }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function defaultRouteForRole(role: Role): string {
  switch (role) {
    case Role.CUSTOMER:
      return '/store';
    case Role.PICKER:
      return '/picker';
    case Role.STORE_MANAGER:
      return '/dispatch';
    case Role.SUPPORT_AGENT:
      return '/support';
    case Role.FINANCE_REVIEWER:
      return '/finance';
    case Role.ADMIN:
      return '/admin';
    default:
      return '/store';
  }
}
