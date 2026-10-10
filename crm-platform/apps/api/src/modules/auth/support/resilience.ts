import { HttpStatus, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';

const logger = new Logger('AuthResilience');
let lastReported = 0;

/**
 * What the authentication checks do when Redis (revocation tombstones, throttles, MFA challenges) errors.
 *
 *   closed  refuse with 503: a revoked session never works because a cache was down, and brute-force protection is
 *           never silently off. This is the default in production.
 *   open    carry on without the check. The default everywhere else (laptops, CI), and an explicit opt-in in
 *           production: AUTH_REDIS_FAILURE_MODE=open.
 *
 * Read from the environment at call time so a test can flip it, and so the choice needs no injection.
 */
export function redisFailsClosed(env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = env.AUTH_REDIS_FAILURE_MODE;
  if (mode === 'open') return false;
  if (mode === 'closed') return true;
  return env.NODE_ENV === 'production';
}

/** The 503 a closed-mode refusal returns. Retry-After is advisory: the client should retry shortly. */
export function degradedError(): AppError {
  return new AppError(
    ERROR_CODES.AUTH_SERVICE_DEGRADED,
    'Sign-in is temporarily unavailable. Try again in a moment.',
    HttpStatus.SERVICE_UNAVAILABLE,
    [{ path: 'retryAfterSeconds', message: '5' }],
  );
}

/**
 * One error line a minute, whichever component noticed first. This is the line to alert on: while it is firing, either
 * every authenticated request is being refused (closed) or revocation and throttling are off (open).
 */
export function reportRedisFailure(component: string, err: unknown): void {
  const now = Date.now();
  if (now - lastReported < 60_000) return;
  lastReported = now;
  logger.error(
    { err, component, mode: redisFailsClosed() ? 'closed' : 'open' },
    'auth.redis_unavailable: the authentication store is not answering',
  );
}

/**
 * For a catch block around a Redis check. Closed mode throws the 503; open mode returns so the caller can carry on
 * (and the failure is still reported).
 */
export function onRedisFailure(component: string, err: unknown): void {
  reportRedisFailure(component, err);
  if (redisFailsClosed()) throw degradedError();
}
