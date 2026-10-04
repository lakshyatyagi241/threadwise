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
});

export type InfraEnv = z.output<typeof infraEnvSchema>;

/** DI token for the parsed environment. */
export const INFRA_ENV = Symbol('INFRA_ENV');

/** Read at call time so tests can change the environment between runs. */
export function readInfraEnv(env: NodeJS.ProcessEnv = process.env): InfraEnv {
  return infraEnvSchema.parse(env);
}
