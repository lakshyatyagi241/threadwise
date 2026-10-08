import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { ERROR_CODES } from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { INFRA_ENV, type InfraEnv } from '../../../config/domains/platform-infrastructure.env';
import type { ThrottleSpec } from './rate-limit.policies';
import { RateLimiter } from './rate-limiter';
import { SKIP_THROTTLE_KEY, THROTTLE_KEY } from './throttle.decorators';

/** The limit of a route with no `@Throttle()`, when the environment sets one. Per caller, per route. */
function defaultSpec(perMinute: number): ThrottleSpec | undefined {
  return perMinute > 0 ? { limit: perMinute, windowSeconds: 60, by: 'actor-or-ip' } : undefined;
}

/**
 * Global request throttle (WD-INFRA-010).
 *
 * Registered right after JwtAuthGuard in AppModule: by then the caller is known (so `actor` limits work and a stolen address
 * does not share a quota with an office), and it is still ahead of the account, trial and permission guards, which read the
 * database. A refused request therefore costs one Redis call, not a query.
 *
 * A request that fails authentication never reaches this guard; that is cheap (a signature check) and has no quota to spend.
 */
@Injectable()
export class ThrottleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
    @Inject(INFRA_ENV) private readonly env: InfraEnv,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.env.INFRA_RATE_LIMIT_ENABLED || context.getType() !== 'http') return true;

    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(SKIP_THROTTLE_KEY, targets) === true) return true;
    const spec =
      this.reflector.getAllAndOverride<ThrottleSpec | undefined>(THROTTLE_KEY, targets) ??
      defaultSpec(this.env.INFRA_RATE_LIMIT_DEFAULT_PER_MINUTE);
    if (!spec) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const key = this.keyFor(spec, context, req);
    const result = await this.limiter.consume(key, spec.limit, spec.windowSeconds);
    // A degraded result (Redis down) carries no real numbers; say nothing rather than promise a quota.
    if (!result.degraded) {
      res.setHeader('X-RateLimit-Limit', String(result.limit));
      res.setHeader('X-RateLimit-Remaining', String(result.remaining));
      res.setHeader('X-RateLimit-Reset', String(result.retryAfterSeconds));
    }
    if (result.allowed) return true;

    res.setHeader('Retry-After', String(result.retryAfterSeconds));
    throw new AppError(
      ERROR_CODES.RATE_LIMITED,
      `Too many requests. Try again in ${result.retryAfterSeconds} seconds.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /**
   * `rl:<limit>/<window>:<Controller.handler>:<subject>`. The limit and window are part of the key so changing a number
   * never inherits a counter built under the old one.
   */
  private keyFor(spec: ThrottleSpec, context: ExecutionContext, req: Request): string {
    const where = `${context.getClass().name}.${context.getHandler().name}`;
    return `rl:${spec.limit}/${spec.windowSeconds}s:${where}:${this.subjectOf(spec, req)}`;
  }

  private subjectOf(spec: ThrottleSpec, req: Request): string {
    const ip = `ip:${req.ip ?? 'unknown'}`;
    if (spec.by === 'ip') return ip;
    const actor = RequestContextStore.peek();
    if (!actor || actor.actorId == null) return ip;
    return `${actor.actorType}:${actor.orgId}:${actor.actorId}`;
  }
}
