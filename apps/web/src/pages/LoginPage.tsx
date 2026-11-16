import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api.ts';
import { defaultRouteForRole, useAuth } from '../lib/auth.tsx';

const DEMO_ACCOUNTS = [
  { role: 'customer', email: 'customer@demo.fulfilliq.test', label: 'Customer (Avery Chen)' },
  { role: 'picker', email: 'picker@demo.fulfilliq.test', label: 'Warehouse Picker (Sam Rivera)' },
  { role: 'store_manager', email: 'manager@demo.fulfilliq.test', label: 'Store Manager (Riley Brooks)' },
  { role: 'support_agent', email: 'support@demo.fulfilliq.test', label: 'Support Agent (Morgan Blake)' },
  { role: 'finance_reviewer', email: 'finance@demo.fulfilliq.test', label: 'Finance Reviewer (Dana Vance)' },
  { role: 'admin', email: 'admin@demo.fulfilliq.test', label: 'Administrator (Taylor Kim)' },
];

export function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('customer@demo.fulfilliq.test');
  const [password, setPassword] = useState('DemoPass123!');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('+1-555-0199');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const switchMode = (nextMode: 'login' | 'register') => {
    setMode(nextMode);
    setError(null);
    if (nextMode === 'register' && email.endsWith('@demo.fulfilliq.test')) {
      setEmail('');
      setPassword('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        const user = await login(email, password);
        navigate(defaultRouteForRole(user.role));
      } else {
        const user = await register({ email, password, fullName, phone });
        navigate(defaultRouteForRole(user.role));
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : mode === 'login'
            ? 'Unable to sign in'
            : 'Unable to create account'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const quickFill = (demoEmail: string) => {
    setMode('login');
    setEmail(demoEmail);
    setPassword('DemoPass123!');
    setError(null);
  };

  return (
    <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 items-start py-6">
      <section className="bg-white border border-slate-200 rounded-lg p-6 sm:p-8">
        <div
          role="tablist"
          aria-label="Account access mode"
          className="grid grid-cols-2 p-1 bg-slate-100 rounded-md border border-slate-200 mb-6"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            onClick={() => switchMode('login')}
            className={`py-2 text-sm font-medium rounded transition-colors ${
              mode === 'login'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            onClick={() => switchMode('register')}
            className={`py-2 text-sm font-medium rounded transition-colors ${
              mode === 'register'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Create Account
          </button>
        </div>

        <h1 className="text-2xl font-bold text-slate-900">
          {mode === 'login' ? 'Sign in to FulfillIQ' : 'Create local customer account'}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {mode === 'login'
            ? 'Role-based access control is enforced server-side with JWT tokens. All accounts and orders in this environment are synthetic.'
            : 'New accounts are saved locally in the SQLite database and mirrored to ./data/csv/users.csv. Self-service signup assigns customer permissions.'}
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5" noValidate>
          {error && (
            <div role="alert" className="p-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-800">
              {error}
            </div>
          )}

          {mode === 'register' && (
            <>
              <div>
                <label htmlFor="register-name" className="block text-sm font-medium text-slate-700 mb-1.5">
                  Full name
                </label>
                <input
                  id="register-name"
                  type="text"
                  required
                  autoComplete="name"
                  placeholder="Jordan Patel"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-md focus:border-blue-700"
                />
              </div>

              <div>
                <label htmlFor="register-phone" className="block text-sm font-medium text-slate-700 mb-1.5">
                  Synthetic phone number
                </label>
                <input
                  id="register-phone"
                  type="tel"
                  required
                  autoComplete="tel"
                  placeholder="+1-555-0199"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-md focus:border-blue-700"
                />
              </div>
            </>
          )}

          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-slate-700 mb-1.5">
              Email address
            </label>
            <input
              id="login-email"
              type="email"
              required
              autoComplete="email"
              placeholder={mode === 'register' ? 'jordan.patel@demo.fulfilliq.test' : undefined}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-md focus:border-blue-700"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 mb-1.5">
              Password {mode === 'register' && <span className="text-slate-500 font-normal">(min 8 chars)</span>}
            </label>
            <input
              id="login-password"
              type="password"
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-md focus:border-blue-700"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-60 transition-colors min-h-[44px]"
          >
            {submitting
              ? mode === 'login'
                ? 'Signing in...'
                : 'Creating account...'
              : mode === 'login'
                ? 'Sign In'
                : 'Create Account & Sign In'}
          </button>
        </form>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-6 sm:p-8">
        <h2 className="text-lg font-semibold text-slate-900">Demo Role Accounts (Demo Only)</h2>
        <p className="mt-1.5 text-sm text-slate-600">
          Select any seeded synthetic role below to populate credentials, then click Sign In. Admins can also bulk-import users via CSV.
        </p>

        <div className="mt-5 divide-y divide-slate-200 border border-slate-200 rounded-md">
          {DEMO_ACCOUNTS.map((acc) => (
            <button
              key={acc.email}
              type="button"
              onClick={() => quickFill(acc.email)}
              className={`w-full text-left px-4 py-3 flex items-center justify-between gap-4 hover:bg-slate-50 transition-colors ${
                mode === 'login' && email === acc.email ? 'bg-blue-50' : 'bg-white'
              }`}
            >
              <div>
                <div className="text-sm font-medium text-slate-900">{acc.label}</div>
                <div className="text-xs font-mono text-slate-500">{acc.email}</div>
              </div>
              <span className="text-xs font-medium text-blue-700 whitespace-nowrap shrink-0">
                Use Account
              </span>
            </button>
          ))}
        </div>

        <p className="mt-4 text-xs text-slate-500">
          Warning: Demo credentials (<span className="font-mono">DemoPass123!</span>) are for local and academic testing only.
        </p>
      </section>
    </div>
  );
}
