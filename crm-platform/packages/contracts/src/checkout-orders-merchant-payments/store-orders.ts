import { z } from 'zod';
import { pageResponseSchema } from '../common/pagination';
import { uuidSchema } from '../common/ids';

/**
 * The merchant's order screens (Reference /store/orders): the list with status and source filters, one order, the status form,
 * the payment-link actions and the invoice. Money is integer minor units. Ids on the wire are uuids; `orderNo` is the number
 * buyers are shown (`#id`, as in Reference).
 */

/** Reference `WaOrder::STATUSES`, in its order. */
export const STORE_ORDER_STATUSES = [
  'new',
  'pending',
  'confirmed',
  'paid',
  'processing',
  'completed',
  'shipped',
  'cancelled',
] as const;
export const storeOrderStatusSchema = z.enum(STORE_ORDER_STATUSES);
export type StoreOrderStatus = z.infer<typeof storeOrderStatusSchema>;

/** Reference `WaOrder::SOURCES`. */
export const STORE_ORDER_SOURCES = [
  'waba',
  'storefront',
  'twilio',
  'manual',
  'shopify',
  'woocommerce',
  'whatsapp_ai',
] as const;
export const storeOrderSourceSchema = z.enum(STORE_ORDER_SOURCES);
export type StoreOrderSource = z.infer<typeof storeOrderSourceSchema>;

/**
 * Where an order stands on money: `paid` (status paid, or a gateway or WhatsApp Pay confirmed it), `cod` (cash on delivery, not
 * yet paid), `awaiting` (a payment link was issued), `unpaid` (nothing asked for yet).
 */
export const STORE_PAYMENT_STATUSES = ['paid', 'awaiting', 'cod', 'unpaid'] as const;
export const storePaymentStatusSchema = z.enum(STORE_PAYMENT_STATUSES);
export type StorePaymentStatus = z.infer<typeof storePaymentStatusSchema>;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const listStoreOrdersQuerySchema = z.object({
  status: z.union([storeOrderStatusSchema, z.literal('all')]).default('all'),
  source: z.union([storeOrderSourceSchema, z.literal('all')]).default('all'),
  storefrontId: uuidSchema.optional(),
  paymentStatus: storePaymentStatusSchema.optional(),
  /** Inclusive calendar days, UTC. */
  from: day.optional(),
  to: day.optional(),
  /** Matches the buyer's phone (digits), name or the order number. */
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(512).optional(),
});
export type ListStoreOrdersQuery = z.infer<typeof listStoreOrdersQuerySchema>;

export const storeOrderListItemSchema = z.object({
  id: uuidSchema,
  orderNo: z.number().int(),
  source: z.string(),
  status: z.string(),
  paymentStatus: storePaymentStatusSchema,
  paymentMethod: z.string(),
  customerName: z.string().nullable(),
  customerPhone: z.string().nullable(),
  itemsCount: z.number().int(),
  totalMinor: z.number().int(),
  currencyCode: z.string(),
  storefrontId: uuidSchema.nullable(),
  storefrontName: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type StoreOrderListItem = z.infer<typeof storeOrderListItemSchema>;

export const storeOrderListResponseSchema = pageResponseSchema(storeOrderListItemSchema);
export type StoreOrderListResponse = z.infer<typeof storeOrderListResponseSchema>;

/** The status tabs: one count per status plus `all` (workspace-wide, ignoring the other filters, as Reference). */
export const storeOrderCountsSchema = z.object({
  all: z.number().int(),
  new: z.number().int(),
  pending: z.number().int(),
  confirmed: z.number().int(),
  paid: z.number().int(),
  processing: z.number().int(),
  completed: z.number().int(),
  shipped: z.number().int(),
  cancelled: z.number().int(),
});
export type StoreOrderCounts = z.infer<typeof storeOrderCountsSchema>;

export const storeOrderLineSchema = z.object({
  productId: z.number().int().nullable(),
  name: z.string(),
  qty: z.number().int(),
  priceMinor: z.number().int(),
  lineTotalMinor: z.number().int(),
  image: z.string().nullable(),
  retailerId: z.string().nullable(),
  /** "M / Red" for a variant line; null for older lines and plain products. */
  variantTitle: z.string().nullable().optional(),
});
export type StoreOrderLine = z.infer<typeof storeOrderLineSchema>;

/** One payment attempt or settlement recorded on the order. */
export const storeOrderPaymentSchema = z.object({
  kind: z.enum(['gateway', 'payment_link', 'whatsapp_pay', 'cod', 'manual']),
  /** Gateway slug (`razorpay`, `stripe`...) or null. */
  gateway: z.string().nullable(),
  status: storePaymentStatusSchema,
  amountMinor: z.number().int(),
  currencyCode: z.string(),
  /** The provider's own payment or link id, when known. */
  reference: z.string().nullable(),
  url: z.string().nullable(),
  at: z.string().datetime().nullable(),
});
export type StoreOrderPayment = z.infer<typeof storeOrderPaymentSchema>;

export const storeOrderTimelineEntrySchema = z.object({
  at: z.string().datetime(),
  kind: z.enum(['created', 'status_changed', 'payment_link', 'paid', 'invoice', 'note', 'updated']),
  detail: z.string().nullable(),
  /** `user`, `system` (a webhook) or `customer` (the storefront checkout). */
  actor: z.string(),
});
export type StoreOrderTimelineEntry = z.infer<typeof storeOrderTimelineEntrySchema>;

export const storeOrderDetailSchema = storeOrderListItemSchema.extend({
  customerEmail: z.string().nullable(),
  customerAddress: z.string().nullable(),
  items: z.array(storeOrderLineSchema),
  subtotalMinor: z.number().int(),
  shippingMinor: z.number().int(),
  taxMinor: z.number().int(),
  taxInclusive: z.boolean(),
  discountMinor: z.number().int(),
  couponCode: z.string().nullable(),
  notes: z.string().nullable(),
  paymentLink: z.string().nullable(),
  rtoScore: z.number().int().nullable(),
  rtoBand: z.string().nullable(),
  payments: z.array(storeOrderPaymentSchema),
  timeline: z.array(storeOrderTimelineEntrySchema),
  /** Gateways this order can be paid with right now (resolved for its shop), for the "Send checkout" picker. */
  availableGateways: z.array(z.object({ slug: z.string(), name: z.string() })),
  /** Linked CRM records; null until the order is turned into one. */
  contactId: uuidSchema.nullable(),
  invoiceId: uuidSchema.nullable(),
  salesOrderId: uuidSchema.nullable(),
  rowVersion: z.number().int(),
  updatedAt: z.string().datetime(),
});
export type StoreOrderDetail = z.infer<typeof storeOrderDetailSchema>;

/**
 * Reference `updateStatus`: status is required, the operator may move an order to any status (there is no state machine), `notes`
 * and `paymentLink` are optional. The buyer is messaged when the status changed or a payment link was typed.
 */
export const updateStoreOrderStatusSchema = z.object({
  status: storeOrderStatusSchema,
  notes: z.string().trim().max(1000).nullish(),
  paymentLink: z.string().trim().url().max(1024).nullish(),
  rowVersion: z.number().int().positive().optional(),
});
export type UpdateStoreOrderStatusInput = z.infer<typeof updateStoreOrderStatusSchema>;

export const sendStoreOrderPaymentLinkSchema = z.object({
  paymentLink: z.string().trim().url().max(1024),
});
export type SendStoreOrderPaymentLinkInput = z.infer<typeof sendStoreOrderPaymentLinkSchema>;

/** Reference `sendCheckout`: mint a hosted link on a chosen merchant gateway and send it. Without a slug the resolved default is used. */
export const generateStoreOrderPaymentLinkSchema = z.object({
  gateway: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_-]{1,64}$/)
    .optional(),
});
export type GenerateStoreOrderPaymentLinkInput = z.infer<
  typeof generateStoreOrderPaymentLinkSchema
>;

export const storeOrderPaymentLinkResponseSchema = z.object({
  ok: z.boolean(),
  url: z.string().nullable(),
  /** The WhatsApp message to the buyer went out. False when the link was saved but nothing could send. */
  sent: z.boolean(),
  gateway: z.string().nullable(),
});
export type StoreOrderPaymentLinkResponse = z.infer<typeof storeOrderPaymentLinkResponseSchema>;

export const storeOrderStatusResponseSchema = z.object({
  order: storeOrderDetailSchema,
  /** The buyer was told about the change (status and/or link). */
  notified: z.boolean(),
});
export type StoreOrderStatusResponse = z.infer<typeof storeOrderStatusResponseSchema>;

export const createStoreOrderInvoiceResponseSchema = z.object({
  invoiceId: uuidSchema,
  number: z.string().nullable(),
  salesOrderId: uuidSchema.nullable(),
  /** The order already had an invoice: this is that one. */
  existing: z.boolean(),
});
export type CreateStoreOrderInvoiceResponse = z.infer<typeof createStoreOrderInvoiceResponseSchema>;
