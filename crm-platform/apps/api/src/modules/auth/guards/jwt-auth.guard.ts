import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Redis } from 'ioredis';
import { ACTOR_KINDS_KEY, IS_PUBLIC_KEY } from '../../../common/decorators';
import { PREFETCH_FAILED } from '../../../common/context/auth-prefetch';
import {
  RequestContextStore,
  type ActorType,
  type ImpersonationContext,
} from '../../../common/context/request-context';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { AppError } from '../../../common/errors/app-error';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { ActivityService } from '../../../kernel/activity/activity.service';
import { ImpersonationService } from '../platform/impersonation.service';
import { OperatorAuthService } from '../platform/operator-auth.service';
import { SecurityPolicyService } from '../platform/security-policy.service';
import { EpochService } from '../sessions/epoch.service';
import { PartnerAgentStatusService } from '../sessions/partner-agent-status.service';
import { SessionService, idleTimeoutError } from '../sessions/session.service';
import { AuthKeys } from '../support/redis-keys';
import { onRedisFailure } from '../support/resilience';
import { TokenService } from '../token.service';
import { cacheMetrics } from '@crm/observability';

const sessionCache = cacheMetrics('session_revocation');

/**
 * Global authentication guard.
 *
 * Authentication is opt-OUT (@Public), not opt-in. A new controller added in a
 * hurry is protected by default; the failure mode of the opposite convention
 * is an unauthenticated endpoint nobody notices until it is on the internet.
 *
 * Beyond the signature check it enforces, per request and from
 * Redis only:
 *   - the platform epoch (revoke-all invalidates older tokens at once)
 *   - the session tombstone (sign out / revoke / reset kills a still-valid
 *     access token on its next use)
 *   - the idle timeout for sessions that did not ask to be remembered
 *     (operators can never ask, so it always applies to them)
 *   - the session cap, when the administrator lowered it after the session
 *     was opened (a database sweep, only on the first request after the change)
 * and records session activity for the next idle check.
 *
 * Partner agents have no session row, so their revocation is the epoch (the same
 * "revoke everything" bump) and a cached status check: a suspended agent is refused within seconds.
 *
 * When Redis errors the behaviour follows the platform failure mode (support/resilience.ts): CLOSED
 * (503) by default in production, so a revoked session never works because a cache was down; OPEN
 * elsewhere, where the 15-minute access token bounds the exposure. Either way the failure is logged.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly epoch: EpochService,
    private readonly policy: SecurityPolicyService,
    private readonly sessions: SessionService,
    private readonly operators: OperatorAuthService,
    private readonly impersonations: ImpersonationService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly partners: PartnerAgentStatusService,
    @Optional() private readonly activity?: ActivityService,
    @Optional() private readonly rbac?: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw AppError.unauthenticated('Missing bearer token');
    }

    const claims = await this.tokens.verifyAccess(header.slice('Bearer '.length).trim());

    // Routes may narrow which identity pools can reach them. A staff token
    // must not open a partner endpoint, and vice versa.
    const allowedKinds = this.reflector.getAllAndOverride<ActorType[]>(ACTOR_KINDS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowedKinds?.length && !allowedKinds.includes(claims.typ)) {
      throw AppError.unauthenticated('Invalid or expired token');
    }

    const sessionBacked = claims.typ === 'user' || claims.typ === 'platform_operator';
    // Tokens issued before sessions existed carry no `sid`; one forced re-login
    // after deploy is the price of being able to revoke at all.
    if (sessionBacked && !claims.sid) throw AppError.unauthenticated('Invalid or expired token');

    // A signed-in workspace member will go through the account gate and the permission check next. Send their Redis reads now,
    // together with the session read below, instead of three round trips one after the other (common/context/auth-prefetch.ts).
    if (claims.typ === 'user' && !claims.imp && claims.org > 0) {
      this.startPrefetch(claims.org, claims.sub);
    }

    // An act-as token (operator inside a workspace) has no auth_sessions row: its session is the impersonation row, checked
    // here on every request so stop, expiry and the operator losing access all take effect at once. It skips the idle timeout
    // and the session cap, which belong to the owner's real sessions and must not be touched by the operator.
    let impersonation: ImpersonationContext | undefined;
    if (claims.imp) {
      if (claims.typ !== 'user' || claims.imp.sid !== claims.sid) {
        throw AppError.unauthenticated('Invalid or expired token');
      }
      if ((claims.ep ?? 0) < (await this.epoch.current())) {
        throw AppError.unauthenticated('Invalid or expired token');
      }
      impersonation = await this.impersonations.assertOpen(claims);
    } else if (sessionBacked) {
      if ((claims.ep ?? 0) < (await this.epoch.current())) {
        throw AppError.unauthenticated('Invalid or expired token');
      }
      await this.checkSession(claims.sid!, claims.typ, claims.rm === true, claims.org, claims.sub);
    } else if (claims.typ === 'partner_agent') {
      if ((claims.ep ?? 0) < (await this.epoch.current())) {
        throw AppError.unauthenticated('Invalid or expired token');
      }
      await this.partners.assertActive(claims.org, claims.sub);
    }

    const ctx = RequestContextStore.require();
    ctx.orgId = claims.org;
    ctx.actorType = claims.typ;
    ctx.actorId = claims.sub;
    ctx.userId = claims.typ === 'user' ? claims.sub : null;
    ctx.sessionId = claims.sid;
    ctx.impersonation = impersonation;

    // Any authenticated request by a workspace's own people is workspace activity: it resets the inactivity clock (ADR-0028). An operator
    // looking at a workspace (act-as) is not the customer being active, so it does not count.
    if (!impersonation && claims.org > 0 && claims.typ !== 'platform_operator') {
      this.activity?.touch(claims.org);
    }

    return true;
  }

  /**
   * Starts the cache reads the account gate and the permission check will want. They only read; whatever they find (or do not
   * find) is judged by the same code as before, in the same guards, after this one has accepted the session. A read that fails is
   * replaced by that code's own read.
   */
  private startPrefetch(orgId: number, userId: number): void {
    const ctx = RequestContextStore.peek();
    if (!ctx) return;
    try {
      ctx.prefetch = {
        orgId,
        userId,
        orgSuspended: this.redis.get(AuthKeys.orgSuspended(orgId)).catch(() => PREFETCH_FAILED),
        gate: this.redis.get(AuthKeys.gate(orgId, userId)).catch(() => PREFETCH_FAILED),
        grants: this.rbac?.startCachedRead(orgId, userId),
      };
    } catch {
      // Best effort: with no prefetch every guard reads for itself, as it always did.
      ctx.prefetch = undefined;
    }
  }

  private async checkSession(
    sid: string,
    typ: string,
    remembered: boolean,
    orgId: number,
    subjectId: number,
  ): Promise<void> {
    // Revoked, but the Redis tombstone write failed: refuse regardless of what Redis says (or whether it is up).
    if (this.sessions.isRevocationPending(sid)) {
      throw AppError.unauthenticated('Invalid or expired token');
    }
    let revoked: string | null = null;
    let lastActivity: string | null = null;
    let capMarker: string | null = null;
    try {
      [revoked, lastActivity, capMarker] = await this.redis.mget(
        AuthKeys.revoked(sid),
        AuthKeys.activity(sid),
        AuthKeys.capChecked(sid),
      );
    } catch (err) {
      // Closed mode throws the 503 here; open mode logs and lets the (short-lived) token through.
      sessionCache.error();
      onRedisFailure('session-check', err);
      this.logger.warn({ err }, 'session check skipped: redis unavailable');
      return;
    }
    if (revoked) {
      sessionCache.hit();
      throw AppError.unauthenticated('Invalid or expired token');
    }
    sessionCache.miss();

    const policy = await this.policy.policy();
    // Remembered staff sessions are exempt, as in Reference; operators have no
    // "keep me signed in", so for them the rule always applies (TW-AUTH-033).
    const exempt = typ === 'user' && remembered;
    const limit = policy.sessionTimeoutMinutes;
    if (
      !exempt &&
      lastActivity &&
      limit > 0 &&
      Date.now() - Number(lastActivity) > limit * 60_000
    ) {
      if (typ === 'user') {
        // Ends the row and writes the audit entry exactly once; the tombstone
        // it sets makes the next request fail without a database round trip.
        void this.sessions.expireIdle(orgId, subjectId, sid, limit, Number(lastActivity));
      } else {
        void this.sessions.tombstone(sid);
      }
      throw idleTimeoutError(limit);
    }

    if (typ === 'user') {
      void this.sessions.enforceCapIfChanged(
        orgId,
        subjectId,
        sid,
        policy.maxConcurrentSessions,
        capMarker,
      );
    } else if (typ === 'platform_operator') {
      void this.operators.enforceCapIfChanged(
        subjectId,
        sid,
        policy.maxConcurrentSessions,
        capMarker,
      );
    }
    void this.sessions.touchActivity(sid);
  }
}
