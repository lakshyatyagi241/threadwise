import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { storefrontResponseSchema } from './storefront';

/** The store dashboard (WD-STORE-001): the last 30 days of one shop's workspace. */

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

export const storeOverviewSchema = z.object({
  shop: storefrontResponseSchema,
  /** Every shop of the workspace, newest update first: feeds the shop switcher (shown with two or more). */
  shops: z.array(z.object({ id: uuidSchema, shopName: z.string().nullable(), slug: z.string() })),
  stats: storeStatsSchema,
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
