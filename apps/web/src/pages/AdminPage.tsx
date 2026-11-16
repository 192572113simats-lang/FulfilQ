import React, { useEffect, useState } from 'react';
import { ApiError, apiFetch, formatMoney } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { Role } from '@fulfilliq/shared';

interface RegionRow {
  regionId: string;
  code: string;
  name: string;
  taxRate: number;
  shippingRuleType: 'flat' | 'threshold';
  shippingFlatCents: number;
  shippingFreeThresholdCents: number;
  refundApprovalLimitCents: number;
  returnWindowDays: number;
  reservationExpiryMinutes: number;
}

interface UserRow {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  warehouseName: string | null;
  isActive: number;
}

interface GatewayStatus {
  mode: 'local_stub' | 'sandbox_http';
  simulateOutage: boolean;
  sandboxUrl: string;
  status: string;
  pendingRetryCount: number;
}

interface ProductThresholdRow {
  id: string;
  sku: string;
  name: string;
  lowStockThreshold: number;
  qtyAvailable: number;
}

export function AdminPage() {
  const { announce } = useAuth();
  const [regions, setRegions] = useState<RegionRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [gateway, setGateway] = useState<GatewayStatus | null>(null);
  const [products, setProducts] = useState<ProductThresholdRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // New region form
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newTax, setNewTax] = useState('0.09');
  const [newRefundLimitDollars, setNewRefundLimitDollars] = useState('200');
  const [newReturnDays, setNewReturnDays] = useState('14');
  const [newWhName, setNewWhName] = useState('');
  const [newWhCode, setNewWhCode] = useState('');

  const loadAll = async () => {
    setLoading(true);
    try {
      const [regRes, usrRes, gwRes, prodRes] = await Promise.all([
        apiFetch<{ regions: RegionRow[] }>('/api/regions'),
        apiFetch<{ users: UserRow[] }>('/api/admin/users'),
        apiFetch<GatewayStatus>('/api/admin/gateway'),
        apiFetch<{ products: ProductThresholdRow[] }>('/api/products?warehouseId=wh-central'),
      ]);
      setRegions(regRes.regions);
      setUsers(usrRes.users);
      setGateway(gwRes);
      setProducts(prodRes.products.slice(0, 8));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin console');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const updateGateway = async (patch: Partial<{ mode: 'local_stub' | 'sandbox_http'; simulateOutage: boolean }>) => {
    setError(null);
    setFeedback(null);
    try {
      await apiFetch('/api/admin/gateway', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setFeedback('Payment gateway configuration updated.');
      announce('Gateway configuration updated');
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gateway update failed');
    }
  };

  const updateRegionLimit = async (region: RegionRow, nextLimitCents: number) => {
    setError(null);
    setFeedback(null);
    try {
      await apiFetch(`/api/admin/regions/${region.regionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ refundApprovalLimitCents: nextLimitCents }),
      });
      setFeedback(`Updated ${region.name} refund limit.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Region update failed');
    }
  };

  const createRegion = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    try {
      const code = newCode.trim().toUpperCase();
      await apiFetch('/api/admin/regions', {
        method: 'POST',
        body: JSON.stringify({
          regionId: `reg-${code.toLowerCase()}`,
          code,
          name: newName.trim(),
          taxRate: Number(newTax),
          shippingRuleType: 'threshold',
          shippingFlatCents: 900,
          shippingFreeThresholdCents: 8500,
          refundApprovalLimitCents: Math.round(Number(newRefundLimitDollars) * 100),
          returnWindowDays: Number(newReturnDays),
          reservationExpiryMinutes: 15,
          warehouseName: newWhName.trim() || `${newName.trim()} Hub`,
          warehouseCode: newWhCode.trim() || `WH-${code}`,
          warehouseCity: newName.trim(),
        }),
      });
      setNewCode('');
      setNewName('');
      setNewWhName('');
      setNewWhCode('');
      setFeedback('New regional warehouse and policy added with zero code changes.');
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create region');
    }
  };

  const updateUserRole = async (userId: string, role: Role) => {
    setError(null);
    setFeedback(null);
    try {
      await apiFetch(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      setFeedback('User role updated.');
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Role update failed');
    }
  };

  const updateThreshold = async (productId: string, lowStockThreshold: number) => {
    setError(null);
    setFeedback(null);
    try {
      await apiFetch(`/api/admin/products/${productId}/threshold`, {
        method: 'PATCH',
        body: JSON.stringify({ lowStockThreshold }),
      });
      setFeedback('Low-stock deterministic threshold updated.');
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Threshold update failed');
    }
  };

  return (
    <div className="space-y-8">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-slate-900">Administration & Regional Policies</h1>
        <p className="mt-1 text-sm text-slate-600">
          Configure payment gateway adapters, regional tax/shipping/refund policies, deterministic thresholds, and user roles.
        </p>
      </div>

      {feedback && (
        <div role="status" className="p-3 bg-emerald-50 border border-emerald-200 rounded-md text-sm text-emerald-900">
          {feedback}
        </div>
      )}
      {error && (
        <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="h-48 bg-white border border-slate-200 rounded-lg animate-pulse" />
      ) : (
        <>
          {/* Gateway Status Panel (S03b) */}
          {gateway && (
            <section className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Payment Gateway Status</h2>
                <p className="text-xs text-slate-600 mt-1 font-mono">
                  Active Adapter: {gateway.mode} · Status: {gateway.status} · Pending Retries: {gateway.pendingRetryCount}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    updateGateway({
                      mode: gateway.mode === 'local_stub' ? 'sandbox_http' : 'local_stub',
                    })
                  }
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50"
                >
                  Switch to {gateway.mode === 'local_stub' ? 'Sandbox HTTP' : 'Local Stub'}
                </button>
                <button
                  type="button"
                  onClick={() => updateGateway({ simulateOutage: !gateway.simulateOutage })}
                  className={`px-3.5 py-2 text-xs font-semibold rounded-md text-white ${
                    gateway.simulateOutage ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-red-700 hover:bg-red-800'
                  }`}
                >
                  {gateway.simulateOutage ? 'Recover Gateway Outage' : 'Simulate Gateway Outage'}
                </button>
              </div>
            </section>
          )}

          {/* Region Policies */}
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Regional Policies (Configuration-Driven)</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                    <th className="px-4 py-3 font-medium">Region</th>
                    <th className="px-4 py-3 font-medium">Tax Rate</th>
                    <th className="px-4 py-3 font-medium">Shipping Rule</th>
                    <th className="px-4 py-3 font-medium">Return Window</th>
                    <th className="px-4 py-3 font-medium">Refund Reviewer Limit</th>
                    <th className="px-4 py-3 text-right font-medium">Quick Adjust</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {regions.map((r) => (
                    <tr key={r.regionId}>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{r.name}</div>
                        <div className="font-mono text-xs text-slate-500">{r.code}</div>
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums">{(r.taxRate * 100).toFixed(1)}%</td>
                      <td className="px-4 py-3 text-xs tabular-nums">
                        {r.shippingRuleType === 'threshold'
                          ? `${formatMoney(r.shippingFlatCents)} (free ≥ ${formatMoney(r.shippingFreeThresholdCents)})`
                          : `${formatMoney(r.shippingFlatCents)} flat`}
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums">{r.returnWindowDays} days</td>
                      <td className="px-4 py-3 font-mono tabular-nums font-semibold">
                        {formatMoney(r.refundApprovalLimitCents)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => updateRegionLimit(r, r.refundApprovalLimitCents + 5000)}
                          className="px-3 py-1 text-xs font-medium border border-slate-300 rounded hover:bg-slate-50"
                        >
                          +$50 Limit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Add New Region Form */}
            <form onSubmit={createRegion} className="p-5 bg-slate-50 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-6 gap-3 items-end">
              <div>
                <label htmlFor="reg-code" className="block text-xs font-medium text-slate-700 mb-1">
                  Region Code
                </label>
                <input
                  id="reg-code"
                  required
                  placeholder="WEST"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-sm bg-white border border-slate-300 rounded"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="reg-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Region Name
                </label>
                <input
                  id="reg-name"
                  required
                  placeholder="Western Mountain Region"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-sm bg-white border border-slate-300 rounded"
                />
              </div>
              <div>
                <label htmlFor="reg-tax" className="block text-xs font-medium text-slate-700 mb-1">
                  Tax Rate
                </label>
                <input
                  id="reg-tax"
                  type="number"
                  step="0.01"
                  required
                  value={newTax}
                  onChange={(e) => setNewTax(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-sm font-mono bg-white border border-slate-300 rounded"
                />
              </div>
              <div>
                <label htmlFor="reg-limit" className="block text-xs font-medium text-slate-700 mb-1">
                  Refund Limit ($)
                </label>
                <input
                  id="reg-limit"
                  type="number"
                  required
                  value={newRefundLimitDollars}
                  onChange={(e) => setNewRefundLimitDollars(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-sm font-mono bg-white border border-slate-300 rounded"
                />
              </div>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded hover:bg-blue-800 min-h-[36px]"
              >
                Add Region + Hub
              </button>
            </form>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Users & Roles */}
            <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200">
                <h2 className="text-lg font-semibold text-slate-900">Users & Roles (RBAC)</h2>
              </div>
              <ul className="divide-y divide-slate-200">
                {users.map((u) => (
                  <li key={u.id} className="px-4 py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{u.fullName}</p>
                      <p className="text-xs font-mono text-slate-500 truncate">{u.email}</p>
                    </div>
                    <div>
                      <label htmlFor={`role-${u.id}`} className="sr-only">
                        Role for {u.fullName}
                      </label>
                      <select
                        id={`role-${u.id}`}
                        value={u.role}
                        onChange={(e) => updateUserRole(u.id, e.target.value as Role)}
                        className="px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
                      >
                        {Object.values(Role).map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {/* Deterministic Low-Stock Thresholds */}
            <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200">
                <h2 className="text-lg font-semibold text-slate-900">Low-Stock Rule Thresholds</h2>
              </div>
              <ul className="divide-y divide-slate-200">
                {products.map((p) => (
                  <li key={p.id} className="px-4 py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{p.name}</p>
                      <p className="text-xs font-mono text-slate-500">
                        {p.sku} · Central Stock: {p.qtyAvailable}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-mono tabular-nums text-slate-700">
                        Threshold: {p.lowStockThreshold}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateThreshold(p.id, p.lowStockThreshold + 1)}
                        className="px-2.5 py-1 text-xs border border-slate-300 rounded hover:bg-slate-50"
                      >
                        +1
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
