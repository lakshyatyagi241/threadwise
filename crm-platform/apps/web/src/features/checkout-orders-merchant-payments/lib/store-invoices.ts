import { INVOICE_STATUSES, type InvoiceStatus, type InvoiceSummary } from '@crm/contracts';
import type { Tone } from './status';

/**
 * The store's invoices are a FILTERED VIEW of the Sales invoice list: an invoice created from a store order carries source `own`
 * (`external-order-billing.service.ts`). The list endpoint has no `source` filter, so the rows are narrowed here, page by page.
 * Pure, no React.
 */
export const STORE_INVOICE_SOURCE = 'own';

/** Rows asked of the Sales list per page (the endpoint's default). */
export const PAGE_LIMIT = 50;
/** Keep fetching until this many store invoices are in hand (a screenful). */
export const SCREENFUL = 20;
/** At most this many pages are fetched automatically per refresh; beyond it the person presses Load more. */
export const AUTO_PAGE_CAP = 6;

export const isStoreInvoice = (row: Pick<InvoiceSummary, 'source'>): boolean =>
  row.source === STORE_INVOICE_SOURCE;

/** The store's rows of one page, in the order the list returned them. */
export const keepStoreInvoices = <T extends Pick<InvoiceSummary, 'source'>>(rows: readonly T[]): T[] =>
  rows.filter(isStoreInvoice);

/** Pages merged into one list of store invoices; a row that appears twice (a page refetched while data moved) is kept once. */
export function mergeStoreInvoices<T extends Pick<InvoiceSummary, 'source' | 'id'>>(
  pages: ReadonlyArray<readonly T[]>,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const page of pages) {
    for (const row of keepStoreInvoices(page)) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
  }
  return out;
}

/**
 * Whether to fetch the next page by itself: more pages exist, a screenful is not reached yet and the automatic cap is not used up.
 * After the cap the screen shows Load more and the person decides.
 */
export function shouldAutoFetch(state: {
  hasMore: boolean;
  kept: number;
  pagesFetched: number;
  target?: number;
  cap?: number;
}): boolean {
  const { hasMore, kept, pagesFetched, target = SCREENFUL, cap = AUTO_PAGE_CAP } = state;
  return hasMore && kept < target && pagesFetched < cap;
}

/** True when the automatic budget ran out while more pages exist (the screen says it has not looked through everything). */
export const stoppedAtCap = (state: { hasMore: boolean; pagesFetched: number; cap?: number }): boolean =>
  state.hasMore && state.pagesFetched >= (state.cap ?? AUTO_PAGE_CAP);

/** Invoice status chips in this domain's colours: paid green, overdue and void red, issued and part-paid amber, draft grey. */
export function invoiceTone(status: InvoiceStatus | string): Tone {
  switch (status) {
    case 'paid':
      return 'success';
    case 'overdue':
    case 'void':
      return 'danger';
    case 'issued':
    case 'partially_paid':
      return 'warning';
    default:
      return 'neutral';
  }
}

/** The total of a row for display: `amountsMinor.total` is a string of minor units at the currency's exponent. */
export function invoiceTotal(
  row: Pick<InvoiceSummary, 'amountsMinor' | 'currency' | 'currencyExponent'>,
  locale: string,
): string {
  const exp = Math.max(0, Math.min(6, row.currencyExponent));
  const major = Number(row.amountsMinor.total) / 10 ** exp;
  if (!Number.isFinite(major)) return '';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: row.currency,
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(major);
  } catch {
    return `${row.currency} ${major.toLocaleString(locale, { minimumFractionDigits: exp, maximumFractionDigits: exp })}`;
  }
}

/** The name shown for the buyer: the invoice's own buyer name, else the linked contact's. */
export const buyerLabel = (
  row: Pick<InvoiceSummary, 'buyerName' | 'contact'>,
): string => row.buyerName?.trim() || row.contact?.name?.trim() || '';

/** "Oct 02, 2026" for a calendar date (`YYYY-MM-DD`): read as the day it names, never shifted by the viewer's time zone. */
export function formatCalendarDay(day: string | null | undefined, locale: string): string {
  if (!day || !/^\d{4}-\d{2}-\d{2}/.test(day)) return '';
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(d);
}

/** The status the address names, or undefined (an unknown value in a shared link is ignored, not an error). */
export function parseStatusParam(value: string | null | undefined): InvoiceStatus | undefined {
  return (INVOICE_STATUSES as readonly string[]).includes(value ?? '')
    ? (value as InvoiceStatus)
    : undefined;
}
