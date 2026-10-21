import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import type { AccountFlags } from '@crm/contracts';
import { takeAuthPrefetch } from '../../../common/context/auth-prefetch';
import { RequestContextStore } from '../../../common/context/request-context';
import { DatabaseService } from '../../../infra/db/database.service';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { SecurityPolicyService } from '../platform/security-policy.service';
import { toDate, type DateLike } from '../support/dates';
import { isPasswordStale } from '../support/password-policy';
import { AuthKeys, Ttl } from '../support/redis-keys';
import { OrgSuspensionService, isOperatorImpersonation } from './org-suspension.service';
import { cacheMetrics } from '@crm/observability';

const cache = cacheMetrics('account_gate');

export interface AccountGateState {
  /** This person's own account is not active. */
  suspended: boolean;
  /**
   * The whole workspace is suspended by the platform. Read live (5-second cache), never part of the per-user cached copy, so an
   * unsuspend does not wait for the 30-second user cache. The API refuses it in AccountGateGuard; here it only feeds the flags.
   */
  orgSuspended?: boolean;
  emailUnverified: boolean;
  /** Policy 'block': unverified accounts cannot use the API. */
  emailBlocking: boolean;
  mfaEnrolmentRequired: boolean;
  passwordChangeRequired: boolean;
  mfaEnabled: boolean;
  isAdmin: boolean;
  isOwner: boolean;
}

/**
 * Writes a freshly computed gate state only if no `invalidate` / `invalidateAll` ran since the reader started computing it.
 * KEYS = cache key, per-user generation, global generation; ARGV = the two generations the reader saw, ttl, json. Without this, a
 * request that read the old state just before a writer committed and invalidated could cache that old state afterwards and keep
 * a suspended person signed in for the whole 30 s.
 */
export const SET_UNLESS_INVALIDATED_LUA = `
local u = redis.call('GET', KEYS[2]) or ''
local g = redis.call('GET', KEYS[3]) or ''
if u == ARGV[1] and g == ARGV[2] then
  redis.call('SET', KEYS[1], ARGV[4], 'EX', tonumber(ARGV[3]))
  return 1
end
return 0`;
/** How long a generation counter outlives the invalidation that bumped it: longer than any gate read plus the 30 s entry. */
const GENERATION_TTL_SECONDS = 120;

/**
 * Computes what, if anything, stands between a signed-in user and the app:
 * suspension, an unverified email, a required-but-missing second factor, or a
 * password that must change (TW-AUTH-016/032/035).
 *
 * The result is cached for 30 seconds per user; writes that change it
 * (verify email, enable MFA, change password) call `invalidate`. A policy
 * change reaches users within the TTL.
 */
@Injectable()
export class AccountGateService {
  private readonly logger = new Logger(AccountGateService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly policy: SecurityPolicyService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly orgs: OrgSuspensionService,
  ) {}

  /**
   * `includeOrgSuspension: false` skips the workspace-suspension lookup (a Redis round trip) for a caller that has already made it:
   * AccountGateGuard checks the workspace first and never reads `orgSuspended` from this state, so asking again cost every
   * authenticated request one extra sequential Redis call. The result then has no `orgSuspended` field.
   */
  async stateFor(
    orgId: number,
    userId: number,
    opts: { includeOrgSuspension?: boolean } = {},
  ): Promise<AccountGateState> {
    const own = await this.userState(orgId, userId);
    if (opts.includeOrgSuspension === false) return own;
    const orgSuspended = isOperatorImpersonation(RequestContextStore.peek())
      ? false
      : await this.orgs.isSuspended(orgId);
    return { ...own, orgSuspended };
  }

  private async userState(orgId: number, userId: number): Promise<AccountGateState> {
    const key = AuthKeys.gate(orgId, userId);
    // JwtAuthGuard may have sent this read together with its own (auth-prefetch.ts); a failed one is simply read again here.
    const early = await takeAuthPrefetch('gate', orgId, userId);
    const cached =
      early === undefined || typeof early === 'symbol'
        ? await this.redis.get(key).catch(() => {
            cache.error();
            return null;
          })
        : early;
    if (cached) {
      cache.hit();
      return JSON.parse(cached) as AccountGateState;
    }
    cache.miss();

    const genKey = AuthKeys.gateGeneration(orgId, userId);
    const seen = await this.redis.mget(genKey, AuthKeys.gateGenerationAll).catch(() => null);
    const state = await this.compute(orgId, userId);
    if (seen) {
      await this.redis
        .eval(
          SET_UNLESS_INVALIDATED_LUA,
          3,
          key,
          genKey,
          AuthKeys.gateGenerationAll,
          seen[0] ?? '',
          seen[1] ?? '',
          String(Ttl.gateSeconds),
          JSON.stringify(state),
        )
        .catch((err: unknown) => {
          this.logger.warn({ err }, 'could not cache gate state');
        });
    }
    return state;
  }

  async invalidate(orgId: number, userId: number): Promise<void> {
    // Generation first, so a reader still computing cannot cache its old answer after the DEL (see SET_UNLESS_INVALIDATED_LUA).
    const genKey = AuthKeys.gateGeneration(orgId, userId);
    await this.redis
      .multi()
      .incr(genKey)
      .expire(genKey, GENERATION_TTL_SECONDS)
      .del(AuthKeys.gate(orgId, userId))
      .exec()
      .catch(() => undefined);
  }

  /**
   * Drops every cached gate state. A policy change or a platform-wide force
   * reset must reach people now, not when each user's 30-second cache expires.
   */
  async invalidateAll(): Promise<void> {
    try {
      await this.redis
        .multi()
        .incr(AuthKeys.gateGenerationAll)
        .expire(AuthKeys.gateGenerationAll, GENERATION_TTL_SECONDS)
        .exec();
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', 'auth:gate:*', 'COUNT', 500);
        cursor = next;
        if (keys.length > 0) await this.redis.unlink(...keys);
      } while (cursor !== '0');
    } catch (err) {
      this.logger.warn({ err }, 'could not clear gate cache');
    }
  }

  toFlags(state: AccountGateState): AccountFlags {
    return {
      suspended: state.suspended || state.orgSuspended === true,
      emailUnverified: state.emailUnverified,
      emailBlocked: state.emailBlocking,
      mfaEnrolmentRequired: state.mfaEnrolmentRequired,
      passwordChangeRequired: state.passwordChangeRequired,
    };
  }

  private async compute(orgId: number, userId: number): Promise<AccountGateState> {
    const [policy, registration] = await Promise.all([
      this.policy.policy(),
      this.policy.registration(),
    ]);

    const res = await this.db.txAs({ orgId, userId }, async (tx) =>
      tx.execute(sql`
        SELECT u.status,
               s.email_verified_at, s.force_password_change, s.password_changed_at,
               COALESCE(s.mfa_enabled, false) AS mfa_enabled,
               EXISTS (
                 SELECT 1 FROM user_roles ur
                 JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id
                 WHERE ur.org_id = u.org_id AND ur.user_id = u.id AND r.system_key IN ('admin', 'workspace_admin')
               ) AS is_admin,
               (o.settings ->> 'ownerUserId') = u.uuid::text AS is_owner
        FROM users u
        JOIN organizations o ON o.id = u.org_id
        LEFT JOIN user_security s ON s.org_id = u.org_id AND s.user_id = u.id
        WHERE u.org_id = ${orgId} AND u.id = ${userId}
      `),
    );
    const row = res.rows[0] as unknown as
      | {
          status: string;
          email_verified_at: DateLike | null;
          force_password_change: boolean | null;
          password_changed_at: DateLike | null;
          mfa_enabled: boolean;
          is_admin: boolean;
          is_owner: boolean | null;
        }
      | undefined;

    if (!row) {
      return {
        suspended: true,
        emailUnverified: false,
        emailBlocking: false,
        mfaEnrolmentRequired: false,
        passwordChangeRequired: false,
        mfaEnabled: false,
        isAdmin: false,
        isOwner: false,
      };
    }

    const isOwner = row.is_owner === true;
    const emailUnverified = !row.email_verified_at && registration.emailVerification !== 'off';
    const covered =
      policy.requireMfaForAll ||
      (policy.requireMfaForAdmins && row.is_admin) ||
      (policy.requireMfaForOwners && isOwner);

    return {
      suspended: row.status !== 'active',
      emailUnverified,
      emailBlocking: emailUnverified && registration.emailVerification === 'block',
      mfaEnrolmentRequired: covered && !row.mfa_enabled,
      passwordChangeRequired:
        row.force_password_change === true ||
        isPasswordStale(
          row.password_changed_at ? toDate(row.password_changed_at) : null,
          policy.passwordMaxAgeDays,
        ),
      mfaEnabled: row.mfa_enabled,
      isAdmin: row.is_admin,
      isOwner,
    };
  }
}
