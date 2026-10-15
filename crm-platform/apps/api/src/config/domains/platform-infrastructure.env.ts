import { z } from 'zod';

/**
 * Environment of the platform-infrastructure domain (INFRA_*). Parsed here, once, at module construction: the shared
 * env.schema.ts is a kernel file this domain does not edit. A malformed value stops the process with a readable message
 * rather than becoming a silently disabled limiter.
 *
 * Compose files tend to pass an unset variable as an empty string, which must mean "not set".
 */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

export const infraEnvSchema = z.object({
  /** Master switch for the request throttle (TW-INFRA-010). Off: the guard lets everything through and sets no headers. */
  INFRA_RATE_LIMIT_ENABLED: z.preprocess(blankToUndefined, booleanish.default(true)),
  /**
   * Requests per minute for any route that carries no `@Throttle()` of its own, per caller (the actor, else the address).
   * 0 (the default) means such routes are not limited. Raise it per environment only after webhook and polling routes
   * name their policy, or provider callbacks from a shared address will be refused.
   */
  INFRA_RATE_LIMIT_DEFAULT_PER_MINUTE: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(0).max(1_000_000).default(0),
  ),
  /**
   * Largest JSON or form body, in KiB, for any route that has no class of its own below. 100 is what Express enforced before
   * this setting existed, so the default changes nothing; raise it only for a measured need, because every request is
   * buffered in memory up to this size before authentication runs.
   */
  INFRA_BODY_LIMIT_KB: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(10_240).default(100),
  ),
  /**
   * Machine-to-machine callbacks (store, channel and payment webhooks). Unauthenticated until their signature is checked,
   * which needs the whole body, so the cap has to cover the largest honest sender.
   */
  INFRA_BODY_LIMIT_WEBHOOK_KB: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(10_240).default(1024),
  ),
  /** WhatsApp Cloud API callbacks, which batch many events into one delivery and are the largest payloads we receive. */
  INFRA_BODY_LIMIT_WHATSAPP_WEBHOOK_KB: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(10_240).default(4096),
  ),
  /**
   * How often each worker process says it is alive and samples the outbox. A worker counts as alive for three beats, so one
   * missed beat (a long GC, a busy database) does not flap.
   */
  INFRA_WORKER_HEARTBEAT_SECONDS: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(2).max(60).default(10),
  ),
  /** Readiness reports the outbox as lagging once its oldest due event has waited this long. Informational: never fails /ready. */
  INFRA_OUTBOX_LAG_WARN_SECONDS: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(86_400).default(60),
  ),
  /** Event-loop and runtime monitoring in every API and worker process. On by default; off only to rule it out while debugging. */
  OBS_RUNTIME_MONITOR: z.preprocess(blankToUndefined, booleanish.default(true)),
  /** Reporting window. 10 s is the standard: long enough for stable percentiles, short enough to see a stall. */
  OBS_RUNTIME_INTERVAL_SECONDS: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(60).default(10),
  ),
  /** Port of the `GET /metrics` listener (own server, not an API route). 0, the default, collects but does not listen. */
  OBS_METRICS_PORT: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(0).max(65_535).default(0),
  ),
  /** Bind address of that listener. Loopback unless the deployment puts the scraper on the container network. */
  OBS_METRICS_HOST: z.preprocess(blankToUndefined, z.string().min(1).default('127.0.0.1')),
  /** Optional bearer token for scrapes. Set it whenever the host is not loopback. */
  OBS_METRICS_TOKEN: z.preprocess(blankToUndefined, z.string().min(16).optional()),
  /** A window whose worst loop delay reaches this many ms is logged once with the slowest requests of that window. */
  OBS_BLOCKED_LOG_THRESHOLD_MS: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(10).max(60_000).default(250),
  ),
});

export type InfraEnv = z.output<typeof infraEnvSchema>;

/** DI token for the parsed environment. */
export const INFRA_ENV = Symbol('INFRA_ENV');

/** Read at call time so tests can change the environment between runs. */
export function readInfraEnv(env: NodeJS.ProcessEnv = process.env): InfraEnv {
  return infraEnvSchema.parse(env);
}
