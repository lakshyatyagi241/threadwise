import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { RequestContextStore, type RequestContext } from '../context/request-context';

/**
 * Opens the ambient request context for the whole request lifecycle.
 *
 * Middleware, not an interceptor: middleware runs *before* guards, so the
 * guards themselves can populate org and actor on the same context object, and
 * anything they log is already correlated.
 *
 * The context starts unauthenticated (orgId 0). A guard fills it in. Any query
 * that runs before that fails closed, because `withTenant` rejects orgId 0.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    const requestId = incoming && incoming.length <= 128 ? incoming : randomUUID();

    const ctx: RequestContext = {
      requestId,
      orgId: 0,
      actorType: 'system',
      actorId: null,
      userId: null,
      ip: req.ip,
      userAgent: req.header('user-agent')?.slice(0, 512),
    };

    res.setHeader('x-request-id', requestId);
    RequestContextStore.run(ctx, () => next());
  }
}
