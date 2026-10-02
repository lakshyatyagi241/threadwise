import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { RateLimitService } from '../security/rate-limit.service';
import { AuthKeys, Ttl } from './redis-keys';

export type MfaPool = 'user' | 'operator';

/**
 * One person's budget of wrong second-factor codes and wrong confirmation
 * passwords (WD-AUTH-030): five in fifteen minutes, counted across every sign-in
 * challenge and every enrol / disable / regenerate call.
 *
 * Each sign-in challenge already allows five tries, but a fresh challenge costs
 * only a correct password, so without this per-person budget an attacker who
 * knows the password can keep drawing new challenges and guess for ever. A
 * successful second factor clears the budget.
 *
 * The budget is deliberately not tied to the sign-in lockout setting: lockout
 * can be switched off for convenience, a six-digit code must stay protected.
 */
@Injectable()
export class MfaAttemptLimiter {
  constructor(private readonly rate: RateLimitService) {}

  /** Throws AUTH_ACCOUNT_LOCKED (429) while the person is out of attempts. */
  async assertAvailable(pool: MfaPool, orgId: number, subjectId: number): Promise<void> {
    const state = await this.rate.peek(AuthKeys.mfaFailures(pool, orgId, subjectId));
    if (state.count < Ttl.mfaFailureMax) return;
    const minutes = Math.max(1, Math.ceil(state.retryAfterSeconds / 60));
    throw new AppError(
      ERROR_CODES.AUTH_ACCOUNT_LOCKED,
      `Too many incorrect codes. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      HttpStatus.TOO_MANY_REQUESTS,
      [{ path: 'retryAfterSeconds', message: String(state.retryAfterSeconds) }],
    );
  }

  /** Counts one wrong attempt. Returns true when that was the last one allowed. */
  async recordFailure(pool: MfaPool, orgId: number, subjectId: number): Promise<boolean> {
    const hit = await this.rate.hit(
      AuthKeys.mfaFailures(pool, orgId, subjectId),
      Ttl.mfaFailureWindowSeconds,
    );
    return hit.count >= Ttl.mfaFailureMax;
  }

  async clear(pool: MfaPool, orgId: number, subjectId: number): Promise<void> {
    await this.rate.reset(AuthKeys.mfaFailures(pool, orgId, subjectId));
  }
}
