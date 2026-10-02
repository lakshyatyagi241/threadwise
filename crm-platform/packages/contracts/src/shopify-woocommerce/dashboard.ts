import { z } from 'zod';

/**
 * The store dashboard (WD-ECOM-023): everything the store screen's tabs show, in one read. Shopify serves it from the CRM's mirror
 * of the store; WooCommerce reads recent orders, products, customers and the 30 day sales report live from the store (an answer that
 * does not come leaves that list empty) and the CRM figures from the mirror.
 */

const iso = z.string().datetime().nullable();

export const dashboardOrderSchema = z.object({
  name: z.string(),
  customer: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  /** The store's payment status (Shopify `financial_status`, WooCommerce order status). */
  status: z.string().nullable(),
  fulfillment: z.string().nullable(),
  total: z.number(),
  currency: z.string(),
  createdAt: iso,
});
export type DashboardOrder = z.infer<typeof dashboardOrderSchema>;

export const dashboardProductSchema = z.object({
  /** The CRM's product id when the product is mirrored, else the store's own id. */
  id: z.string(),
  title: z.string(),
  vendor: z.string().nullable(),
  imageUrl: z.string().nullable(),
  productUrl: z.string().nullable(),
  price: z.number(),
  comparePrice: z.number().nullable(),
  /** Whole percent off the compare-at price; 0 when none. */
  discountPct: z.number().int().min(0).max(100),
  inStock: z.boolean(),
});
export type DashboardProduct = z.infer<typeof dashboardProductSchema>;

export const dashboardCustomerSchema = z.object({
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  ordersCount: z.number().int().min(0),
  totalSpent: z.number().min(0),
});
export type DashboardCustomer = z.infer<typeof dashboardCustomerSchema>;

export const dashboardLogSchema = z.object({
  id: z.number().int(),
  eventType: z.string(),
  status: z.string(),
  recipient: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type DashboardLog = z.infer<typeof dashboardLogSchema>;

export const dashboardTemplateSchema = z.object({
  uuid: z.string().uuid(),
  name: z.string(),
  category: z.string().nullable(),
  language: z.string(),
  /** `waba`, `twilio` or `baileys`: the engine the template belongs to. */
  engine: z.string(),
  /** The Cloud API account (provider config uuid) a WABA template is bound to; null otherwise. */
  senderAccount: z.string().uuid().nullable(),
  /** How many numbered variables ({{1}}, {{2}}, ...) the body declares; 0 means named tokens only. */
  paramCount: z.number().int().min(0),
});
export type DashboardTemplate = z.infer<typeof dashboardTemplateSchema>;

export const dashboardAnalyticsSchema = z.object({
  revenueTotal: z.number(),
  ordersTotal: z.number().int(),
  aov: z.number(),
  messagesSent: z.number().int(),
  offersSent: z.number().int(),
  /** The last 14 days of revenue, oldest first. */
  trend: z.array(z.object({ label: z.string(), value: z.number() })),
  trendMax: z.number(),
  codConfirmed: z.number().int(),
  codCancelled: z.number().int(),
  /** Confirmed COD orders times the average order. */
  codProtected: z.number(),
  /** Cancelled COD orders times the average order. */
  rtoAvoided: z.number(),
  recoverySends: z.number().int(),
});
export type DashboardAnalytics = z.infer<typeof dashboardAnalyticsSchema>;

export const dashboardSenderSchema = z.object({
  /** `engine:uuid`. */
  key: z.string(),
  label: z.string(),
  engine: z.string(),
});
export type DashboardSender = z.infer<typeof dashboardSenderSchema>;

export const storeDashboardSchema = z.object({
  currency: z.string(),
  counts: z.object({
    products: z.number().int(),
    orders: z.number().int(),
    customers: z.number().int(),
  }),
  activeEvents: z.number().int(),
  logTotal: z.number().int(),
  logsByStatus: z.record(z.string(), z.number().int()),
  logsByEvent: z.record(z.string(), z.number().int()),
  recentLogs: z.array(dashboardLogSchema),
  orders: z.array(dashboardOrderSchema),
  products: z.array(dashboardProductSchema),
  /** Shopify: the discounted, newest and priciest products (8 each). Empty for WooCommerce. */
  offers: z.array(dashboardProductSchema),
  newArrivals: z.array(dashboardProductSchema),
  popular: z.array(dashboardProductSchema),
  customers: z.array(dashboardCustomerSchema),
  /** Templates an automation or broadcast can send now. */
  templates: z.array(dashboardTemplateSchema),
  contactGroups: z.array(z.object({ uuid: z.string().uuid(), name: z.string(), color: z.string().nullable() })),
  coupons: z.array(z.object({ code: z.string(), type: z.string(), amount: z.number() })),
  /** WooCommerce: the mirrored products an offer can be about. */
  offerProducts: z.array(z.object({ uuid: z.string().uuid(), name: z.string(), priceMinor: z.number() })),
  analytics: dashboardAnalyticsSchema,
  /** Revenue shown on the overview: WooCommerce's 30 day sales report, Shopify's recent mirrored orders. */
  revenue30d: z.number(),
  /** WooCommerce only: the rest of the sales report, the numbers it can be sent from, and the chosen one. */
  woo: z
    .object({
      orders30d: z.number().int(),
      customers30d: z.number().int(),
      itemsSold30d: z.number().int(),
      senders: z.array(dashboardSenderSchema),
      senderKey: z.string().nullable(),
    })
    .nullable(),
});
export type StoreDashboard = z.infer<typeof storeDashboardSchema>;
