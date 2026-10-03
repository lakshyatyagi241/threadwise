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
  /** True when the buyer may tick "renew automatically" with this gateway for this purchase (WD-PAYGW-012). */
  autoRenew: z.boolean(),
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
      provider: z.enum(['razorpay', 'paddle', 'cashfree', 'hyperpay', 'braintree']),
      params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    }),
    /** The browser POSTs these fields to the provider's page (PayU): built from plain data, never from server HTML. */
    z.object({
      type: z.literal('form_post'),
      url: z.string().url(),
      fields: z.record(z.string(), z.string()),
    }),
    /** Bank transfer and offline gateways: what to do, then upload proof (WD-PAYGW-013). The order number is the payment reference. */
    z.object({
      type: z.literal('instructions'),
      kind: z.enum(['bank_transfer', 'offline']),
      rows: z.array(z.object({ label: z.string(), value: z.string() })),
      notes: z.string().nullable(),
      amount: z.string(),
      currency: z.string(),
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
  /** A pending bank-transfer or offline order: the buyer can still attach (or replace) payment proof. */
  acceptsProof: z.boolean(),
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

/** Proof of an offline payment (WD-PAYGW-013): the file is multipart `proof`; these are the text fields beside it. */
export const PAYGW_PROOF_MAX_BYTES = 4 * 1024 * 1024;
export const paygwProofFieldsSchema = z.object({
  paymentReference: z.string().trim().max(120).optional(),
  proofNote: z.string().trim().max(1000).optional(),
});
export type PaygwProofFields = z.infer<typeof paygwProofFieldsSchema>;

export const paygwProofResponseSchema = z.object({
  orderNumber: z.string(),
  status: paygwOrderStatusSchema,
  proofSubmittedAt: z.string(),
});
export type PaygwProofResponse = z.infer<typeof paygwProofResponseSchema>;

/**
 * In-app payment confirmation (WD-PAYGW-034): a client that finished a provider flow itself (a native SDK, a signed result)
 * posts what the provider gave it for ITS OWN order. The server asks the driver to verify it exactly as the web return does;
 * nothing the client says marks an order paid by itself.
 */
export const paygwConfirmRequestSchema = z.object({
  payload: z.record(z.string().max(64), z.string().max(4096)).default({}),
});
export type PaygwConfirmRequest = z.infer<typeof paygwConfirmRequestSchema>;

export const paygwConfirmResponseSchema = z.object({
  orderNumber: z.string(),
  status: z.enum(['paid', 'pending', 'failed', 'cancelled']),
  /** True when the order was already paid before this call (a replay): nothing was applied twice. */
  alreadyPaid: z.boolean(),
});
export type PaygwConfirmResponse = z.infer<typeof paygwConfirmResponseSchema>;
