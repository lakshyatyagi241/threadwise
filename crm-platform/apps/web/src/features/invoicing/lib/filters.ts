import { INVOICE_DOC_TYPES, type InvoiceDocType } from '@crm/contracts';
import { isDay } from './dates';
import { TABS, type InvoiceTab } from './status';

/**
 * The Invoices list state, kept in the address so a view can be shared and the back button works. The tab picks the status;
 * the toolbar narrows it. Everything here is pure. The names that go to the API are the real query names of `GET /invoices`.
 *
 * Sorting: the API orders by creation only (`order=asc|desc`), so "oldest first" and "newest first" are the only sorts. Reference's
 * sort by due date and by amount are not offered (the list endpoint cannot do them).
 */
export const ORDERS = ['desc', 'asc'] as const;
export type InvoiceOrder = (typeof ORDERS)[number];

export interface InvoiceFilters {
  tab: InvoiceTab;
  q: string;
  /** A contact id, or empty. */
  contact: string;
  /** Issue-date window, `YYYY-MM-DD` or empty. */
  issuedFrom: string;
  issuedTo: string;
  /** Due-date window. */
  dueFrom: string;
  dueTo: string;
  currency: string;
  docType: InvoiceDocType | '';
  /** Only the invoices the caller owns. */
  mine: boolean;
  order: InvoiceOrder;
}

export const DEFAULT_FILTERS: InvoiceFilters = {
  tab: 'all',
  q: '',
  contact: '',
  issuedFrom: '',
  issuedTo: '',
  dueFrom: '',
  dueTo: '',
  currency: '',
  docType: '',
  mine: false,
  order: 'desc',
};

interface SearchLike {
  get(name: string): string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isTab = (v: string | null): v is InvoiceTab =>
  (TABS as readonly (string | null)[]).includes(v);
const isDocType = (v: string | null): v is InvoiceDocType =>
  (INVOICE_DOC_TYPES as readonly (string | null)[]).includes(v);
const day = (v: string | null) => (isDay(v) ? v.slice(0, 10) : '');

/** Reads the state from the address; unknown or malformed values fall back to the defaults instead of failing. */
export function parseFilters(search: SearchLike): InvoiceFilters {
  const tab = search.get('tab');
  const contact = search.get('contact');
  const docType = search.get('docType');
  const currency = (search.get('currency') ?? '').toUpperCase();
  return {
    tab: isTab(tab) ? tab : 'all',
    q: (search.get('q') ?? '').slice(0, 100),
    contact: contact && UUID.test(contact) ? contact : '',
    issuedFrom: day(search.get('issuedFrom')),
    issuedTo: day(search.get('issuedTo')),
    dueFrom: day(search.get('dueFrom')),
    dueTo: day(search.get('dueTo')),
    currency: /^[A-Z]{3}$/.test(currency) ? currency : '',
    docType: isDocType(docType) ? docType : '',
    mine: search.get('mine') === '1',
    order: search.get('order') === 'asc' ? 'asc' : 'desc',
  };
}

/** The `?query` for these filters; defaults are left out so the plain screen keeps a plain address. */
export function filtersToSearch(f: InvoiceFilters): string {
  const p = new URLSearchParams();
  if (f.tab !== 'all') p.set('tab', f.tab);
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.contact) p.set('contact', f.contact);
  if (f.issuedFrom) p.set('issuedFrom', f.issuedFrom);
  if (f.issuedTo) p.set('issuedTo', f.issuedTo);
  if (f.dueFrom) p.set('dueFrom', f.dueFrom);
  if (f.dueTo) p.set('dueTo', f.dueTo);
  if (f.currency) p.set('currency', f.currency);
  if (f.docType) p.set('docType', f.docType);
  if (f.mine) p.set('mine', '1');
  if (f.order !== 'desc') p.set('order', f.order);
  const s = p.toString();
  return s ? `?${s}` : '';
}

type NarrowingFilters = Pick<
  InvoiceFilters,
  | 'q'
  | 'contact'
  | 'issuedFrom'
  | 'issuedTo'
  | 'dueFrom'
  | 'dueTo'
  | 'currency'
  | 'docType'
  | 'mine'
>;

/** Anything the toolbar narrowed (the tab and the order do not count). */
export const hasActiveFilter = (f: NarrowingFilters): boolean =>
  f.q.trim() !== '' ||
  f.contact !== '' ||
  f.issuedFrom !== '' ||
  f.issuedTo !== '' ||
  f.dueFrom !== '' ||
  f.dueTo !== '' ||
  f.currency !== '' ||
  f.docType !== '' ||
  f.mine;

export type QueryValues = Record<string, string | number | boolean | undefined>;

/** Narrowing filters shared by the list and the counts endpoints (empty values are dropped by the client). */
export function sharedQuery(f: NarrowingFilters): QueryValues {
  return {
    q: f.q.trim() || undefined,
    contactId: f.contact || undefined,
    issuedFrom: f.issuedFrom || undefined,
    issuedTo: f.issuedTo || undefined,
    dueFrom: f.dueFrom || undefined,
    dueTo: f.dueTo || undefined,
    currency: f.currency || undefined,
    docType: f.docType || undefined,
    mine: f.mine ? true : undefined,
  };
}

/** `status` carries the tab by its API name (`partially_paid`); `order` is sent only when it is not the default. */
export const listQuery = (f: InvoiceFilters): QueryValues => ({
  ...sharedQuery(f),
  status: f.tab === 'all' ? undefined : f.tab,
  order: f.order === 'asc' ? 'asc' : undefined,
});

/** Counts take the same narrowing filters but never the tab, so every badge answers for its own tab. */
export const countsQuery = (f: InvoiceFilters): QueryValues => sharedQuery(f);

/** `0 > from > to` windows are swapped so a person who typed them the wrong way round still gets a result. */
export function orderedWindow(from: string, to: string): { from: string; to: string } {
  return from && to && from > to ? { from: to, to: from } : { from, to };
}
