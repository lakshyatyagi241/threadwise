import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { storefrontResponseSchema } from './storefront';

/** The store dashboard (TW-STORE-001): the last 30 days of one shop's workspace. */

export const storeStatsSchema = z.object({
  /** Sum of order totals of the last 30 days, in minor units (the currency of the shop). */
  revenue30: z.number().int(),
  orders30: z.number().int(),
  /** Average order value, rounded, minor units. */
  aov: z.number().int(),
  products: z.number().int(),
  storefrontViews30: z.number().int(),
});

export const storeRecentOrderSchema = z.object({
  id: uuidSchema,
  orderNo: z.number().int(),
  customerName: z.string().nullable(),
  customerPhone: z.string().nullable(),
  /** Number of lines of the order ("N item(s)"). */
  itemsCount: z.number().int(),
  totalMinor: z.number().int(),
  currencyCode: z.string(),
  status: z.string(),
  source: z.string(),
  createdAt: z.string().datetime(),
});

/** The numbers beside the store sidebar entries (Reference shows each when above zero). Workspace-wide, every shop. */
export const storeSidebarCountsSchema = z.object({
  orders: z.number().int(),
  products: z.number().int(),
  groups: z.number().int(),
  coupons: z.number().int(),
  /** Reviews waiting for a decision. */
  reviewsPending: z.number().int(),
  /** Payment configurations of the workspace. */
  payments: z.number().int(),
  /** Active workspace-level checkout gateways. */
  gateways: z.number().int(),
  customers: z.number().int(),
});
export type StoreSidebarCounts = z.infer<typeof storeSidebarCountsSchema>;

/**
 * How the store reaches WhatsApp, for the sidebar's top card and its Live pill (Reference: any of the three ways makes it Live).
 * `official`: the primary official config is connected (`label` is its provider name). `device`: the shop's own bound device is
 * connected (`label` is "+91 98..."). `other_device`: some other device of the workspace is connected. `none`: Setup.
 */
export const storeConnectionSchema = z.object({
  kind: z.enum(['official', 'device', 'other_device', 'none']),
  label: z.string().nullable(),
  live: z.boolean(),
});
export type StoreConnection = z.infer<typeof storeConnectionSchema>;

export const storeOverviewSchema = z.object({
  shop: storefrontResponseSchema,
  /** Every shop of the workspace, newest update first: feeds the shop switcher (shown with two or more). */
  shops: z.array(z.object({ id: uuidSchema, shopName: z.string().nullable(), slug: z.string() })),
  stats: storeStatsSchema,
  counts: storeSidebarCountsSchema,
  connection: storeConnectionSchema,
  salesByDay: z.object({
    labels: z.array(z.string()),
    /** Major units, whole numbers. */
    revenue: z.array(z.number().int()),
    orders: z.array(z.number().int()),
  }),
  topProducts: z.array(z.object({ name: z.string(), qty: z.number().int() })),
  recentOrders: z.array(storeRecentOrderSchema),
});
export type StoreOverview = z.infer<typeof storeOverviewSchema>;

export const storeOverviewQuerySchema = z.object({ shopId: uuidSchema.optional() });
export type StoreOverviewQuery = z.infer<typeof storeOverviewQuerySchema>;
