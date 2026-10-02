import { z } from 'zod';
import { uuidSchema, emailSchema, phoneSchema } from '../common/ids';
import { pageInfoSchema } from '../common/pagination';
import { queryBoolean, queryList } from '../contacts-attributes-tags/query-helpers';
import { moneyTotalSchema } from '../deals-pipelines/money';
import { SALES_DOC_MAX_LINES } from './money';

/**
 * Proposals and estimates (TW-PROP / TW-EST): one engine, one `kind` filter. A document is a numbered, priced offer to a buyer that
 * moves draft -> sent -> viewed -> accepted | declined | expired -> converted. Money crosses the wire as strings: `*Minor` fields
 * are whole minor units of `currency`, the others decimal strings in major units; quantities and rates are decimal strings too.
 * The math is `computeSalesDoc` in ./money (the form preview uses the same function).
 */

export const SALES_DOC_KINDS = ['proposal', 'estimate'] as const;
export const salesDocKindSchema = z.enum(SALES_DOC_KINDS);
export type SalesDocKind = z.infer<typeof salesDocKindSchema>;

/**
 * draft: being written; sent: out with the buyer; viewed: the buyer opened the link; accepted / declined: decided (by the buyer,
 * or recorded by staff); expired: valid-until passed while open; converted: turned into an invoice.
 */
export const SALES_DOC_STATUSES = [
  'draft',
  'sent',
  'viewed',
  'accepted',
  'declined',
  'expired',
  'converted',
] as const;
export const salesDocStatusSchema = z.enum(SALES_DOC_STATUSES);
export type SalesDocStatus = z.infer<typeof salesDocStatusSchema>;

export const SALES_DOC_SOURCES = ['manual', 'ai', 'api'] as const;
export const salesDocSourceSchema = z.enum(SALES_DOC_SOURCES);
export type SalesDocSource = z.infer<typeof salesDocSourceSchema>;

export const SALES_DOC_TITLE_MAX = 255;
export const SALES_DOC_NOTES_MAX = 5000;
export const SALES_DOC_TERMS_MAX = 10000;
export const SALES_DOC_LINE_DESCRIPTION_MAX = 500;

// --- request pieces --------------------------------------------------------------------------------------------------------

const decimal = (max: number, scale: number) =>
  z
    .string()
    .trim()
    .regex(
      new RegExp(`^\\d{1,${max}}(\\.\\d{1,${scale}})?$`),
      `a non-negative decimal with at most ${scale} decimals`,
    );

/** Major units, up to 3 decimals typed (the currency decides how many it may keep). */
export const salesDocMoneySchema = decimal(12, 4);
/** Quantity, up to 4 decimals. */
export const salesDocQtySchema = decimal(8, 4);
/** A percent with two decimals: "18", "18.5". Range is checked with the rest of the math (0 to 100). */
export const salesDocPercentSchema = decimal(3, 2);

export const salesDocDiscountSchema = z.object({
  kind: z.enum(['percent', 'amount']),
  /** Percent (0 to 100) or an amount in major units of the document currency. */
  value: salesDocMoneySchema,
});
export type SalesDocDiscount = z.infer<typeof salesDocDiscountSchema>;

export const salesDocLineInputSchema = z.object({
  description: z.string().trim().min(1).max(SALES_DOC_LINE_DESCRIPTION_MAX),
  qty: salesDocQtySchema.default('1'),
  unitPrice: salesDocMoneySchema,
  /** Per-line discount; null or absent for none. */
  discount: salesDocDiscountSchema.nullish(),
  /** Percent; null or absent follows the document's tax rate. */
  taxRate: salesDocPercentSchema.nullish(),
});
export type SalesDocLineInput = z.infer<typeof salesDocLineInputSchema>;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD');
const currency = z
  .string()
  .trim()
  .length(3)
  .transform((v) => v.toUpperCase())
  .refine((v) => /^[A-Z]{3}$/.test(v), 'currency must be a 3-letter ISO code');

const buyerShape = {
  /** Default: the linked contact's. */
  buyerName: z.string().trim().max(255).nullish(),
  buyerEmail: emailSchema.nullish(),
  buyerPhone: phoneSchema.nullish(),
};

export const createSalesDocSchema = z.object({
  kind: salesDocKindSchema,
  title: z.string().trim().max(SALES_DOC_TITLE_MAX).nullish(),
  ...buyerShape,
  contactId: uuidSchema.nullish(),
  companyId: uuidSchema.nullish(),
  dealId: uuidSchema.nullish(),
  /** An active member; default the caller. */
  ownerId: uuidSchema.nullish(),
  /** ISO 4217; default the workspace's (settings currency, else its default pipeline's, else USD). Fixed while the document is draft. */
  currency: currency.optional(),
  /** Percent, the default rate of every line that names none. Default "0". */
  taxRate: salesDocPercentSchema.nullish(),
  discount: salesDocDiscountSchema.nullish(),
  validUntil: date.nullish(),
  notes: z.string().trim().max(SALES_DOC_NOTES_MAX).nullish(),
  terms: z.string().trim().max(SALES_DOC_TERMS_MAX).nullish(),
  /** Start from a template's terms, notes and validity; named fields win. Default: the default template of the kind. */
  templateId: uuidSchema.nullish(),
  lines: z.array(salesDocLineInputSchema).min(1).max(SALES_DOC_MAX_LINES),
});
export type CreateSalesDocInput = z.infer<typeof createSalesDocSchema>;

/** A draft is edited whole: absent keeps, `null` clears (where a field can be empty); `lines` replaces every line. */
export const updateSalesDocSchema = z.object({
  title: z.string().trim().max(SALES_DOC_TITLE_MAX).nullish(),
  ...buyerShape,
  contactId: uuidSchema.nullish(),
  companyId: uuidSchema.nullish(),
  dealId: uuidSchema.nullish(),
  ownerId: uuidSchema.nullish(),
  currency: currency.optional(),
  taxRate: salesDocPercentSchema.nullish(),
  discount: salesDocDiscountSchema.nullish(),
  validUntil: date.nullish(),
  notes: z.string().trim().max(SALES_DOC_NOTES_MAX).nullish(),
  terms: z.string().trim().max(SALES_DOC_TERMS_MAX).nullish(),
  lines: z.array(salesDocLineInputSchema).min(1).max(SALES_DOC_MAX_LINES).optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateSalesDocInput = z.infer<typeof updateSalesDocSchema>;

// --- responses -------------------------------------------------------------------------------------------------------------

export const salesDocLineSchema = z.object({
  position: z.number().int(),
  description: z.string(),
  qty: z.string(),
  unitPrice: z.string(),
  unitPriceMinor: z.string(),
  discount: salesDocDiscountSchema.nullable(),
  /** The line's own rate; null follows the document's. */
  taxRate: z.string().nullable(),
  /** The rate actually applied. */
  effectiveTaxRate: z.string(),
  grossMinor: z.string(),
  discountMinor: z.string(),
  /** Gross less the line discount: the line total before the document discount and tax. */
  netMinor: z.string(),
  taxMinor: z.string(),
});
export type SalesDocLine = z.infer<typeof salesDocLineSchema>;

export const salesDocTotalsSchema = z.object({
  subtotalMinor: z.string(),
  /** The document-level discount only (line discounts are inside the lines). */
  discountMinor: z.string(),
  taxMinor: z.string(),
  totalMinor: z.string(),
  subtotal: z.string(),
  discount: z.string(),
  tax: z.string(),
  total: z.string(),
});
export type SalesDocTotals = z.infer<typeof salesDocTotalsSchema>;

const personRef = z.object({ id: uuidSchema, name: z.string() });

/** What the caller may do next, from the status alone (the permission check is separate). */
export const salesDocActionsSchema = z.object({
  edit: z.boolean(),
  send: z.boolean(),
  /** Staff accept / decline on the buyer's behalf. */
  decide: z.boolean(),
  revise: z.boolean(),
  extend: z.boolean(),
  convertInvoice: z.boolean(),
  convertDeal: z.boolean(),
  delete: z.boolean(),
});
export type SalesDocActions = z.infer<typeof salesDocActionsSchema>;

export const salesDocSummarySchema = z.object({
  id: uuidSchema,
  kind: salesDocKindSchema,
  number: z.string(),
  status: salesDocStatusSchema,
  title: z.string().nullable(),
  buyerName: z.string().nullable(),
  contact: z.object({ id: uuidSchema, name: z.string().nullable() }).nullable(),
  company: personRef.nullable(),
  deal: z.object({ id: uuidSchema, title: z.string() }).nullable(),
  owner: personRef.nullable(),
  currency: z.string(),
  totals: salesDocTotalsSchema,
  validUntil: z.string().nullable(),
  /** Open (sent or viewed) and past its valid-until date, whether or not the sweep has marked it yet. */
  overdue: z.boolean(),
  sentAt: z.string().datetime().nullable(),
  firstViewedAt: z.string().datetime().nullable(),
  decidedAt: z.string().datetime().nullable(),
  revision: z.number().int(),
  source: salesDocSourceSchema,
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SalesDocSummary = z.infer<typeof salesDocSummarySchema>;

export const salesDocLinkStateSchema = z.object({
  /** Reachable by the buyer: not revoked, not past its expiry, and the document is out (not a draft). */
  active: z.boolean(),
  expiresAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  viewCount: z.number().int(),
  lastViewedAt: z.string().datetime().nullable(),
});

export const salesDocResponseSchema = salesDocSummarySchema.extend({
  buyer: z.object({
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
  }),
  exponent: z.number().int(),
  /** The document's default tax rate, a percent. */
  taxRate: z.string(),
  discount: salesDocDiscountSchema.nullable(),
  lines: z.array(salesDocLineSchema),
  notes: z.string().nullable(),
  terms: z.string().nullable(),
  acceptedRevision: z.number().int().nullable(),
  duplicatedFromId: uuidSchema.nullable(),
  invoice: z.object({ id: uuidSchema }).nullable(),
  createdBy: personRef.nullable(),
  link: salesDocLinkStateSchema,
  actions: salesDocActionsSchema,
});
export type SalesDocResponse = z.infer<typeof salesDocResponseSchema>;

export const salesDocPageResponseSchema = z.object({
  data: z.array(salesDocSummarySchema),
  page: pageInfoSchema,
});
export type SalesDocPageResponse = z.infer<typeof salesDocPageResponseSchema>;

// --- list, counts ----------------------------------------------------------------------------------------------------------

const salesDocFilterShape = {
  kind: salesDocKindSchema.optional(),
  /** Number, title, and the linked contact's or company's name. Buyer fields are encrypted and not searched. */
  q: z.string().trim().min(1).max(100).optional(),
  contactId: uuidSchema.optional(),
  companyId: uuidSchema.optional(),
  dealId: uuidSchema.optional(),
  ownerId: uuidSchema.optional(),
  /** Owned by the caller. */
  mine: queryBoolean().optional(),
  currency: currency.optional(),
  /** Valid-until window, inclusive dates (the calendar reads this). */
  validFrom: date.optional(),
  validTo: date.optional(),
};

export const listSalesDocsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(512).optional(),
  status: queryList(salesDocStatusSchema).optional(),
  ...salesDocFilterShape,
});
export type ListSalesDocsQuery = z.infer<typeof listSalesDocsQuerySchema>;

/** The documents of one contact or deal (the id is in the path). */
export const listLinkedSalesDocsQuerySchema = listSalesDocsQuerySchema.omit({
  contactId: true,
  dealId: true,
});
export type ListLinkedSalesDocsQuery = z.infer<typeof listLinkedSalesDocsQuerySchema>;

export const salesDocCountsQuerySchema = z.object({ ...salesDocFilterShape });
export type SalesDocCountsQuery = z.infer<typeof salesDocCountsQuerySchema>;

export const salesDocCountsResponseSchema = z.object({
  total: z.number().int(),
  byStatus: z.object({
    draft: z.number().int(),
    sent: z.number().int(),
    viewed: z.number().int(),
    accepted: z.number().int(),
    declined: z.number().int(),
    expired: z.number().int(),
    converted: z.number().int(),
  }),
  /** Sent, viewed and accepted-not-yet-converted documents: the "open value" tile, one total per currency. */
  openValue: z.array(moneyTotalSchema),
});
export type SalesDocCountsResponse = z.infer<typeof salesDocCountsResponseSchema>;

// --- transitions -----------------------------------------------------------------------------------------------------------

export const SEND_CHANNELS = ['email', 'whatsapp', 'link'] as const;
export const salesDocSendChannelSchema = z.enum(SEND_CHANNELS);
export type SalesDocSendChannel = z.infer<typeof salesDocSendChannelSchema>;

/**
 * `email`: mails the link to the buyer now (the buyer's address, or `to`). `whatsapp`: asks the messaging side to deliver it (an outbox
 * event; the document is marked sent). `link`: the caller shares the link themselves (copy-link): the document is marked sent.
 */
export const sendSalesDocSchema = z.object({
  channel: salesDocSendChannelSchema,
  /** Email address (email) or E.164 number (whatsapp); default the buyer's. */
  to: z.string().trim().max(255).optional(),
  /** A line added above the link. */
  message: z.string().trim().max(2000).optional(),
  rowVersion: z.number().int().positive().optional(),
});
export type SendSalesDocInput = z.infer<typeof sendSalesDocSchema>;

export const salesDocShareLinkSchema = z.object({
  token: z.string(),
  /** `/q/<token>` on the web app. */
  path: z.string(),
  /** The absolute link on the configured web origin. */
  url: z.string(),
  active: z.boolean(),
  expiresAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
});
export type SalesDocShareLink = z.infer<typeof salesDocShareLinkSchema>;

export const sendSalesDocResponseSchema = z.object({
  document: salesDocResponseSchema,
  delivery: z.object({
    channel: salesDocSendChannelSchema,
    /** `sent`: the mail went out; `queued`: handed to the messaging side; `shared`: marked sent, the caller shares the link. */
    status: z.enum(['sent', 'queued', 'shared']),
    to: z.string().nullable(),
  }),
  link: salesDocShareLinkSchema,
});
export type SendSalesDocResponse = z.infer<typeof sendSalesDocResponseSchema>;

/** Staff accepting or declining on the buyer's behalf (a signed copy, a phone call): recorded as such in the timeline. */
export const staffDecisionSchema = z.object({
  note: z.string().trim().max(1000).optional(),
  rowVersion: z.number().int().positive().optional(),
});
export type StaffDecisionInput = z.infer<typeof staffDecisionSchema>;

export const reviseSalesDocSchema = z.object({
  rowVersion: z.number().int().positive().optional(),
});
export type ReviseSalesDocInput = z.infer<typeof reviseSalesDocSchema>;

/** A new valid-until date on an open or expired document; an expired one is open again. */
export const extendSalesDocSchema = z.object({
  validUntil: date,
  rowVersion: z.number().int().positive().optional(),
});
export type ExtendSalesDocInput = z.infer<typeof extendSalesDocSchema>;

/** A new link (the old one stops working at once); optionally with its own expiry in days (null: no expiry of its own). */
export const regenerateLinkSchema = z.object({
  expiresInDays: z.number().int().min(1).max(3650).nullish(),
});
export type RegenerateLinkInput = z.infer<typeof regenerateLinkSchema>;

export const duplicateSalesDocSchema = z.object({
  /** Duplicate into the other kind (a proposal that becomes an estimate). Default: the same kind. */
  kind: salesDocKindSchema.optional(),
});
export type DuplicateSalesDocInput = z.infer<typeof duplicateSalesDocSchema>;

export const convertToDealSchema = z.object({
  title: z.string().trim().min(1).max(191).optional(),
  pipelineId: uuidSchema.optional(),
  stageId: uuidSchema.optional(),
});
export type ConvertToDealInput = z.infer<typeof convertToDealSchema>;

export const convertToDealResponseSchema = z.object({
  document: salesDocResponseSchema,
  deal: z.object({ id: uuidSchema, title: z.string() }),
});
export type ConvertToDealResponse = z.infer<typeof convertToDealResponseSchema>;

// --- timeline and revisions ------------------------------------------------------------------------------------------------

export const SALES_DOC_EVENT_TYPES = [
  'created',
  'edited',
  'duplicated',
  'sent',
  'viewed',
  'accepted',
  'declined',
  'expired',
  'revised',
  'extended',
  'converted_invoice',
  'converted_deal',
  'link_regenerated',
  'link_revoked',
] as const;
export const salesDocEventTypeSchema = z.enum(SALES_DOC_EVENT_TYPES);
export type SalesDocEventType = z.infer<typeof salesDocEventTypeSchema>;

export const salesDocEventSchema = z.object({
  id: uuidSchema,
  type: salesDocEventTypeSchema,
  actor: z.object({ kind: z.enum(['user', 'buyer', 'system']), user: personRef.nullable() }),
  fromStatus: salesDocStatusSchema.nullable(),
  toStatus: salesDocStatusSchema.nullable(),
  revision: z.number().int(),
  channel: z.string().nullable(),
  /** Buyer evidence (encrypted at rest): who signed, from where. */
  signerName: z.string().nullable(),
  signerEmail: z.string().nullable(),
  hasSignature: z.boolean(),
  comment: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  meta: z.record(z.unknown()),
  createdAt: z.string().datetime(),
});
export type SalesDocEvent = z.infer<typeof salesDocEventSchema>;

export const salesDocEventDetailSchema = salesDocEventSchema.extend({
  /** The drawn signature as a PNG data URL. */
  signature: z.string().nullable(),
});

export const listSalesDocEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().min(1).max(512).optional(),
});
export type ListSalesDocEventsQuery = z.infer<typeof listSalesDocEventsQuerySchema>;

export const salesDocRevisionSchema = z.object({
  revision: z.number().int(),
  status: salesDocStatusSchema,
  totalMinor: z.string(),
  createdBy: personRef.nullable(),
  createdAt: z.string().datetime(),
});
export type SalesDocRevision = z.infer<typeof salesDocRevisionSchema>;

export const salesDocRevisionDetailSchema = salesDocRevisionSchema.extend({
  snapshot: z.object({
    title: z.string().nullable(),
    currency: z.string(),
    taxRate: z.string(),
    discount: salesDocDiscountSchema.nullable(),
    validUntil: z.string().nullable(),
    notes: z.string().nullable(),
    terms: z.string().nullable(),
    lines: z.array(salesDocLineSchema),
    totals: salesDocTotalsSchema,
  }),
});
export type SalesDocRevisionDetail = z.infer<typeof salesDocRevisionDetailSchema>;
