import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * The public shop (WD-STORE-009..021). Nothing here needs a sign-in: the buyer is anonymous, the shop is named by its slug (or
 * its own domain), and every price and quantity in a request is re-derived on the server.
 */

export const STORE_PAGE_SIZE = 48;
export const STORE_CART_MAX_LINES = 100;
export const STORE_CART_MAX_QTY = 999;

/** One product as a theme draws it (a card or the product page). */
export const publicProductSchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  name: z.string(),
  sku: z.string().nullable(),
  description: z.string().nullable(),
  bodyHtml: z.string().nullable(),
  priceMinor: z.number().int(),
  priceDisplay: z.string(),
  comparePriceMinor: z.number().int().nullable(),
  comparePriceDisplay: z.string().nullable(),
  onSale: z.boolean(),
  currencyCode: z.string(),
  imageUrl: z.string().nullable(),
  galleryUrls: z.array(z.string()),
  category: z.string().nullable(),
  /** Null means unlimited; the cart never offers more than this. */
  stockQty: z.number().int().nullable(),
  brand: z.string().nullable(),
  /** True when the product was created within the last 14 days (the card's "New" badge). Absent on an older server. */
  isNew: z.boolean().optional(),
  /** Shown in the product page's meta list; absent when unset. */
  weightGrams: z.number().int().nullable().optional(),
  tags: z.array(z.string()).optional(),
});
export type PublicProduct = z.infer<typeof publicProductSchema>;

/** The shop block every theme page receives. */
export const publicShopSchema = z.object({
  name: z.string(),
  slug: z.string(),
  themeKey: z.string(),
  brandColor: z.string(),
  heroText: z.string(),
  footerText: z.string(),
  logoUrl: z.string().nullable(),
  currencyCode: z.string(),
  /** Digits of the number "Order on WhatsApp" opens; null when the shop has no sending number. */
  waNumber: z.string().nullable(),
  shipping: z.object({
    flatMinor: z.number().int(),
    freeAboveMinor: z.number().int(),
    note: z.string().nullable(),
  }),
  /** Provider key and the handle or link the buyer is shown after ordering; never a secret. */
  payment: z.object({ provider: z.string().nullable(), handle: z.string().nullable() }),
  publicUrl: z.string(),
});
export type PublicShop = z.infer<typeof publicShopSchema>;

export const publicHomeQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  /** `1` on a "Show more" fetch: the call is not a page view, so the daily view counter is left alone (WD-STORE-020). */
  partial: z.enum(['1']).optional(),
});
export type PublicHomeQuery = z.infer<typeof publicHomeQuerySchema>;

export const publicHomeSchema = z.object({
  shop: publicShopSchema,
  products: z.array(publicProductSchema),
  /** Categories of the products on this page only. */
  categories: z.array(z.string()),
  /** Cheapest and dearest price of this page in major units (the filter slider's range). */
  priceMin: z.number().int(),
  priceMax: z.number().int(),
  hasMore: z.boolean(),
  total: z.number().int(),
  page: z.number().int(),
});
export type PublicHome = z.infer<typeof publicHomeSchema>;

export const publicReviewSchema = z.object({
  id: uuidSchema,
  customerName: z.string().nullable(),
  rating: z.number().int(),
  body: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export const publicProductPageSchema = z.object({
  shop: publicShopSchema,
  product: publicProductSchema,
  related: z.array(publicProductSchema),
  reviews: z.array(publicReviewSchema),
  ratingAvg: z.number().nullable(),
  ratingCount: z.number().int(),
});
export type PublicProductPage = z.infer<typeof publicProductPageSchema>;

export const cartLineSchema = z.object({
  id: uuidSchema,
  qty: z.number().int().min(1).max(STORE_CART_MAX_QTY),
});
const cartItems = z.array(cartLineSchema).min(1).max(STORE_CART_MAX_LINES);

export const STORE_PAYMENT_METHODS = ['prepaid', 'cod'] as const;

export const checkoutSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(1).max(32),
  email: z.string().trim().email().max(160).nullish().or(z.literal('')),
  address: z.string().max(1000).nullish(),
  note: z.string().max(1000).nullish(),
  coupon: z.string().trim().max(64).nullish(),
  paymentMethod: z.enum(STORE_PAYMENT_METHODS).nullish(),
  items: cartItems,
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const checkoutResponseSchema = z.object({
  /** The order number the buyer is shown ("#123"). */
  orderNo: z.number().int(),
  /** `wa.me` link with the confirmation text; null when the shop has no number. */
  waUrl: z.string().nullable(),
  /** Public path of the tracking page. */
  trackUrl: z.string(),
  message: z.string(),
});
export type CheckoutResponse = z.infer<typeof checkoutResponseSchema>;

export const couponQuoteSchema = z.object({
  code: z.string().trim().min(1).max(64),
  items: cartItems,
});
export type CouponQuoteInput = z.infer<typeof couponQuoteSchema>;
export const couponQuoteResponseSchema = z.object({
  code: z.string(),
  discountMinor: z.number().int(),
  shippingMinor: z.number().int(),
  totalMinor: z.number().int(),
  freeShipping: z.boolean(),
});
export type CouponQuoteResponse = z.infer<typeof couponQuoteResponseSchema>;

export const abandonCartSchema = z.object({
  name: z.string().trim().max(120).nullish(),
  phone: z.string().trim().min(1).max(32),
  items: cartItems,
});
export type AbandonCartInput = z.infer<typeof abandonCartSchema>;
export const abandonCartResponseSchema = z.object({ scheduled: z.boolean() });

/** `POST /s/<slug>/review` as the storefront JS posts it (the product is the id the page carries). */
export const publicReviewInputSchema = z.object({
  productId: uuidSchema,
  name: z.string().trim().min(1).max(120),
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().max(1000).nullish(),
});
export type PublicReviewInput = z.infer<typeof publicReviewInputSchema>;
export const publicReviewResponseSchema = z.object({ message: z.string() });

/** The tracking page (`/s/<slug>/order/<token>`): read-only; the token is the access control. */
export const publicOrderSchema = z.object({
  shop: publicShopSchema,
  order: z.object({
    orderNo: z.number().int(),
    status: z.string(),
    paymentMethod: z.string(),
    customerName: z.string().nullable(),
    /** The delivery address the buyer typed ("Delivery to" card); absent or null when none was given. */
    customerAddress: z.string().nullable().optional(),
    items: z.array(
      z.object({
        name: z.string(),
        qty: z.number().int(),
        priceMinor: z.number().int(),
        image: z.string().nullable(),
      }),
    ),
    shippingMinor: z.number().int(),
    discountMinor: z.number().int(),
    totalMinor: z.number().int(),
    currencyCode: z.string(),
    paymentLink: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
});
export type PublicOrder = z.infer<typeof publicOrderSchema>;

/** Which shop a host serves (a verified custom domain). */
export const hostResolveQuerySchema = z.object({ host: z.string().trim().min(1).max(253) });
export type HostResolveQuery = z.infer<typeof hostResolveQuerySchema>;
export const hostResolveResponseSchema = z.object({ slug: z.string() });
export type HostResolveResponse = z.infer<typeof hostResolveResponseSchema>;

/**
 * The Razorpay webhook answer (`POST /store-public/webhooks/razorpay`): `order` is the order number the event settled, null
 * when the event named no order or the order was refused (`rejected` says why); `ignored` is the event name when it is one
 * the shop does not act on (acknowledged so Razorpay stops retrying).
 */
export const razorpayWebhookResponseSchema = z.object({
  ok: z.literal(true),
  order: z.number().int().nullable().optional(),
  ignored: z.string().optional(),
  rejected: z.enum(['order_not_in_shop', 'amount_mismatch', 'order_cancelled']).optional(),
});
export type RazorpayWebhookResponse = z.infer<typeof razorpayWebhookResponseSchema>;
