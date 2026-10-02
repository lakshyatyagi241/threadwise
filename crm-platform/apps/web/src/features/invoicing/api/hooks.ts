'use client';

import { keepPreviousData, useInfiniteQuery, useQuery, type QueryClient } from '@tanstack/react-query';
import { invoicingApi, type Page, type Query } from './service';

export const KEYS = {
  all: ['invoicing'] as const,
  list: ['invoicing', 'list'] as const,
  counts: ['invoicing', 'counts'] as const,
  invoice: (id: string) => ['invoicing', 'invoice', id] as const,
  events: (id: string) => ['invoicing', 'events', id] as const,
  payments: ['invoicing', 'payments'] as const,
  summary: ['invoicing', 'summary'] as const,
  aging: ['invoicing', 'aging'] as const,
  outstanding: ['invoicing', 'outstanding'] as const,
  rates: ['invoicing', 'rates'] as const,
  presets: ['invoicing', 'presets'] as const,
  settings: ['invoicing', 'settings'] as const,
  gateway: ['invoicing', 'gateway'] as const,
  recurring: ['invoicing', 'recurring'] as const,
  creditNotes: ['invoicing', 'credit-notes'] as const,
  salesOrders: ['invoicing', 'sales-orders'] as const,
  contact: (id: string) => ['invoicing', 'contact', id] as const,
};

const PAGE_SIZE = 25;

/** A cursor list with "load more": every list screen of the domain uses this one shape. */
function useCursorQuery<T>(
  key: readonly unknown[],
  fetchPage: (query: Query, signal?: AbortSignal) => Promise<Page<T>>,
  query: Query,
  opts: { enabled?: boolean; limit?: number } = {},
) {
  const limit = opts.limit ?? PAGE_SIZE;
  const q = useInfiniteQuery({
    queryKey: [...key, query, limit],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => fetchPage({ limit, ...query, cursor: pageParam }, signal),
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
    enabled: opts.enabled ?? true,
    placeholderData: keepPreviousData,
    retry: false,
  });
  return { ...q, items: q.data?.pages.flatMap((p) => p.items) ?? [] };
}

// --- invoices ---------------------------------------------------------------------------------------------------------------

/** The invoice list, "load more" by cursor. */
export const useInvoicesList = (query: Query, opts: { enabled?: boolean; limit?: number } = {}) =>
  useCursorQuery(KEYS.list, invoicingApi.list, query, opts);

/** Tab badges and the outstanding tiles. A failure only hides them: the lists work without. */
export function useInvoiceCounts(query: Query) {
  return useQuery({
    queryKey: [...KEYS.counts, query],
    queryFn: ({ signal }) => invoicingApi.counts(query, signal),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 15_000,
  });
}

export function useInvoice(id: string | null) {
  return useQuery({
    queryKey: KEYS.invoice(id ?? ''),
    queryFn: ({ signal }) => invoicingApi.get(id!, signal),
    enabled: id !== null,
    retry: false,
  });
}

export function useInvoiceEvents(id: string | null) {
  return useQuery({
    queryKey: KEYS.events(id ?? ''),
    queryFn: ({ signal }) => invoicingApi.events(id!, signal),
    enabled: id !== null,
    retry: false,
  });
}

// --- payments ---------------------------------------------------------------------------------------------------------------

/** The ledger entries of one invoice (newest first). */
export function useInvoicePayments(invoiceId: string | null) {
  return useQuery({
    queryKey: [...KEYS.payments, 'invoice', invoiceId],
    queryFn: ({ signal }) => invoicingApi.payments({ invoiceId: invoiceId!, limit: 100 }, signal),
    enabled: invoiceId !== null,
    retry: false,
    select: (r) => r.items,
  });
}

/** The payments ledger, "load more" by cursor. */
export const usePaymentsList = (query: Query, opts: { enabled?: boolean } = {}) =>
  useCursorQuery([...KEYS.payments, 'list'], invoicingApi.payments, query, opts);

export function usePaymentSummary(days: number) {
  return useQuery({
    queryKey: [...KEYS.summary, days],
    queryFn: ({ signal }) => invoicingApi.paymentSummary(days, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useAging(query: Query = {}, enabled = true) {
  return useQuery({
    queryKey: [...KEYS.aging, query],
    queryFn: ({ signal }) => invoicingApi.aging(query, signal),
    enabled,
    retry: false,
  });
}

/** Who owes what, per contact and currency, "load more" by cursor. */
export const useOutstandingList = (query: Query, opts: { enabled?: boolean } = {}) =>
  useCursorQuery(KEYS.outstanding, invoicingApi.outstanding, query, opts);

// --- tax rates, the business profile ----------------------------------------------------------------------------------------

export function useTaxRates(query: Query = {}) {
  return useQuery({
    queryKey: [...KEYS.rates, query],
    queryFn: ({ signal }) => invoicingApi.taxRates(query, signal),
    staleTime: 60_000,
    retry: false,
  });
}

/** A country's preset rows (`exists` says which are already in the workspace). Off until a country is chosen. */
export function useTaxPresets(country: string | null) {
  return useQuery({
    queryKey: [...KEYS.presets, country],
    queryFn: ({ signal }) => invoicingApi.taxPresets({ country: country! }, signal),
    enabled: !!country && /^[A-Za-z]{2}$/.test(country),
    retry: false,
    staleTime: 60_000,
  });
}

/** The business profile: seller identity, numbering, default terms and tax regime. Never fails for a missing row (defaults come back). */
export function useInvoiceSettings() {
  return useQuery({
    queryKey: KEYS.settings,
    queryFn: ({ signal }) => invoicingApi.settings(signal),
    staleTime: 60_000,
    retry: false,
  });
}

export function useInvoiceGateway(enabled = true) {
  return useQuery({
    queryKey: KEYS.gateway,
    queryFn: ({ signal }) => invoicingApi.gateway(signal),
    enabled,
    retry: false,
  });
}

// --- recurring invoices, credit notes, sales orders -------------------------------------------------------------------------

export const useRecurringList = (query: Query, opts: { enabled?: boolean } = {}) =>
  useCursorQuery([...KEYS.recurring, 'list'], invoicingApi.recurringList, query, opts);

export function useRecurring(id: string | null) {
  return useQuery({
    queryKey: [...KEYS.recurring, 'one', id],
    queryFn: ({ signal }) => invoicingApi.recurring(id!, signal),
    enabled: id !== null,
    retry: false,
  });
}

export function useRecurringRuns(id: string | null) {
  return useQuery({
    queryKey: [...KEYS.recurring, 'runs', id],
    queryFn: ({ signal }) => invoicingApi.recurringRuns(id!, { limit: 100 }, signal),
    enabled: id !== null,
    retry: false,
    select: (r) => r.items,
  });
}

export const useCreditNotesList = (query: Query, opts: { enabled?: boolean } = {}) =>
  useCursorQuery([...KEYS.creditNotes, 'list'], invoicingApi.creditNotes, query, opts);

export function useCreditNote(id: string | null) {
  return useQuery({
    queryKey: [...KEYS.creditNotes, 'one', id],
    queryFn: ({ signal }) => invoicingApi.creditNote(id!, signal),
    enabled: id !== null,
    retry: false,
  });
}

export const useSalesOrdersList = (query: Query, opts: { enabled?: boolean } = {}) =>
  useCursorQuery([...KEYS.salesOrders, 'list'], invoicingApi.salesOrders, query, opts);

export function useSalesOrderCounts() {
  return useQuery({
    queryKey: [...KEYS.salesOrders, 'counts'],
    queryFn: ({ signal }) => invoicingApi.salesOrderCounts(signal),
    retry: false,
    staleTime: 15_000,
  });
}

export function useSalesOrder(id: string | null) {
  return useQuery({
    queryKey: [...KEYS.salesOrders, 'one', id],
    queryFn: ({ signal }) => invoicingApi.salesOrder(id!, signal),
    enabled: id !== null,
    retry: false,
  });
}

// --- pickers ----------------------------------------------------------------------------------------------------------------

/** A contact known only by id (it arrived in the address): its name for the filter chip. */
export function useContactName(id: string) {
  return useQuery({
    queryKey: KEYS.contact(id),
    enabled: id !== '',
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => {
      const c = await invoicingApi.contactById(id, signal);
      return c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.phone || '';
    },
  });
}

/** After any write: every list, badge, summary and open document of the domain is stale. */
export const invalidateInvoicing = (qc: QueryClient) => qc.invalidateQueries({ queryKey: KEYS.all });
