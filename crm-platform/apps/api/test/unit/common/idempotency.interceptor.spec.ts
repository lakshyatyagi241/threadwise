import { describe, expect, it } from 'vitest';
import { Observable, lastValueFrom, of, throwError } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Redis } from 'ioredis';
import { IdempotencyInterceptor } from '../../../src/common/interceptors/idempotency.interceptor';
import { RequestContextStore } from '../../../src/common/context/request-context';

/** ADR 0029, section 1: what the interceptor does on a repeat, with an in-memory Redis. */

class FakeRedis {
  readonly store = new Map<string, string>();
  readonly ttl = new Map<string, number>();
  down = false;
  async set(key: string, value: string, _ex: 'EX', seconds: number, nx?: 'NX') {
    if (this.down) throw new Error('redis is down');
    if (nx === 'NX' && this.store.has(key)) return null;
    this.store.set(key, value);
    this.ttl.set(key, seconds);
    return 'OK';
  }
  async get(key: string) {
    if (this.down) throw new Error('redis is down');
    return this.store.get(key) ?? null;
  }
  async del(key: string) {
    this.store.delete(key);
    return 1;
  }
}

const ctxOf = (method: string, path: string, body: unknown, key?: string): ExecutionContext =>
  ({
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        path,
        body,
        header: (n: string) => (n === 'idempotency-key' ? key : undefined),
      }),
    }),
  }) as unknown as ExecutionContext;

const reflector = { getAllAndOverride: () => true } as unknown as Reflector;

function setup() {
  const redis = new FakeRedis();
  const interceptor = new IdempotencyInterceptor(reflector, redis as unknown as Redis);
  let calls = 0;
  const call = (
    method: string,
    path: string,
    body: unknown,
    key?: string,
    actorId = 1,
    handler: () => CallHandler = () => ({ handle: () => of({ n: ++calls }) }),
  ) =>
    RequestContextStore.run(
      { requestId: 'r', orgId: 7, actorType: 'user', actorId, userId: actorId },
      () => lastValueFrom(interceptor.intercept(ctxOf(method, path, body, key), handler())),
    );
  return { redis, call, calls: () => calls };
}

describe('IdempotencyInterceptor', () => {
  it('runs the handler every time when there is no key', async () => {
    const { call, calls } = setup();
    await call('POST', '/v2/tags', { name: 'a' });
    await call('POST', '/v2/tags', { name: 'a' });
    expect(calls()).toBe(2);
  });

  it('replays the stored reply for the same route, body and key', async () => {
    const { call, calls } = setup();
    const first = await call('POST', '/v2/tags', { name: 'a' }, 'k1');
    await new Promise((r) => setImmediate(r)); // the reply is stored without waiting
    const second = await call('POST', '/v2/tags', { name: 'a' }, 'k1');
    expect(second).toEqual(first);
    expect(calls()).toBe(1);
  });

  it('is 409 IDEMPOTENCY_KEY_REUSED for the same route and key with another body, and does not run', async () => {
    const { call, calls } = setup();
    await call('POST', '/v2/tags', { name: 'a' }, 'k2');
    await new Promise((r) => setImmediate(r));
    await expect(call('POST', '/v2/tags', { name: 'b' }, 'k2')).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
      status: 409,
    });
    expect(calls()).toBe(1);
  });

  it('treats another route or another actor under the same key as its own operation', async () => {
    const { call, calls } = setup();
    await call('POST', '/v2/tags', { name: 'a' }, 'k3');
    await new Promise((r) => setImmediate(r));
    await call('POST', '/v2/companies', { name: 'a' }, 'k3');
    await call('POST', '/v2/tags', { name: 'a' }, 'k3', 2);
    expect(calls()).toBe(3);
  });

  it('is 409 while the first request is still running', async () => {
    const { call } = setup();
    const never: CallHandler = { handle: () => new Observable<never>(() => undefined) };
    void call('POST', '/v2/tags', { name: 'a' }, 'k4', 1, () => never);
    await new Promise((r) => setImmediate(r));
    await expect(call('POST', '/v2/tags', { name: 'a' }, 'k4')).rejects.toMatchObject({ status: 409 });
  });

  it('frees the key when the first request fails, so the retry runs', async () => {
    const { call, calls } = setup();
    await expect(
      call('POST', '/v2/tags', { name: 'a' }, 'k5', 1, () => ({ handle: () => throwError(() => new Error('boom')) })),
    ).rejects.toThrow('boom');
    await new Promise((r) => setImmediate(r));
    await call('POST', '/v2/tags', { name: 'a' }, 'k5');
    expect(calls()).toBe(1);
  });

  it('holds a running request for 5 minutes and a finished reply for 24 hours', async () => {
    const { call, redis } = setup();
    let seenWhileRunning = 0;
    await call('POST', '/v2/tags', { name: 'a' }, 'k6', 1, () => ({
      handle: () => {
        seenWhileRunning = [...redis.ttl.values()][0] ?? 0;
        return of({ ok: true });
      },
    }));
    await new Promise((r) => setImmediate(r));
    expect(seenWhileRunning).toBe(300);
    expect([...redis.ttl.values()][0]).toBe(24 * 3600);
  });

  it('fails closed when Redis is down: the handler does not run', async () => {
    const { call, calls, redis } = setup();
    redis.down = true;
    await expect(call('POST', '/v2/tags', { name: 'a' }, 'k7')).rejects.toThrow('redis is down');
    expect(calls()).toBe(0);
  });
});
