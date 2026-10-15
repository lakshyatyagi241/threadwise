import { z } from 'zod';

/**
 * Environment of the whatsapp-cloud-api-waba domain: how this platform reaches WhatsApp.
 *
 * Two routes exist, both Meta Cloud API underneath (mirrors Geta's production setup):
 *  - `interakt`: the BSP Interakt, a Graph proxy at `amped-express.interakt.ai`. Calls carry `x-access-token` (the shared
 *    tech-partner key) plus `x-waba-id`. Onboarding still does the Embedded Signup exchange against Meta Graph and then
 *    registers the WABA with Interakt (`tp-signup`).
 *  - `meta`: Graph directly, `Authorization: Bearer <business token>`.
 *
 * The Meta app / Interakt partner values below are PLATFORM-wide (one Meta app serves every workspace). They live in the
 * environment until the platform settings store (TW-SET) can hold them; every reader goes through `WABA_ENV`, so moving them is
 * a one-file change. Parsed here, once, at module construction: a malformed value stops the process with a readable message.
 *
 * Compose files pass an unset variable as an empty string, which must mean "not set".
 */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = (max = 512) =>
  z.preprocess(blankToUndefined, z.string().max(max).optional());
const versionString = z.string().regex(/^v\d{1,2}\.\d{1,2}$/, 'must look like v25.0');
const urlString = z.string().url();

export const wabaEnvSchema = z.object({
  /** Which route a newly connected number uses when the connect request does not say. */
  WABA_DEFAULT_PROVIDER: z.preprocess(
    blankToUndefined,
    z.enum(['interakt', 'meta']).default('interakt'),
  ),

  // --- Meta Graph (direct, and the onboarding exchange for both routes) -------------------------------------------
  META_API_ENDPOINT: z.preprocess(
    blankToUndefined,
    urlString.default('https://graph.facebook.com'),
  ),
  META_API_VERSION: z.preprocess(blankToUndefined, versionString.default('v25.0')),

  // --- Interakt (amped-express proxy) -----------------------------------------------------------------------------
  INTERAKT_API_ENDPOINT: z.preprocess(
    blankToUndefined,
    urlString.default('https://amped-express.interakt.ai/api'),
  ),
  INTERAKT_API_VERSION: z.preprocess(blankToUndefined, versionString.default('v25.0')),
  /** `/media_handle` is only exposed on Interakt's older API version (Geta pins v17.0 for it). */
  INTERAKT_MEDIA_API_VERSION: z.preprocess(blankToUndefined, versionString.default('v17.0')),
  /** Where a new WABA is registered with Interakt after Embedded Signup. */
  INTERAKT_TP_SIGNUP_URL: z.preprocess(
    blankToUndefined,
    urlString.default('https://api.interakt.ai/v1/organizations/tp-signup/'),
  ),

  // --- The one Meta app / Interakt partner the whole platform onboards through ------------------------------------
  META_APP_ID: optionalString(64),
  META_APP_SECRET: optionalString(128),
  /** Embedded Signup configuration id (Facebook Login for Business). Empty: workspaces paste a token manually. */
  META_EMBEDDED_CONFIG_ID: optionalString(64),
  /**
   * A second Login-for-Business configuration, used only to create a catalog: its token carries `catalog_management`, which the
   * WhatsApp Embedded Signup token does not. Unset keeps the old behaviour (the number's own token is tried).
   */
  META_CATALOGUE_CONFIG_ID: optionalString(64),
  /** Interakt's Embedded Signup solution id (`extras.setup.solutionID`) and the same id sent in `tp-signup`. */
  INTERAKT_SOLUTION_ID: optionalString(64),
  /** Shared tech-partner key: `x-access-token` on every Interakt call, `Authorization` on `tp-signup`. */
  INTERAKT_PARTNER_AUTH_KEY: optionalString(512),
  /**
   * Pinnacle's partner-key API (`create-user-account`, `client-embedded-detail-receiver`, `share-creditline-api`). Pinnacle offers no
   * white-label address for these, so they stay on its own host, apart from the provider's `baseUrl` (where messages are sent, which
   * is the white-label subdomain).
   */
  PINNACLE_PARTNER_API_URL: z.preprocess(
    blankToUndefined,
    urlString.default('https://partnersv1.pinbot.ai'),
  ),
  /** Platform system user: authorises the token exchange and is assigned to each WABA (`MANAGE`). */
  META_SYSTEM_USER_ID: optionalString(64),
  META_SYSTEM_USER_TOKEN: optionalString(1024),
  /** The platform's own business id; fallback to find a WABA when `debug_token` does not list one. */
  META_BUSINESS_ID: optionalString(64),

  /** Offer "connect my existing Business App number" (coexistence) in Embedded Signup. */
  WABA_COEXISTENCE: z.preprocess(
    blankToUndefined,
    z
      .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
      .transform((v) => v === true || v === 'true' || v === '1')
      .default(false),
  ),
  /** Webhook handshake token. Normally saved in the platform settings; this is the env fallback. */
  WABA_VERIFY_TOKEN: optionalString(96),

  // --- Inbound -----------------------------------------------------------------------------------------------------
  /**
   * Public origin Meta/Interakt can reach, without a trailing slash. The per-phone callback override points at
   * `<WABA_WEBHOOK_PUBLIC_URL>/v2/public/webhooks/whatsapp`. Falls back to APP_URL; must be https in production.
   */
  WABA_WEBHOOK_PUBLIC_URL: z.preprocess(blankToUndefined, urlString.optional()),
  /**
   * Interakt does not document a body signature. Off by default for the `interakt` route; the `meta` route always
   * verifies `X-Hub-Signature-256` when an app secret exists. Set true to also require it from Interakt-forwarded events.
   */
  WABA_REQUIRE_INTERAKT_SIGNATURE: z.preprocess(
    blankToUndefined,
    z
      .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
      .transform((v) => v === true || v === 'true' || v === '1')
      .default(false),
  ),
  /**
   * Comma-separated source addresses whose unsigned, key-less POSTs to the WhatsApp callback are accepted: a relay (Geta's
   * callback forwarder) that re-posts the raw body and drops Meta's signature header. Matched against the client IP that
   * `TRUST_PROXY` resolves, so keep that setting exact. Empty (default) trusts nobody; `WABA_REQUIRE_INTERAKT_SIGNATURE` still wins.
   */
  WABA_TRUSTED_FORWARDER_IPS: z.preprocess(
    blankToUndefined,
    z
      .string()
      .transform((v) =>
        v
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      )
      .default(''),
  ),
  /**
   * Development only: let a provider of the WhatsApp provider registry live on a loopback or private address over plain http (a stand-in
   * server on the developer's machine). Ignored when NODE_ENV is `production`: the registry's addresses are typed by an operator and
   * every call to them carries a credential, so production only ever reaches public https hosts.
   */
  WABA_PROVIDER_ALLOW_PRIVATE_HOSTS: z.preprocess(
    blankToUndefined,
    z
      .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
      .transform((v) => v === true || v === 'true' || v === '1')
      .default(false),
  ),
  /** Per-request ceiling for calls to Meta/Interakt, in ms. */
  WABA_HTTP_TIMEOUT_MS: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1000).max(120_000).default(15_000),
  ),
});

export type WabaEnv = z.infer<typeof wabaEnvSchema>;

export function readWabaEnv(raw: Record<string, unknown>): WabaEnv {
  const parsed = wabaEnvSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid whatsapp-cloud-api-waba environment:\n${details}\n`);
  }
  return parsed.data;
}

/** Injection token for the parsed environment. */
export const WABA_ENV = Symbol('WABA_ENV');
