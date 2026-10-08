import type { ListStoreOrdersQuery } from '@crm/contracts';
import { isOrderSource, isOrderStatus, isPaymentStatus } from './status';

/**
 * The filters of the orders list as the address carries them: `?status=paid&source=waba&pay=cod&from=2026-10-01&to=2026-10-05&q=ali&store=<id>`.
 * Pure: no React, no router. `shop` (the store switcher) is a separate parameter owned by the sidebar and is kept as it is.
 */
export interface OrdersFilters {
  status: string; // 'all' or an order status
  source: string; // 'all' or an order source
  paymentStatus: string; // 'all' or a payment status
  from: string; // YYYY-MM-DD or ''
  to: string;
  q: string;
  storefrontId: string; // '' = all shops
}

export const DEFAULT_ORDERS_FILTERS: OrdersFilters = {
  status: 'all',
  source: 'all',
  paymentStatus: 'all',
  from: '',
  to: '',
  q: '',
  storefrontId: '',
};

/** The address parameter of each filter. */
export const FILTER_PARAMS = {
  status: 'status',
  source: 'source',
  paymentStatus: 'pay',
  from: 'from',
  to: 'to',
  q: 'q',
  storefrontId: 'store',
} as const;

export const ORDERS_PAGE_SIZE = 25;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A real calendar day, not only the right shape (2026-02-31 is refused). */
export function isCalendarDay(v: string): boolean {
  if (!DAY.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

interface ParamSource {
  get(name: string): string | null;
}

/** Read the filters from an address; anything unknown or malformed falls back to its default, so a stale link never breaks the list. */
export function parseOrdersFilters(params: ParamSource): OrdersFilters {
  const status = params.get(FILTER_PARAMS.status) ?? '';
  const source = params.get(FILTER_PARAMS.source) ?? '';
  const pay = params.get(FILTER_PARAMS.paymentStatus) ?? '';
  const from = (params.get(FILTER_PARAMS.from) ?? '').trim();
  const to = (params.get(FILTER_PARAMS.to) ?? '').trim();
  const store = (params.get(FILTER_PARAMS.storefrontId) ?? '').trim();
  return {
    status: isOrderStatus(status) ? status : 'all',
    source: isOrderSource(source) ? source : 'all',
    paymentStatus: isPaymentStatus(pay) ? pay : 'all',
    from: isCalendarDay(from) ? from : '',
    to: isCalendarDay(to) ? to : '',
    q: (params.get(FILTER_PARAMS.q) ?? '').trim().slice(0, 120),
    storefrontId: UUID.test(store) ? store : '',
  };
}

/** The API query for a set of filters. Defaults are left out so the request stays short. */
export function ordersQuery(
  f: OrdersFilters,
  limit: number = ORDERS_PAGE_SIZE,
): Partial<ListStoreOrdersQuery> {
  const q: Partial<ListStoreOrdersQuery> = { limit };
  if (f.status !== 'all' && isOrderStatus(f.status)) q.status = f.status;
  if (f.source !== 'all' && isOrderSource(f.source)) q.source = f.source;
  if (f.paymentStatus !== 'all' && isPaymentStatus(f.paymentStatus))
    q.paymentStatus = f.paymentStatus;
  if (f.storefrontId) q.storefrontId = f.storefrontId;
  if (f.from) q.from = f.from;
  if (f.to) q.to = f.to;
  if (f.q.trim()) q.q = f.q.trim();
  return q;
}

/**
 * The query string for a set of filters (without the leading `?`), keeping the store switcher's `shop` when there is one.
 * Defaults are left out; an empty result means "no filters".
 */
export function ordersSearch(f: OrdersFilters, shop?: string | null): string {
  const p = new URLSearchParams();
  if (shop) p.set('shop', shop);
  if (f.status !== 'all') p.set(FILTER_PARAMS.status, f.status);
  if (f.source !== 'all') p.set(FILTER_PARAMS.source, f.source);
  if (f.paymentStatus !== 'all') p.set(FILTER_PARAMS.paymentStatus, f.paymentStatus);
  if (f.storefrontId) p.set(FILTER_PARAMS.storefrontId, f.storefrontId);
  if (f.from) p.set(FILTER_PARAMS.from, f.from);
  if (f.to) p.set(FILTER_PARAMS.to, f.to);
  if (f.q.trim()) p.set(FILTER_PARAMS.q, f.q.trim());
  return p.toString();
}

/** True when anything narrows the list (the status tab counts: "Paid" with no rows is a filter that matched nothing). */
export function hasActiveFilter(f: OrdersFilters): boolean {
  return (
    f.status !== 'all' ||
    f.source !== 'all' ||
    f.paymentStatus !== 'all' ||
    f.storefrontId !== '' ||
    f.from !== '' ||
    f.to !== '' ||
    f.q.trim() !== ''
  );
}

/** Clear every filter. */
export const resetOrdersFilters = (): OrdersFilters => ({ ...DEFAULT_ORDERS_FILTERS });

/** A date range whose start is after its end can never match; the screen says so instead of showing an empty list. */
export function isInvertedRange(f: Pick<OrdersFilters, 'from' | 'to'>): boolean {
  return f.from !== '' && f.to !== '' && f.from > f.to;
}
