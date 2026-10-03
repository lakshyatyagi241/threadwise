import {
  billingOptionsResponseSchema,
  couponItemSchema,
  couponListResponseSchema,
  creditPackageItemSchema,
  creditPackageListResponseSchema,
  currencyItemSchema,
  currencyListResponseSchema,
  fetchRatesResponseSchema,
  setDefaultCurrencyResponseSchema,
  type CouponListQuery,
  type CurrencyListQuery,
} from '@crm/contracts';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';

/** Query keys, one place. Everything here is an operator-console call (`/api/platform/*`). */
export const KEYS = {
  coupons: ['operator', 'coupons'] as const,
  couponList: (q: Partial<CouponListQuery>) => ['operator', 'coupons', 'list', q] as const,
  coupon: (id: string) => ['operator', 'coupons', 'one', id] as const,
  options: ['operator', 'billing-options'] as const,
  packages: ['operator', 'credit-packages'] as const,
  package: (id: string) => ['operator', 'credit-packages', 'one', id] as const,
  currencies: ['operator', 'currencies'] as const,
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

export const fetchPackages = (signal?: AbortSignal) =>
  operatorFetch('/credit-packages', { schema: creditPackageListResponseSchema, signal });

export const fetchPackage = (id: string, signal?: AbortSignal) =>
  operatorFetch(`/credit-packages/${id}`, { schema: creditPackageItemSchema, signal });

export const fetchCurrencies = (q: Partial<CurrencyListQuery>, signal?: AbortSignal) =>
  operatorFetch('/currencies', {
    query: { q: q.q, page: q.page && q.page > 1 ? q.page : undefined },
    schema: currencyListResponseSchema,
    signal,
  });

export {
  couponItemSchema,
  creditPackageItemSchema,
  currencyItemSchema,
  fetchRatesResponseSchema,
  setDefaultCurrencyResponseSchema,
};
