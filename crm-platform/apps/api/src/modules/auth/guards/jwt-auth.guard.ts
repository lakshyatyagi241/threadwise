import { CanActivate, ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Redis } from 'ioredis';
import { ACTOR_KINDS_KEY, IS_PUBLIC_KEY } from '../../../common/decorators';
import { RequestContextStore, type ActorType } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { SecurityPolicyService } from '../platform/security-policy.service';
import { EpochService } from '../sessions/epoch.service';
import { SessionService } from '../sessions/session.service';
import { AuthKeys } from '../support/redis-keys';
import { TokenService } from '../token.service';

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
 * and records session activity for the next idle check.
 *
 * Redis failures fail open here: the access token is only 15 minutes long,
 * and refusing every request because a cache is down is the worse outcome.
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
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
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

    if (sessionBacked) {
      if ((claims.ep ?? 0) < (await this.epoch.current())) {
        throw AppError.unauthenticated('Invalid or expired token');
      }
      await this.checkSession(claims.sid!, claims.typ, claims.rm === true);
    }

    const ctx = RequestContextStore.require();
    ctx.orgId = claims.org;
    ctx.actorType = claims.typ;
    ctx.actorId = claims.sub;
    ctx.userId = claims.typ === 'user' ? claims.sub : null;
    ctx.sessionId = claims.sid;

    return true;
  }

  private async checkSession(sid: string, typ: string, remembered: boolean): Promise<void> {
    let revoked: string | null = null;
    let lastActivity: string | null = null;
    try {
      [revoked, lastActivity] = await this.redis.mget(
        AuthKeys.revoked(sid),
        AuthKeys.activity(sid),
      );
    } catch (err) {
      this.logger.warn({ err }, 'session check skipped: redis unavailable');
      return;
    }
    if (revoked) throw AppError.unauthenticated('Invalid or expired token');

    if (typ === 'user' && !remembered && lastActivity) {
      const { sessionTimeoutMinutes } = await this.policy.policy();
      if (
        sessionTimeoutMinutes > 0 &&
        Date.now() - Number(lastActivity) > sessionTimeoutMinutes * 60_000
      ) {
        // The refresh path will refuse it too; revoking here makes the next
        // request fail without a database round trip.
        void this.sessions.tombstone(sid);
        throw AppError.unauthenticated('Invalid or expired token');
      }
    }
    void this.sessions.touchActivity(sid);
  }
}
