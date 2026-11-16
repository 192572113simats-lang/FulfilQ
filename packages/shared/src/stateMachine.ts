export enum OrderStatus {
  PLACED = 'PLACED',
  RESERVED = 'RESERVED',
  PAYMENT_PENDING = 'PAYMENT_PENDING',
  PAID = 'PAID',
  PICKING = 'PICKING',
  PACKED = 'PACKED',
  DISPATCHED = 'DISPATCHED',
  DELIVERED = 'DELIVERED',
  RETURN_REQUESTED = 'RETURN_REQUESTED',
  REFUND_PENDING = 'REFUND_PENDING',
  REFUNDED = 'REFUNDED',
  REFUND_REJECTED = 'REFUND_REJECTED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PLACED]: [OrderStatus.RESERVED, OrderStatus.CANCELLED],
  [OrderStatus.RESERVED]: [
    OrderStatus.PAID,
    OrderStatus.PAYMENT_PENDING,
    OrderStatus.EXPIRED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.PAYMENT_PENDING]: [
    OrderStatus.PAID,
    OrderStatus.EXPIRED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.PAID]: [OrderStatus.PICKING],
  [OrderStatus.PICKING]: [OrderStatus.PACKED],
  [OrderStatus.PACKED]: [OrderStatus.DISPATCHED],
  [OrderStatus.DISPATCHED]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [OrderStatus.RETURN_REQUESTED],
  [OrderStatus.RETURN_REQUESTED]: [OrderStatus.REFUND_PENDING],
  [OrderStatus.REFUND_PENDING]: [OrderStatus.REFUNDED, OrderStatus.REFUND_REJECTED],
  [OrderStatus.REFUNDED]: [],
  [OrderStatus.REFUND_REJECTED]: [],
  [OrderStatus.EXPIRED]: [],
  [OrderStatus.CANCELLED]: [],
};

export function isValidOrderTransition(from: OrderStatus, to: OrderStatus): boolean {
  const allowed = ORDER_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

/**
 * Customer-facing permitted milestones (S06) — excludes internal states/notes.
 */
export interface CustomerMilestone {
  key: 'paid' | 'picked' | 'dispatched' | 'delivered' | 'return';
  label: string;
  completed: boolean;
  reachedAt: string | null;
}

export function deriveCustomerMilestones(
  status: OrderStatus,
  history: Array<{ toStatus: string; createdAt: string }>
): CustomerMilestone[] {
  const reachedTime = (statuses: OrderStatus[]) => {
    const match = history.find((h) => statuses.includes(h.toStatus as OrderStatus));
    return match ? match.createdAt : null;
  };

  const paidAt = reachedTime([OrderStatus.PAID]);
  const pickedAt = reachedTime([OrderStatus.PACKED, OrderStatus.PICKING]);
  const dispatchedAt = reachedTime([OrderStatus.DISPATCHED]);
  const deliveredAt = reachedTime([OrderStatus.DELIVERED]);
  const returnAt = reachedTime([
    OrderStatus.RETURN_REQUESTED,
    OrderStatus.REFUND_PENDING,
    OrderStatus.REFUNDED,
    OrderStatus.REFUND_REJECTED,
  ]);

  const milestones: CustomerMilestone[] = [
    {
      key: 'paid',
      label: 'Payment Confirmed',
      completed: Boolean(paidAt),
      reachedAt: paidAt,
    },
    {
      key: 'picked',
      label: 'Picked & Packed',
      completed: Boolean(reachedTime([OrderStatus.PACKED, OrderStatus.DISPATCHED, OrderStatus.DELIVERED])),
      reachedAt: pickedAt,
    },
    {
      key: 'dispatched',
      label: 'Dispatched from Warehouse',
      completed: Boolean(dispatchedAt),
      reachedAt: dispatchedAt,
    },
    {
      key: 'delivered',
      label: 'Delivered',
      completed: Boolean(deliveredAt),
      reachedAt: deliveredAt,
    },
  ];

  if (returnAt || [
    OrderStatus.RETURN_REQUESTED,
    OrderStatus.REFUND_PENDING,
    OrderStatus.REFUNDED,
    OrderStatus.REFUND_REJECTED,
  ].includes(status)) {
    let label = 'Return Requested';
    if (status === OrderStatus.REFUND_PENDING) label = 'Refund Under Review';
    if (status === OrderStatus.REFUNDED) label = 'Refund Approved & Issued';
    if (status === OrderStatus.REFUND_REJECTED) label = 'Refund Request Declined';
    milestones.push({
      key: 'return',
      label,
      completed: status === OrderStatus.REFUNDED || status === OrderStatus.REFUND_REJECTED,
      reachedAt: returnAt,
    });
  }

  return milestones;
}
