import { z } from 'zod';

/**
 * The platform operator's "WhatsApp Catalog" settings (WD-CAT-030): WaDesk's `system_settings` keys `catalog_*`. Only the Graph
 * API version changes behaviour (every catalog call to Meta uses it); the other fields are stored and shown and read by nothing,
 * as in WaDesk (QUIRK recorded in the parity file).
 */

/** WaDesk's default when the setting was never saved. */
export const CATALOG_DEFAULT_GRAPH_VERSION = 'v23.0';
export const CATALOG_GRAPH_VERSION_RE = /^v\d{1,2}\.\d{1,2}$/;
export const CATALOG_DEFAULT_CURRENCY = 'USD';

export const catalogSettingsUsageSchema = z.object({
  /** Workspaces with a saved catalog id. */
  workspacesConnected: z.number().int(),
  /** Products whose Meta sync status is `synced`. */
  productsSynced: z.number().int(),
  /** Rows of the catalog send log that were sent. */
  messagesSent: z.number().int(),
});

export const catalogSettingsResponseSchema = z.object({
  catalogEnabled: z.boolean(),
  commerceEnabled: z.boolean(),
  /** The version in force: the saved one, else the server default. */
  graphApiVersion: z.string(),
  metaAppId: z.string(),
  /** The app secret is write-only: only whether one is saved is returned. */
  metaAppSecretSet: z.boolean(),
  defaultCurrency: z.string(),
  usage: catalogSettingsUsageSchema,
  /** Version of the settings document, sent back on save. */
  rowVersion: z.number().int(),
});
export type CatalogSettingsResponse = z.infer<typeof catalogSettingsResponseSchema>;

export const updateCatalogSettingsSchema = z.object({
  rowVersion: z.number().int().min(0),
  catalogEnabled: z.boolean().optional(),
  commerceEnabled: z.boolean().optional(),
  /** `vNN.N`. Blank clears the saved value, so the server default applies (WaDesk saved a blank and broke the URLs; fixed). */
  graphApiVersion: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || CATALOG_GRAPH_VERSION_RE.test(v),
      'Use a Graph API version such as v23.0',
    )
    .optional(),
  metaAppId: z.string().trim().max(60).optional(),
  /** Blank keeps the saved secret. */
  metaAppSecret: z.string().trim().max(120).optional(),
  defaultCurrency: z
    .string()
    .trim()
    .refine((v) => v === '' || v.length === 3, 'Use a 3-letter currency code')
    .optional(),
});
export type UpdateCatalogSettingsInput = z.infer<typeof updateCatalogSettingsSchema>;
