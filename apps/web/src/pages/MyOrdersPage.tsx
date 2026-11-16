import React, { useEffect, useState } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { ApiError, apiFetch, formatMoney } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { StatusLabel } from '../components/StatusLabel.tsx';

interface OrderSummary {
  id: string;
  orderNumber: string;
  warehouseName: string;
  regionName: string;
  status: string;
  totalCents: number;
  deliveredAt: string | null;
  createdAt: string;
}

interface Milestone {
  key: string;
  label: string;
  completed: boolean;
  reachedAt: string | null;
}

interface OrderDetail extends OrderSummary {
  returnWindowDays: number;
  items: Array<{ id: string; sku: string; name: string; quantity: number; unitPriceCents: number }>;
  returnRequest: { id: string; status: string; reason: string; decisionReason: string | null } | null;
}

export function MyOrdersPage() {
  const { announce } = useAuth();
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [returnReason, setReturnReason] = useState('');
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadOrders = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ orders: OrderSummary[] }>('/api/orders');
      setOrders(res.orders);
      if (res.orders.length > 0 && !selectedId) {
        setSelectedId(res.orders[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const loadSelected = async (id: string) => {
    try {
      const [detRes, trackRes] = await Promise.all([
        apiFetch<{ order: OrderDetail }>(`/api/orders/${id}`),
        apiFetch<{ milestones: Milestone[] }>(`/api/orders/${id}/tracking`),
      ]);
      setDetail(detRes.order);
      setMilestones(trackRes.milestones);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to load order tracking');
    }
  };

  useEffect(() => {
    if (selectedId) {
      loadSelected(selectedId);
    }
  }, [selectedId]);

  const handleRetryPayment = async (orderId: string) => {
    setActionError(null);
    setActionMessage(null);
    try {
      const res = await apiFetch<{ orderStatus: string }>(`/api/payments/${orderId}/retry`, {
        method: 'POST',
      });
      setActionMessage(`Payment retry result: ${res.orderStatus}`);
      announce(`Payment status updated to ${res.orderStatus}`);
      await loadOrders();
      await loadSelected(orderId);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Retry failed');
    }
  };

  const handleRequestReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setActionError(null);
    setActionMessage(null);
    try {
      await apiFetch(`/api/orders/${detail.id}/return`, {
        method: 'POST',
        body: JSON.stringify({ reason: returnReason }),
      });
      setReturnReason('');
      setActionMessage('Return request submitted and queued for review.');
      announce('Return request submitted');
      await loadOrders();
      await loadSelected(detail.id);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Return request failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-slate-900">My Orders & Tracking</h1>
        <p className="mt-1 text-sm text-slate-600">
          Track permitted fulfilment milestones or submit a return within your region&apos;s policy window.
        </p>
      </div>

      {error && (
        <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="h-48 bg-white border border-slate-200 rounded-lg animate-pulse" />
      ) : orders.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-sm text-slate-600">
          You have not placed any orders yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Orders List */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg divide-y divide-slate-200">
            {orders.map((o) => {
              const active = o.id === selectedId;
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(o.id);
                    setActionError(null);
                    setActionMessage(null);
                  }}
                  className={`w-full text-left p-4 transition-colors ${
                    active ? 'bg-blue-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-semibold text-slate-900">{o.orderNumber}</span>
                    <span className="font-mono text-sm font-semibold tabular-nums text-slate-900">
                      {formatMoney(o.totalCents)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <StatusLabel status={o.status} />
                    <span className="text-xs text-slate-500">
                      {new Date(o.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Selected Order Tracking & Actions */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-6 space-y-6">
            {detail && (
              <>
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
                  <div>
                    <p className="text-xs text-slate-500">
                      {detail.warehouseName} · {detail.regionName}
                    </p>
                    <h2 className="text-xl font-bold font-mono text-slate-900 mt-0.5">
                      {detail.orderNumber}
                    </h2>
                  </div>
                  <StatusLabel status={detail.status} />
                </div>

                {actionMessage && (
                  <div role="status" className="p-3 bg-emerald-50 border border-emerald-200 rounded-md text-sm text-emerald-900">
                    {actionMessage}
                  </div>
                )}
                {actionError && (
                  <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">
                    {actionError}
                  </div>
                )}

                {/* Accessible Milestones Timeline */}
                <section aria-labelledby="tracking-heading">
                  <h3 id="tracking-heading" className="text-sm font-semibold text-slate-900 mb-3">
                    Fulfilment Milestones
                  </h3>
                  <ol className="space-y-3" aria-label="Order milestones">
                    {milestones.map((m) => (
                      <li key={m.key} className="flex items-start gap-3">
                        {m.completed ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
                        ) : (
                          <Circle className="w-5 h-5 text-slate-300 shrink-0 mt-0.5" aria-hidden="true" />
                        )}
                        <div>
                          <p className={`text-sm font-medium ${m.completed ? 'text-slate-900' : 'text-slate-500'}`}>
                            {m.label}{' '}
                            <span className="sr-only">({m.completed ? 'Completed' : 'Pending'})</span>
                          </p>
                          <p className="text-xs font-mono text-slate-500">
                            {m.reachedAt ? new Date(m.reachedAt).toLocaleString() : 'Pending'}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>

                {/* Items */}
                <section>
                  <h3 className="text-sm font-semibold text-slate-900 mb-2">Items</h3>
                  <ul className="divide-y divide-slate-200 border border-slate-200 rounded-md text-sm">
                    {detail.items.map((item) => (
                      <li key={item.id} className="px-3.5 py-2.5 flex items-center justify-between gap-4">
                        <div>
                          <span className="font-medium text-slate-900">{item.name}</span>
                          <span className="ml-2 text-xs font-mono text-slate-500">{item.sku}</span>
                        </div>
                        <span className="font-mono tabular-nums text-slate-700">
                          {item.quantity} × {formatMoney(item.unitPriceCents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>

                {/* Payment Retry for PAYMENT_PENDING */}
                {detail.status === 'PAYMENT_PENDING' && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-md flex items-center justify-between gap-4">
                    <p className="text-sm text-amber-900">
                      Payment gateway was unreachable. Retry safely using your preserved idempotency key.
                    </p>
                    <button
                      type="button"
                      onClick={() => handleRetryPayment(detail.id)}
                      className="px-4 py-2 text-sm font-semibold text-white bg-blue-700 rounded-md hover:bg-blue-800 whitespace-nowrap"
                    >
                      Retry Payment
                    </button>
                  </div>
                )}

                {/* Return Request Form for DELIVERED */}
                {detail.status === 'DELIVERED' && !detail.returnRequest && (
                  <form onSubmit={handleRequestReturn} className="border-t border-slate-200 pt-5 space-y-3">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Request Return ({detail.returnWindowDays}-day regional window)
                    </h3>
                    <div>
                      <label htmlFor="return-reason" className="block text-xs font-medium text-slate-700 mb-1">
                        Reason for return
                      </label>
                      <textarea
                        id="return-reason"
                        required
                        minLength={5}
                        rows={2}
                        value={returnReason}
                        onChange={(e) => setReturnReason(e.target.value)}
                        placeholder="Describe why you are returning this order..."
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                      />
                    </div>
                    <button
                      type="submit"
                      className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800"
                    >
                      Submit Return Request
                    </button>
                  </form>
                )}

                {detail.returnRequest && (
                  <div className="border-t border-slate-200 pt-4 text-sm">
                    <p className="font-semibold text-slate-900">Return Status: {detail.returnRequest.status}</p>
                    <p className="text-slate-600 mt-1">Reason: {detail.returnRequest.reason}</p>
                    {detail.returnRequest.decisionReason && (
                      <p className="text-slate-600 mt-1">Reviewer Note: {detail.returnRequest.decisionReason}</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
