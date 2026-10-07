import {
  billingOptionsResponseSchema,
  referralListResponseSchema,
  type ReferralListQuery,
  type ReferralRange,
  couponItemSchema,
  couponListResponseSchema,
  currencyItemSchema,
  currencyListResponseSchema,
  fetchRatesResponseSchema,
  setDefaultCurrencyResponseSchema,
  type CouponListQuery,
  type CurrencyListQuery,
} from '@crm/contracts';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { apiFetch } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';
import { fileNameFromDisposition } from './lib/download';

/** Query keys, one place. Everything here is an operator-console call (`/api/platform/*`). */
export const KEYS = {
  coupons: ['operator', 'coupons'] as const,
  couponList: (q: Partial<CouponListQuery>) => ['operator', 'coupons', 'list', q] as const,
  coupon: (id: string) => ['operator', 'coupons', 'one', id] as const,
  options: ['operator', 'billing-options'] as const,
  currencies: ['operator', 'currencies'] as const,
  affiliate: ['affiliate'] as const,
  affiliateList: (q: ReferralListQuery) => ['affiliate', 'list', q] as const,
  currencyList: (q: Partial<CurrencyListQuery>) => ['operator', 'currencies', 'list', q] as const,
};

export const fetchCoupons = (q: Partial<CouponListQuery>, signal?: AbortSignal) =>
  operatorFetch('/coupons', {
    query: {
      q: q.q,
      status: q.status && q.status !== 'all' ? q.status : undefined,
      page: q.page && q.page > 1 ? q.page : undefined,
    },
    schema: couponListResponseSchema,
    signal,
  });

export const fetchCoupon = (id: string, signal?: AbortSignal) =>
  operatorFetch(`/coupons/${id}`, { schema: couponItemSchema, signal });

export const fetchOptions = (signal?: AbortSignal) =>
  operatorFetch('/billing-options', { schema: billingOptionsResponseSchema, signal });

export const fetchCurrencies = (q: Partial<CurrencyListQuery>, signal?: AbortSignal) =>
  operatorFetch('/currencies', {
    query: { q: q.q, page: q.page && q.page > 1 ? q.page : undefined },
    schema: currencyListResponseSchema,
    signal,
  });

export {
  couponItemSchema,
  currencyItemSchema,
  fetchRatesResponseSchema,
  setDefaultCurrencyResponseSchema,
};

/** The signed-in user's own affiliate data (`/api/v2/me/*`, any authenticated user; nothing here is operator-only). */
export const fetchReferrals = (q: ReferralListQuery, signal?: AbortSignal) =>
  apiFetch('/me/referrals', {
    query: { range: q.range, bucket: q.bucket, q: q.q, cursor: q.cursor, limit: q.limit },
    schema: referralListResponseSchema,
    signal,
  });

/**
 * The CSV of a range. It needs the session, so it is fetched (a bare link would carry no auth header) and the body is
 * handed to the browser as a file. Search is not part of it: the export is the whole range.
 */
export async function downloadReferralsCsv(
  range: ReferralRange,
  now = new Date(),
): Promise<{ blob: Blob; fileName: string }> {
  const res = await fetch(`/api/v2/me/referrals/export?range=${encodeURIComponent(range)}`, {
    headers: { Accept: 'text/csv', 'X-Request-Id': crypto.randomUUID() },
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    throw toApiError(res.status, body, res.headers.get('x-request-id'));
  }
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return {
    blob: await res.blob(),
    fileName: fileNameFromDisposition(
      res.headers.get('content-disposition'),
      `affiliate-history-${stamp}.csv`,
    ),
  };
}
