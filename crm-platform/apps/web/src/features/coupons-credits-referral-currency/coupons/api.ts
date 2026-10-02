import {
  couponListResponseSchema,
  couponOptionsResponseSchema,
  couponSchema,
  type CouponStatusFilter,
  type CreateCouponRequest,
  type UpdateCouponRequest,
} from '@crm/contracts';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';

/** Operator console, through the same-origin operator proxy (`/api/platform/*`). Coupons are platform-global. */
export const COUPON_KEYS = {
  all: ['operator', 'coupons'] as const,
  list: (q: string, status: CouponStatusFilter, cursor: string | undefined) =>
    ['operator', 'coupons', 'list', { q, status, cursor: cursor ?? null }] as const,
  one: (id: string) => ['operator', 'coupons', 'one', id] as const,
  options: ['operator', 'coupons', 'options'] as const,
};

export const couponApi = {
  list: (
    p: { q: string; status: CouponStatusFilter; cursor: string | undefined; limit: number },
    signal?: AbortSignal,
  ) =>
    operatorFetch('/coupons', {
      query: { q: p.q || undefined, status: p.status, limit: p.limit, cursor: p.cursor },
      schema: couponListResponseSchema,
      signal,
    }),
  options: (signal?: AbortSignal) =>
    operatorFetch('/coupons/options', { schema: couponOptionsResponseSchema, signal }),
  get: (id: string, signal?: AbortSignal) =>
    operatorFetch(`/coupons/${encodeURIComponent(id)}`, { schema: couponSchema, signal }),
  create: (body: CreateCouponRequest) =>
    operatorFetch('/coupons', { method: 'POST', body, schema: couponSchema }),
  update: (id: string, body: UpdateCouponRequest) =>
    operatorFetch(`/coupons/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body,
      schema: couponSchema,
    }),
  setActive: (id: string, value: boolean) =>
    operatorFetch(`/coupons/${encodeURIComponent(id)}/active`, {
      method: 'PUT',
      body: { value },
      schema: couponSchema,
    }),
  remove: (id: string) => operatorFetch(`/coupons/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
