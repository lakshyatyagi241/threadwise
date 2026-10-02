import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { emailSchema } from '../common/ids';

/**
 * The invoicing profile (TW-INV-021/022, owner direction): who the seller is, per country, and how its invoices are numbered and
 * worded. One row per workspace; `GET` returns the defaults when nothing was saved yet (Reference created the row on a GET), `PATCH`
 * changes only what is sent (Reference's checkbox semantics reset `fy_reset` and the triggers on every save).
 *
 * The same profile is read by invoices, credit notes and recurring invoices, and by proposals and estimates for the seller block.
 */
export const NUMBER_FORMAT_TOKENS = ['{PREFIX}', '{YEAR}', '{YY}', '{SEQ}'] as const;

const prefix = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{1,10}$/, '1 to 10 letters or digits')
  .transform((v) => v.toUpperCase());
const country = z
  .string()
  .trim()
  .length(2)
  .transform((v) => v.toUpperCase())
  .refine((v) => /^[A-Z]{2}$/.test(v), 'an ISO 3166-1 alpha-2 country code');
const regime = z.string().regex(/^[a-z0-9_]{1,32}$/);

export const invoiceExtraFieldSchema = z.object({
  label: z.string().trim().min(1).max(40),
  value: z.string().trim().min(1).max(80),
});

/** Bank details printed on the invoice and shown on the public page: label to value, such as { "IBAN": "...", "BIC": "..." }. */
export const bankDetailsSchema = z
  .record(z.string().trim().min(1).max(40), z.string().trim().min(1).max(120))
  .refine((r) => Object.keys(r).length <= 12, 'at most 12 bank detail fields');

export const invoiceProfileSchema = z.object({
  // seller identity
  sellerName: z.string().nullable(),
  sellerAddress: z.string().nullable(),
  sellerCountry: z.string().nullable(),
  /** State or province: an ISO 3166-2 subdivision code without the country ("MH", "CA"); drives India's CGST+SGST vs IGST. */
  sellerState: z.string().nullable(),
  /** GSTIN, VAT number, EIN ... */
  sellerTaxId: z.string().nullable(),
  sellerRegistrationNo: z.string().nullable(),
  sellerPhone: z.string().nullable(),
  supportEmail: z.string().nullable(),
  extraFields: z.array(invoiceExtraFieldSchema),
  // branding
  logoUrl: z.string().nullable(),
  brandColor: z.string().nullable(),
  // payment details
  bankDetails: z.record(z.string()).nullable(),
  paymentInstructions: z.string().nullable(),
  // numbering
  numberingPrefix: z.string(),
  proformaPrefix: z.string(),
  receiptPrefix: z.string(),
  creditNotePrefix: z.string(),
  salesOrderPrefix: z.string(),
  /** Tokens: {PREFIX}, {YEAR} (the year the series is in), {YY}, {SEQ}. Must contain {SEQ}. */
  numberFormat: z.string(),
  numberPadding: z.number().int(),
  /** The counter restarts every year (every fiscal year when the fiscal year does not start in January). */
  yearlyReset: z.boolean(),
  /** 1 to 12; April = 4 for India. */
  fiscalYearStartMonth: z.number().int(),
  // defaults
  /** Default payment terms in days; null means due on issue. */
  dueDays: z.number().int().nullable(),
  terms: z.string().nullable(),
  footerNote: z.string().nullable(),
  invoiceTitle: z.string().nullable(),
  /** The rule set new invoices are priced under (the tax preset id of the workspace's country). */
  defaultTaxRegime: z.string(),
  overdueReminders: z.boolean(),
  /** Workspace currency new invoices default to (read-only here: it belongs to the workspace settings). */
  currency: z.string(),
  rowVersion: z.number().int().nullable(),
  updatedAt: z.string().datetime().nullable(),
});
export type InvoiceProfile = z.infer<typeof invoiceProfileSchema>;

export const updateInvoiceProfileSchema = z.object({
  sellerName: z.string().trim().max(191).nullish(),
  sellerAddress: z.string().trim().max(1000).nullish(),
  sellerCountry: country.nullish(),
  sellerState: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,3}$/)
    .nullish(),
  sellerTaxId: z.string().trim().max(64).nullish(),
  sellerRegistrationNo: z.string().trim().max(64).nullish(),
  sellerPhone: z.string().trim().max(40).nullish(),
  supportEmail: emailSchema.nullish(),
  extraFields: z.array(invoiceExtraFieldSchema).max(8).optional(),
  /** An https URL of the logo (uploading is the files module's job). */
  logoUrl: z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((u) => u.startsWith('https://'), 'an https URL')
    .nullish(),
  brandColor: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'a hex colour such as #0B3D2E')
    .nullish(),
  bankDetails: bankDetailsSchema.nullish(),
  paymentInstructions: z.string().trim().max(2000).nullish(),
  numberingPrefix: prefix.optional(),
  proformaPrefix: prefix.optional(),
  receiptPrefix: prefix.optional(),
  creditNotePrefix: prefix.optional(),
  salesOrderPrefix: prefix.optional(),
  numberFormat: z
    .string()
    .trim()
    .max(60)
    .regex(/^[A-Za-z0-9{}_./ -]+$/, 'letters, digits, {PREFIX} {YEAR} {YY} {SEQ} and - _ . / only')
    .refine((v) => v.includes('{SEQ}'), 'the format must contain {SEQ}')
    .refine(
      (v) =>
        (v.match(/\{[A-Z]+\}/g) ?? []).every((t) =>
          (NUMBER_FORMAT_TOKENS as readonly string[]).includes(t),
        ),
      'unknown token: use {PREFIX}, {YEAR}, {YY} and {SEQ}',
    )
    .optional(),
  numberPadding: z.number().int().min(1).max(10).optional(),
  yearlyReset: z.boolean().optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  dueDays: z.number().int().min(0).max(365).nullish(),
  terms: z.string().trim().max(10000).nullish(),
  footerNote: z.string().trim().max(2000).nullish(),
  invoiceTitle: z.string().trim().max(60).nullish(),
  defaultTaxRegime: regime.optional(),
  overdueReminders: z.boolean().optional(),
  rowVersion: z.number().int().positive().optional(),
});
export type UpdateInvoiceProfileInput = z.infer<typeof updateInvoiceProfileSchema>;

// --- online payment connection (TW-PAY-009, TW-PAY-015) -----------------------------------------------------------------------

/**
 * The webhook connection a workspace turns on to receive "paid" events for its invoices. The built-in provider is a generic
 * HMAC-signed webhook (`hmac_generic`); real gateway adapters plug into the same port later. Without a connection the public page
 * shows the bank-transfer instructions from the profile ("manual" payment).
 */
export const INVOICE_GATEWAY_PROVIDERS = ['hmac_generic'] as const;
export const invoiceGatewayProviderSchema = z.enum(INVOICE_GATEWAY_PROVIDERS);

export const invoiceGatewayResponseSchema = z.object({
  provider: invoiceGatewayProviderSchema,
  configured: z.boolean(),
  enabled: z.boolean(),
  mode: z.enum(['test', 'live']),
  /** Where the provider posts events: `/v2/public/webhooks/invoice-payments/<endpoint id>`. The id is not a secret, the signature is. */
  webhookPath: z.string().nullable(),
  /** Whether a signing secret is stored. The secret itself is never returned. */
  hasSecret: z.boolean(),
  updatedAt: z.string().datetime().nullable(),
});
export type InvoiceGatewayResponse = z.infer<typeof invoiceGatewayResponseSchema>;

export const updateInvoiceGatewaySchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(['test', 'live']).optional(),
  /** Stored encrypted; send it only to set or rotate it. At least 16 characters. */
  webhookSecret: z.string().min(16).max(256).optional(),
});
export type UpdateInvoiceGatewayInput = z.infer<typeof updateInvoiceGatewaySchema>;

/** The shape the generic HMAC webhook accepts (documented in docs/api/sales-invoices-payments.md). */
export const invoiceGatewayEventSchema = z.object({
  /** Unique per event: the idempotency key. */
  id: z.string().min(1).max(128),
  type: z.enum(['payment.succeeded', 'payment.failed']),
  data: z.object({
    /** The payment attempt's uuid the buyer was sent to pay with. */
    reference: uuidSchema,
    /** Major units. Compared with the attempt, never trusted on its own. */
    amount: z.string().regex(/^\d{1,12}(\.\d{1,4})?$/),
    currency: z.string().length(3),
    /** The provider's id of the payment (the ledger's idempotency key for it). */
    paymentId: z.string().min(1).max(191),
  }),
});
export type InvoiceGatewayEvent = z.infer<typeof invoiceGatewayEventSchema>;
