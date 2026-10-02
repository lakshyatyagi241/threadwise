import { formatPercent } from '@crm/contracts';
import { chunk } from '../lib/selection';
import type { SalesDocKind } from '../lib/kinds';
import { minorToInput } from '../lib/money';
import type { DocDiscount } from '../lib/totals';
import { call, callPublic } from './http';
import {
  contactHitPageSchema,
  contactHitSchema,
  convertDealResultSchema,
  dealHitPageSchema,
  dealHitSchema,
  decisionResultSchema,
  docCountsSchema,
  docRowPageSchema,
  eventListSchema,
  memberPageSchema,
  publicDocSchema,
  salesDocSchema,
  sendResultSchema,
  shareLinkSchema,
  type BulkOutcome,
  type BuyerDecision,
  type ContactHit,
  type DealHit,
  type DecisionResult,
  type DocCounts,
  type DocEvent,
  type DocInput,
  type DocRow,
  type Member,
  type PublicDoc,
  type SalesDoc,
  type SendInput,
  type SendResult,
  type ShareLink,
} from './schemas';

type Query = Record<string, string | number | boolean | undefined>;

export interface DocPageResult {
  docs: DocRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

const wireDiscount = (d: DocDiscount, currency: string) =>
  d
    ? d.kind === 'percent'
      ? { kind: 'percent' as const, value: formatPercent(d.bp) }
      : { kind: 'amount' as const, value: minorToInput(d.minor, currency) }
    : null;

/** The request body for a document: the one place that maps the builder's input (minor units, basis points) to the wire. */
function bodyOf(input: DocInput) {
  return {
    title: input.title || null,
    contactId: input.contactId,
    dealId: input.dealId,
    buyerName: input.buyer.name || null,
    buyerEmail: input.buyer.email || null,
    buyerPhone: input.buyer.phone || null,
    currency: input.currency,
    taxRate: formatPercent(input.defaultTaxBp),
    discount: wireDiscount(input.discount, input.currency),
    validUntil: input.validUntil,
    notes: input.notes || null,
    terms: input.terms || null,
    lines: input.items.map((i) => ({
      description: i.description,
      qty: i.qty,
      unitPrice: minorToInput(i.unitPriceMinor, input.currency),
      discount: wireDiscount(i.discount, input.currency),
      taxRate: i.taxRateBp === null ? null : formatPercent(i.taxRateBp),
    })),
  };
}

const empty = {} as const;

/** Every sales-docs call, one function each. Reads are parsed at the boundary and mapped to the view models. */
export const salesDocsApi = {
  list(kind: SalesDocKind, query: Query, signal?: AbortSignal): Promise<DocPageResult> {
    return call('/sales-docs', { query: { kind, ...query }, schema: docRowPageSchema, signal });
  },
  counts(kind: SalesDocKind, query: Query, signal?: AbortSignal): Promise<DocCounts> {
    return call('/sales-docs/counts', {
      query: { kind, ...query },
      schema: docCountsSchema,
      signal,
    });
  },
  get(id: string, signal?: AbortSignal): Promise<SalesDoc> {
    return call(`/sales-docs/${id}`, { schema: salesDocSchema, signal });
  },
  /** The documents of one contact or deal, newest first, both kinds. */
  async linked(
    link: { contactId?: string; dealId?: string },
    signal?: AbortSignal,
  ): Promise<DocRow[]> {
    const path = link.contactId
      ? `/contacts/${link.contactId}/sales-docs`
      : `/deals/${link.dealId}/sales-docs`;
    return (await call(path, { query: { limit: 50 }, schema: docRowPageSchema, signal })).docs;
  },
  create(kind: SalesDocKind, input: DocInput): Promise<SalesDoc> {
    return call('/sales-docs', {
      method: 'POST',
      body: { kind, ...bodyOf(input) },
      schema: salesDocSchema,
    });
  },
  /** Needs the `rowVersion` that was read; a 409 means someone else changed the document. */
  update(doc: Pick<SalesDoc, 'id' | 'rowVersion'>, input: DocInput): Promise<SalesDoc> {
    return call(`/sales-docs/${doc.id}`, {
      method: 'PATCH',
      body: { ...bodyOf(input), rowVersion: doc.rowVersion },
      schema: salesDocSchema,
    });
  },
  /** Mails the link, asks for WhatsApp delivery, or marks it sent (`link`); a draft becomes sent. */
  send(id: string, input: SendInput): Promise<SendResult> {
    return call(`/sales-docs/${id}/send`, {
      method: 'POST',
      body: input,
      schema: sendResultSchema,
    });
  },
  /** Staff recording the buyer's answer (a signed copy, a phone call). */
  accept: (id: string, note?: string): Promise<SalesDoc> =>
    call(`/sales-docs/${id}/accept`, {
      method: 'POST',
      body: note ? { note } : empty,
      schema: salesDocSchema,
    }),
  decline: (id: string, note?: string): Promise<SalesDoc> =>
    call(`/sales-docs/${id}/decline`, {
      method: 'POST',
      body: note ? { note } : empty,
      schema: salesDocSchema,
    }),
  /** Back to a draft to change what was sent (revision + 1; the old content is kept). */
  revise: (id: string): Promise<SalesDoc> =>
    call(`/sales-docs/${id}/revise`, { method: 'POST', body: empty, schema: salesDocSchema }),
  /** A new valid-until date; an expired document is open again. */
  extend: (id: string, validUntil: string): Promise<SalesDoc> =>
    call(`/sales-docs/${id}/extend`, {
      method: 'POST',
      body: { validUntil },
      schema: salesDocSchema,
    }),
  duplicate: (id: string): Promise<SalesDoc> =>
    call(`/sales-docs/${id}/duplicate`, { method: 'POST', body: empty, schema: salesDocSchema }),
  convertInvoice: (id: string): Promise<SalesDoc> =>
    call(`/sales-docs/${id}/convert/invoice`, {
      method: 'POST',
      body: empty,
      schema: salesDocSchema,
    }),
  /** Creates a deal from the document (title, value, contact) and links it back. */
  convertDeal: (id: string) =>
    call(`/sales-docs/${id}/convert/deal`, {
      method: 'POST',
      body: empty,
      schema: convertDealResultSchema,
    }),
  remove: (id: string): Promise<void> => call(`/sales-docs/${id}`, { method: 'DELETE' }),
  /** There is no bulk route: each document is deleted on its own, a few at a time, and failures are counted. */
  async bulkDelete(ids: readonly string[]): Promise<BulkOutcome> {
    let changed = 0;
    let failed = 0;
    for (const group of chunk(ids, 5)) {
      const results = await Promise.allSettled(group.map((id) => salesDocsApi.remove(id)));
      for (const r of results) {
        if (r.status === 'fulfilled') changed++;
        else failed++;
      }
    }
    return { changed, failed };
  },
  events(id: string, signal?: AbortSignal): Promise<DocEvent[]> {
    return call(`/sales-docs/${id}/events`, {
      query: { limit: 100 },
      schema: eventListSchema,
      signal,
    });
  },

  // the share link
  link: (id: string, signal?: AbortSignal): Promise<ShareLink> =>
    call(`/sales-docs/${id}/link`, { schema: shareLinkSchema, signal }),
  regenerateLink: (id: string): Promise<ShareLink> =>
    call(`/sales-docs/${id}/link/regenerate`, {
      method: 'POST',
      body: empty,
      schema: shareLinkSchema,
    }),
  revokeLink: (id: string): Promise<ShareLink> =>
    call(`/sales-docs/${id}/link/revoke`, { method: 'POST', body: empty, schema: shareLinkSchema }),

  // pickers
  async members(signal?: AbortSignal): Promise<Member[]> {
    const page = await call('/users', { query: { limit: 200 }, schema: memberPageSchema, signal });
    return page.data;
  },
  async searchContacts(q: string, signal?: AbortSignal): Promise<ContactHit[]> {
    const page = await call('/contacts', {
      query: { q: q.trim() || undefined, limit: 15 },
      schema: contactHitPageSchema,
      signal,
    });
    return page.data;
  },
  contactById: (id: string, signal?: AbortSignal): Promise<ContactHit> =>
    call(`/contacts/${id}`, { schema: contactHitSchema, signal }),
  createContact(input: { name: string; email?: string; phone?: string }): Promise<ContactHit> {
    return call('/contacts', {
      method: 'POST',
      body: {
        name: input.name,
        ...(input.email ? { email: input.email } : {}),
        ...(input.phone ? { phone: input.phone } : {}),
      },
      schema: contactHitSchema,
    });
  },
  async searchDeals(q: string, signal?: AbortSignal): Promise<DealHit[]> {
    const page = await call('/deals', {
      query: { q: q.trim() || undefined, limit: 15 },
      schema: dealHitPageSchema,
      signal,
    });
    return page.data;
  },
  dealById: (id: string, signal?: AbortSignal): Promise<DealHit> =>
    call(`/deals/${id}`, { schema: dealHitSchema, signal }),
};

/** The buyer's calls: no session, the link's token is the credential. */
export const publicApi = {
  get(token: string, signal?: AbortSignal): Promise<PublicDoc> {
    return callPublic(`/sales-docs/${encodeURIComponent(token)}`, {
      schema: publicDocSchema,
      signal,
    });
  },
  accept(token: string, d: BuyerDecision): Promise<DecisionResult> {
    return callPublic(`/sales-docs/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      body: {
        signerName: d.signerName,
        consent: d.consent === true,
        ...(d.signature ? { signature: d.signature } : {}),
      },
      schema: decisionResultSchema,
    });
  },
  decline(token: string, d: BuyerDecision): Promise<DecisionResult> {
    return callPublic(`/sales-docs/${encodeURIComponent(token)}/decline`, {
      method: 'POST',
      body: {
        ...(d.signerName && d.signerName.length >= 2 ? { signerName: d.signerName } : {}),
        ...(d.reason ? { reason: d.reason } : {}),
      },
      schema: decisionResultSchema,
    });
  },
};
