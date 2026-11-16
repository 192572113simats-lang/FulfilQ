import React, { useEffect, useState } from 'react';
import { ApiError, apiFetch, formatMoney } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { StatusLabel } from '../components/StatusLabel.tsx';

interface ReturnRow {
  id: string;
  orderId: string;
  orderNumber: string;
  customerEmail: string;
  regionName: string;
  regionRefundLimitCents: number;
  requiresAdminApproval: boolean;
  reason: string;
  requestedAmountCents: number;
  status: string;
  decidedBy: string | null;
  decidedByName: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
  createdAt: string;
}

interface ReconRow {
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  orderTotalCents: number;
  regionName: string;
  paymentId: string | null;
  paymentStatus: string | null;
  paymentAmountCents: number | null;
  gatewayUsed: string | null;
  gatewayRef: string | null;
  mismatch: boolean;
  mismatchReason: string | null;
}

interface AuditRow {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  fromState: string | null;
  toState: string | null;
  actorName: string;
  actorRole: string;
  amountCents: number | null;
  reason: string | null;
  createdAt: string;
}

export function FinancePage() {
  const { user, announce } = useAuth();
  const [tab, setTab] = useState<'refunds' | 'reconciliation' | 'audit'>('refunds');
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [recon, setRecon] = useState<ReconRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditRow[]>([]);
  const [auditFilterType, setAuditFilterType] = useState('');
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [retRes, recRes, audRes] = await Promise.all([
        apiFetch<{ returns: ReturnRow[] }>('/api/returns'),
        apiFetch<{ records: ReconRow[] }>('/api/finance/reconciliation'),
        apiFetch<{ logs: AuditRow[] }>(
          `/api/audit${auditFilterType ? `?entityType=${encodeURIComponent(auditFilterType)}` : ''}`
        ),
      ]);
      setReturns(retRes.returns);
      setRecon(recRes.records);
      setAuditLogs(audRes.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load finance console');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [auditFilterType]);

  const decideRefund = async (returnId: string, decision: 'approve' | 'reject') => {
    setError(null);
    setFeedback(null);
    const reason = (reasons[returnId] || '').trim();
    if (reason.length < 4) {
      setError('Enter an audit decision reason (at least 4 characters) before approving or rejecting.');
      return;
    }
    try {
      await apiFetch(`/api/returns/${returnId}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason }),
      });
      setFeedback(`Refund ${decision === 'approve' ? 'approved' : 'rejected'} and recorded in audit log.`);
      announce(`Refund ${decision}d`);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Refund decision failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Finance Governance & Audit</h1>
          <p className="mt-1 text-sm text-slate-600">
            Human-authorized refund decisions bounded by regional limits, payment reconciliation, and append-only audit logs.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg" role="tablist" aria-label="Finance sections">
          {(
            [
              ['refunds', 'Refund Queue'],
              ['reconciliation', 'Reconciliation'],
              ['audit', 'Audit Log'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
                tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
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
      ) : tab === 'refunds' ? (
        <div className="space-y-4">
          {returns.map((r) => (
            <section key={r.id} className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs text-slate-500">
                    {r.regionName} · Region Reviewer Limit: {formatMoney(r.regionRefundLimitCents)} · Contact: {r.customerEmail}
                  </p>
                  <h2 className="text-lg font-bold font-mono text-slate-900 mt-0.5">
                    {r.orderNumber} · {formatMoney(r.requestedAmountCents)}
                  </h2>
                  <p className="text-sm text-slate-700 mt-1">Customer Reason: {r.reason}</p>
                </div>
                <StatusLabel status={r.status} />
              </div>

              {r.requiresAdminApproval && r.status === 'REFUND_PENDING' && (
                <p className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  Exceeds {r.regionName} finance_reviewer limit ({formatMoney(r.regionRefundLimitCents)}). Admin approval required ({user?.role === 'admin' ? 'You hold admin authority' : 'You are signed in as ' + user?.role}).
                </p>
              )}

              {r.status === 'REFUND_PENDING' && (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3 pt-2 border-t border-slate-100">
                  <div className="flex-1">
                    <label htmlFor={`reason-${r.id}`} className="block text-xs font-medium text-slate-700 mb-1">
                      Audit Reason (required)
                    </label>
                    <input
                      id={`reason-${r.id}`}
                      type="text"
                      value={reasons[r.id] || ''}
                      onChange={(e) => setReasons((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      placeholder="Enter justification for approval or rejection..."
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => decideRefund(r.id, 'approve')}
                      className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-md hover:bg-emerald-800 min-h-[38px]"
                    >
                      Approve Refund
                    </button>
                    <button
                      type="button"
                      onClick={() => decideRefund(r.id, 'reject')}
                      className="px-4 py-2 text-xs font-semibold text-white bg-red-700 rounded-md hover:bg-red-800 min-h-[38px]"
                    >
                      Reject Refund
                    </button>
                  </div>
                </div>
              )}

              {r.decisionReason && (
                <p className="text-xs text-slate-600 border-t border-slate-100 pt-2">
                  Decided by {r.decidedByName || r.decidedBy} · Reason: {r.decisionReason}
                </p>
              )}
            </section>
          ))}
        </div>
      ) : tab === 'reconciliation' ? (
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-4 py-3 font-medium">Order Status</th>
                  <th className="px-4 py-3 font-medium">Payment Status</th>
                  <th className="px-4 py-3 font-medium">Gateway</th>
                  <th className="px-4 py-3 text-right font-medium">Order / Paid</th>
                  <th className="px-4 py-3 font-medium">Reconciliation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {recon.map((row) => (
                  <tr key={row.orderId} className={row.mismatch ? 'bg-amber-50/70' : 'hover:bg-slate-50'}>
                    <td className="px-4 py-3 font-mono font-semibold">{row.orderNumber}</td>
                    <td className="px-4 py-3">
                      <StatusLabel status={row.orderStatus} />
                    </td>
                    <td className="px-4 py-3">
                      {row.paymentStatus ? <StatusLabel status={row.paymentStatus} /> : <span className="text-xs text-slate-400">None</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {row.gatewayUsed || '—'} {row.gatewayRef ? `· ${row.gatewayRef}` : ''}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {formatMoney(row.orderTotalCents)} / {row.paymentAmountCents !== null ? formatMoney(row.paymentAmountCents) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {row.mismatch ? (
                        <span className="font-semibold text-amber-800">Mismatch: {row.mismatchReason}</span>
                      ) : (
                        <span className="text-emerald-700 font-medium">Reconciled</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-4">
            <h2 className="text-sm font-semibold text-slate-900">Append-Only Audit Log</h2>
            <div>
              <label htmlFor="audit-entity-filter" className="sr-only">
                Filter audit logs by entity type
              </label>
              <select
                id="audit-entity-filter"
                value={auditFilterType}
                onChange={(e) => setAuditFilterType(e.target.value)}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
              >
                <option value="">All Entities</option>
                <option value="order">Orders</option>
                <option value="return">Returns & Refunds</option>
                <option value="payment">Payments</option>
                <option value="stock">Stock Corrections</option>
                <option value="region">Regions</option>
                <option value="gateway">Gateway</option>
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <th className="px-4 py-2.5 font-medium">Timestamp</th>
                  <th className="px-4 py-2.5 font-medium">Action / Transition</th>
                  <th className="px-4 py-2.5 font-medium">Actor</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-4 py-2.5 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2.5 font-mono text-slate-500 whitespace-nowrap">
                      {new Date(l.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-900">
                      {l.action} {l.toState ? `(${l.fromState ?? 'NULL'} → ${l.toState})` : ''}
                    </td>
                    <td className="px-4 py-2.5">
                      {l.actorName} ({l.actorRole})
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {l.amountCents !== null ? formatMoney(l.amountCents) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{l.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
