import { z } from 'zod';

/**
 * The platform operator's switches for Shopify and WooCommerce (TW-ECOM-001, 002). Shopify needs the platform's own app
 * (client id and secret from the Shopify partner dashboard); WooCommerce has no app, so it is only a switch. A secret is
 * never returned: the screen learns only whether one is saved.
 */

export const shopifyPlatformSettingsSchema = z.object({
  enabled: z.boolean(),
  clientId: z.string(),
  hasSecret: z.boolean(),
  scopes: z.string(),
  redirectUri: z.string(),
  integrationsCount: z.number().int().min(0),
  eventsCount: z.number().int().min(0),
  logsCount: z.number().int().min(0),
});
export type ShopifyPlatformSettings = z.infer<typeof shopifyPlatformSettingsSchema>;

/** Every field is optional: what is left out stays as it was. A blank secret keeps the saved one. */
export const updateShopifySettingsSchema = z.object({
  enabled: z.boolean().optional(),
  clientId: z.string().trim().max(191).optional(),
  clientSecret: z.string().trim().max(191).optional(),
  scopes: z.string().trim().max(500).optional(),
  /** Empty means the default address on this install. */
  redirectUri: z.union([z.literal(''), z.string().trim().url().max(255)]).optional(),
});
export type UpdateShopifySettingsInput = z.infer<typeof updateShopifySettingsSchema>;

export const woocommercePlatformSettingsSchema = z.object({
  enabled: z.boolean(),
  integrationsCount: z.number().int().min(0),
  eventsCount: z.number().int().min(0),
  logsCount: z.number().int().min(0),
});
export type WoocommercePlatformSettings = z.infer<typeof woocommercePlatformSettingsSchema>;

export const updateWoocommerceSettingsSchema = z.object({ enabled: z.boolean() });
export type UpdateWoocommerceSettingsInput = z.infer<typeof updateWoocommerceSettingsSchema>;
