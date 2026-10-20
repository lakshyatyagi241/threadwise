import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import { Observable, from, map, of, switchMap, tap } from 'rxjs';
import { ERROR_CODES } from '@crm/contracts';
import type { Request } from 'express';
import { IDEMPOTENT_KEY } from '../decorators';
import { RequestContextStore } from '../context/request-context';
import { AppError } from '../errors/app-error';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { cacheMetrics } from '@crm/observability';

const cache = cacheMetrics('idempotency');

const TTL_SECONDS = 24 * 3600;
/** How long a key stays reserved while its request runs. A crash mid-request frees it after this, not after a day (ADR 0029). */
const IN_FLIGHT_TTL_SECONDS = 300;
const IN_FLIGHT = '__in_flight__';

interface StoredEntry {
  slot?: string;
  fp?: string;
  state?: string;
  body?: unknown;
}

type RunResult = { kind: 'value'; value: unknown } | { kind: 'other-actor' };

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
 * Design record: docs/adr/0029-idempotency.md.
 *
 * Keys are namespaced per org: two tenants generating the same uuid must not
 * collide. Each entry records its slot (actor, method, path) and a body fingerprint.
 * Another actor, or the same actor on another method/route, reusing the key gets its own
 * slot (it can
 * never read or block on someone else's response); the same actor, route and key
 * with a different body gets 409 IDEMPOTENCY_KEY_REUSED instead of a replay.
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
    const actor = `${ctx.actorType ?? 'anon'}:${ctx.actorId ?? ctx.userId ?? 0}`;
    const sha = (v: string) => createHash('sha256').update(v).digest('hex');
    // slot = who and which route; fingerprint = the request body. Same slot + other body = conflict.
    const slot = `${actor}|${request.method} ${request.path}`;
    const fingerprint = sha(JSON.stringify(request.body ?? null));
    const primary = `idem:${ctx.orgId}:${providedKey}`;

    return this.run(primary, slot, fingerprint, providedKey, next, true).pipe(
      switchMap((r) =>
        r.kind === 'other-actor'
          ? this.run(`${primary}:${sha(slot)}`, slot, fingerprint, providedKey, next, false)
          : of(r),
      ),
      map((r) => (r.kind === 'value' ? r.value : null)),
    );
  }

  private run(
    cacheKey: string,
    slot: string,
    fingerprint: string,
    providedKey: string,
    next: CallHandler,
    allowOtherActor: boolean,
  ): Observable<RunResult> {
    const inFlight = JSON.stringify({ slot, fp: fingerprint, state: IN_FLIGHT });
    return from(this.redis.set(cacheKey, inFlight, 'EX', IN_FLIGHT_TTL_SECONDS, 'NX')).pipe(
      tap({ error: () => cache.error() }),
      switchMap((reserved): Observable<RunResult> => {
        if (reserved === 'OK') {
          cache.miss();
          return next.handle().pipe(
            tap({
              next: (body) => {
                void this.redis
                  .set(
                    cacheKey,
                    JSON.stringify({ slot, fp: fingerprint, state: 'done', body: body ?? null }),
                    'EX',
                    TTL_SECONDS,
                  )
                  .catch((err: unknown) => this.logger.warn({ err }, 'idempotency store failed'));
              },
              error: () => {
                // The operation failed — free the key so a real retry works.
                void this.redis.del(cacheKey).catch(() => undefined);
              },
            }),
            map((value): RunResult => ({ kind: 'value', value })),
          );
        }

        return from(this.redis.get(cacheKey)).pipe(
          switchMap((stored): Observable<RunResult> => {
            let entry: StoredEntry | null = null;
            try {
              entry = stored ? (JSON.parse(stored) as StoredEntry) : null;
            } catch {
              entry = null;
            }
            if (allowOtherActor && entry?.slot !== undefined && entry.slot !== slot) {
              return of({ kind: 'other-actor' });
            }
            if (entry?.fp !== undefined && entry.fp !== fingerprint) {
              throw new AppError(
                ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
                'This Idempotency-Key was already used for a different request',
                409,
              );
            }
            if (!entry || entry.state === IN_FLIGHT) {
              throw new AppError(
                ERROR_CODES.CONFLICT,
                'A request with this Idempotency-Key is still in flight',
                409,
              );
            }
            cache.hit();
            this.logger.log({ key: providedKey }, 'replaying idempotent response');
            return of({ kind: 'value', value: entry.body ?? null });
          }),
        );
      }),
    );
  }
}
