'use client';

import { useQuery } from '@tanstack/react-query';
import {
  salesDocPageResponseSchema,
  salesDocSummarySchema,
  type SalesDocSummary,
} from '@crm/contracts';
import { call } from './http';
import { invoicingApi } from './service';

/**
 * The accepted proposals and estimates an order can start from. They live in the sales-docs API; only the summary shape is read
 * here (`salesDocSummarySchema` of the contracts), and a single document answers with the same fields plus more.
 */
export type QuoteRow = SalesDocSummary;

export const quotesApi = {
  /** Accepted documents (both kinds), newest first; `q` matches number, title, contact or company. */
  async accepted(q: string, signal?: AbortSignal): Promise<QuoteRow[]> {
    const page = await call('/sales-docs', {
      query: { status: 'accepted', limit: 20, q: q.trim() || undefined },
      schema: salesDocPageResponseSchema,
      signal,
    });
    return page.data;
  },
  /** One document by id (any status: the server decides if it can become an order). */
  get: (id: string, signal?: AbortSignal): Promise<QuoteRow> =>
    call(`/sales-docs/${id}`, { schema: salesDocSummarySchema, signal }),
};

export function useAcceptedQuotes(q: string, enabled = true) {
  return useQuery({
    queryKey: ['invoicing', 'sales-orders', 'quotes', 'accepted', q.trim()],
    queryFn: ({ signal }) => quotesApi.accepted(q, signal),
    enabled,
    retry: false,
    staleTime: 15_000,
  });
}

export function useQuote(id: string | null) {
  return useQuery({
    queryKey: ['invoicing', 'sales-orders', 'quotes', 'one', id],
    queryFn: ({ signal }) => quotesApi.get(id!, signal),
    enabled: id !== null,
    retry: false,
    staleTime: 30_000,
  });
}

/**
 * The live order of an accepted offer, found again after SO_QUOTE_TAKEN. The API has no filter by offer; a new order's reference
 * defaults to the offer's number, so searching by number finds it (an order whose reference was edited is not found: the
 * message then simply has no link).
 */
export function useOrderOfQuote(quote: { id: string; number: string } | null) {
  return useQuery({
    queryKey: ['invoicing', 'sales-orders', 'of-quote', quote?.id],
    queryFn: async ({ signal }) => {
      const page = await invoicingApi.salesOrders({ q: quote!.number, limit: 20 }, signal);
      return page.items.find((o) => o.quote?.id === quote!.id && o.status !== 'cancelled') ?? null;
    },
    enabled: quote !== null,
    retry: false,
    staleTime: 15_000,
  });
}
