import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Discount coupons (TW-CPN-001..008). A coupon is a platform-wide code the operator creates and a buyer types at plan checkout.
 * Money is a decimal STRING in major units (never a float); identifiers are uuids; the plans a coupon is restricted to are
 * named by plan SLUG, the one stable plan reference the rest of the platform uses (`organizations.plan`, `orders.plan_slug`).
 */

/** Rows per page of the operator list (Reference: `paginate(12)`). */
export const COUPON_PAGE_SIZE = 12;

export const couponTypeSchema = z.enum(['percent', 'fixed']);
export type CouponType = z.infer<typeof couponTypeSchema>;

export const couponStatusFilterSchema = z.enum(['all', 'active', 'disabled', 'expired']);
export type CouponStatusFilter = z.infer<typeof couponStatusFilterSchema>;

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

/** `numeric(12,4)`: up to eight whole digits and four decimals, never negative. */
const decimal = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,4})?$/, 'Enter a number such as 10 or 12.5.');
const optionalDecimal = z.preprocess(blankToNull, decimal.nullable());
const optionalCount = z.preprocess(
  blankToNull,
  z.number().int().min(1).max(2_000_000_000).nullable(),
);
const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullable());
const optionalDate = z.preprocess(blankToNull, z.string().datetime({ offset: true }).nullable());

/** Upper-cased, trimmed; the database stores it that way and a CHECK keeps it so. */
export const couponCodeSchema = z
  .string()
  .trim()
  .min(1, 'Enter a coupon code.')
  .max(64)
  .transform((v) => v.toUpperCase());

const couponFieldsShape = {
  code: couponCodeSchema,
  description: optionalText(255).default(null),
  adminNote: optionalText(1000).default(null),
  type: couponTypeSchema.default('percent'),
  amount: decimal,
  /** Percent coupons only: the most one redemption may take off. Blank = no cap. */
  maxDiscountAmount: optionalDecimal.default(null),
  /** The one currency this coupon is priced for. Blank = any currency. */
  currencyCode: z
    .preprocess(
      blankToNull,
      z
        .string()
        .trim()
        .max(8)
        .transform((v) => v.toUpperCase())
        .nullable(),
    )
    .default(null),
  minOrderAmount: optionalDecimal.default(null),
  maxUses: optionalCount.default(null),
  perUserLimit: optionalCount.default(null),
  /** Plan or add-on slugs. Empty = any plan. */
  applicablePlans: z.array(z.string().trim().min(1).max(64)).max(200).default([]),
  startsAt: optionalDate.default(null),
  expiresAt: optionalDate.default(null),
  isActive: z.boolean().default(true),
  firstPurchaseOnly: z.boolean().default(false),
  stackableWithOther: z.boolean().default(false),
};

/** Reference: `expires_at` must be on or after `starts_at`. */
export function couponWindowIssue(
  startsAt: string | null | undefined,
  expiresAt: string | null | undefined,
): string | null {
  if (!startsAt || !expiresAt) return null;
  return Date.parse(expiresAt) < Date.parse(startsAt)
    ? 'The expiry must be on or after the start.'
    : null;
}

export const createCouponRequestSchema = z.object(couponFieldsShape).superRefine((v, ctx) => {
  const issue = couponWindowIssue(v.startsAt, v.expiresAt);
  if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: issue });
});
export type CreateCouponRequest = z.input<typeof createCouponRequestSchema>;
export type CreateCouponPayload = z.output<typeof createCouponRequestSchema>;

/**
 * Update: any subset of the fields plus the optimistic lock. A field that is sent replaces the stored one; `null` clears it
 * (Reference's form could not clear the plan restriction, so an explicit empty `applicablePlans` does here: see the parity doc).
 */
export const updateCouponRequestSchema = z
  .object(couponFieldsShape)
  .partial()
  .extend({ rowVersion: z.number().int().positive() })
  .superRefine((v, ctx) => {
    const issue = couponWindowIssue(v.startsAt, v.expiresAt);
    if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: issue });
  });
export type UpdateCouponRequest = z.input<typeof updateCouponRequestSchema>;
export type UpdateCouponPayload = z.output<typeof updateCouponRequestSchema>;

export const setCouponActiveRequestSchema = z.object({
  isActive: z.boolean(),
  rowVersion: z.number().int().positive().optional(),
});
export type SetCouponActiveRequest = z.infer<typeof setCouponActiveRequestSchema>;

export const couponListQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || undefined),
  /** Anything but the three known values behaves as `all`, as in Reference. */
  status: couponStatusFilterSchema.catch('all').default('all'),
  page: z.coerce.number().int().min(1).max(100_000).catch(1).default(1),
});
export type CouponListQuery = z.infer<typeof couponListQuerySchema>;

export const couponItemSchema = z.object({
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
  usesCount: z.number().int().nonnegative(),
  applicablePlans: z.array(z.string()),
  startsAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  isActive: z.boolean(),
  firstPurchaseOnly: z.boolean(),
  stackableWithOther: z.boolean(),
  /** `expiresAt` is in the past (computed on the server clock, so every viewer agrees). */
  isExpired: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  rowVersion: z.number().int(),
});
export type CouponItem = z.infer<typeof couponItemSchema>;

const count = z.number().int().nonnegative();

export const couponListResponseSchema = z.object({
  data: z.array(couponItemSchema),
  /** The four KPI cards: global, never narrowed by the search or the status pill. */
  summary: z.object({ total: count, active: count, expired: count, redeemed: count }),
  /** The numbers on the pills (global as well). */
  counts: z.object({ all: count, active: count, disabled: count, expired: count }),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  /** The platform default currency: what a fixed amount is shown in when the coupon has no currency lock of its own. */
  defaultCurrency: z.string(),
  /** Rows matching the search and the pill. */
  total: count,
  pageCount: count,
  /** 1-based first and last row shown ("Showing a-b of N"); 0 when the page is empty. */
  from: count,
  to: count,
});
export type CouponListResponse = z.infer<typeof couponListResponseSchema>;

/** What the coupon and credit-package forms need: the plans a coupon may be restricted to and the currencies on offer. */
export const billingOptionsResponseSchema = z.object({
  plans: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      kind: z.enum(['plan', 'addon']),
      isActive: z.boolean(),
    }),
  ),
  /** Active catalog currencies; the five Reference fallbacks when the catalog is empty. */
  currencies: z.array(
    z.object({
      code: z.string(),
      symbol: z.string().nullable(),
      name: z.string().nullable(),
      precision: z.number().int().min(0).max(6),
    }),
  ),
});
export type BillingOptionsResponse = z.infer<typeof billingOptionsResponseSchema>;

// --- the rejection reasons of the resolver (TW-CPN-006) ---------------------------------------------------------------------

export const COUPON_REJECTION_REASONS = [
  'empty',
  'not_found',
  'disabled',
  'not_started',
  'expired',
  'exhausted',
  'currency_mismatch',
  'not_stackable',
  'first_purchase_only',
  'per_user_limit',
  'below_minimum',
  'plan_mismatch',
  'no_discount',
] as const;
export type CouponRejectionReason = (typeof COUPON_REJECTION_REASONS)[number];

/** The buyer-facing sentence for each reason, in Reference's wording (translation keys can wrap these later). */
export function couponRejectionMessage(
  reason: CouponRejectionReason,
  ctx: { code?: string; currency?: string | null } = {},
): string {
  switch (reason) {
    case 'empty':
      return 'Enter a coupon code.';
    case 'not_found':
      return `Coupon "${ctx.code ?? ''}" not recognised.`;
    case 'disabled':
      return 'This coupon is disabled.';
    case 'not_started':
      return 'This coupon is not active yet.';
    case 'expired':
      return 'This coupon has expired.';
    case 'exhausted':
      return 'This coupon is fully used.';
    case 'currency_mismatch':
      return `This coupon is only valid for payments in ${(ctx.currency ?? '').toUpperCase()}.`;
    case 'not_stackable':
      return 'This coupon cannot be combined with another coupon.';
    case 'first_purchase_only':
      return 'This coupon is valid on your first purchase only.';
    case 'per_user_limit':
      return 'You have already used this coupon the maximum number of times.';
    case 'below_minimum':
      return 'Order is below the coupon minimum.';
    case 'plan_mismatch':
      return 'This coupon does not apply to this plan.';
    case 'no_discount':
      return 'Coupon yielded no discount.';
  }
}
export const COUPON_APPLIED_MESSAGE = 'Coupon applied.';
