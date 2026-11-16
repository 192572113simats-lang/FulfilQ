import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Role } from '@fulfilliq/shared';
import { AuthProvider, defaultRouteForRole, useAuth } from './lib/auth.tsx';
import { AppShell } from './components/AppShell.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { StorefrontPage } from './pages/StorefrontPage.tsx';
import { MyOrdersPage } from './pages/MyOrdersPage.tsx';
import { PickerPage } from './pages/PickerPage.tsx';
import { DispatchPage } from './pages/DispatchPage.tsx';
import { SupportPage } from './pages/SupportPage.tsx';
import { FinancePage } from './pages/FinancePage.tsx';
import { AdminPage } from './pages/AdminPage.tsx';
import { DeliveryBoardPage } from './pages/DeliveryBoardPage.tsx';

function RequireRoleRoute({
  allowed,
  children,
}: {
  allowed?: Role[];
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="h-48 bg-white border border-slate-200 rounded-lg animate-pulse" />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (allowed && !allowed.includes(user.role)) {
    return <Navigate to={defaultRouteForRole(user.role)} replace />;
  }
  return <>{children}</>;
}

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="h-48 bg-white border border-slate-200 rounded-lg animate-pulse" />;
  }
  if (!user) {
    return <Navigate to="/store" replace />;
  }
  return <Navigate to={defaultRouteForRole(user.role)} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppShell>
          <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/store" element={<StorefrontPage />} />
            <Route
              path="/orders"
              element={
                <RequireRoleRoute allowed={[Role.CUSTOMER, Role.ADMIN]}>
                  <MyOrdersPage />
                </RequireRoleRoute>
              }
            />
            <Route
              path="/picker"
              element={
                <RequireRoleRoute allowed={[Role.PICKER, Role.ADMIN]}>
                  <PickerPage />
                </RequireRoleRoute>
              }
            />
            <Route
              path="/dispatch"
              element={
                <RequireRoleRoute allowed={[Role.STORE_MANAGER, Role.ADMIN]}>
                  <DispatchPage />
                </RequireRoleRoute>
              }
            />
            <Route
              path="/support"
              element={
                <RequireRoleRoute allowed={[Role.SUPPORT_AGENT, Role.ADMIN]}>
                  <SupportPage />
                </RequireRoleRoute>
              }
            />
            <Route
              path="/finance"
              element={
                <RequireRoleRoute allowed={[Role.FINANCE_REVIEWER, Role.ADMIN]}>
                  <FinancePage />
                </RequireRoleRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <RequireRoleRoute allowed={[Role.ADMIN]}>
                  <AdminPage />
                </RequireRoleRoute>
              }
            />
            <Route
              path="/delivery-board"
              element={
                <RequireRoleRoute>
                  <DeliveryBoardPage />
                </RequireRoleRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell>
      </BrowserRouter>
    </AuthProvider>
  );
}
