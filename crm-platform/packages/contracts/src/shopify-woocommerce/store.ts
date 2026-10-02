import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * A workspace's connected store (WD-ECOM-004, 005, 006, 013, 025). One store per workspace is shown (the newest connected);
 * credentials are never returned. `connected` means credentials are held: a Shopify store whose app was uninstalled keeps its
 * row, mapping and logs but reads as not connected.
 */

const iso = z.string().datetime().nullable();

const storeBase = {
  id: uuidSchema,
  storeUrl: z.string(),
  storeName: z.string().nullable(),
  status: z.string(),
  connected: z.boolean(),
  connectedAt: iso,
  lastVerifiedAt: iso,
  productsSyncedAt: iso,
  ordersSyncedAt: iso,
  customersSyncedAt: iso,
  /** What the last import brought in, per resource. */
  syncStats: z.record(z.string(), z.number()).nullable(),
  /** The address the store delivers its webhooks to. */
  webhookUrl: z.string(),
  /** The webhooks registered on the store: topic to the store's id for it. */
  webhookIds: z.record(z.string(), z.string()),
  createdAt: z.string().datetime(),
  rowVersion: z.number().int(),
};

export const shopifyStoreSchema = z.object({
  ...storeBase,
  shopId: z.string().nullable(),
  shopEmail: z.string().nullable(),
  shopOwner: z.string().nullable(),
  shopPlan: z.string().nullable(),
  shopCurrency: z.string().nullable(),
  shopCountry: z.string().nullable(),
  /** The scopes Shopify granted. */
  scopes: z.string().nullable(),
});
export type ShopifyStore = z.infer<typeof shopifyStoreSchema>;

export const woocommerceStoreSchema = z.object({
  ...storeBase,
  storeCurrency: z.string().nullable(),
  storeCountry: z.string().nullable(),
  storeVersion: z.string().nullable(),
});
export type WoocommerceStore = z.infer<typeof woocommerceStoreSchema>;

/** What the Shopify page needs: whether the platform's app is on, what it asks for, the webhook topics, and the store. */
export const shopifyOverviewSchema = z.object({
  appEnabled: z.boolean(),
  scopes: z.string(),
  eventTopics: z.array(z.string()),
  store: shopifyStoreSchema.nullable(),
});
export type ShopifyOverview = z.infer<typeof shopifyOverviewSchema>;

export const woocommerceOverviewSchema = z.object({
  appEnabled: z.boolean(),
  eventTopics: z.array(z.string()),
  store: woocommerceStoreSchema.nullable(),
});
export type WoocommerceOverview = z.infer<typeof woocommerceOverviewSchema>;

/** The store domain: a bare handle, a full `*.myshopify.com` name or a pasted address are all accepted. */
export const connectShopifySchema = z.object({ shop: z.string().trim().min(1).max(191) });
export type ConnectShopifyInput = z.infer<typeof connectShopifySchema>;

export const shopifyConnectStartSchema = z.object({ url: z.string().url() });
export type ShopifyConnectStart = z.infer<typeof shopifyConnectStartSchema>;

export const connectWoocommerceSchema = z.object({
  storeUrl: z.string().trim().min(1).max(255),
  consumerKey: z.string().trim().min(1).max(191),
  consumerSecret: z.string().trim().min(1).max(191),
});
export type ConnectWoocommerceInput = z.infer<typeof connectWoocommerceSchema>;

/** A non-saving credential check: a failure is a 200 with `ok = false` and the reason, as the form shows it inline. */
export const woocommerceTestResultSchema = z.object({ ok: z.boolean(), message: z.string() });
export type WoocommerceTestResult = z.infer<typeof woocommerceTestResultSchema>;
