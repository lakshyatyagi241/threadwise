import { z } from 'zod';
import {
  parseMajor as contractParseMajor,
  parsePercentBp,
  publicSalesDocSchema,
  salesDocCountsResponseSchema,
  salesDocEventSchema,
  salesDocResponseSchema,
  salesDocSummarySchema,
  type SalesDocActions,
  type SalesDocEventType,
  type SalesDocLine,
  type SalesDocKind,
} from '@crm/contracts';
import { isKind } from '../lib/kinds';
import { normalizeStatus, type DocStatus } from '../lib/status';
import type { DocDiscount } from '../lib/totals';

/**
 * The view models the screens work with, and the one place that turns the `@crm/contracts` (sales-docs) wire shapes into them.
 * On the wire money is strings (`*Minor` fields are whole minor units, the rest major-unit decimals) and rates are percent
 * strings; the screens hold integer minor units and basis points so the pricing function and the table can use them directly.
 * Components never touch a wire shape.
 */

const toNumber = (s: string): number => Number(s);
const bp = (percent: string): number => parsePercentBp(percent) ?? 0;

export interface Ref {
  id: string;
  name: string;
}

/** A line's discount, as the form and the sheet use it. */
function discountOf(
  d: { kind: 'percent' | 'amount'; value: string } | null,
  currency: string,
): DocDiscount {
  if (!d) return null;
  if (d.kind === 'percent') {
    const v = bp(d.value);
    return v > 0 ? { kind: 'percent', bp: v } : null;
  }
  const minor = contractParseMajor(d.value, currency);
  return minor !== null && minor > 0n ? { kind: 'amount', minor: Number(minor) } : null;
}

export interface DocItem {
  id: string;
  description: string;
  /** Decimal string, up to 4 decimals. */
  qty: string;
  unitPriceMinor: number;
  discount: DocDiscount;
  /** The line's own tax rate in basis points; null follows the document's. */
  taxRateBp: number | null;
  /** The rate actually applied. */
  effectiveTaxBp: number;
  /** As the server priced it. */
  grossMinor: number;
  discountMinor: number;
  netMinor: number;
  taxMinor: number;
}

function itemOf(l: SalesDocLine, currency: string): DocItem {
  return {
    id: `l${l.position}`,
    description: l.description,
    qty: l.qty,
    unitPriceMinor: toNumber(l.unitPriceMinor),
    discount: discountOf(l.discount, currency),
    taxRateBp: l.taxRate === null ? null : bp(l.taxRate),
    effectiveTaxBp: bp(l.effectiveTaxRate),
    grossMinor: toNumber(l.grossMinor),
    discountMinor: toNumber(l.discountMinor),
    netMinor: toNumber(l.netMinor),
    taxMinor: toNumber(l.taxMinor),
  };
}

/** What the list, the panels and the row menu need. */
export interface DocRow {
  id: string;
  kind: SalesDocKind;
  number: string;
  status: DocStatus;
  title: string;
  buyerName: string;
  contact: Ref | null;
  company: Ref | null;
  deal: Ref | null;
  owner: Ref | null;
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  validUntil: string | null;
  /** Open and past its valid-until date, whether or not the sweep has marked it expired yet. */
  overdue: boolean;
  sentAt: string | null;
  firstViewedAt: string | null;
  decidedAt: string | null;
  revision: number;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

const ref = (r: { id: string; name: string | null } | null): Ref | null =>
  r ? { id: r.id, name: r.name ?? '' } : null;

type Summary = z.infer<typeof salesDocSummarySchema>;

function rowOf(s: Summary): DocRow {
  return {
    id: s.id,
    kind: isKind(s.kind) ? s.kind : 'proposal',
    number: s.number,
    status: normalizeStatus(s.status),
    title: s.title ?? '',
    buyerName: s.buyerName ?? '',
    contact: ref(s.contact),
    company: ref(s.company),
    deal: s.deal ? { id: s.deal.id, name: s.deal.title } : null,
    owner: ref(s.owner),
    currency: s.currency.toUpperCase(),
    subtotalMinor: toNumber(s.totals.subtotalMinor),
    discountMinor: toNumber(s.totals.discountMinor),
    taxMinor: toNumber(s.totals.taxMinor),
    totalMinor: toNumber(s.totals.totalMinor),
    validUntil: s.validUntil ? s.validUntil.slice(0, 10) : null,
    overdue: s.overdue,
    sentAt: s.sentAt,
    firstViewedAt: s.firstViewedAt,
    decidedAt: s.decidedAt,
    revision: s.revision,
    rowVersion: s.rowVersion,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export interface Buyer {
  name: string;
  email: string;
  phone: string;
}

export interface LinkState {
  active: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
}

/** The whole document: the row plus the buyer, the lines, the terms, the link and what its status allows next. */
export interface SalesDoc extends DocRow {
  buyer: Buyer;
  exponent: number;
  /** The document's default tax rate in basis points. */
  defaultTaxBp: number;
  discount: DocDiscount;
  items: DocItem[];
  notes: string;
  terms: string;
  acceptedRevision: number | null;
  invoice: { id: string } | null;
  createdBy: Ref | null;
  link: LinkState;
  /** From the server, by status alone; permissions are separate. */
  actions: SalesDocActions;
}

type Full = z.infer<typeof salesDocResponseSchema>;

export function mapSalesDoc(w: Full): SalesDoc {
  const row = rowOf(w);
  return {
    ...row,
    buyer: { name: w.buyer.name ?? '', email: w.buyer.email ?? '', phone: w.buyer.phone ?? '' },
    exponent: w.exponent,
    defaultTaxBp: bp(w.taxRate),
    discount: discountOf(w.discount, row.currency),
    items: w.lines.map((l) => itemOf(l, row.currency)),
    notes: w.notes ?? '',
    terms: w.terms ?? '',
    acceptedRevision: w.acceptedRevision,
    invoice: w.invoice,
    createdBy: ref(w.createdBy),
    link: w.link,
    actions: w.actions,
  };
}

export const salesDocSchema = salesDocResponseSchema.transform(mapSalesDoc);

export const docRowPageSchema = z
  .object({
    data: z.array(salesDocSummarySchema),
    page: z.object({
      nextCursor: z.string().nullable(),
      hasMore: z.boolean(),
      limit: z.number().optional(),
    }),
  })
  .transform((r) => ({
    docs: r.data.map(rowOf),
    nextCursor: r.page.nextCursor,
    hasMore: r.page.hasMore,
  }));

// --- counts -------------------------------------------------------------------------------------------------------------

export interface DocCounts {
  all: number;
  draft: number;
  sent: number;
  viewed: number;
  accepted: number;
  declined: number;
  expired: number;
  converted: number;
  openValue: Array<{ currency: string; minor: number }>;
}

export const docCountsSchema = salesDocCountsResponseSchema.transform((c): DocCounts => ({
  all: c.total,
  ...c.byStatus,
  openValue: c.openValue.map((v) => ({
    currency: v.currency.toUpperCase(),
    minor: Number(contractParseMajor(v.amount, v.currency) ?? 0n),
  })),
}));

// --- the share link ------------------------------------------------------------------------------------------------------

export interface ShareLink {
  url: string;
  path: string;
  active: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
}

export const shareLinkSchema = z
  .object({
    token: z.string(),
    path: z.string(),
    url: z.string(),
    active: z.boolean(),
    expiresAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
  })
  .transform((l): ShareLink => ({
    url: l.url,
    path: l.path,
    active: l.active,
    expiresAt: l.expiresAt,
    revokedAt: l.revokedAt,
  }));

/** What sending answers: the document, how it went, and the link. */
export interface SendResult {
  doc: SalesDoc;
  delivery: {
    channel: 'email' | 'whatsapp' | 'link';
    status: 'sent' | 'queued' | 'shared';
    to: string | null;
  };
  link: ShareLink;
}

export const sendResultSchema = z
  .object({
    document: salesDocSchema,
    delivery: z.object({
      channel: z.enum(['email', 'whatsapp', 'link']),
      status: z.enum(['sent', 'queued', 'shared']),
      to: z.string().nullable(),
    }),
    link: shareLinkSchema,
  })
  .transform((r): SendResult => ({ doc: r.document, delivery: r.delivery, link: r.link }));

export const convertDealResultSchema = z
  .object({ document: salesDocSchema, deal: z.object({ id: z.string(), title: z.string() }) })
  .transform((r) => ({ doc: r.document, deal: { id: r.deal.id, name: r.deal.title } }));

// --- activity -----------------------------------------------------------------------------------------------------------

export type EventType = SalesDocEventType;

export interface DocEvent {
  id: string;
  type: EventType;
  at: string;
  actor: { kind: 'user' | 'buyer' | 'system'; name: string };
  channel: string | null;
  signerName: string | null;
  comment: string | null;
  /** The buyer's address and browser, recorded with a decision. */
  ip: string | null;
  hasSignature: boolean;
  from: DocStatus | null;
  to: DocStatus | null;
  revision: number;
}

export const eventListSchema = z
  .object({ data: z.array(salesDocEventSchema) })
  .transform((r): DocEvent[] =>
    r.data.map((e) => ({
      id: e.id,
      type: e.type,
      at: e.createdAt,
      actor: { kind: e.actor.kind, name: e.actor.user?.name ?? '' },
      channel: e.channel,
      signerName: e.signerName,
      comment: e.comment,
      ip: e.ip,
      hasSignature: e.hasSignature,
      from: e.fromStatus ? normalizeStatus(e.fromStatus) : null,
      to: e.toStatus ? normalizeStatus(e.toStatus) : null,
      revision: e.revision,
    })),
  );

// --- the buyer's page ---------------------------------------------------------------------------------------------------

export interface PublicDoc {
  kind: SalesDocKind;
  number: string;
  title: string;
  /** As the buyer should read it: past its valid-until date an open document is already expired. */
  status: DocStatus;
  seller: { name: string };
  buyer: { name: string; company: string };
  currency: string;
  items: DocItem[];
  defaultTaxBp: number;
  discount: DocDiscount;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  notes: string;
  terms: string;
  validUntil: string | null;
  sentAt: string | null;
  canDecide: boolean;
  blockedReason: 'expired' | null;
  decision: { status: 'accepted' | 'declined'; decidedAt: string; signerName: string } | null;
  revision: number;
}

export const publicDocSchema = publicSalesDocSchema.transform((w): PublicDoc => {
  const currency = w.currency.toUpperCase();
  return {
    kind: isKind(w.kind) ? w.kind : 'proposal',
    number: w.number,
    title: w.title ?? '',
    status: normalizeStatus(w.status),
    seller: { name: w.seller.name },
    buyer: { name: w.buyer.name ?? '', company: w.buyer.company ?? '' },
    currency,
    items: w.lines.map((l) => itemOf(l, currency)),
    defaultTaxBp: bp(w.taxRate),
    discount: discountOf(w.discount, currency),
    subtotalMinor: toNumber(w.totals.subtotalMinor),
    discountMinor: toNumber(w.totals.discountMinor),
    taxMinor: toNumber(w.totals.taxMinor),
    totalMinor: toNumber(w.totals.totalMinor),
    notes: w.notes ?? '',
    terms: w.terms ?? '',
    validUntil: w.validUntil ? w.validUntil.slice(0, 10) : null,
    sentAt: w.sentAt,
    canDecide: w.canDecide,
    blockedReason: w.blockedReason,
    decision: w.decision
      ? {
          status: w.decision.status,
          decidedAt: w.decision.decidedAt,
          signerName: w.decision.signerName ?? '',
        }
      : null,
    revision: w.revision,
  };
});

/** What the buyer sends with Accept or Decline. */
export interface BuyerDecision {
  signerName: string;
  /** A drawn signature as a PNG data URL, or null when the buyer chose to sign with the typed name. */
  signature: string | null;
  /** Accept only: the buyer confirms the scope and pricing. */
  consent?: boolean;
  /** Decline only. */
  reason?: string;
}

export const decisionResultSchema = z.object({
  status: z.enum(['accepted', 'declined']),
  decidedAt: z.string(),
  replay: z.boolean(),
});
export type DecisionResult = z.infer<typeof decisionResultSchema>;

// --- requests -----------------------------------------------------------------------------------------------------------

/** One row of a document as the builder submits it. */
export interface LineInputValue {
  description: string;
  qty: string;
  unitPriceMinor: number;
  discount: DocDiscount;
  /** Basis points; null follows the document's rate. */
  taxRateBp: number | null;
}

export interface DocInput {
  title: string;
  contactId: string | null;
  dealId: string | null;
  buyer: Buyer;
  currency: string;
  items: LineInputValue[];
  defaultTaxBp: number;
  discount: DocDiscount;
  notes: string;
  terms: string;
  validUntil: string | null;
}

export type SendChannel = 'link' | 'email' | 'whatsapp';
export interface SendInput {
  channel: SendChannel;
  /** Email address (email) or phone (whatsapp); the buyer's by default. */
  to?: string;
  /** A line added above the link. */
  message?: string;
}

export interface BulkOutcome {
  changed: number;
  failed: number;
}

export interface Member {
  id: string;
  fullName: string;
}

/** Only what the pickers read; the rest of those responses is ignored. */
export const memberPageSchema = z.object({
  data: z.array(z.object({ id: z.string(), fullName: z.string() })),
});

export const contactHitSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  phone: z.string().nullable(),
  email: z.string().nullable().optional(),
});
export type ContactHit = z.infer<typeof contactHitSchema>;
export const contactHitPageSchema = z.object({ data: z.array(contactHitSchema) });
export const contactLabel = (c: ContactHit): string =>
  c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || c.phone || '';

export const dealHitSchema = z.object({
  id: z.string(),
  title: z.string(),
  contact: z
    .object({ id: z.string(), name: z.string().nullable().optional() })
    .nullable()
    .optional(),
});
export type DealHit = z.infer<typeof dealHitSchema>;
export const dealHitPageSchema = z.object({ data: z.array(dealHitSchema) });
