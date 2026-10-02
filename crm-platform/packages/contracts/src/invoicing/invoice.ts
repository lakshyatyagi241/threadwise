import { z } from 'zod';
import { emailSchema, phoneSchema, uuidSchema } from '../common/ids';
import { pageInfoSchema } from '../common/pagination';
import { queryBoolean, queryList } from '../contacts-attributes-tags/query-helpers';
import { moneyTotalSchema } from '../deals-pipelines/money';
import { INVOICE_MAX_LINES } from './invoice-math';
import {
  invoicePaymentStatusSchema,
  invoiceStatusSchema,
  invoiceStoredStatusSchema,
} from './invoice-status';
import { taxComponentSchema, taxTypeSchema } from './tax-rate';

/**
 * Invoices (TW-INV-001..031, "Port decisions"). A sales invoice is created as a DRAFT (no number, no public link, editable), ISSUED
 * (numbered from the series, frozen, public link minted), then paid through the payment ledger, or voided. Money crosses the wire as
 * strings: `amounts` are decimal strings in major units of `currency` (its own number of decimals), `amountsMinor` the same as whole
 * minor units; quantities and rates are decimal strings too. The pricing function is `computeInvoice` (./invoice-math), the same
 * rule as proposals and estimates; the web form's live preview calls it.
 */

export const INVOICE_DOC_TYPES = ['tax_invoice', 'proforma', 'receipt'] as const;
export const invoiceDocTypeSchema = z.enum(INVOICE_DOC_TYPES);
export type InvoiceDocType = z.infer<typeof invoiceDocTypeSchema>;

/** Types a person can create by hand; `receipt` is what a paid store order becomes (a later source). */
export const invoiceCreatableDocTypeSchema = z.enum(['tax_invoice', 'proforma']);

export const INVOICE_SOURCES = [
  'manual',
  'quote',
  'order',
  'woocommerce',
  'shopify',
  'own',
  'api',
  'ai',
  'recurring',
  'sales_order',
] as const;
export const invoiceSourceSchema = z.enum(INVOICE_SOURCES);
export type InvoiceSource = z.infer<typeof invoiceSourceSchema>;

export const INVOICE_NOTES_MAX = 5000;
export const INVOICE_TERMS_MAX = 10000;
export const INVOICE_LINE_DESCRIPTION_MAX = 500;

// --- request pieces --------------------------------------------------------------------------------------------------------

const decimal = (max: number, scale: number) =>
  z
    .string()
    .trim()
    .regex(
      new RegExp(`^\\d{1,${max}}(\\.\\d{1,${scale}})?$`),
      `a non-negative decimal with at most ${scale} decimals`,
    );

/** Major units, up to 4 decimals typed (the currency decides how many it may keep). */
export const invoiceMoneySchema = decimal(12, 4);
export const invoiceQtySchema = decimal(8, 4);
export const invoicePercentSchema = decimal(3, 2);

export const invoiceDiscountSchema = z.object({
  kind: z.enum(['percent', 'amount']),
  /** Percent (0 to 100) or an amount in major units of the document currency. */
  value: invoiceMoneySchema,
});
export type InvoiceDiscount = z.infer<typeof invoiceDiscountSchema>;

const hsn = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z]{2,12}$/, 'an HSN or SAC code is 2 to 12 letters or digits');

export const invoiceLineInputSchema = z.object({
  description: z.string().trim().min(1).max(INVOICE_LINE_DESCRIPTION_MAX),
  sku: z.string().trim().max(64).nullish(),
  /** India: harmonised system / services accounting code; defaults from the tax rate when absent. */
  hsnSac: hsn.nullish(),
  qty: invoiceQtySchema.default('1'),
  unitPrice: invoiceMoneySchema,
  /** Per-line discount; null or absent for none. */
  discount: invoiceDiscountSchema.nullish(),
  /**
   * The tax rate of the line. ABSENT: the workspace's default tax rate (none when there is no default). `null`: no tax. A uuid: that
   * rate (404 when it is not in the workspace, 422 when it is inactive or outside its effective window).
   */
  taxRateId: uuidSchema.nullish(),
});
export type InvoiceLineInput = z.infer<typeof invoiceLineInputSchema>;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD');
const currency = z
  .string()
  .trim()
  .length(3)
  .transform((v) => v.toUpperCase())
  .refine((v) => /^[A-Z]{3}$/.test(v), 'currency must be a 3-letter ISO code');
const country = z
  .string()
  .trim()
  .length(2)
  .transform((v) => v.toUpperCase())
  .refine((v) => /^[A-Z]{2}$/.test(v), 'an ISO 3166-1 alpha-2 country code');
const placeOfSupply = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/,
    'an ISO 3166-2 code such as IN-MH or US-CA, or a country code',
  );
const taxId = z.string().trim().min(2).max(40);
const regime = z.string().regex(/^[a-z0-9_]{1,32}$/);

const buyerShape = {
  /** Default: the linked contact's name. */
  buyerName: z.string().trim().max(255).nullish(),
  buyerEmail: emailSchema.nullish(),
  buyerPhone: phoneSchema.nullish(),
  buyerAddress: z.string().trim().max(1000).nullish(),
  /** GSTIN, VAT number, EIN ... */
  buyerTaxId: taxId.nullish(),
  buyerCountry: country.nullish(),
};

export const createInvoiceSchema = z.object({
  /** Default `tax_invoice`. */
  docType: invoiceCreatableDocTypeSchema.optional(),
  ...buyerShape,
  contactId: uuidSchema.nullish(),
  companyId: uuidSchema.nullish(),
  dealId: uuidSchema.nullish(),
  /** An active member; default the caller. */
  ownerId: uuidSchema.nullish(),
  /** ISO 4217; default the workspace's currency. Fixed while the invoice is a draft's own business, frozen at issue. */
  currency: currency.optional(),
  /** The rule set the document is priced under; default from the invoicing profile. */
  taxRegime: regime.optional(),
  /**
   * `rates` (default): each line takes the tax rate it names (or the default). `auto`: the server decides each line's taxes from the
   * invoicing profile's country, the seller's and the buyer's place, tax ids and the supply (`@crm/tax`, "Why this tax?"): India
   * CGST+SGST vs IGST, EU reverse charge, UK/US/Canada rules. The reasons come back in `taxExplanation`.
   */
  taxMode: z.enum(['rates', 'auto']).optional(),
  supplyType: z.enum(['goods', 'services', 'digital']).optional(),
  placeOfSupply: placeOfSupply.nullish(),
  reverseCharge: z.boolean().optional(),
  /** Default: the issue date when issued. */
  issueDate: date.nullish(),
  /** An explicit due date, or `paymentTermsDays` from the issue date; absent for both: the profile's default terms. */
  dueDate: date.nullish(),
  paymentTermsDays: z.number().int().min(0).max(365).nullish(),
  /** The buyer's purchase-order number or any reference printed on the invoice. */
  reference: z.string().trim().max(191).nullish(),
  discount: invoiceDiscountSchema.nullish(),
  /** Major units; never discounted or taxed. */
  shipping: invoiceMoneySchema.nullish(),
  notes: z.string().trim().max(INVOICE_NOTES_MAX).nullish(),
  /** Default: the profile's terms. */
  terms: z.string().trim().max(INVOICE_TERMS_MAX).nullish(),
  legalNotes: z.string().trim().max(1000).nullish(),
  lines: z.array(invoiceLineInputSchema).min(1).max(INVOICE_MAX_LINES),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

/**
 * A draft is edited whole (absent keeps, `null` clears where a field can be empty; `lines` replaces every line). Once issued, the
 * amounts, lines, buyer name and numbering are frozen (409 INV_NOT_DRAFT), and only the fields marked below can still move.
 */
export const updateInvoiceSchema = z.object({
  docType: invoiceCreatableDocTypeSchema.optional(),
  buyerName: buyerShape.buyerName,
  /** Still editable after issue. */
  buyerEmail: buyerShape.buyerEmail,
  /** Still editable after issue. */
  buyerPhone: buyerShape.buyerPhone,
  buyerAddress: buyerShape.buyerAddress,
  buyerTaxId: buyerShape.buyerTaxId,
  buyerCountry: buyerShape.buyerCountry,
  /** Still editable after issue. */
  contactId: uuidSchema.nullish(),
  companyId: uuidSchema.nullish(),
  dealId: uuidSchema.nullish(),
  /** Still editable after issue. */
  ownerId: uuidSchema.nullish(),
  currency: currency.optional(),
  taxRegime: regime.optional(),
  taxMode: z.enum(['rates', 'auto']).optional(),
  supplyType: z.enum(['goods', 'services', 'digital']).optional(),
  placeOfSupply: placeOfSupply.nullish(),
  reverseCharge: z.boolean().optional(),
  issueDate: date.nullish(),
  /** Still editable after issue (extend or shorten the terms). */
  dueDate: date.nullish(),
  paymentTermsDays: z.number().int().min(0).max(365).nullish(),
  /** Still editable after issue. */
  reference: z.string().trim().max(191).nullish(),
  discount: invoiceDiscountSchema.nullish(),
  shipping: invoiceMoneySchema.nullish(),
  /** Still editable after issue. */
  notes: z.string().trim().max(INVOICE_NOTES_MAX).nullish(),
  /** Still editable after issue. */
  terms: z.string().trim().max(INVOICE_TERMS_MAX).nullish(),
  legalNotes: z.string().trim().max(1000).nullish(),
  lines: z.array(invoiceLineInputSchema).min(1).max(INVOICE_MAX_LINES).optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;

/** Issue a draft: allocates the number, mints the public link, freezes the document. */
export const issueInvoiceSchema = z.object({
  /** Default today in the workspace calendar. */
  issueDate: date.nullish(),
  dueDate: date.nullish(),
  paymentTermsDays: z.number().int().min(0).max(365).nullish(),
  rowVersion: z.number().int().positive().optional(),
});
export type IssueInvoiceInput = z.infer<typeof issueInvoiceSchema>;

export const INVOICE_SEND_CHANNELS = ['link', 'email', 'whatsapp'] as const;
export const sendInvoiceSchema = z.object({
  /** `link` records that the staff member shared the public link themselves; `email` and `whatsapp` raise the delivery event. */
  channel: z.enum(INVOICE_SEND_CHANNELS).default('link'),
  message: z.string().trim().max(1000).nullish(),
});
export type SendInvoiceInput = z.infer<typeof sendInvoiceSchema>;

export const voidInvoiceSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  rowVersion: z.number().int().positive().optional(),
});
export type VoidInvoiceInput = z.infer<typeof voidInvoiceSchema>;

/** Regenerate gives the invoice a new link (the old one stops working); `revoke` only turns the current one off. */
export const publicLinkSchema = z.object({
  /** Days the new link lives; absent for no expiry. */
  expiresInDays: z.number().int().min(1).max(3650).nullish(),
});
export type PublicLinkInput = z.infer<typeof publicLinkSchema>;

// --- responses -------------------------------------------------------------------------------------------------------------

const amountStrings = z.object({
  subtotal: z.string(),
  discount: z.string(),
  shipping: z.string(),
  tax: z.string(),
  /** The part of `tax` that is added on top of the prices (exclusive); an inclusive tax is already inside them. */
  taxAdded: z.string(),
  total: z.string(),
  paid: z.string(),
  refunded: z.string(),
  /** total - credited - paid, never below 0 (an over-payment shows as `credit`). */
  balance: z.string(),
  /** paid + credited - total when more was received or credited than the invoice asks for; "0" otherwise. */
  credit: z.string(),
  /** The total of the issued credit notes against the invoice. */
  credited: z.string(),
});
export const invoiceAmountsSchema = amountStrings;
export type InvoiceAmounts = z.infer<typeof invoiceAmountsSchema>;

const userRef = z.object({ id: uuidSchema, name: z.string() });

export const invoiceLineResponseSchema = z.object({
  id: uuidSchema,
  position: z.number().int(),
  description: z.string(),
  sku: z.string().nullable(),
  hsnSac: z.string().nullable(),
  qty: z.string(),
  unitPrice: z.string(),
  discount: invoiceDiscountSchema.nullable(),
  taxRateId: uuidSchema.nullable(),
  taxName: z.string().nullable(),
  taxType: taxTypeSchema.nullable(),
  /** Percent. */
  taxRate: z.string(),
  taxInclusive: z.boolean(),
  taxComponents: z.array(taxComponentSchema.extend({ amount: z.string() })).nullable(),
  amounts: z.object({
    gross: z.string(),
    discount: z.string(),
    net: z.string(),
    docDiscountShare: z.string(),
    tax: z.string(),
    total: z.string(),
  }),
});
export type InvoiceLineResponse = z.infer<typeof invoiceLineResponseSchema>;

export const invoiceTaxSummaryRowSchema = z.object({
  name: z.string(),
  type: taxTypeSchema.nullable(),
  rate: z.string(),
  inclusive: z.boolean(),
  /** The taxable amount, tax excluded. */
  base: z.string(),
  tax: z.string(),
  components: z.array(taxComponentSchema.extend({ amount: z.string() })).nullable(),
});
export type InvoiceTaxSummaryRow = z.infer<typeof invoiceTaxSummaryRowSchema>;

export const invoiceSellerSchema = z.object({
  name: z.string().nullable(),
  address: z.string().nullable(),
  country: z.string().nullable(),
  state: z.string().nullable(),
  taxId: z.string().nullable(),
  registrationNo: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  /** Free statutory fields the workspace prints (label and value). */
  extra: z.array(z.object({ label: z.string(), value: z.string() })),
  bankDetails: z.record(z.string()).nullable(),
});
export type InvoiceSeller = z.infer<typeof invoiceSellerSchema>;

export const invoiceLinkStateSchema = z.object({
  /** The unguessable token the buyer's link carries; shown to staff so the link can be copied again. */
  token: z.string(),
  /** `/i/<token>` on the web app. */
  path: z.string(),
  expiresAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  /** False when revoked or expired: the buyer sees a "link unavailable" page. */
  active: z.boolean(),
});
export type InvoiceLinkState = z.infer<typeof invoiceLinkStateSchema>;

/** What a list row carries (no lines). */
export const invoiceSummarySchema = z.object({
  id: uuidSchema,
  /** Null for a draft. */
  number: z.string().nullable(),
  docType: invoiceDocTypeSchema,
  source: invoiceSourceSchema,
  /** The derived status the tabs and badges show. */
  status: invoiceStatusSchema,
  storedStatus: invoiceStoredStatusSchema,
  paymentStatus: invoicePaymentStatusSchema,
  overdue: z.boolean(),
  /** Calendar days past the due date while open and overdue; null otherwise. */
  daysOverdue: z.number().int().nullable(),
  currency: z.string(),
  currencyExponent: z.number().int(),
  amounts: amountStrings,
  amountsMinor: amountStrings,
  buyerName: z.string().nullable(),
  buyerEmail: z.string().nullable(),
  contact: z.object({ id: uuidSchema, name: z.string().nullable() }).nullable(),
  company: z.object({ id: uuidSchema, name: z.string().nullable() }).nullable(),
  deal: z.object({ id: uuidSchema, title: z.string() }).nullable(),
  owner: userRef.nullable(),
  issueDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  issuedAt: z.string().datetime().nullable(),
  paidAt: z.string().datetime().nullable(),
  sentAt: z.string().datetime().nullable(),
  viewCount: z.number().int(),
  reference: z.string().nullable(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type InvoiceSummary = z.infer<typeof invoiceSummarySchema>;

export const invoiceResponseSchema = invoiceSummarySchema.extend({
  buyer: z.object({
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    address: z.string().nullable(),
    taxId: z.string().nullable(),
    country: z.string().nullable(),
  }),
  seller: invoiceSellerSchema.nullable(),
  taxRegime: z.string(),
  placeOfSupply: z.string().nullable(),
  reverseCharge: z.boolean(),
  legalNotes: z.string().nullable(),
  /** "Why this tax?": what the tax engine decided for an `auto` invoice (null for `rates`). */
  taxExplanation: z
    .object({
      reasons: z.array(z.string()),
      warnings: z.array(z.string()),
      documentNotes: z.array(z.string()),
      taxFree: z.boolean(),
    })
    .nullable(),
  discount: invoiceDiscountSchema.nullable(),
  notes: z.string().nullable(),
  terms: z.string().nullable(),
  lines: z.array(invoiceLineResponseSchema),
  taxSummary: z.array(invoiceTaxSummaryRowSchema),
  /** The accepted proposal or estimate the invoice was made from (`kind` picks its page). */
  quote: z.object({ id: uuidSchema, number: z.string(), kind: z.enum(['proposal', 'estimate']) }).nullable(),
  /** The sales order this invoice bills (a partial invoice of it). */
  salesOrder: z.object({ id: uuidSchema, number: z.string() }).nullable(),
  /** The recurring schedule that made this invoice. */
  recurring: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  createdBy: userRef.nullable(),
  publicLink: invoiceLinkStateSchema.nullable(),
  deliveryChannel: z.string().nullable(),
  firstViewedAt: z.string().datetime().nullable(),
  lastViewedAt: z.string().datetime().nullable(),
  voidedAt: z.string().datetime().nullable(),
  voidReason: z.string().nullable(),
});
export type InvoiceResponse = z.infer<typeof invoiceResponseSchema>;

export const invoicePageResponseSchema = z.object({
  data: z.array(invoiceSummarySchema),
  page: pageInfoSchema,
});
export type InvoicePageResponse = z.infer<typeof invoicePageResponseSchema>;

// --- list, counts ----------------------------------------------------------------------------------------------------------

const filterShape = {
  /** Number, buyer name or reference. */
  q: z.string().trim().min(1).max(100).optional(),
  docType: queryList(invoiceDocTypeSchema).optional(),
  contactId: uuidSchema.optional(),
  companyId: uuidSchema.optional(),
  dealId: uuidSchema.optional(),
  ownerId: uuidSchema.optional(),
  /** Owned by the caller. */
  mine: queryBoolean().optional(),
  currency: currency.optional(),
  issuedFrom: date.optional(),
  issuedTo: date.optional(),
  dueFrom: date.optional(),
  dueTo: date.optional(),
};

export const listInvoicesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(512).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  /** Derived statuses, comma separated: `status=issued,partially_paid`. */
  status: queryList(invoiceStatusSchema).optional(),
  ...filterShape,
});
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;

/** Counts take every filter except the status (the tabs show how many each status would hold). */
export const invoiceCountsQuerySchema = z.object(filterShape);
export type InvoiceCountsQuery = z.infer<typeof invoiceCountsQuerySchema>;

export const invoiceCountsResponseSchema = z.object({
  all: z.number().int(),
  draft: z.number().int(),
  issued: z.number().int(),
  partiallyPaid: z.number().int(),
  paid: z.number().int(),
  overdue: z.number().int(),
  void: z.number().int(),
  /** Open balance of the invoices in the filter, per currency (issued, partly paid and overdue). */
  outstanding: z.array(moneyTotalSchema),
  /** Of which past due. */
  overdueAmount: z.array(moneyTotalSchema),
});
export type InvoiceCountsResponse = z.infer<typeof invoiceCountsResponseSchema>;

/** The invoices of one contact or deal, for their detail pages, with the money rolled up per currency. */
export const linkedInvoicesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(512).optional(),
  status: queryList(invoiceStatusSchema).optional(),
});
export type LinkedInvoicesQuery = z.infer<typeof linkedInvoicesQuerySchema>;

export const linkedInvoicesResponseSchema = z.object({
  data: z.array(invoiceSummarySchema),
  page: pageInfoSchema,
  totals: z.object({
    invoiced: z.array(moneyTotalSchema),
    paid: z.array(moneyTotalSchema),
    outstanding: z.array(moneyTotalSchema),
    overdue: z.array(moneyTotalSchema),
  }),
});
export type LinkedInvoicesResponse = z.infer<typeof linkedInvoicesResponseSchema>;

// --- timeline --------------------------------------------------------------------------------------------------------------

export const INVOICE_EVENT_TYPES = [
  'created',
  'edited',
  'issued',
  'sent',
  'viewed',
  'payment_recorded',
  'payment_refunded',
  'paid',
  'overdue',
  'voided',
  'link_regenerated',
  'link_revoked',
  'pay_attempt',
  'credit_note_issued',
] as const;

export const invoiceEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  detail: z.string().nullable(),
  actor: z.object({
    kind: z.enum(['user', 'buyer', 'gateway', 'system']),
    user: userRef.nullable(),
  }),
  meta: z.record(z.unknown()).nullable(),
  at: z.string().datetime(),
});
export type InvoiceEvent = z.infer<typeof invoiceEventSchema>;

export const invoiceEventsResponseSchema = z.object({
  data: z.array(invoiceEventSchema),
  page: pageInfoSchema,
});
export type InvoiceEventsResponse = z.infer<typeof invoiceEventsResponseSchema>;

export const invoiceEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(512).optional(),
});
export type InvoiceEventsQuery = z.infer<typeof invoiceEventsQuerySchema>;
