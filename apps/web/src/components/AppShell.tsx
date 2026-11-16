import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { Role } from '@fulfilliq/shared';
import { useAuth } from '../lib/auth.tsx';

interface NavItem {
  to: string;
  label: string;
  roles: Role[];
}

const NAV_ITEMS: NavItem[] = [
  { to: '/store', label: 'Storefront', roles: [Role.CUSTOMER, Role.ADMIN] },
  { to: '/orders', label: 'My Orders', roles: [Role.CUSTOMER, Role.ADMIN] },
  { to: '/picker', label: 'Pick Queue', roles: [Role.PICKER, Role.ADMIN] },
  { to: '/dispatch', label: 'Dispatch & Alerts', roles: [Role.STORE_MANAGER, Role.ADMIN] },
  { to: '/support', label: 'Support Console', roles: [Role.SUPPORT_AGENT, Role.ADMIN] },
  { to: '/finance', label: 'Finance & Audit', roles: [Role.FINANCE_REVIEWER, Role.ADMIN] },
  { to: '/admin', label: 'Admin Policy', roles: [Role.ADMIN] },
  {
    to: '/delivery-board',
    label: 'Delivery Board',
    roles: [
      Role.CUSTOMER,
      Role.PICKER,
      Role.SUPPORT_AGENT,
      Role.STORE_MANAGER,
      Role.FINANCE_REVIEWER,
      Role.ADMIN,
    ],
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout, liveMessage } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleNav = user
    ? NAV_ITEMS.filter((item) => item.roles.includes(user.role)).slice(0, 5)
    : [];

  const allRoleNav = user ? NAV_ITEMS.filter((item) => item.roles.includes(user.role)) : [];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-blue-700 focus:text-white focus:rounded-md"
      >
        Skip to main content
      </a>

      {/* Strict 3-zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Brand wordmark */}
          <Link
            to={user ? visibleNav[0]?.to || '/store' : '/login'}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            FulfillIQ
          </Link>

          {/* Zone 2: Concise single-line nav links */}
          <nav aria-label="Primary navigation" className="hidden lg:flex items-center gap-6">
            {visibleNav.map((item) => {
              const active = location.pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`text-sm font-medium whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                    active
                      ? 'border-blue-700 text-slate-900'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Zone 3: Single primary action / auth control */}
          <div className="flex items-center gap-3 shrink-0">
            {user ? (
              <>
                <span className="hidden sm:inline text-xs text-slate-600 whitespace-nowrap">
                  {user.fullName.split(' (')[0]} · {user.role}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    navigate('/login');
                  }}
                  className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
                >
                  Sign Out
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0"
              >
                Sign In
              </Link>
            )}

            {user && (
              <button
                type="button"
                aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
                aria-expanded={mobileOpen}
                onClick={() => setMobileOpen((v) => !v)}
                className="lg:hidden p-2 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-100 min-h-[40px] min-w-[40px] flex items-center justify-center"
              >
                {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            )}
          </div>
        </div>

        {/* Mobile / Admin overflow drawer */}
        {user && mobileOpen && (
          <nav
            aria-label="Mobile navigation"
            className="lg:hidden border-t border-slate-200 bg-white px-4 py-3 flex flex-col gap-1"
          >
            {allRoleNav.map((item) => {
              const active = location.pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  className={`px-3 py-2.5 rounded-md text-sm font-medium ${
                    active ? 'bg-blue-50 text-blue-800' : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}
      </header>

      {/* Secondary role workspace bar only if role has >5 views (e.g. admin) */}
      {user && allRoleNav.length > 5 && (
        <div className="hidden lg:block bg-white border-b border-slate-200">
          <div className="max-w-7xl mx-auto px-6 py-2 flex items-center gap-6 overflow-x-auto">
            {allRoleNav.slice(5).map((item) => {
              const active = location.pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`text-xs font-medium whitespace-nowrap shrink-0 py-1 ${
                    active ? 'text-blue-700 underline underline-offset-4' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Accessible aria-live status region */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveMessage}
      </div>

      <main id="main-content" className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8">
        {children}
      </main>

      <footer className="border-t border-slate-200 bg-white mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-500">
          <p>FulfillIQ · Synthetic omnichannel fulfilment sandbox (no real customer or card data)</p>
          <div className="flex items-center gap-4">
            <a href="/api/docs" target="_blank" rel="noreferrer" className="hover:text-slate-900 underline">
              OpenAPI Docs
            </a>
            <a href="/api/project.zip" download="fulfilliq-project.zip" className="hover:text-slate-900 underline">
              Download Project ZIP
            </a>
            <Link to="/delivery-board" className="hover:text-slate-900 underline">
              Delivery Board (Simulated)
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
