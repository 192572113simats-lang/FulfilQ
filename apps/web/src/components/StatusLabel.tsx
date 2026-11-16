import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Package,
  RotateCcw,
  Truck,
  XCircle,
} from 'lucide-react';
import { OrderStatus } from '@fulfilliq/shared';

interface StatusMeta {
  label: string;
  colorClass: string;
  Icon: typeof CheckCircle2;
}

const STATUS_MAP: Record<string, StatusMeta> = {
  [OrderStatus.PLACED]: { label: 'Placed', colorClass: 'text-slate-700', Icon: Clock },
  [OrderStatus.RESERVED]: { label: 'Stock Reserved', colorClass: 'text-amber-700', Icon: Clock },
  [OrderStatus.PAYMENT_PENDING]: { label: 'Payment Pending Retry', colorClass: 'text-amber-700', Icon: AlertTriangle },
  [OrderStatus.PAID]: { label: 'Paid · Ready for Pick', colorClass: 'text-blue-700', Icon: CheckCircle2 },
  [OrderStatus.PICKING]: { label: 'Picking in Progress', colorClass: 'text-blue-700', Icon: Package },
  [OrderStatus.PACKED]: { label: 'Packed · Awaiting Dispatch', colorClass: 'text-slate-900', Icon: Package },
  [OrderStatus.DISPATCHED]: { label: 'Dispatched', colorClass: 'text-blue-700', Icon: Truck },
  [OrderStatus.DELIVERED]: { label: 'Delivered', colorClass: 'text-emerald-700', Icon: CheckCircle2 },
  [OrderStatus.RETURN_REQUESTED]: { label: 'Return Requested', colorClass: 'text-amber-700', Icon: RotateCcw },
  [OrderStatus.REFUND_PENDING]: { label: 'Refund Pending Review', colorClass: 'text-amber-700', Icon: Clock },
  [OrderStatus.REFUNDED]: { label: 'Refunded', colorClass: 'text-emerald-700', Icon: CheckCircle2 },
  [OrderStatus.REFUND_REJECTED]: { label: 'Refund Declined', colorClass: 'text-red-700', Icon: XCircle },
  [OrderStatus.EXPIRED]: { label: 'Reservation Expired', colorClass: 'text-slate-500', Icon: XCircle },
  [OrderStatus.CANCELLED]: { label: 'Cancelled', colorClass: 'text-slate-500', Icon: XCircle },
  SUCCEEDED: { label: 'Succeeded', colorClass: 'text-emerald-700', Icon: CheckCircle2 },
  PENDING_RETRY: { label: 'Pending Retry', colorClass: 'text-amber-700', Icon: AlertTriangle },
  FAILED: { label: 'Failed', colorClass: 'text-red-700', Icon: XCircle },
  OPEN: { label: 'Open Alert', colorClass: 'text-red-700', Icon: AlertTriangle },
  RESOLVED: { label: 'Resolved', colorClass: 'text-emerald-700', Icon: CheckCircle2 },
  APPROVED: { label: 'Approved', colorClass: 'text-emerald-700', Icon: CheckCircle2 },
  REJECTED: { label: 'Rejected', colorClass: 'text-red-700', Icon: XCircle },
  REQUESTED: { label: 'Requested', colorClass: 'text-amber-700', Icon: Clock },
};

export function StatusLabel({ status }: { status: string }) {
  const meta = STATUS_MAP[status] || {
    label: status,
    colorClass: 'text-slate-700',
    Icon: Clock,
  };
  const { Icon } = meta;

  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap ${meta.colorClass}`}>
      <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span>{meta.label}</span>
    </span>
  );
}
