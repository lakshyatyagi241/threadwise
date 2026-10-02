import { z } from 'zod';
import { pageInfoSchema, cursorSchema } from '../common/pagination';
import { uuidSchema } from '../common/ids';

/**
 * Discount coupons (TW-CPN-001..008). Money is a decimal string end to end. A coupon is platform-global: the operator console
 * manages them, the checkout resolves them. The amount of a percent coupon is a percentage; of a fixed coupon, a sum in whatever
 * currency the order is in (Reference parity: no conversion; the optional currency lock decides which orders it may meet).
 */
export const couponTypeSchema = z.enum(['percent', 'fixed']);
export type CouponType = z.infer<typeof couponTypeSchema>;

export const couponStatusFilterSchema = z.enum(['all', 'active', 'disabled', 'expired']);
export type CouponStatusFilter = z.infer<typeof couponStatusFilterSchema>;

export const COUPON_LIMITS = {
  code: 64,
  description: 255,
  adminNote: 1000,
  pageSize: 12,
} as const;

export const couponSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  description: z.string().nullable(),
  adminNote: z.string().nullable(),
  type: couponTypeSchema,
  amount: z.string(),
  maxDiscountAmount: z.string().nullable(),
  currencyCode: z.string().nullable(),
  minOrderAmount: z.string().nullable(),
  maxUses: z.number().int().nullable(),
  perUserLimit: z.number().int().nullable(),
  usesCount: z.number().int(),
  /** Plan and add-on slugs the coupon is limited to; empty = any plan. */
  applicablePlanSlugs: z.array(z.string()),
  startsAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  isActive: z.boolean(),
  /** `expiresAt` is in the past (a disabled coupon can be expired too). */
  isExpired: z.boolean(),
  firstPurchaseOnly: z.boolean(),
  stackableWithOther: z.boolean(),
  rowVersion: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Coupon = z.infer<typeof couponSchema>;

const money = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,8}(\.\d{1,4})?$/, `${label}: enter a number such as 10 or 10.50`);

const optionalMoney = (label: string) =>
  z.union([money(label), z.literal('').transform(() => null), z.null()]).optional();

const optionalText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v));

const optionalCount = z.union([z.number().int().min(1).max(2_000_000_000), z.null()]).optional();

const optionalDate = z
  .union([z.string().datetime({ offset: true }), z.literal('').transform(() => null), z.null()])
  .optional();

/** The fields an operator sets; the same shape creates a coupon and (partially) edits one. */
export const couponFieldsSchema = z.object({
  code: z.string().trim().min(1).max(COUPON_LIMITS.code),
  description: optionalText(COUPON_LIMITS.description),
  adminNote: optionalText(COUPON_LIMITS.adminNote),
  type: couponTypeSchema,
  amount: money('Amount'),
  maxDiscountAmount: optionalMoney('Max discount'),
  currencyCode: z
    .union([z.string().trim().toUpperCase().max(8), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v)),
  minOrderAmount: optionalMoney('Minimum order'),
  maxUses: optionalCount,
  perUserLimit: optionalCount,
  applicablePlanSlugs: z.array(z.string().trim().min(1).max(96)).max(200).optional(),
  startsAt: optionalDate,
  expiresAt: optionalDate,
  isActive: z.boolean().optional(),
  firstPurchaseOnly: z.boolean().optional(),
  stackableWithOther: z.boolean().optional(),
});

const windowOk = (v: { startsAt?: string | null; expiresAt?: string | null }) =>
  !v.startsAt || !v.expiresAt || new Date(v.expiresAt) >= new Date(v.startsAt);
const windowIssue = {
  message: 'Expires at must be on or after Starts at.',
  path: ['expiresAt'] as string[],
};

export const createCouponRequestSchema = couponFieldsSchema.refine(windowOk, windowIssue);
export type CreateCouponRequest = z.infer<typeof createCouponRequestSchema>;

/** PATCH: only what is sent changes; `null` clears an optional field, an empty plan list means "any plan". */
export const updateCouponRequestSchema = couponFieldsSchema
  .partial()
  .extend({ rowVersion: z.number().int().positive() })
  .refine(windowOk, windowIssue);
export type UpdateCouponRequest = z.infer<typeof updateCouponRequestSchema>;

export const setCouponActiveRequestSchema = z.object({ value: z.boolean() });
export type SetCouponActiveRequest = z.infer<typeof setCouponActiveRequestSchema>;

export const listCouponsQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: couponStatusFilterSchema.default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(COUPON_LIMITS.pageSize),
  cursor: cursorSchema.optional(),
});
export type ListCouponsQuery = z.infer<typeof listCouponsQuerySchema>;

export const couponListResponseSchema = z.object({
  data: z.array(couponSchema),
  page: pageInfoSchema,
  /** Rows matching the search and the status pill, over every page. */
  total: z.number().int(),
  /** The KPI strip: global, never narrowed by the search or the pill. */
  stats: z.object({
    total: z.number().int(),
    active: z.number().int(),
    expired: z.number().int(),
    redeemed: z.number().int(),
  }),
  /** The pill counts: global, like the KPIs. */
  counts: z.object({
    all: z.number().int(),
    active: z.number().int(),
    expired: z.number().int(),
  }),
});
export type CouponListResponse = z.infer<typeof couponListResponseSchema>;

/** What the coupon form offers: the plans and add-ons a coupon can be limited to, and the currencies it can be locked to. */
export const couponOptionsResponseSchema = z.object({
  plans: z.array(z.object({ slug: z.string(), name: z.string(), kind: z.enum(['plan', 'addon']) })),
  currencies: z.array(z.object({ code: z.string(), symbol: z.string().nullable() })),
});
export type CouponOptionsResponse = z.infer<typeof couponOptionsResponseSchema>;

/** The checkout's "Apply" button: the server prices the plan itself and ignores anything the browser might claim (TW-CPN-007). */
export const applyCouponRequestSchema = z.object({
  code: z.string().trim().max(COUPON_LIMITS.code),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3,5}$/)
    .optional(),
  period: z.enum(['monthly', 'yearly']).optional(),
});
export type ApplyCouponRequest = z.infer<typeof applyCouponRequestSchema>;

export const applyCouponResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  /** Major units in the order currency; "0.00" when rejected. */
  discount: z.string(),
  /** The canonical (upper-case) code, or null when rejected. */
  code: z.string().nullable(),
  /** The order summary the server computed (so the browser never recomputes tax): same currency, same period. */
  currency: z.string(),
  subtotal: z.string(),
  tax: z.string(),
  total: z.string(),
});
export type ApplyCouponResponse = z.infer<typeof applyCouponResponseSchema>;
