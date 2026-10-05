import type { ListStorePaymentsQuery, StorePaymentStatus } from '@crm/contracts';
import { isPaymentStatus } from './status';

/** The filter bar of the Payments screen, kept in the address so a filtered list can be shared and survives a reload. */
export interface PaymentFilters {
  status: StorePaymentStatus | '';
  /** `prepaid`, `cod` or a gateway slug; empty is every method. */
  method: string;
  /** `YYYY-MM-DD`, inclusive; empty is open ended. */
  from: string;
  to: string;
  q: string;
}

export const EMPTY_FILTERS: PaymentFilters = { status: '', method: '', from: '', to: '', q: '' };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9_-]+$/;
const MAX_METHOD = 64;
const MAX_Q = 120;

/** Only a real calendar day counts: `2026-02-30` is rejected. */
export function isDay(v: string): boolean {
  if (!DAY.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

type ParamSource = { get(name: string): string | null };

/** Read the filters from the address. Anything invalid is dropped rather than sent to the server. */
export function parseFilters(params: ParamSource): PaymentFilters {
  const status = (params.get('status') ?? '').trim();
  const method = (params.get('method') ?? '').trim().toLowerCase().slice(0, MAX_METHOD);
  const from = (params.get('from') ?? '').trim();
  const to = (params.get('to') ?? '').trim();
  const q = (params.get('q') ?? '').trim().slice(0, MAX_Q);
  return {
    status: isPaymentStatus(status) ? status : '',
    method: method === 'prepaid' || method === 'cod' || SLUG.test(method) ? method : '',
    from: isDay(from) ? from : '',
    to: isDay(to) ? to : '',
    q,
  };
}

/**
 * Write the filters back into the address. Parameters that are not filters (the `?shop=` of the store area) are kept; empty
 * filters are left out so the clean address is `/store/payments`.
 */
export function filtersToSearch(
  filters: PaymentFilters,
  current: string | URLSearchParams = '',
): string {
  const out = new URLSearchParams(typeof current === 'string' ? current : current.toString());
  for (const key of ['status', 'method', 'from', 'to', 'q'] as const) out.delete(key);
  for (const key of ['status', 'method', 'from', 'to', 'q'] as const) {
    const v = filters[key].trim();
    if (v) out.set(key, v);
  }
  return out.toString();
}

/** The list query: only what is set. */
export function filtersToQuery(filters: PaymentFilters): Partial<ListStorePaymentsQuery> {
  const query: Partial<ListStorePaymentsQuery> = {};
  if (filters.status) query.status = filters.status;
  if (filters.method) query.method = filters.method;
  const range = orderedRange(filters);
  if (range.from) query.from = range.from;
  if (range.to) query.to = range.to;
  if (filters.q.trim()) query.q = filters.q.trim();
  return query;
}

/** A start date after the end date asks for nothing: the screen says so instead of showing an empty list. */
export function rangeIsInverted(filters: PaymentFilters): boolean {
  return !!filters.from && !!filters.to && filters.from > filters.to;
}

/** The range as it is sent: an inverted one is not sent at all. */
function orderedRange(filters: PaymentFilters): { from: string; to: string } {
  return rangeIsInverted(filters) ? { from: '', to: '' } : { from: filters.from, to: filters.to };
}

export function hasActiveFilters(filters: PaymentFilters): boolean {
  return (
    !!filters.status || !!filters.method || !!filters.from || !!filters.to || !!filters.q.trim()
  );
}

/** What the method select shows: a preset, or "a gateway" with its code in the box next to it. */
export type MethodChoice = '' | 'prepaid' | 'cod' | 'gateway';

export function methodChoice(method: string): MethodChoice {
  if (method === '') return '';
  if (method === 'prepaid' || method === 'cod') return method;
  return 'gateway';
}

/** A gateway code as typed: lower-case, only the characters a code holds. */
export function cleanGatewayCode(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, MAX_METHOD);
}
