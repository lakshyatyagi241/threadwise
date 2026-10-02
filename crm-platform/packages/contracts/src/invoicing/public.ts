import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import {
  invoiceAmountsSchema,
  invoiceDocTypeSchema,
  invoiceLineResponseSchema,
  invoiceSellerSchema,
  invoiceTaxSummaryRowSchema,
} from './invoice';
import { invoiceStatusSchema } from './invoice-status';

/**
 * What a buyer sees at `/i/<token>` (WD-INV-016/017, D-15). No login: the unguessable token is the only capability. The page shows
 * the invoice, what has been paid and what is left, and how to pay; it never shows internal ids, the owner, notes meant for staff,
 * other invoices or the buyer's email/phone. A revoked or expired link answers 410, an unknown one 404.
 */
export const publicInvoiceSchema = z.object({
  number: z.string(),
  docType: invoiceDocTypeSchema,
  status: invoiceStatusSchema,
  currency: z.string(),
  currencyExponent: z.number().int(),
  issueDate: z.string(),
  dueDate: z.string().nullable(),
  seller: invoiceSellerSchema,
  buyer: z.object({
    name: z.string().nullable(),
    address: z.string().nullable(),
    taxId: z.string().nullable(),
  }),
  reference: z.string().nullable(),
  lines: z.array(invoiceLineResponseSchema.omit({ id: true, taxRateId: true })),
  taxSummary: z.array(invoiceTaxSummaryRowSchema),
  amounts: invoiceAmountsSchema,
  reverseCharge: z.boolean(),
  legalNotes: z.string().nullable(),
  notes: z.string().nullable(),
  terms: z.string().nullable(),
  footerNote: z.string().nullable(),
  title: z.string(),
  brandColor: z.string().nullable(),
  logoUrl: z.string().nullable(),
  /** What was received so far (refunds included as negative entries). */
  payments: z.array(
    z.object({
      kind: z.enum(['payment', 'refund']),
      amount: z.string(),
      method: z.string(),
      paidAt: z.string().datetime(),
      receiptNumber: z.string().nullable(),
    }),
  ),
  /** True while a balance is open on an issued invoice and a payment option exists. */
  payable: z.boolean(),
  paymentOptions: z.object({
    /** Bank transfer instructions, when the workspace has set them. */
    bankTransfer: z
      .object({ instructions: z.string().nullable(), details: z.record(z.string()).nullable() })
      .nullable(),
    /** An online provider is connected: `POST .../pay` returns a checkout. */
    online: z.boolean(),
  }),
  voidedAt: z.string().datetime().nullable(),
  voidReason: z.string().nullable(),
});
export type PublicInvoice = z.infer<typeof publicInvoiceSchema>;

/** The buyer pressed "Pay now". `amount` defaults to the whole balance; a smaller amount is a partial payment. */
export const publicPaySchema = z.object({
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d{1,4})?$/)
    .optional(),
});
export type PublicPayInput = z.infer<typeof publicPaySchema>;

export const publicPayResponseSchema = z.object({
  /** `instructions`: pay by bank transfer as described; `redirect`: send the browser to `url`; `unavailable`: nothing to pay with. */
  kind: z.enum(['instructions', 'redirect', 'unavailable']),
  attemptId: uuidSchema.nullable(),
  amount: z.string(),
  currency: z.string(),
  url: z.string().nullable(),
  instructions: z.string().nullable(),
  details: z.record(z.string()).nullable(),
  /** The page is display-only: only a verified webhook marks the invoice paid, never what the browser comes back with. */
  note: z.string(),
});
export type PublicPayResponse = z.infer<typeof publicPayResponseSchema>;
