import { z } from 'zod';

/**
 * Settings of the catalog domain (TW-CAT-030, 034). Reference kept them in the platform operator's system settings
 * (`catalog_graph_api_version`, `baileys_server_url`); there is no platform-settings store in this repo yet, so they are
 * environment values read once by the provider module. When that store lands, the reader below is the one place to change.
 */
const catalogEnvSchema = z.object({
  /** `live` talks to Meta, 360dialog and the Node bridge; `fixture` is the in-memory sandbox (tests, and the UI without Meta). */
  CAT_PROVIDER_MODE: z.enum(['live', 'fixture']).default('live'),
  /** Reference's `catalog_graph_api_version`, default `v23.0`. */
  CAT_GRAPH_API_VERSION: z
    .string()
    .regex(/^v\d{1,2}\.\d{1,2}$/, 'Use a Graph API version such as v23.0')
    .default('v23.0'),
  /** Reference's `baileys_server_url` (else `SERVER_URL`), default `http://localhost:8888`. */
  BAILEYS_SERVER_URL: z.string().url().default('http://localhost:8888'),
  /** Sent as `X-Node-Token` when set. */
  BAILEYS_SERVER_TOKEN: z.string().min(1).optional(),
  /** How often the Meta resync sweep runs (TW-CAT-013); Reference recommended hourly. */
  CAT_RESYNC_INTERVAL_MS: z.coerce.number().int().min(60_000).default(3_600_000),
  /** The Meta app and its catalog login configuration (see META_CATALOGUE_CONFIG_ID); the same app WhatsApp Embedded Signup uses. */
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_CATALOGUE_CONFIG_ID: z.string().optional(),
});

export type CatalogEnv = z.infer<typeof catalogEnvSchema>;

/** Reads and validates the catalog settings; a bad value stops the boot with a readable message, like the rest of the config. */
export function readCatalogEnv(raw: Record<string, string | undefined> = process.env): CatalogEnv {
  const blank = (v: string | undefined) =>
    v === undefined || v.trim() === '' ? undefined : v.trim();
  const parsed = catalogEnvSchema.safeParse({
    CAT_PROVIDER_MODE: blank(raw.CAT_PROVIDER_MODE),
    CAT_GRAPH_API_VERSION: blank(raw.CAT_GRAPH_API_VERSION),
    BAILEYS_SERVER_URL: blank(raw.BAILEYS_SERVER_URL) ?? blank(raw.SERVER_URL),
    BAILEYS_SERVER_TOKEN: blank(raw.BAILEYS_SERVER_TOKEN),
    CAT_RESYNC_INTERVAL_MS: blank(raw.CAT_RESYNC_INTERVAL_MS),
    META_APP_ID: blank(raw.META_APP_ID),
    META_APP_SECRET: blank(raw.META_APP_SECRET),
    META_CATALOGUE_CONFIG_ID: blank(raw.META_CATALOGUE_CONFIG_ID),
  });
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid catalog configuration:\n${details}\n`);
  }
  return parsed.data;
}
