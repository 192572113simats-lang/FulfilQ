import { z } from 'zod';
import { OrderStatus } from './stateMachine.ts';

export const CONTRACT_VERSION = '1.0.0' as const;

export enum Role {
  CUSTOMER = 'customer',
  PICKER = 'picker',
  SUPPORT_AGENT = 'support_agent',
  STORE_MANAGER = 'store_manager',
  FINANCE_REVIEWER = 'finance_reviewer',
  ADMIN = 'admin',
}

export const AddressPayloadSchema = z.object({
  recipientName: z.string().trim().min(2).max(120),
  line1: z.string().trim().min(3).max(160),
  line2: z.string().trim().max(160).optional().default(''),
  city: z.string().trim().min(2).max(80),
  postalCode: z.string().trim().min(3).max(20),
  country: z.string().trim().min(2).max(60).default('Synthetic Republic'),
  phone: z.string().trim().min(6).max(30),
});
export type AddressPayload = z.infer<typeof AddressPayloadSchema>;

export const OrderItemInputSchema = z.object({
  productId: z.string().trim().min(1),
  quantity: z.number().int().min(1).max(100),
});
export type OrderItemInput = z.infer<typeof OrderItemInputSchema>;

export const CreateOrderPayloadSchema = z.object({
  warehouseId: z.string().trim().min(1),
  items: z.array(OrderItemInputSchema).min(1).max(50),
  shippingAddress: AddressPayloadSchema,
  customerNote: z.string().trim().max(300).optional(),
});
export type CreateOrderPayload = z.infer<typeof CreateOrderPayloadSchema>;

export const PaymentRequestPayloadSchema = z.object({
  orderId: z.string().trim().min(1),
  method: z.enum(['synthetic_card']).default('synthetic_card'),
  syntheticCardLast4: z
    .string()
    .regex(/^\d{4}$/, 'Synthetic test last-4 digits required (e.g. 4242)')
    .default('4242'),
  simulatedOutcome: z.enum(['succeed', 'gateway_down', 'decline']).optional(),
});
export type PaymentRequestPayload = z.infer<typeof PaymentRequestPayloadSchema>;

export const ShippingRuleTypeSchema = z.enum(['flat', 'threshold']);

export const RegionPolicySchema = z.object({
  regionId: z.string().trim().min(1),
  code: z.string().trim().min(2).max(16),
  name: z.string().trim().min(2).max(80),
  taxRate: z.number().min(0).max(0.5),
  shippingRuleType: ShippingRuleTypeSchema,
  shippingFlatCents: z.number().int().min(0),
  shippingFreeThresholdCents: z.number().int().min(0),
  refundApprovalLimitCents: z.number().int().min(0),
  returnWindowDays: z.number().int().min(1).max(90),
  reservationExpiryMinutes: z.number().int().min(1).max(120),
});
export type RegionPolicy = z.infer<typeof RegionPolicySchema>;

export interface OrderItemDTO {
  id: string;
  productId: string;
  sku: string;
  name: string;
  barcode: string;
  quantity: number;
  pickedQuantity: number;
  unitPriceCents: number;
}

export interface OrderDTO {
  contractVersion: typeof CONTRACT_VERSION;
  id: string;
  orderNumber: string;
  customerId: string;
  customerEmail?: string;
  customerPhone?: string;
  warehouseId: string;
  warehouseName: string;
  regionId: string;
  regionName: string;
  status: OrderStatus;
  subtotalCents: number;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
  shippingAddress: AddressPayload;
  reservedUntil: string | null;
  assignedPickerId: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItemDTO[];
}

export interface PaymentIntentDTO {
  contractVersion: typeof CONTRACT_VERSION;
  id: string;
  orderId: string;
  idempotencyKey: string;
  amountCents: number;
  status: 'PENDING_RETRY' | 'SUCCEEDED' | 'FAILED';
  gatewayUsed: 'local_stub' | 'sandbox_http';
  gatewayRef: string | null;
  retryCount: number;
  nextRetryAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReturnRequestDTO {
  id: string;
  orderId: string;
  orderNumber: string;
  customerId: string;
  regionId: string;
  reason: string;
  requestedAmountCents: number;
  status: 'REQUESTED' | 'REFUND_PENDING' | 'APPROVED' | 'REJECTED';
  decidedBy: string | null;
  decidedByName?: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export type DeliveryColumn = 'Ready' | 'In Progress' | 'Review' | 'Test' | 'Blocked' | 'Done';

export interface DeliveryStoryDTO {
  id: string;
  epic: string;
  title: string;
  priority: 'M' | 'S' | 'C';
  points: number;
  sprint: number;
  ownerRole: string;
  columnStatus: DeliveryColumn;
  dependencies: string[];
  acceptanceCriteria: string;
  blockedReason: string | null;
  isDeferred: boolean;
  simulatedNote: string;
}
