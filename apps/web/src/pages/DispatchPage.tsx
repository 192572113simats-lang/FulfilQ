import React, { useEffect, useState } from 'react';
import { ApiError, apiFetch, formatMoney } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { StatusLabel } from '../components/StatusLabel.tsx';

interface ManagerOrder {
  id: string;
  orderNumber: string;
  warehouseName: string;
  regionName: string;
  status: string;
  totalCents: number;
  customerEmail: string;
  createdAt: string;
}

interface LowStockAlert {
  id: string;
  warehouseId: string;
  warehouseName: string;
  productId: string;
  sku: string;
  productName: string;
  qtyAtTrigger: number;
  currentQtyAvailable: number;
  threshold: number;
  status: string;
  createdAt: string;
}

interface ProductOpt {
  id: string;
  sku: string;
  name: string;
  qtyAvailable: number;
}

export function DispatchPage() {
  const { announce } = useAuth();
  const [orders, setOrders] = useState<ManagerOrder[]>([]);
  const [alerts, setAlerts] = useState<LowStockAlert[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Stock correction form
  const [corrProductId, setCorrProductId] = useState('prod-002');
  const [corrDelta, setCorrDelta] = useState('10');
  const [corrReason, setCorrReason] = useState('Received physical warehouse cycle-count replenishment');

  const loadData = async () => {
    setLoading(true);
    try {
      const [ordRes, alertRes, prodRes] = await Promise.all([
        apiFetch<{ orders: ManagerOrder[] }>('/api/orders'),
        apiFetch<{ alerts: LowStockAlert[] }>('/api/alerts/low-stock'),
        apiFetch<{ products: ProductOpt[] }>('/api/products?warehouseId=wh-central'),
      ]);
      setOrders(ordRes.orders);
      setAlerts(alertRes.alerts);
      setProducts(prodRes.products);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dispatch console');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const transitionOrder = async (orderId: string, toStatus: string) => {
    setError(null);
    setFeedback(null);
    try {
      await apiFetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: toStatus,
          reason: `Store manager updated status to ${toStatus}`,
        }),
      });
      setFeedback(`Order updated to ${toStatus}`);
      announce(`Order updated to ${toStatus}`);
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Transition failed');
    }
  };

  const resolveAlert = async (alertId: string) => {
    setError(null);
    setFeedback(null);
    try {
      await apiFetch(`/api/alerts/low-stock/${alertId}/resolve`, { method: 'POST' });
      setFeedback('Low-stock alert resolved.');
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to resolve alert');
    }
  };

  const submitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    try {
      const res = await apiFetch<{ qtyAvailable: number }>('/api/inventory/corrections', {
        method: 'POST',
        body: JSON.stringify({
          warehouseId: 'wh-central',
          productId: corrProductId,
          deltaQty: Number(corrDelta),
          reason: corrReason,
        }),
      });
      setFeedback(`Stock correction logged. New available stock: ${res.qtyAvailable} units.`);
      announce('Stock correction applied');
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Stock correction failed');
    }
  };

  return (
    <div className="space-y-8">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-slate-900">Dispatch & Inventory Alerts</h1>
        <p className="mt-1 text-sm text-slate-600">
          Dispatch packed orders, monitor deterministic fixed-threshold low-stock alerts, and submit audited human stock corrections.
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
          {/* Dispatch Queue */}
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Store Orders & Dispatch</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                    <th className="px-4 py-3 font-medium">Order</th>
                    <th className="px-4 py-3 font-medium">Warehouse</th>
                    <th className="px-4 py-3 font-medium">Masked Contact</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Total</th>
                    <th className="px-4 py-3 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {orders.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono font-semibold text-slate-900">{o.orderNumber}</td>
                      <td className="px-4 py-3 text-slate-700">{o.warehouseName}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{o.customerEmail}</td>
                      <td className="px-4 py-3">
                        <StatusLabel status={o.status} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {formatMoney(o.totalCents)}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {o.status === 'PACKED' && (
                          <button
                            type="button"
                            onClick={() => transitionOrder(o.id, 'DISPATCHED')}
                            className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 rounded hover:bg-blue-800"
                          >
                            Dispatch
                          </button>
                        )}
                        {o.status === 'DISPATCHED' && (
                          <button
                            type="button"
                            onClick={() => transitionOrder(o.id, 'DELIVERED')}
                            className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 rounded hover:bg-emerald-800"
                          >
                            Mark Delivered
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Deterministic Low-Stock Alerts */}
            <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200">
                <h2 className="text-lg font-semibold text-slate-900">
                  Low-Stock Alerts (Fixed-Threshold Rule)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Deterministic rule: raises at most one OPEN alert per item until resolved. No ML forecasting.
                </p>
              </div>
              {alerts.length === 0 ? (
                <p className="p-6 text-sm text-slate-600">No low-stock alerts triggered.</p>
              ) : (
                <ul className="divide-y divide-slate-200">
                  {alerts.map((a) => (
                    <li key={a.id} className="p-4 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {a.productName} <span className="font-mono text-xs text-slate-500">({a.sku})</span>
                        </p>
                        <p className="text-xs text-slate-600 mt-0.5 tabular-nums">
                          {a.warehouseName} · Current: {a.currentQtyAvailable} · Threshold: {a.threshold}
                        </p>
                        <div className="mt-1">
                          <StatusLabel status={a.status} />
                        </div>
                      </div>
                      {a.status === 'OPEN' && (
                        <button
                          type="button"
                          onClick={() => resolveAlert(a.id)}
                          className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                        >
                          Resolve
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Human-Only Stock Correction */}
            <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Manual Stock Correction</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Human responsibility rule: stock adjustments are never automated and always require a named reason.
                </p>
              </div>

              <form onSubmit={submitCorrection} className="space-y-4">
                <div>
                  <label htmlFor="corr-product" className="block text-xs font-medium text-slate-700 mb-1">
                    Product (Central Warehouse)
                  </label>
                  <select
                    id="corr-product"
                    value={corrProductId}
                    onChange={(e) => setCorrProductId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} · {p.name} ({p.qtyAvailable} avail)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="corr-delta" className="block text-xs font-medium text-slate-700 mb-1">
                    Quantity Adjustment (+/-)
                  </label>
                  <input
                    id="corr-delta"
                    type="number"
                    required
                    value={corrDelta}
                    onChange={(e) => setCorrDelta(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>

                <div>
                  <label htmlFor="corr-reason" className="block text-xs font-medium text-slate-700 mb-1">
                    Audit Reason
                  </label>
                  <input
                    id="corr-reason"
                    type="text"
                    required
                    minLength={4}
                    value={corrReason}
                    onChange={(e) => setCorrReason(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </div>

                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800"
                >
                  Apply Audited Stock Correction
                </button>
              </form>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
