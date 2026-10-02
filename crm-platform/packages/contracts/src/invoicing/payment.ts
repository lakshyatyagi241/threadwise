import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { pageInfoSchema } from '../common/pagination';
import { queryBoolean, queryList } from '../contacts-attributes-tags/query-helpers';
import { moneyTotalSchema } from '../deals-pipelines/money';
import { agingBucketSchema } from './invoice-status';

/**
 * Payments (WD-PAY-001..005, WD-PAY-015, "Port decisions"). The payment ledger is APPEND-ONLY: a payment is a positive entry
 * against one invoice, a refund a negative entry that names the payment it returns, and a mistake is corrected by a refund, never
 * by editing. The invoice's paid amount and payment status are computed from the ledger by the database in the same transaction.
 *
 * Money crosses the wire as decimal strings in major units of the entry's currency, which must be the invoice's currency
 * (WaDesk subtracted EUR from USD). A refund is returned as a negative string ("-25.00").
 */

export const PAYMENT_METHODS = [
  'cash',
  'bank',
  'card',
  'upi',
  'cheque',
  'other',
  'manual',
  'gateway',
  'wa_pay',
  'storefront',
] as const;
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

/** The methods a person can pick when recording by hand (the others are written by integrations). */
export const MANUAL_PAYMENT_METHODS = ['cash', 'bank', 'card', 'upi', 'cheque', 'other'] as const;
export const manualPaymentMethodSchema = z.enum(MANUAL_PAYMENT_METHODS);

export const PAYMENT_SOURCES = ['manual', 'gateway', 'wa_pay', 'storefront', 'api'] as const;
export const paymentSourceSchema = z.enum(PAYMENT_SOURCES);
export type PaymentSource = z.infer<typeof paymentSourceSchema>;

export const PAYMENT_KINDS = ['payment', 'refund'] as const;
export const paymentKindSchema = z.enum(PAYMENT_KINDS);
export type PaymentKind = z.infer<typeof paymentKindSchema>;

const amount = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,4})?$/, 'a positive decimal such as "100.50"');
const when = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD'),
  z.string().datetime({ offset: true }),
]);

/** Record money received against an issued invoice. */
export const recordPaymentSchema = z.object({
  amount,
  /** Must equal the invoice's currency when given; the invoice's is used otherwise. */
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((v) => v.toUpperCase())
    .optional(),
  method: manualPaymentMethodSchema.default('bank'),
  /** A date (the workspace calendar day) or a full timestamp. Default now. Not in the future. */
  paidAt: when.optional(),
  /** Transaction id, cheque number ... */
  reference: z.string().trim().max(191).nullish(),
  note: z.string().trim().max(2000).nullish(),
  /**
   * More than the open balance is refused (422 PAY_OVERPAYMENT) unless this is true; the excess then shows as a credit on the
   * invoice. WaDesk accepted any amount silently.
   */
  allowOverpayment: z.boolean().default(false),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

/** `POST /payments` names the invoice in the body; `POST /invoices/:id/payments` takes it from the path. */
export const recordPaymentForInvoiceSchema = recordPaymentSchema.extend({ invoiceId: uuidSchema });
export type RecordPaymentForInvoiceInput = z.infer<typeof recordPaymentForInvoiceSchema>;

export const refundPaymentSchema = z.object({
  /** Default: everything of the payment not refunded yet. */
  amount: amount.optional(),
  reason: z.string().trim().max(500).nullish(),
  paidAt: when.optional(),
});
export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>;

const ref = z.object({ id: uuidSchema, name: z.string().nullable() });

export const paymentResponseSchema = z.object({
  id: uuidSchema,
  kind: paymentKindSchema,
  /** Positive for a payment, negative for a refund. */
  amount: z.string(),
  amountMinor: z.string(),
  currency: z.string(),
  method: paymentMethodSchema,
  source: paymentSourceSchema,
  paidAt: z.string().datetime(),
  reference: z.string().nullable(),
  note: z.string().nullable(),
  receiptNumber: z.string().nullable(),
  invoice: z.object({ id: uuidSchema, number: z.string().nullable() }).nullable(),
  contact: ref.nullable(),
  /** On a refund: the payment it returns. */
  refundOf: z.object({ id: uuidSchema, receiptNumber: z.string().nullable() }).nullable(),
  /** On a payment: how much of it has been refunded so far (major units, positive). */
  refunded: z.string(),
  /** On a payment: what can still be refunded. */
  refundable: z.string(),
  recordedBy: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  createdAt: z.string().datetime(),
});
export type PaymentResponse = z.infer<typeof paymentResponseSchema>;

export const paymentPageResponseSchema = z.object({
  data: z.array(paymentResponseSchema),
  page: pageInfoSchema,
});
export type PaymentPageResponse = z.infer<typeof paymentPageResponseSchema>;

/** The result of recording or refunding: the ledger entry, and where it left the invoice. */
export const paymentOutcomeSchema = z.object({
  payment: paymentResponseSchema,
  invoice: z.object({
    id: uuidSchema,
    number: z.string().nullable(),
    status: z.string(),
    paymentStatus: z.string(),
    currency: z.string(),
    total: z.string(),
    paid: z.string(),
    balance: z.string(),
    credit: z.string(),
  }),
});
export type PaymentOutcome = z.infer<typeof paymentOutcomeSchema>;

export const listPaymentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(512).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  invoiceId: uuidSchema.optional(),
  contactId: uuidSchema.optional(),
  companyId: uuidSchema.optional(),
  dealId: uuidSchema.optional(),
  kind: paymentKindSchema.optional(),
  method: queryList(paymentMethodSchema).optional(),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((v) => v.toUpperCase())
    .optional(),
  /** Payments dated on or after / before (inclusive), `YYYY-MM-DD` in the workspace calendar. */
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Reference, receipt number or invoice number. */
  q: z.string().trim().min(1).max(100).optional(),
});
export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;

/** A payment receipt (WD-PAY-015): the printable proof of one ledger entry. */
export const paymentReceiptSchema = z.object({
  receiptNumber: z.string().nullable(),
  kind: paymentKindSchema,
  amount: z.string(),
  currency: z.string(),
  method: paymentMethodSchema,
  paidAt: z.string().datetime(),
  reference: z.string().nullable(),
  seller: z.object({
    name: z.string().nullable(),
    address: z.string().nullable(),
    taxId: z.string().nullable(),
  }),
  buyerName: z.string().nullable(),
  invoice: z.object({
    number: z.string().nullable(),
    total: z.string(),
    paid: z.string(),
    balance: z.string(),
  }),
});
export type PaymentReceipt = z.infer<typeof paymentReceiptSchema>;

// --- reports ---------------------------------------------------------------------------------------------------------------

/** KPI cards: money collected in a window, and what is open and what is overdue, per currency (never summed across currencies). */
export const paymentSummaryQuerySchema = z.object({
  /** Collected window in days; default 30. */
  days: z.coerce.number().int().min(1).max(366).default(30),
});
export type PaymentSummaryQuery = z.infer<typeof paymentSummaryQuerySchema>;

export const paymentSummaryResponseSchema = z.object({
  days: z.number().int(),
  collected: z.array(moneyTotalSchema),
  refunded: z.array(moneyTotalSchema),
  outstanding: z.array(moneyTotalSchema.extend({ invoices: z.number().int() })),
  overdue: z.array(moneyTotalSchema.extend({ invoices: z.number().int() })),
});
export type PaymentSummaryResponse = z.infer<typeof paymentSummaryResponseSchema>;

export const agingBucketRowSchema = z.object({
  bucket: agingBucketSchema,
  amount: z.string(),
  invoices: z.number().int(),
});

export const agingResponseSchema = z.object({
  /** The calendar day the report is cut at (the workspace's today). */
  asOf: z.string(),
  /** One block per currency: buckets are never summed across currencies. */
  currencies: z.array(
    z.object({
      currency: z.string(),
      total: z.string(),
      invoices: z.number().int(),
      buckets: z.array(agingBucketRowSchema),
    }),
  ),
});
export type AgingResponse = z.infer<typeof agingResponseSchema>;

export const agingQuerySchema = z.object({
  contactId: uuidSchema.optional(),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((v) => v.toUpperCase())
    .optional(),
});
export type AgingQuery = z.infer<typeof agingQuerySchema>;

/** Outstanding per contact (who owes what), biggest debt first within a currency. */
export const outstandingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(512).optional(),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((v) => v.toUpperCase())
    .optional(),
  onlyOverdue: queryBoolean().optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type OutstandingQuery = z.infer<typeof outstandingQuerySchema>;

export const outstandingRowSchema = z.object({
  /** Null groups the invoices that have no contact. */
  contact: z.object({ id: uuidSchema, name: z.string().nullable() }).nullable(),
  currency: z.string(),
  outstanding: z.string(),
  overdue: z.string(),
  invoices: z.number().int(),
  oldestDueDate: z.string().nullable(),
});
export const outstandingResponseSchema = z.object({
  data: z.array(outstandingRowSchema),
  page: pageInfoSchema,
});
export type OutstandingResponse = z.infer<typeof outstandingResponseSchema>;
