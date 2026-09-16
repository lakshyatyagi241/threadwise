import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Redis } from 'ioredis';
import { Observable, from, of, switchMap, tap } from 'rxjs';
import { ERROR_CODES } from '@crm/contracts';
import type { Request } from 'express';
import { IDEMPOTENT_KEY } from '../decorators';
import { RequestContextStore } from '../context/request-context';
import { AppError } from '../errors/app-error';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';

const TTL_SECONDS = 24 * 3600;
const IN_FLIGHT = '__in_flight__';

/**
 * Idempotency-Key support for mutating routes marked @Idempotent().
 *
 * The problem it solves: a client POSTs, the response is lost to a timeout,
 * the client retries. Without this, the retry sends the message twice, charges
 * the wallet twice, or creates the lead twice.
 *
 * Mechanism:
 *   - reserve the key with SET NX. A second request for the same key while the
 *     first is still running gets 409 rather than racing it.
 *   - on success, store the response body under the key for 24h and replay it
 *     verbatim on any repeat.
 *   - on failure, release the key so a genuine retry can proceed.
 *
 * Keys are namespaced per org: two tenants generating the same uuid must not
 * collide.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const required = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return next.handle();

    const request = context.switchToHttp().getRequest<Request>();
    const providedKey = request.header('idempotency-key');

    // Optional for now so clients can adopt it incrementally. It becomes
    // mandatory on money-moving routes when Billing lands — that is a
    // deliberate, separate decision, not an oversight.
    if (!providedKey) return next.handle();

    const ctx = RequestContextStore.require();
    const cacheKey = `idem:${ctx.orgId}:${providedKey}`;

    return from(this.redis.set(cacheKey, IN_FLIGHT, 'EX', TTL_SECONDS, 'NX')).pipe(
      switchMap((reserved) => {
        if (reserved === 'OK') {
          return next.handle().pipe(
            tap({
              next: (body) => {
                void this.redis
                  .set(cacheKey, JSON.stringify(body ?? null), 'EX', TTL_SECONDS)
                  .catch((err: unknown) => this.logger.warn({ err }, 'idempotency store failed'));
              },
              error: () => {
                // The operation failed — free the key so a real retry works.
                void this.redis.del(cacheKey).catch(() => undefined);
              },
            }),
          );
        }

        return from(this.redis.get(cacheKey)).pipe(
          switchMap((stored) => {
            if (stored === IN_FLIGHT) {
              throw new AppError(
                ERROR_CODES.CONFLICT,
                'A request with this Idempotency-Key is still in flight',
                409,
              );
            }
            this.logger.log({ key: providedKey }, 'replaying idempotent response');
            return of(stored ? (JSON.parse(stored) as unknown) : null);
          }),
        );
      }),
    );
  }
}
