import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { ApiError, apiFetch, formatMoney } from '../lib/api.ts';
import { StatusLabel } from '../components/StatusLabel.tsx';

interface SupportOrderRow {
  id: string;
  orderNumber: string;
  status: string;
  totalCents: number;
  warehouseName: string;
  regionName: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  createdAt: string;
  paymentStatus: string | null;
  returnStatus: string | null;
  returnReason: string | null;
  refundDecisionReason: string | null;
}

interface OrderDetailTimeline {
  id: string;
  orderNumber: string;
  status: string;
  internalNotes?: string;
  history: Array<{
    id: string;
    action: string;
    fromStatus: string | null;
    toStatus: string | null;
    actorName: string;
    actorRole: string;
    reason: string | null;
    createdAt: string;
  }>;
  returnRequest: { id: string; status: string; reason: string; decisionReason: string | null } | null;
}

export function SupportPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SupportOrderRow[]>([]);
  const [selected, setSelected] = useState<OrderDetailTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const runSearch = async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ orders: SupportOrderRow[] }>(
        `/api/support/orders?q=${encodeURIComponent(q)}`
      );
      setResults(res.orders);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runSearch('');
  }, []);

  const loadOrderDetail = async (id: string) => {
    setError(null);
    try {
      const res = await apiFetch<{ order: OrderDetailTimeline }>(`/api/orders/${id}`);
      setSelected(res.order);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load order detail');
    }
  };

  const queueReturnForRefund = async (returnId: string, orderId: string) => {
    setError(null);
    setMessage(null);
    try {
      await apiFetch(`/api/returns/${returnId}/queue-refund`, { method: 'POST' });
      setMessage('Return verified and queued to REFUND_PENDING for Finance Reviewer.');
      await runSearch(query);
      await loadOrderDetail(orderId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to queue return');
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-slate-900">Support Lookup Console</h1>
        <p className="mt-1 text-sm text-slate-600">
          Search orders by order ID, order number, email, or phone fragment. Refund approval and stock correction are restricted to authorized finance/store roles.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(query);
        }}
        className="flex flex-col sm:flex-row gap-3 max-w-2xl"
      >
        <div className="relative flex-1">
          <label htmlFor="support-q" className="sr-only">
            Search by Order ID, email, or phone fragment
          </label>
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            id="support-q"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. FIQ-2026-1011, customer@demo, or 0101"
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-md min-h-[42px]"
          />
        </div>
        <button
          type="submit"
          className="px-5 py-2 text-sm font-semibold text-white bg-blue-700 rounded-md hover:bg-blue-800 min-h-[42px]"
        >
          Lookup Order
        </button>
      </form>

      {message && (
        <div role="status" className="p-3 bg-emerald-50 border border-emerald-200 rounded-md text-sm text-emerald-900">
          {message}
        </div>
      )}
      {error && (
        <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
          {loading ? (
            <div className="h-48 animate-pulse" />
          ) : results.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-600">No matching orders found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                    <th className="px-4 py-3 font-medium">Order</th>
                    <th className="px-4 py-3 font-medium">Customer</th>
                    <th className="px-4 py-3 font-medium">Order / Return Status</th>
                    <th className="px-4 py-3 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {results.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => loadOrderDetail(r.id)}
                      className={`cursor-pointer hover:bg-slate-50 ${selected?.id === r.id ? 'bg-blue-50' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-mono font-semibold text-slate-900">{r.orderNumber}</div>
                        <div className="text-xs text-slate-500">{r.regionName}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-slate-900">{r.customerName}</div>
                        <div className="text-xs font-mono text-slate-500">
                          {r.customerEmail} · {r.customerPhone}
                        </div>
                      </td>
                      <td className="px-4 py-3 space-y-1">
                        <StatusLabel status={r.status} />
                        {r.returnStatus && (
                          <div className="text-xs text-slate-600">Return: {r.returnStatus}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {formatMoney(r.totalCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5">
          {!selected ? (
            <p className="text-sm text-slate-600">Select an order from the table to inspect its full timeline and return status.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <h2 className="text-lg font-bold font-mono text-slate-900">{selected.orderNumber}</h2>
                <StatusLabel status={selected.status} />
              </div>

              {selected.returnRequest && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-2 text-xs">
                  <p className="font-semibold text-slate-900">
                    Return Status (Read-Only Approval): {selected.returnRequest.status}
                  </p>
                  <p className="text-slate-600">Reason: {selected.returnRequest.reason}</p>
                  {selected.returnRequest.decisionReason && (
                    <p className="text-slate-700">Decision Note: {selected.returnRequest.decisionReason}</p>
                  )}
                  {selected.returnRequest.status === 'REQUESTED' && (
                    <button
                      type="button"
                      onClick={() => queueReturnForRefund(selected.returnRequest!.id, selected.id)}
                      className="mt-1 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded hover:bg-slate-800"
                    >
                      Verify Return & Queue for Refund Review
                    </button>
                  )}
                </div>
              )}

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  Audit Timeline
                </h3>
                <ol className="space-y-2.5 text-xs">
                  {selected.history.map((h) => (
                    <li key={h.id} className="border-b border-slate-100 pb-2">
                      <div className="flex justify-between font-medium text-slate-900">
                        <span>
                          {h.fromStatus ? `${h.fromStatus} → ${h.toStatus}` : h.toStatus || h.action}
                        </span>
                        <span className="font-mono text-slate-500">
                          {new Date(h.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-slate-600 mt-0.5">
                        {h.actorName} ({h.actorRole}) — {h.reason}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
