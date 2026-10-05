import { z } from 'zod';
import { pageResponseSchema } from '../common/pagination';
import { uuidSchema } from '../common/ids';

/**
 * Storefront discount codes (WaDesk /store/coupons, WaCoupon). Money fields are minor units; for `percent` the `amount` is the
 * percentage (stored as a whole number clamped to 0..100, as WaDesk does). The checkout computes the discount server-side.
 */

export const STORE_COUPON_TYPES = ['percent', 'flat'] as const;
export const storeCouponTypeSchema = z.enum(STORE_COUPON_TYPES);
export type StoreCouponType = z.infer<typeof storeCouponTypeSchema>;

/** WaDesk `regex:/^[A-Za-z0-9_-]+$/`, max 64. */
export const storeCouponCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Letters, numbers, dashes and underscores only');

/** Where a coupon stands right now, derived on read. */
export const STORE_COUPON_STATES = [
  'active',
  'inactive',
  'scheduled',
  'expired',
  'exhausted',
] as const;
export const storeCouponStateSchema = z.enum(STORE_COUPON_STATES);
export type StoreCouponState = z.infer<typeof storeCouponStateSchema>;

const couponFields = {
  code: storeCouponCodeSchema,
  type: storeCouponTypeSchema,
  amount: z.number().int().min(0),
  minSubtotalMinor: z.number().int().min(0).nullish(),
  maxDiscountMinor: z.number().int().min(0).nullish(),
  freeShipping: z.boolean().default(false),
  active: z.boolean().default(true),
  startsAt: z.string().datetime({ offset: true }).nullish(),
  expiresAt: z.string().datetime({ offset: true }).nullish(),
  /** Total redemptions allowed; null is unlimited. */
  usageLimit: z.number().int().min(1).nullish(),
  /** One shop of the workspace, or null for every shop. */
  storefrontId: uuidSchema.nullish(),
};

const validWindow = (v: { startsAt?: string | null; expiresAt?: string | null }): boolean =>
  !v.startsAt || !v.expiresAt || new Date(v.startsAt).getTime() < new Date(v.expiresAt).getTime();

export const createStoreCouponSchema = z
  .object(couponFields)
  .refine(validWindow, { path: ['expiresAt'], message: 'Must be after the start' });
export type CreateStoreCouponInput = z.infer<typeof createStoreCouponSchema>;

/** A full edit (WaDesk resubmits the whole form) guarded by the row version. */
export const updateStoreCouponSchema = z
  .object({ ...couponFields, rowVersion: z.number().int().positive() })
  .refine(validWindow, { path: ['expiresAt'], message: 'Must be after the start' });
export type UpdateStoreCouponInput = z.infer<typeof updateStoreCouponSchema>;

export const storeCouponSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  type: z.string(),
  amount: z.number().int(),
  minSubtotalMinor: z.number().int().nullable(),
  maxDiscountMinor: z.number().int().nullable(),
  freeShipping: z.boolean(),
  active: z.boolean(),
  startsAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  usageLimit: z.number().int().nullable(),
  usedCount: z.number().int(),
  state: storeCouponStateSchema,
  storefrontId: uuidSchema.nullable(),
  storefrontName: z.string().nullable(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type StoreCoupon = z.infer<typeof storeCouponSchema>;

export const listStoreCouponsQuerySchema = z.object({
  q: z.string().trim().max(64).optional(),
  state: storeCouponStateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).max(512).optional(),
});
export type ListStoreCouponsQuery = z.infer<typeof listStoreCouponsQuerySchema>;

export const storeCouponListResponseSchema = pageResponseSchema(storeCouponSchema);
export type StoreCouponListResponse = z.infer<typeof storeCouponListResponseSchema>;

/** An order that used the coupon. */
export const storeCouponUsageSchema = z.object({
  orderId: uuidSchema,
  orderNo: z.number().int(),
  customerName: z.string().nullable(),
  customerPhone: z.string().nullable(),
  discountMinor: z.number().int(),
  totalMinor: z.number().int(),
  currencyCode: z.string(),
  status: z.string(),
  createdAt: z.string().datetime(),
});
export type StoreCouponUsage = z.infer<typeof storeCouponUsageSchema>;

export const listStoreCouponUsagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).max(512).optional(),
});
export type ListStoreCouponUsagesQuery = z.infer<typeof listStoreCouponUsagesQuerySchema>;

export const storeCouponUsageListResponseSchema = pageResponseSchema(storeCouponUsageSchema);
export type StoreCouponUsageListResponse = z.infer<typeof storeCouponUsageListResponseSchema>;
