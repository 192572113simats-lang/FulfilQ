import React, { useEffect, useState } from 'react';
import { ScanBarcode } from 'lucide-react';
import { ApiError, apiFetch } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { StatusLabel } from '../components/StatusLabel.tsx';

interface PickItem {
  id: string;
  productId: string;
  sku: string;
  name: string;
  barcode: string;
  quantity: number;
  pickedQuantity: number;
}

interface PickOrder {
  id: string;
  orderNumber: string;
  status: string;
  warehouseName: string;
  recipientName: string;
  city: string;
  maskedPhone: string;
  items: PickItem[];
}

export function PickerPage() {
  const { announce } = useAuth();
  const [queue, setQueue] = useState<PickOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanInput, setScanInput] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ orderId: string; type: 'ok' | 'err'; msg: string } | null>(null);

  const loadQueue = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ queue: PickOrder[] }>('/api/picking/queue');
      setQueue(res.queue);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pick queue');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQueue();
  }, []);

  const handleScan = async (e: React.FormEvent, orderId: string) => {
    e.preventDefault();
    const code = (scanInput[orderId] || '').trim();
    if (!code) return;
    setFeedback(null);
    try {
      const res = await apiFetch<{ scannedSku: string }>(`/api/picking/${orderId}/scan`, {
        method: 'POST',
        body: JSON.stringify({ barcodeOrSku: code, quantity: 1 }),
      });
      setScanInput((prev) => ({ ...prev, [orderId]: '' }));
      setFeedback({ orderId, type: 'ok', msg: `Confirmed unit for ${res.scannedSku}` });
      announce(`Confirmed pick for ${res.scannedSku}`);
      await loadQueue();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Scan rejected';
      setFeedback({ orderId, type: 'err', msg });
      announce(msg);
    }
  };

  const handlePack = async (orderId: string) => {
    setFeedback(null);
    try {
      await apiFetch(`/api/picking/${orderId}/pack`, { method: 'POST' });
      setFeedback({ orderId, type: 'ok', msg: 'Order marked PACKED and ready for dispatch.' });
      announce('Order marked packed');
      await loadQueue();
    } catch (err) {
      setFeedback({ orderId, type: 'err', msg: err instanceof ApiError ? err.message : 'Pack failed' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-slate-900">Warehouse Pick Queue</h1>
        <p className="mt-1 text-sm text-slate-600">
          Displays only paid and stock-reserved orders. Scan with a keyboard-wedge barcode reader or type the SKU/barcode manually.
        </p>
      </div>

      {error && (
        <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="h-48 bg-white border border-slate-200 rounded-lg animate-pulse" />
      ) : queue.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-sm text-slate-600">
          No paid orders are currently waiting to be picked.
        </div>
      ) : (
        <div className="space-y-5">
          {queue.map((order) => {
            const allPicked = order.items.every((i) => i.pickedQuantity >= i.quantity);
            const orderFeedback = feedback?.orderId === order.id ? feedback : null;

            return (
              <section key={order.id} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-3">
                  <div>
                    <h2 className="text-lg font-bold font-mono text-slate-900">{order.orderNumber}</h2>
                    <p className="text-xs text-slate-500">
                      {order.warehouseName} · {order.city} · Contact {order.maskedPhone}
                    </p>
                  </div>
                  <StatusLabel status={order.status} />
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs text-slate-500">
                        <th className="py-2 pr-4 font-medium">Item</th>
                        <th className="py-2 pr-4 font-medium">SKU / Barcode</th>
                        <th className="py-2 text-right font-medium">Picked</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {order.items.map((item) => (
                        <tr key={item.id}>
                          <td className="py-2.5 pr-4 font-medium text-slate-900">{item.name}</td>
                          <td className="py-2.5 pr-4 font-mono text-xs text-slate-600">
                            {item.sku} · {item.barcode}
                          </td>
                          <td className="py-2.5 text-right font-mono tabular-nums font-semibold">
                            {item.pickedQuantity} / {item.quantity}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {orderFeedback && (
                  <div
                    role={orderFeedback.type === 'err' ? 'alert' : 'status'}
                    className={`p-3 rounded-md text-xs font-medium ${
                      orderFeedback.type === 'err'
                        ? 'bg-red-50 border border-red-200 text-red-800'
                        : 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                    }`}
                  >
                    {orderFeedback.msg}
                  </div>
                )}

                {order.status !== 'PACKED' && (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-end justify-between gap-3 pt-2">
                    <form onSubmit={(e) => handleScan(e, order.id)} className="flex-1 flex items-end gap-2">
                      <div className="flex-1">
                        <label htmlFor={`scan-${order.id}`} className="block text-xs font-medium text-slate-700 mb-1">
                          Barcode Scanner / Manual SKU Entry
                        </label>
                        <div className="relative">
                          <ScanBarcode className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                          <input
                            id={`scan-${order.id}`}
                            type="text"
                            value={scanInput[order.id] || ''}
                            onChange={(e) => setScanInput((prev) => ({ ...prev, [order.id]: e.target.value }))}
                            placeholder="Scan barcode or enter SKU (e.g. 890100000005)"
                            className="w-full pl-9 pr-3 py-2 text-sm font-mono border border-slate-300 rounded-md min-h-[44px]"
                          />
                        </div>
                      </div>
                      <button
                        type="submit"
                        className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 min-h-[44px] whitespace-nowrap"
                      >
                        Confirm Pick
                      </button>
                    </form>

                    <button
                      type="button"
                      disabled={!allPicked}
                      onClick={() => handlePack(order.id)}
                      className="px-4 py-2 text-sm font-semibold text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:bg-slate-300 disabled:cursor-not-allowed min-h-[44px] whitespace-nowrap"
                    >
                      Mark Packed
                    </button>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
