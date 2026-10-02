import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { pageInfoSchema } from '../common/pagination';
import { queryList } from '../contacts-attributes-tags/query-helpers';
import { invoiceAmountsSchema, invoiceSellerSchema, invoiceTaxSummaryRowSchema } from './invoice';

/**
 * Credit notes (owner direction; Reference had the words "credit note" in a PDF title and nothing behind them). A credit note is a
 * numbered document against ONE issued invoice that reduces what the buyer owes: all of it, or some lines, or some quantity of
 * a line, or a free-form amount (a goodwill discount). It has its own series (CRN-...), its own wording and its own tax
 * figures, computed by the same engine as the invoice.
 *
 *   draft -> issued -> void
 *
 * Issuing it is where money moves: the credit reduces the invoice's balance (`settlement: balance`), and with
 * `settlement: refund` any cash that would now be an over-payment is returned through the payment ledger as refund entries
 * (so the ledger, the invoice and the credit note always agree). The total of the issued credit notes of an invoice can never
 * exceed the invoice.
 */
export const CREDIT_NOTE_STATUSES = ['draft', 'issued', 'void'] as const;
export const creditNoteStatusSchema = z.enum(CREDIT_NOTE_STATUSES);
export type CreditNoteStatus = z.infer<typeof creditNoteStatusSchema>;

export const CREDIT_NOTE_REASONS = [
  'return',
  'price_adjustment',
  'billing_error',
  'cancellation',
  'goodwill',
  'other',
] as const;
export const creditNoteReasonSchema = z.enum(CREDIT_NOTE_REASONS);
export type CreditNoteReason = z.infer<typeof creditNoteReasonSchema>;

export const CREDIT_NOTE_SETTLEMENTS = ['balance', 'refund'] as const;
export const creditNoteSettlementSchema = z.enum(CREDIT_NOTE_SETTLEMENTS);
export type CreditNoteSettlement = z.infer<typeof creditNoteSettlementSchema>;

const decimal = (max: number, scale: number) =>
  z
    .string()
    .trim()
    .regex(
      new RegExp(`^\\d{1,${max}}(\\.\\d{1,${scale}})?$`),
      `a positive decimal with at most ${scale} decimals`,
    );

/** One credited line: part of a line of the invoice (`invoiceLineId`), or a free-form adjustment (no `invoiceLineId`). */
export const creditNoteLineInputSchema = z
  .object({
    /** A line of the invoice being credited. The credit takes its price, discount and tax from that line. */
    invoiceLineId: uuidSchema.nullish(),
    /** The quantity credited; default the whole remaining quantity of the line. */
    qty: decimal(8, 4).optional(),
    /** Free-form line: description and the amount credited (before tax). */
    description: z.string().trim().min(1).max(500).optional(),
    amount: decimal(12, 4).optional(),
    /** Free-form line: the tax rate (a tax rate id of the workspace); absent means the invoice's default of the original document: none. */
    taxRateId: uuidSchema.nullish(),
  })
  .refine((l) => (l.invoiceLineId ? true : !!l.description && !!l.amount), {
    message: 'a free-form line needs a description and an amount',
    path: ['description'],
  });
export type CreditNoteLineInput = z.infer<typeof creditNoteLineInputSchema>;

export const createCreditNoteSchema = z.object({
  invoiceId: uuidSchema,
  reason: creditNoteReasonSchema,
  note: z.string().trim().max(2000).nullish(),
  /** Credit everything still creditable on the invoice (the lines of the other fields are then ignored). */
  full: z.boolean().default(false),
  lines: z.array(creditNoteLineInputSchema).max(100).optional(),
  /** What happens to money when it is issued. Default `balance`. */
  settlement: creditNoteSettlementSchema.default('balance'),
  issueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
});
export type CreateCreditNoteInput = z.infer<typeof createCreditNoteSchema>;

export const updateCreditNoteSchema = z.object({
  reason: creditNoteReasonSchema.optional(),
  note: z.string().trim().max(2000).nullish(),
  settlement: creditNoteSettlementSchema.optional(),
  lines: z.array(creditNoteLineInputSchema).min(1).max(100).optional(),
  full: z.boolean().optional(),
  issueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  rowVersion: z.number().int().positive(),
});
export type UpdateCreditNoteInput = z.infer<typeof updateCreditNoteSchema>;

export const issueCreditNoteSchema = z.object({
  rowVersion: z.number().int().positive().optional(),
});
export type IssueCreditNoteInput = z.infer<typeof issueCreditNoteSchema>;

export const voidCreditNoteSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type VoidCreditNoteInput = z.infer<typeof voidCreditNoteSchema>;

export const creditNoteLineResponseSchema = z.object({
  id: uuidSchema,
  position: z.number().int(),
  invoiceLineId: uuidSchema.nullable(),
  description: z.string(),
  hsnSac: z.string().nullable(),
  qty: z.string(),
  unitPrice: z.string(),
  taxName: z.string().nullable(),
  taxRate: z.string(),
  taxInclusive: z.boolean(),
  amounts: z.object({ net: z.string(), tax: z.string(), total: z.string() }),
});

export const creditNoteSummarySchema = z.object({
  id: uuidSchema,
  /** Null for a draft. */
  number: z.string().nullable(),
  status: creditNoteStatusSchema,
  reason: creditNoteReasonSchema,
  settlement: creditNoteSettlementSchema,
  invoice: z.object({ id: uuidSchema, number: z.string().nullable() }),
  buyerName: z.string().nullable(),
  currency: z.string(),
  total: z.string(),
  totalMinor: z.string(),
  /** Of the total: reduced the invoice's balance, and returned as cash through the payment ledger. */
  applied: z.string(),
  refunded: z.string(),
  issueDate: z.string().nullable(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
});
export type CreditNoteSummary = z.infer<typeof creditNoteSummarySchema>;

export const creditNoteResponseSchema = creditNoteSummarySchema.extend({
  note: z.string().nullable(),
  seller: invoiceSellerSchema.nullable(),
  lines: z.array(creditNoteLineResponseSchema),
  taxSummary: z.array(invoiceTaxSummaryRowSchema),
  amounts: z.object({
    subtotal: z.string(),
    tax: z.string(),
    taxAdded: z.string(),
    total: z.string(),
  }),
  /** What the invoice looks like after this credit note (balance, credited). */
  invoiceAmounts: invoiceAmountsSchema,
  voidReason: z.string().nullable(),
  voidedAt: z.string().datetime().nullable(),
});
export type CreditNoteResponse = z.infer<typeof creditNoteResponseSchema>;

export const creditNotePageSchema = z.object({
  data: z.array(creditNoteSummarySchema),
  page: pageInfoSchema,
});

export const listCreditNotesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(512).optional(),
  status: queryList(creditNoteStatusSchema).optional(),
  invoiceId: uuidSchema.optional(),
  contactId: uuidSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type ListCreditNotesQuery = z.infer<typeof listCreditNotesQuerySchema>;
