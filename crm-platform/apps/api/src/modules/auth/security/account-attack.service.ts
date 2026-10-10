import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ERROR_CODES, type SecurityPolicy } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { networkPrefix } from '../support/ip';
import { sha256Hex } from '../support/crypto-utils';
import { AuthKeys, Ttl } from '../support/redis-keys';
import { AuthAuditService } from './auth-audit.service';
import { CaptchaService } from './captcha.service';
import { RateLimitService } from './rate-limit.service';

/** An account is "under attack" after this many failures PER lockout threshold, from any addresses, in the window. */
export const ACCOUNT_ATTACK_FACTOR = 5;
/** Remembered networks per account: enough for home, office, phone; bounded so the set cannot grow without limit. */
const MAX_KNOWN_NETWORKS = 20;

export type AttackPool = 'staff' | 'operator' | 'partner';

/**
 * Progressive defence against distributed guessing (credential stuffing / password spraying).
 *
 * The per-(account, address) lockout and the per-address ceiling stop one source. They cannot see an attacker who spreads
 * guesses over many addresses, each staying under its own limit. This keeps ONE more counter per account, across every
 * address. It never locks the account (that would let a stranger lock the owner out); once it passes
 * ACCOUNT_ATTACK_FACTOR x the lockout threshold within an hour it only adds friction for networks the person has not
 * signed in from before:
 *
 *   - captcha configured   a solved captcha is required from an unfamiliar network;
 *   - no captcha           the attempt is refused (429, AUTH_CHALLENGE_REQUIRED) until the window passes.
 *
 * A network the person signed in from successfully (first two IPv4 octets / four IPv6 hextets, hashed) is never affected,
 * so the real owner on their usual connection keeps signing in while the attack is going on.
 */
@Injectable()
export class AccountAttackGuard {
  private readonly logger = new Logger(AccountAttackGuard.name);

  constructor(
    private readonly rate: RateLimitService,
    private readonly captcha: CaptchaService,
    private readonly audit: AuthAuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Failures that mark an account as under attack; 0 = disabled (lockout is switched off). */
  threshold(policy: Pick<SecurityPolicy, 'lockoutAfterFailures'>): number {
    return policy.lockoutAfterFailures > 0
      ? policy.lockoutAfterFailures * ACCOUNT_ATTACK_FACTOR
      : 0;
  }

  /** Counts one failed credential check against the account, whatever address it came from. */
  async recordFailure(
    pool: AttackPool,
    orgId: number,
    email: string,
    policy: Pick<SecurityPolicy, 'lockoutAfterFailures'>,
  ): Promise<void> {
    const limit = this.threshold(policy);
    if (limit === 0) return;
    const { count } = await this.rate.hit(
      AuthKeys.accountFailures(pool, orgId, email),
      Ttl.accountAttackWindowSeconds,
    );
    if (count === limit) {
      // Once per window: the crossing itself is the alert.
      await this.audit.recordStandalone({
        event: 'auth.account_under_attack',
        status: 'warning',
        orgId: orgId || undefined,
        payload: { pool, failures: count, windowMinutes: Ttl.accountAttackWindowSeconds / 60 },
      });
    }
  }

  /**
   * Throws AUTH_CHALLENGE_REQUIRED when the account is under attack and this caller is neither a known network nor able to
   * solve the captcha. Does nothing for an account that is not under attack.
   */
  async assertAllowed(
    pool: AttackPool,
    orgId: number,
    email: string,
    ip: string | null,
    captchaToken: string | undefined,
    policy: Pick<SecurityPolicy, 'lockoutAfterFailures'>,
  ): Promise<void> {
    const limit = this.threshold(policy);
    if (limit === 0) return;
    const state = await this.rate.peek(AuthKeys.accountFailures(pool, orgId, email));
    if (state.count < limit) return;
    if (await this.isKnownNetwork(pool, orgId, email, ip)) return;
    if (pool !== 'partner') {
      const verdict = await this.captcha.check(
        captchaToken,
        pool === 'operator' ? 'operator' : 'login',
      );
      if (verdict === 'ok') return;
    }
    throw new AppError(
      ERROR_CODES.AUTH_CHALLENGE_REQUIRED,
      'We have seen many failed sign-ins for this account. Sign in from a device you have used before, or try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
      [{ path: 'retryAfterSeconds', message: String(Math.max(state.retryAfterSeconds, 60)) }],
    );
  }

  /** After a successful sign-in: this network is the person's, so an attack on the account will not lock them out. */
  async rememberNetwork(
    pool: AttackPool,
    orgId: number,
    email: string,
    ip: string | null,
  ): Promise<void> {
    const net = this.netHash(ip);
    if (!net) return;
    const key = AuthKeys.knownNetworks(pool, orgId, email);
    try {
      await this.redis.sadd(key, net);
      await this.redis.expire(key, Ttl.knownNetworkSeconds);
      if ((await this.redis.scard(key)) > MAX_KNOWN_NETWORKS) await this.redis.spop(key);
    } catch (err) {
      this.logger.warn({ err }, 'could not remember the sign-in network');
    }
  }

  private async isKnownNetwork(
    pool: AttackPool,
    orgId: number,
    email: string,
    ip: string | null,
  ): Promise<boolean> {
    const net = this.netHash(ip);
    if (!net) return false;
    try {
      return (await this.redis.sismember(AuthKeys.knownNetworks(pool, orgId, email), net)) === 1;
    } catch {
      return false;
    }
  }

  private netHash(ip: string | null): string | null {
    const prefix = networkPrefix(ip);
    return prefix ? sha256Hex(prefix).slice(0, 16) : null;
  }
}
