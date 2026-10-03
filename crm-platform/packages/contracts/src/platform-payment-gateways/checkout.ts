import { z } from 'zod';
import { cursorSchema, pageInfoSchema } from '../common/pagination';
import { uuidSchema } from '../common/ids';
import { planSlugSchema } from '../plans-subscriptions-trials/plan';

/** Money is a decimal string end to end. Amounts a buyer types are validated by the server, never trusted. */
const decimal = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,3})?$/, 'Enter an amount such as 19 or 19.99.');

export const paygwPeriodSchema = z.enum(['monthly', 'yearly']);
export type PaygwPeriod = z.infer<typeof paygwPeriodSchema>;

export const paygwOrderKindSchema = z.enum(['plan', 'addon', 'wallet_topup', 'manual']);
export type PaygwOrderKind = z.infer<typeof paygwOrderKindSchema>;

export const paygwOrderStatusSchema = z.enum([
  'pending',
  'awaiting_approval',
  'paid',
  'failed',
  'cancelled',
  'refunded',
]);
export type PaygwOrderStatus = z.infer<typeof paygwOrderStatusSchema>;

export const paygwPlanSlugParamSchema = planSlugSchema;

export const paygwQuoteQuerySchema = z.object({
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3,5}$/)
    .optional(),
  period: paygwPeriodSchema.optional(),
  /** A coupon code to preview (plans and add-ons only; ignored for wallet top-ups). The server prices it, the browser sends no amount. */
  coupon: z.string().trim().max(64).optional(),
});
export type PaygwQuoteQuery = z.infer<typeof paygwQuoteQuerySchema>;

export const paygwWalletQuoteQuerySchema = paygwQuoteQuerySchema.extend({ amount: decimal });
export type PaygwWalletQuoteQuery = z.infer<typeof paygwWalletQuoteQuerySchema>;

export const paygwCheckoutGatewaySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  description: z.string(),
  mode: z.enum(['sandbox', 'live']),
});

export const paygwQuoteSchema = z.object({
  kind: paygwOrderKindSchema,
  itemName: z.string(),
  itemSubtitle: z.string().nullable(),
  billingPeriod: paygwPeriodSchema,
  /** The billing periods this item can be bought in (a natively yearly plan offers only yearly; add-ons and wallet only monthly). */
  periods: z.array(paygwPeriodSchema),
  currency: z.string(),
  availableCurrencies: z.array(z.string()),
  subtotal: z.string(),
  discount: z.string(),
  taxRate: z.string(),
  taxLabel: z.string(),
  tax: z.string(),
  total: z.string(),
  /** Wallet top-ups only: what the wallet gains, in minor units of the platform currency. */
  walletCreditMinor: z.number().int().nullable(),
  gateways: z.array(paygwCheckoutGatewaySchema),
  /** The coupon asked for, when one was: `ok: false` carries the reason and no discount was applied. */
  coupon: z
    .object({ code: z.string(), ok: z.boolean(), message: z.string(), discount: z.string() })
    .nullable(),
  /** The country dropdown of the billing form (billing settings, WD-PAYGW-007). */
  countries: z.array(z.string()),
  /** The money-back guarantee line under the summary; `enabled: false` hides it. */
  refund: z.object({ enabled: z.boolean(), days: z.number().int() }),
});
export type PaygwQuote = z.infer<typeof paygwQuoteSchema>;

const text = (max: number) => z.string().trim().max(max).optional();

export const paygwBillingSchema = z.object({
  customerName: text(191),
  customerEmail: z.string().trim().email().max(191).optional(),
  company: text(191),
  address: text(255),
  city: text(120),
  postal: text(32),
  country: text(80),
  taxId: text(64),
});
export type PaygwBilling = z.infer<typeof paygwBillingSchema>;

export const placePlanOrderRequestSchema = z.object({
  gatewayId: uuidSchema,
  currency: paygwQuoteQuerySchema.shape.currency,
  period: paygwPeriodSchema.optional(),
  autoRenew: z.boolean().optional(),
  coupon: text(64),
  billing: paygwBillingSchema.default({}),
});
export type PlacePlanOrderRequest = z.infer<typeof placePlanOrderRequestSchema>;

export const placeWalletOrderRequestSchema = z.object({
  gatewayId: uuidSchema,
  amount: decimal,
  currency: paygwQuoteQuerySchema.shape.currency,
  billing: paygwBillingSchema.default({}),
});
export type PlaceWalletOrderRequest = z.infer<typeof placeWalletOrderRequestSchema>;

/**
 * What the browser does next. `redirect` = leave for the provider; `client_action` = run a provider widget with these
 * parameters (no HTML ever comes from the server); `paid` = nothing more to do; `instructions` = offline payment steps.
 */
export const placeOrderResponseSchema = z.object({
  orderNumber: z.string(),
  orderId: uuidSchema,
  next: z.discriminatedUnion('type', [
    z.object({ type: z.literal('redirect'), url: z.string().url() }),
    z.object({
      type: z.literal('client_action'),
      provider: z.literal('razorpay'),
      params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    }),
    z.object({ type: z.literal('paid') }),
  ]),
});
export type PlaceOrderResponse = z.infer<typeof placeOrderResponseSchema>;

export const paygwOrderItemSchema = z.object({
  id: uuidSchema,
  orderNumber: z.string(),
  kind: paygwOrderKindSchema,
  itemName: z.string(),
  status: paygwOrderStatusSchema,
  billingPeriod: paygwPeriodSchema,
  currency: z.string(),
  amount: z.string(),
  discountAmount: z.string(),
  taxAmount: z.string(),
  couponCode: z.string().nullable(),
  gatewayName: z.string().nullable(),
  failureReason: z.string().nullable(),
  createdAt: z.string(),
  paidAt: z.string().nullable(),
});
export type PaygwOrderItem = z.infer<typeof paygwOrderItemSchema>;

export const paygwOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: cursorSchema.optional(),
});
export type PaygwOrdersQuery = z.infer<typeof paygwOrdersQuerySchema>;

export const paygwOrdersResponseSchema = z.object({
  data: z.array(paygwOrderItemSchema),
  page: pageInfoSchema,
  /** Lifetime paid total per currency (no silent conversion between currencies). */
  lifetimeSpend: z.array(
    z.object({ currency: z.string(), total: z.string(), orders: z.number().int() }),
  ),
});
export type PaygwOrdersResponse = z.infer<typeof paygwOrdersResponseSchema>;
