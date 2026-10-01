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
   * allowlist and the audit trail, so a spoofable value weakens all three (WaDesk trusted every proxy).
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

  // --- object storage ------------------------------------------------------
  S3_ENDPOINT: z.string().url().optional(),
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
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
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
        'DATABASE_REPLICA_URL is required in production: partner and public API reads must not hit the primary (ADR-0013).',
      );
    }
    if (parsed.data.JWT_ACCESS_SECRET.startsWith('dev-only')) {
      throw new Error('JWT_ACCESS_SECRET is still the development placeholder.');
    }
    if (parsed.data.JWT_REFRESH_SECRET.startsWith('dev-only')) {
      throw new Error('JWT_REFRESH_SECRET is still the development placeholder.');
    }
    if (parsed.data.CREDENTIALS_ENCRYPTION_KEY === DEV_ENCRYPTION_KEY) {
      throw new Error('CREDENTIALS_ENCRYPTION_KEY is still the development placeholder.');
    }
  }

  return parsed.data;
}
