import { z } from 'zod';

/**
 * Settings of the Geta console publishing (an addition to the flow builder). Read once by the provider module and by the settings
 * service; a bad value stops the boot with a readable message, like the rest of the config. The credentials themselves are NOT
 * here: each workspace enters its own under Settings and they are stored sealed.
 */
const bool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

const getaPublishEnvSchema = z.object({
  /**
   * `live` calls the Geta console; `fixture` is a deterministic in-memory stand-in (nothing leaves the machine). When unset it is
   * `fixture` everywhere except production, so a development machine can never publish a real bot by accident.
   */
  GETA_PUBLISH_MODE: z.enum(['live', 'fixture']).optional(),
  /** Per request, in milliseconds. */
  GETA_PUBLISH_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
  /** Total tries per call: a network error, a timeout, a 429 or a 5xx is tried again with backoff; other 4xx never. */
  GETA_PUBLISH_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(6).default(3),
  /** First backoff; it doubles on every further try. */
  GETA_PUBLISH_BACKOFF_MS: z.coerce.number().int().min(0).max(30_000).default(500),
  /** Lets the base URL point at a private or loopback address (a local stub). Never on in production. */
  GETA_PUBLISH_ALLOW_PRIVATE_HOSTS: bool.default(false),
});

export interface GetaPublishEnv {
  mode: 'live' | 'fixture';
  timeoutMs: number;
  maxAttempts: number;
  backoffMs: number;
  allowPrivateHosts: boolean;
}

export function readGetaPublishEnv(
  raw: Record<string, string | undefined> = process.env,
): GetaPublishEnv {
  const blank = (v: string | undefined) =>
    v === undefined || v.trim() === '' ? undefined : v.trim();
  const parsed = getaPublishEnvSchema.safeParse({
    GETA_PUBLISH_MODE: blank(raw.GETA_PUBLISH_MODE),
    GETA_PUBLISH_TIMEOUT_MS: blank(raw.GETA_PUBLISH_TIMEOUT_MS),
    GETA_PUBLISH_MAX_ATTEMPTS: blank(raw.GETA_PUBLISH_MAX_ATTEMPTS),
    GETA_PUBLISH_BACKOFF_MS: blank(raw.GETA_PUBLISH_BACKOFF_MS),
    GETA_PUBLISH_ALLOW_PRIVATE_HOSTS: blank(raw.GETA_PUBLISH_ALLOW_PRIVATE_HOSTS),
  });
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid Geta publish configuration:\n${details}\n`);
  }
  const e = parsed.data;
  return {
    mode: e.GETA_PUBLISH_MODE ?? (raw.NODE_ENV === 'production' ? 'live' : 'fixture'),
    timeoutMs: e.GETA_PUBLISH_TIMEOUT_MS,
    maxAttempts: e.GETA_PUBLISH_MAX_ATTEMPTS,
    backoffMs: e.GETA_PUBLISH_BACKOFF_MS,
    allowPrivateHosts: e.GETA_PUBLISH_ALLOW_PRIVATE_HOSTS,
  };
}
