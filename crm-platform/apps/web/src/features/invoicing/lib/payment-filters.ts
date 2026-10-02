import { PAYMENT_METHODS, PAYMENT_KINDS, type PaymentKind, type PaymentMethod } from '@crm/contracts';
import { isDay } from './dates';

/**
 * The Payments screen state, kept in the address so a view can be shared and the back button works. Three views: the ledger
 * (every payment and refund), the aging report and what each contact owes. Everything here is pure.
 */
export const PAYMENTS_VIEWS = ['ledger', 'aging', 'outstanding'] as const;
export type PaymentsView = (typeof PAYMENTS_VIEWS)[number];

/** The methods in the order the filter offers them: the ones a person records by hand first, then those written by integrations. */
export const METHOD_ORDER: readonly PaymentMethod[] = ['bank', 'cash', 'card', 'upi', 'cheque', 'other', 'manual', 'gateway', 'wa_pay', 'storefront'];

/** The KPI windows. */
export const SUMMARY_DAYS = [7, 30, 90] as const;
export type SummaryDays = (typeof SUMMARY_DAYS)[number];

export interface PaymentFilters {
  view: PaymentsView;
  q: string;
  kind: PaymentKind | '';
  methods: PaymentMethod[];
  currency: string;
  from: string;
  to: string;
  /** A contact id, or empty. */
  contact: string;
  /** An invoice id, or empty (the ledger of one invoice). */
  invoice: string;
  /** Outstanding view: only contacts with an overdue balance. */
  onlyOverdue: boolean;
  days: SummaryDays;
}

export const DEFAULT_PAYMENT_FILTERS: PaymentFilters = {
  view: 'ledger',
  q: '',
  kind: '',
  methods: [],
  currency: '',
  from: '',
  to: '',
  contact: '',
  invoice: '',
  onlyOverdue: false,
  days: 30,
};

interface SearchLike {
  get(name: string): string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = (v: string | null) => (isDay(v) ? v.slice(0, 10) : '');
const uuid = (v: string | null) => (v && UUID.test(v) ? v : '');

/** Reads the state from the address; unknown or malformed values fall back to the defaults instead of failing. */
export function parsePaymentFilters(search: SearchLike): PaymentFilters {
  const view = search.get('view');
  const kind = search.get('kind');
  const currency = (search.get('currency') ?? '').toUpperCase();
  const days = Number(search.get('days'));
  const methods = (search.get('method') ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter((m): m is PaymentMethod => (PAYMENT_METHODS as readonly string[]).includes(m));
  return {
    view: (PAYMENTS_VIEWS as readonly (string | null)[]).includes(view) ? (view as PaymentsView) : 'ledger',
    q: (search.get('q') ?? '').slice(0, 100),
    kind: (PAYMENT_KINDS as readonly (string | null)[]).includes(kind) ? (kind as PaymentKind) : '',
    methods: [...new Set(methods)],
    currency: /^[A-Z]{3}$/.test(currency) ? currency : '',
    from: day(search.get('from')),
    to: day(search.get('to')),
    contact: uuid(search.get('contact')),
    invoice: uuid(search.get('invoice')),
    onlyOverdue: search.get('overdue') === '1',
    days: (SUMMARY_DAYS as readonly number[]).includes(days) ? (days as SummaryDays) : 30,
  };
}

/** The `?query` for these filters; defaults are left out so the plain screen keeps a plain address. */
export function paymentFiltersToSearch(f: PaymentFilters): string {
  const p = new URLSearchParams();
  if (f.view !== 'ledger') p.set('view', f.view);
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.kind) p.set('kind', f.kind);
  if (f.methods.length > 0) p.set('method', f.methods.join(','));
  if (f.currency) p.set('currency', f.currency);
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.contact) p.set('contact', f.contact);
  if (f.invoice) p.set('invoice', f.invoice);
  if (f.onlyOverdue) p.set('overdue', '1');
  if (f.days !== 30) p.set('days', String(f.days));
  const s = p.toString().replace(/%2C/g, ',');
  return s ? `?${s}` : '';
}

/** Anything the toolbar narrowed (the view and the KPI window do not count). */
export const hasActivePaymentFilter = (f: PaymentFilters): boolean =>
  f.q.trim() !== '' ||
  f.kind !== '' ||
  f.methods.length > 0 ||
  f.currency !== '' ||
  f.from !== '' ||
  f.to !== '' ||
  f.contact !== '' ||
  f.invoice !== '' ||
  (f.view === 'outstanding' && f.onlyOverdue);

export type QueryValues = Record<string, string | number | boolean | undefined>;

/** `GET /payments`. */
export const paymentQuery = (f: PaymentFilters): QueryValues => ({
  q: f.q.trim() || undefined,
  kind: f.kind || undefined,
  method: f.methods.length > 0 ? f.methods.join(',') : undefined,
  currency: f.currency || undefined,
  from: f.from || undefined,
  to: f.to || undefined,
  contactId: f.contact || undefined,
  invoiceId: f.invoice || undefined,
});

/** `GET /payments/outstanding`. */
export const outstandingQuery = (f: PaymentFilters): QueryValues => ({
  q: f.q.trim() || undefined,
  currency: f.currency || undefined,
  onlyOverdue: f.onlyOverdue ? true : undefined,
});

/** `GET /payments/aging`. */
export const agingQuery = (f: PaymentFilters): QueryValues => ({
  currency: f.currency || undefined,
  contactId: f.contact || undefined,
});

/** `from > to` windows are swapped so a person who typed them the wrong way round still gets a result. */
export function orderedWindow(from: string, to: string): { from: string; to: string } {
  return from && to && from > to ? { from: to, to: from } : { from, to };
}

/** The same method toggled in or out of the list, in the canonical order. */
export function toggleMethod(methods: readonly PaymentMethod[], m: PaymentMethod): PaymentMethod[] {
  const on = methods.includes(m);
  return METHOD_ORDER.filter((x) => (x === m ? !on : methods.includes(x)));
}
