import { z } from 'zod';

/**
 * The complete environment contract.
 *
 * Validated once at bootstrap. A missing or malformed value stops the process
 * with a readable list of what is wrong — the alternative is `undefined`
 * silently becoming a connection string at 3am.
 */

/** The value shipped in .env.example. Refused in production. */
const DEV_ENCRYPTION_KEY = 'ZGV2LW9ubHktMzItYnl0ZS1rZXktZG8tbm90LXVzZSE=';

const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_URL: z.string().url().default('http://localhost:3000'),
  /**
   * Which proxies' X-Forwarded-For to believe (express `trust proxy`): a hop count, 'loopback', or a
   * comma-separated list of addresses/CIDRs. The client IP feeds the login lockout, the operator IP
   * allowlist and the audit trail, so a spoofable value weakens all three (Reference trusted every proxy).
   */
  TRUST_PROXY: z.string().default('loopback'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  /** true = BullMQ processors only, no HTTP listener. Same image, different role. */
  WORKER_MODE: booleanish.default(false),

  // --- database ------------------------------------------------------------
  /** Application connection. MUST be a non-superuser, or RLS is bypassed. */
  DATABASE_URL: z.string().min(1),
  DATABASE_REPLICA_URL: z.string().min(1).optional(),
  /** Owner connection, used only by the migration/seed CLI. */
  MIGRATION_DATABASE_URL: z.string().min(1).optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15_000),

  // --- redis ---------------------------------------------------------------
  REDIS_URL: z.string().min(1),

  // --- auth ----------------------------------------------------------------
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  /**
   * Retired signing secrets, comma-separated, accepted for VERIFYING only (each at least 32 characters). Rotation without
   * signing everyone out: move the old JWT_*_SECRET here, put the new one in JWT_*_SECRET, remove the old one after
   * one refresh lifetime (JWT_REFRESH_TTL).
   */
  JWT_ACCESS_PREVIOUS_SECRETS: z.string().optional(),
  JWT_REFRESH_PREVIOUS_SECRETS: z.string().optional(),
  /**
   * What the authentication checks do when Redis errors: 'closed' refuses with 503 (no revocation or throttle is ever
   * silently skipped), 'open' carries on and logs. Unset: closed in production, open elsewhere (modules/auth/support/resilience.ts).
   */
  AUTH_REDIS_FAILURE_MODE: z.enum(['open', 'closed']).optional(),
  /**
   * Passkeys (WebAuthn). The relying-party id is the host of WEB_APP_URL and the accepted origin is WEB_APP_URL's origin;
   * set these only when the browser reaches the app on a different host (several subdomains sharing one registrable domain).
   */
  WEBAUTHN_RP_ID: z.string().min(1).optional(),
  WEBAUTHN_ORIGINS: z.string().optional(),

  /**
   * Clerk verifies the credential (password, Google) client-side and hands
   * the frontend a Clerk session token. This backend never sees a password —
   * it verifies that token server-side with this key, then issues its own
   * short-lived JWT pair as usual so every existing guard/service is
   * unchanged. See modules/auth/clerk.service.ts.
   */
  CLERK_SECRET_KEY: z.string().min(1),

  /**
   * AES-256-GCM key for reversible secrets (channel tokens, API-key HMAC
   * secrets, gateway credentials). 32 bytes, base64: openssl rand -base64 32
   */
  CREDENTIALS_ENCRYPTION_KEY: z
    .string()
    .min(44, 'CREDENTIALS_ENCRYPTION_KEY must be a base64-encoded 32-byte key'),
  /**
   * Retired encryption keys, comma-separated base64, kept only so old blobs still decrypt while
   * `pnpm --filter @crm/api secrets:reencrypt` re-seals them under the current key (then remove).
   */
  CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS: z.string().optional(),

  // --- object storage ------------------------------------------------------
  /** Where chat media lives when the platform storage settings name no bucket: `local` (this container's disk) or `s3` (the S3_* bucket). */
  MEDIA_STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  S3_ENDPOINT: z.string().url().optional(),
  /** The address outsiders (a browser, a WhatsApp provider) use to reach the bucket when `S3_ENDPOINT` is a private one such as `http://minio:9000`; links are signed against it. */
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET_MEDIA: z.string().default('crm-media'),
  S3_BUCKET_DOCUMENTS: z.string().default('crm-documents'),
  S3_BUCKET_EXPORTS: z.string().default('crm-exports'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: booleanish.default(true),

  // --- email ---------------------------------------------------------------
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_FROM: z.string().default('no-reply@localhost'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: booleanish.default(false),

  // --- web app / branding (links in transactional mail, OAuth redirects) ----
  WEB_APP_URL: z.string().url().default('http://localhost:3001'),
  /** Brand name used in mail and the TOTP issuer until the branding domain lands. */
  APP_NAME: z.string().default('CRM Platform'),

  // --- providers -----------------------------------------------------------
  META_GRAPH_VERSION: z.string().default('v21.0'),
  /** Wrap the links in broadcasts so a tap is attributed to the recipient (TW-BCAST-018). */
  LINK_TRACKING_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v.toLowerCase() !== 'false'),
  /** How long a tracked link works, in days; never below 7. */
  LINK_TRACKING_TTL_DAYS: z.coerce.number().int().min(7).default(90),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  /** The Meta app Facebook logs in through (TW-FB-002). Each falls back to the WhatsApp app's value, as in Reference. */
  META_APP_ID: z.string().optional(),
  FB_APP_ID: z.string().optional(),
  FB_APP_SECRET: z.string().optional(),
  FB_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  /** A Login-for-Business configuration id; when set it drives the login dialog. */
  FB_CONFIG_ID: z.string().optional(),
  FB_GRAPH_VERSION: z.string().optional(),
  /** The Graph version the welcome greeting is retried on when the configured one has dropped it; empty disables the retry. */
  FB_GREETING_GRAPH_VERSION: z.string().default('v19.0'),
  /**
   * Dev-only simulated messaging channel (chat conversations). Declared here so a value in .env reaches process.env (only validated
   * keys are assigned there); the rule lives in config/domains/chat-conversations.env.ts. A production process that sets it does not boot.
   */
  CHANNEL_SIMULATOR_ENABLED: booleanish.default(false),
  /**
   * The FAQ engine's AI vendor (ADR-0021): `openrouter` (the default, with a key from the AI keys screens) or `fixture`, an offline
   * stand-in for tests and demos that embeds by shared words and needs no key or network. Declared here because only declared
   * keys of a `.env` file reach `process.env`. A production process that sets `fixture` does not boot.
   */
  // Workspace inactivity lifecycle (ADR-0028). Three independent switches, all safe by default.
  /** Master switch for the daily sweep. Off = no reminders, archives or erasures. */
  ORG_LIFECYCLE_ENABLED: booleanish.default(false),
  /** On = decisions are only logged, nothing changes. Turn the sweep on in dry run first. */
  ORG_LIFECYCLE_DRY_RUN: booleanish.default(true),
  /** Erasure is a second switch: archiving can be live while erasing is not. */
  ORG_LIFECYCLE_DELETE_ENABLED: booleanish.default(false),
  /**
   * How long the platform keeps its own sales records (orders) after a workspace is erased, without the buyer's identity. Tax law sets
   * the period; 8 years covers India's GST rules. Confirm with legal before changing.
   */
  FINANCIAL_RECORD_RETENTION_YEARS: z.coerce.number().int().min(1).max(15).default(8),
  // Event-based analytics (docs/superpowers/specs/2026-10-16-event-based-analytics-design.md).
  /** Master switch for writing analytics events. Off = `AnalyticsEvents.record` does nothing. */
  ANALYTICS_EVENTS_ENABLED: booleanish.default(true),
  /**
   * Each event insert runs in a savepoint so a failure cannot abort the caller's transaction. Turn off only if the Phase 0 benchmark
   * shows the savepoint costs too much; the writer then validates in code and a database error fails the caller's transaction.
   */
  ANALYTICS_EVENT_SAVEPOINT: booleanish.default(true),
  /** The rollup worker (every 30 seconds) and its nightly reconcile. */
  ANALYTICS_ROLLUP_ENABLED: booleanish.default(true),
  /** JSON map of metric key to `legacy` | `shadow` | `rollup`. Anything missing or invalid is `legacy`. */
  ANALYTICS_SOURCES: z.string().default('{}'),
  // --- data retention (docs/runbooks/data-retention.md) --------------------
  /** The nightly job that exports closed partitions to the archive and drops them. Off until an operator has run it as a dry run. */
  RETENTION_ENABLED: booleanish.default(false),
  /** With the job on: log which months it would archive and change nothing. Set false to archive and drop for real. */
  RETENTION_DRY_RUN: booleanish.default(true),
  /** Where closed partitions are archived: `local` (a directory on this host, development only) or `s3` (the S3_* bucket below). */
  ARCHIVE_DRIVER: z.enum(['local', 's3']).default('local'),
  /** The directory for `ARCHIVE_DRIVER=local`. Empty means `.archive` under the working directory. */
  ARCHIVE_LOCAL_DIR: z.string().optional(),
  S3_BUCKET_ARCHIVE: z.string().default('crm-archive'),
  FAQ_AI_DRIVER: z.enum(['openrouter', 'fixture']).optional(),
  /** Overrides OpenRouter's base URL for the FAQ engine (a gateway, a local stub). */
  FAQ_OPENROUTER_BASE_URL: z.string().url().optional(),
  /**
   * AI lead scoring's AI vendor: `openrouter` (the default, with a key from the AI keys screens) or `fixture`, an offline stand-in for
   * tests and demos that needs no key or network. A production process that sets `fixture` does not boot.
   */
  LEAD_SCORING_AI_DRIVER: z.enum(['openrouter', 'fixture']).optional(),
  /** Overrides OpenRouter's base URL for lead scoring (a gateway, a local stub). */
  LEAD_SCORING_OPENROUTER_BASE_URL: z.string().url().optional(),
  EASEBUZZ_ENV: z.enum(['test', 'prod']).default('test'),
  EASEBUZZ_KEY: z.string().optional(),
  EASEBUZZ_SALT: z.string().optional(),

  // --- public api ----------------------------------------------------------
  PUBLIC_API_HMAC_WINDOW_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  PUBLIC_API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),

  // --- observability -------------------------------------------------------
  SENTRY_DSN: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Nest's ConfigModule `validate` hook. Throws with every problem listed at
 * once rather than failing on the first one — fixing five vars across five
 * restarts is a waste of everybody's time.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}\n`);
  }

  // Guard rails that depend on more than one variable, so they cannot live in
  // the schema itself.
  if (parsed.data.NODE_ENV === 'production') {
    if (!parsed.data.DATABASE_REPLICA_URL) {
      throw new Error(
        'DATABASE_REPLICA_URL is required in production: partner and public API reads must not hit the primary.',
      );
    }
    if (parsed.data.JWT_ACCESS_SECRET.startsWith('dev-only')) {
      throw new Error('JWT_ACCESS_SECRET is still the development placeholder.');
    }
    if (parsed.data.JWT_REFRESH_SECRET.startsWith('dev-only')) {
      throw new Error('JWT_REFRESH_SECRET is still the development placeholder.');
    }
    if (parsed.data.FAQ_AI_DRIVER === 'fixture') {
      throw new Error(
        'FAQ_AI_DRIVER=fixture must not be set in production: the fixture is an offline stand-in, not the AI vendor.',
      );
    }
    if (parsed.data.JWT_ACCESS_SECRET === parsed.data.JWT_REFRESH_SECRET) {
      throw new Error(
        'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ: with one key a leaked access token could be replayed as a refresh token.',
      );
    }
    const retired = [
      parsed.data.JWT_ACCESS_PREVIOUS_SECRETS,
      parsed.data.JWT_REFRESH_PREVIOUS_SECRETS,
    ]
      .flatMap((v) => (v ?? '').split(','))
      .map((v) => v.trim())
      .filter(Boolean);
    if (retired.some((v) => v.startsWith('dev-only') || v.length < 32)) {
      throw new Error(
        'JWT_*_PREVIOUS_SECRETS must each be at least 32 characters and not a development placeholder.',
      );
    }
    if (parsed.data.CHANNEL_SIMULATOR_ENABLED) {
      throw new Error(
        'CHANNEL_SIMULATOR_ENABLED must not be set in production: the channel simulator writes customer messages on request.',
      );
    }
    if (parsed.data.CREDENTIALS_ENCRYPTION_KEY === DEV_ENCRYPTION_KEY) {
      throw new Error('CREDENTIALS_ENCRYPTION_KEY is still the development placeholder.');
    }
  }

  return parsed.data;
}
