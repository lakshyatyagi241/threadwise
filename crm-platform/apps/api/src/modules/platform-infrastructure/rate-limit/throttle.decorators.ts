import { SetMetadata } from '@nestjs/common';
import { resolveThrottle, type ThrottleInput, type ThrottleSpec } from './rate-limit.policies';

export const THROTTLE_KEY = 'infra:throttle';
export const SKIP_THROTTLE_KEY = 'infra:throttle:skip';

/**
 * Limits how often one caller may reach this handler (or every handler of the controller). A handler's own decorator wins
 * over its controller's.
 *
 *   @Throttle('auth')                                        // a named policy
 *   @Throttle({ limit: 5, windowSeconds: 3600, by: 'ip' })   // or an explicit one
 *
 * Over the limit the caller gets 429 `RATE_LIMITED` (problem+json) with `Retry-After`.
 */
export const Throttle = (input: ThrottleInput) =>
  SetMetadata<string, ThrottleSpec>(THROTTLE_KEY, resolveThrottle(input));

/** Opts a handler or controller out of every limit, including the environment-wide default. For probes and nothing else. */
export const SkipThrottle = () => SetMetadata(SKIP_THROTTLE_KEY, true);
