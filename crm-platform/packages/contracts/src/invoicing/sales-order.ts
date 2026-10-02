import { z } from 'zod';
import { calendarDaySchema, isoCurrencySchema } from '../sales-docs/input-guards';
import { emailSchema, phoneSchema, uuidSchema } from '../common/ids';
import { pageInfoSchema } from '../common/pagination';
import { queryList } from '../contacts-attributes-tags/query-helpers';
import { moneyTotalSchema } from '../deals-pipelines/money';
import { invoiceLineInputSchema, invoiceMoneySchema, invoiceSummarySchema } from './invoice';

/**
 * Sales orders (owner direction; Reference had none: its "orders" are store orders). The step between an accepted offer and the
 * invoice, for businesses that deliver in parts:
 *
 *   estimate / proposal (accepted) -> SALES ORDER -> one or MORE invoices -> fulfilment
 *
 * An order has priced lines with ordered, invoiced and fulfilled quantities. Invoicing is partial by design: each call to
 * `POST /sales-orders/:id/invoice` bills some quantities (or everything still unbilled) and produces a draft invoice; the order
 * tracks how much of each line is billed (`invoicingStatus`) and delivered (`fulfilmentStatus`) separately, since they move
 * independently. Voiding or deleting such an invoice gives its quantities back to the order.
 */
export const SALES_ORDER_STATUSES = ['draft', 'confirmed', 'cancelled', 'closed'] as const;
export const salesOrderStatusSchema = z.enum(SALES_ORDER_STATUSES);
export type SalesOrderStatus = z.infer<typeof salesOrderStatusSchema>;

export const INVOICING_STATUSES = ['not_invoiced', 'partially_invoiced', 'invoiced'] as const;
export const invoicingStatusSchema = z.enum(INVOICING_STATUSES);
export type InvoicingStatus = z.infer<typeof invoicingStatusSchema>;

export const FULFILMENT_STATUSES = ['unfulfilled', 'partially_fulfilled', 'fulfilled'] as const;
export const fulfilmentStatusSchema = z.enum(FULFILMENT_STATUSES);
export type FulfilmentStatus = z.infer<typeof fulfilmentStatusSchema>;

const date = calendarDaySchema;
const currency = isoCurrencySchema;
const qty = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,4})?$/, 'a positive decimal with at most 4 decimals');

export const createSalesOrderSchema = z
  .object({
    /** Start from an ACCEPTED proposal or estimate: its buyer, links, currency and lines (its document discount is folded into the lines). */
    quoteId: uuidSchema.nullish(),
    buyerName: z.string().trim().max(255).nullish(),
    buyerEmail: emailSchema.nullish(),
    buyerPhone: phoneSchema.nullish(),
    contactId: uuidSchema.nullish(),
    companyId: uuidSchema.nullish(),
    dealId: uuidSchema.nullish(),
    ownerId: uuidSchema.nullish(),
    currency: currency.optional(),
    reference: z.string().trim().max(191).nullish(),
    /** The buyer's purchase-order number or the delivery date the buyer expects. */
    expectedDate: date.nullish(),
    shipping: invoiceMoneySchema.nullish(),
    notes: z.string().trim().max(5000).nullish(),
    terms: z.string().trim().max(10000).nullish(),
    lines: z.array(invoiceLineInputSchema).max(100).optional(),
  })
  .refine((v) => !!v.quoteId || (v.lines?.length ?? 0) > 0, {
    message: 'send a quoteId or at least one line',
    path: ['lines'],
  });
export type CreateSalesOrderInput = z.infer<typeof createSalesOrderSchema>;

export const updateSalesOrderSchema = z.object({
  buyerName: z.string().trim().max(255).nullish(),
  buyerEmail: emailSchema.nullish(),
  buyerPhone: phoneSchema.nullish(),
  contactId: uuidSchema.nullish(),
  companyId: uuidSchema.nullish(),
  dealId: uuidSchema.nullish(),
  ownerId: uuidSchema.nullish(),
  reference: z.string().trim().max(191).nullish(),
  expectedDate: date.nullish(),
  shipping: invoiceMoneySchema.nullish(),
  notes: z.string().trim().max(5000).nullish(),
  terms: z.string().trim().max(10000).nullish(),
  /** Draft only: replaces every line. */
  lines: z.array(invoiceLineInputSchema).min(1).max(100).optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateSalesOrderInput = z.infer<typeof updateSalesOrderSchema>;

/** Bill part of an order. `all` bills every unbilled quantity; otherwise name the lines and quantities. */
export const invoiceFromOrderSchema = z
  .object({
    all: z.boolean().default(false),
    lines: z
      .array(z.object({ lineId: uuidSchema, qty: qty.optional() }))
      .max(100)
      .optional(),
    issueDate: date.nullish(),
    dueDate: date.nullish(),
    paymentTermsDays: z.number().int().min(0).max(365).nullish(),
    /** Issue the invoice at once instead of leaving a draft. */
    issue: z.boolean().default(false),
    /** Shipping is billed with the first invoice unless this is false. */
    includeShipping: z.boolean().default(true),
  })
  .refine((v) => v.all || (v.lines?.length ?? 0) > 0, {
    message: 'send all: true or at least one line',
    path: ['lines'],
  });
export type InvoiceFromOrderInput = z.infer<typeof invoiceFromOrderSchema>;

/** Record that quantities were delivered. */
export const fulfilOrderSchema = z
  .object({
    all: z.boolean().default(false),
    lines: z
      .array(z.object({ lineId: uuidSchema, qty: qty }))
      .max(100)
      .optional(),
    note: z.string().trim().max(500).nullish(),
  })
  .refine((v) => v.all || (v.lines?.length ?? 0) > 0, {
    message: 'send all: true or at least one line',
    path: ['lines'],
  });
export type FulfilOrderInput = z.infer<typeof fulfilOrderSchema>;

export const cancelOrderSchema = z.object({ reason: z.string().trim().min(1).max(500) });
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

export const salesOrderLineResponseSchema = z.object({
  id: uuidSchema,
  position: z.number().int(),
  description: z.string(),
  sku: z.string().nullable(),
  hsnSac: z.string().nullable(),
  qty: z.string(),
  qtyInvoiced: z.string(),
  qtyFulfilled: z.string(),
  /** Ordered but not yet billed. */
  qtyToInvoice: z.string(),
  unitPrice: z.string(),
  taxName: z.string().nullable(),
  taxRate: z.string(),
  taxInclusive: z.boolean(),
  amounts: z.object({ net: z.string(), tax: z.string(), total: z.string() }),
});

export const salesOrderSummarySchema = z.object({
  id: uuidSchema,
  number: z.string(),
  status: salesOrderStatusSchema,
  invoicingStatus: invoicingStatusSchema,
  fulfilmentStatus: fulfilmentStatusSchema,
  buyerName: z.string().nullable(),
  contact: z.object({ id: uuidSchema, name: z.string().nullable() }).nullable(),
  deal: z.object({ id: uuidSchema, title: z.string() }).nullable(),
  quote: z.object({ id: uuidSchema, number: z.string(), kind: z.enum(['proposal', 'estimate']) }).nullable(),
  owner: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  currency: z.string(),
  total: z.string(),
  totalMinor: z.string(),
  expectedDate: z.string().nullable(),
  reference: z.string().nullable(),
  invoiceCount: z.number().int(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
});
export type SalesOrderSummary = z.infer<typeof salesOrderSummarySchema>;

export const salesOrderResponseSchema = salesOrderSummarySchema.extend({
  buyer: z.object({
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
  }),
  amounts: z.object({
    subtotal: z.string(),
    discount: z.string(),
    shipping: z.string(),
    tax: z.string(),
    total: z.string(),
  }),
  shippingInvoiced: z.boolean(),
  notes: z.string().nullable(),
  terms: z.string().nullable(),
  lines: z.array(salesOrderLineResponseSchema),
  /** The invoices made from the order. */
  invoices: z.array(
    z.object({
      id: uuidSchema,
      number: z.string().nullable(),
      status: z.string(),
      total: z.string(),
    }),
  ),
  confirmedAt: z.string().datetime().nullable(),
  cancelledAt: z.string().datetime().nullable(),
  cancelReason: z.string().nullable(),
});
export type SalesOrderResponse = z.infer<typeof salesOrderResponseSchema>;

export const salesOrderPageSchema = z.object({
  data: z.array(salesOrderSummarySchema),
  page: pageInfoSchema,
});

export const listSalesOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(512).optional(),
  status: queryList(salesOrderStatusSchema).optional(),
  invoicingStatus: queryList(invoicingStatusSchema).optional(),
  fulfilmentStatus: queryList(fulfilmentStatusSchema).optional(),
  contactId: uuidSchema.optional(),
  dealId: uuidSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type ListSalesOrdersQuery = z.infer<typeof listSalesOrdersQuerySchema>;

export const salesOrderCountsSchema = z.object({
  all: z.number().int(),
  draft: z.number().int(),
  confirmed: z.number().int(),
  cancelled: z.number().int(),
  closed: z.number().int(),
  toInvoice: z.number().int(),
  toFulfil: z.number().int(),
  openValue: z.array(moneyTotalSchema),
});
export type SalesOrderCounts = z.infer<typeof salesOrderCountsSchema>;

/** What `POST /sales-orders/:id/invoice` returns: the order with its new progress and the invoice that was made. */
export const invoiceFromOrderResponseSchema = z.object({
  order: salesOrderResponseSchema,
  invoice: invoiceSummarySchema,
});
export type InvoiceFromOrderResponse = z.infer<typeof invoiceFromOrderResponseSchema>;
