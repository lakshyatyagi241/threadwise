import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ACTOR_KINDS_KEY, IS_PUBLIC_KEY } from '../../../common/decorators';
import { RequestContextStore, type ActorType } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { TokenService } from '../token.service';

/**
 * Global authentication guard.
 *
 * Authentication is opt-OUT (@Public), not opt-in. A new controller added in a
 * hurry is protected by default; the failure mode of the opposite convention
 * is an unauthenticated endpoint nobody notices until it is on the internet.
 *
 * On success it fills in the ambient request context that the middleware
 * opened, so every downstream query is tenant-scoped without the handler
 * passing anything around.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
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
      throw AppError.forbidden(`this endpoint is not available to ${claims.typ}`);
    }

    const ctx = RequestContextStore.require();
    ctx.orgId = claims.org;
    ctx.actorType = claims.typ;
    ctx.actorId = claims.sub;
    ctx.userId = claims.typ === 'user' ? claims.sub : null;

    return true;
  }
}
