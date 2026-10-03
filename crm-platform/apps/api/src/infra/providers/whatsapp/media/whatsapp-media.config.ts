import { z } from 'zod';

/**
 * Settings of the WhatsApp media pipeline. Read straight from the environment (the central schema belongs to the kernel), validated at
 * call time so a test can change them between runs. Every value has a safe default.
 *
 * Where the provider is (`META_API_ENDPOINT` / `INTERAKT_API_ENDPOINT`, read by `WabaHttp`) is NOT here: it comes with the channel's
 * `MediaProviderProfile` (`media-provider.ts`), and the download guard derives its host list from that profile.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Extra download hosts to accept besides the provider's and Meta's (exact name, or `.suffix`). Empty by default. */
  WHATSAPP_MEDIA_EXTRA_HOSTS: z.string().default(''),
  /** The lookup (`GET /{media-id}`), the upload, and the wait for a download's first byte. */
  WHATSAPP_MEDIA_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(120_000)
    .default(20_000),
  /** A connection that delivers nothing for this long is cut (a stalled download). */
  WHATSAPP_MEDIA_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  /** The whole transfer, however slowly it flows: a 100 MB document on a slow link still ends. */
  WHATSAPP_MEDIA_TOTAL_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(1_800_000)
    .default(300_000),
  /** How long an uploaded media id is reused for the same file on the same number. Meta keeps ids for 30 days; this is far shorter. */
  WHATSAPP_MEDIA_UPLOAD_CACHE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 3600)
    .default(6 * 3600),
  /** How long a temporary link to a stored file works, for a provider that cannot take an upload (the provider fetches it right away). */
  WHATSAPP_MEDIA_LINK_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
});

export interface WhatsappMediaConfig {
  production: boolean;
  extraHosts: string[];
  requestTimeoutMs: number;
  idleTimeoutMs: number;
  totalTimeoutMs: number;
  uploadCacheTtlSeconds: number;
  linkTtlSeconds: number;
  maxRedirects: number;
}

export function whatsappMediaConfig(env: NodeJS.ProcessEnv = process.env): WhatsappMediaConfig {
  const v = schema.parse(env);
  return {
    production: v.NODE_ENV === 'production',
    extraHosts: v.WHATSAPP_MEDIA_EXTRA_HOSTS.split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    requestTimeoutMs: v.WHATSAPP_MEDIA_REQUEST_TIMEOUT_MS,
    idleTimeoutMs: v.WHATSAPP_MEDIA_IDLE_TIMEOUT_MS,
    totalTimeoutMs: v.WHATSAPP_MEDIA_TOTAL_TIMEOUT_MS,
    uploadCacheTtlSeconds: v.WHATSAPP_MEDIA_UPLOAD_CACHE_TTL_SECONDS,
    linkTtlSeconds: v.WHATSAPP_MEDIA_LINK_TTL_SECONDS,
    maxRedirects: 3,
  };
}
