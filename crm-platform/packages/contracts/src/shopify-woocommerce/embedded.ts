import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * The Shopify embedded app (TW-ECOM-038). The page loads inside Shopify's admin; Shopify's App Bridge hands it a short-lived signed
 * session token, and the API answers which connected store that token belongs to. Read-only: no sign-in happens, and nothing here
 * carries a credential, the store's webhook address or its secret.
 */

/** What the page needs before it can ask App Bridge for a token: the app's public client id (null while the app is off). */
export const shopifyEmbeddedConfigSchema = z.object({
  appEnabled: z.boolean(),
  clientId: z.string().nullable(),
});
export type ShopifyEmbeddedConfig = z.infer<typeof shopifyEmbeddedConfigSchema>;

export const shopifyEmbeddedSessionInputSchema = z.object({
  /** The App Bridge session token (a JWT). */
  sessionToken: z.string().trim().min(1).max(4096),
  /** The `shop` Shopify put in the page address; when given it must be the shop the token was issued for. */
  shop: z.string().trim().max(191).optional(),
});
export type ShopifyEmbeddedSessionInput = z.infer<typeof shopifyEmbeddedSessionInputSchema>;

export const shopifyEmbeddedStatusSchema = z.object({
  /** The shop the token is for, as its `*.myshopify.com` name. */
  shop: z.string(),
  /** A store with credentials is connected to a workspace. */
  connected: z.boolean(),
  store: z
    .object({
      id: uuidSchema,
      storeName: z.string().nullable(),
      status: z.string(),
      shopPlan: z.string().nullable(),
      connectedAt: z.string().datetime().nullable(),
      lastVerifiedAt: z.string().datetime().nullable(),
    })
    .nullable(),
  /** One plain sentence the page can show as it is. */
  message: z.string(),
});
export type ShopifyEmbeddedStatus = z.infer<typeof shopifyEmbeddedStatusSchema>;
