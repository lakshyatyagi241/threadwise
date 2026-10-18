import { describe, expect, it, vi } from 'vitest';
import { lastValueFrom, of, throwError, timer, switchMap } from 'rxjs';
import { HttpException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SlowRequestInterceptor } from '../../../src/common/interceptors/slow-request.interceptor';
import { RequestContextStore } from '../../../src/common/context/request-context';

/** QA 51: a request at or over the threshold is logged once with its route pattern; a fast one and a disabled interceptor are silent. */

const cfg = (ms: number) => ({ get: () => ms }) as unknown as ConfigService<never, true>;
const ctxOf = (type = 'http', statusCode = 200): ExecutionContext =>
  ({
    getType: () => type,
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', route: { path: '/v2/contacts/:id' }, url: '/v2/contacts/9f1c-secret-id?token=abc' }),
      getResponse: () => ({ statusCode }),
    }),
  }) as unknown as ExecutionContext;
const handler = (delayMs: number, value: unknown = 'ok'): CallHandler => ({
  handle: () => (delayMs ? timer(delayMs).pipe(switchMap(() => of(value))) : of(value)),
});

function spy(i: SlowRequestInterceptor) {
  const warn = vi.fn();
  (i as unknown as { logger: { warn: typeof warn } }).logger = { warn };
  return warn;
}
const inRequest = <T>(fn: () => T) =>
  RequestContextStore.run(
    { requestId: 'req-1', orgId: 42, actorType: 'user', actorId: 1, userId: 1 } as never,
    fn,
  );

describe('SlowRequestInterceptor', () => {
  it('logs a request over the threshold with the route pattern, org, status and duration', async () => {
    const i = new SlowRequestInterceptor(cfg(20));
    const warn = spy(i);
    await inRequest(() => lastValueFrom(i.intercept(ctxOf(), handler(40))));
    expect(warn).toHaveBeenCalledOnce();
    const line = warn.mock.calls[0][0];
    expect(line).toMatchObject({ msg: 'slow request', method: 'GET', route: '/v2/contacts/:id', orgId: 42, status: 200, requestId: 'req-1' });
    expect(line.durationMs).toBeGreaterThanOrEqual(20);
  });

  it('never puts the URL, ids or the query string in the log line', async () => {
    const i = new SlowRequestInterceptor(cfg(1));
    const warn = spy(i);
    await inRequest(() => lastValueFrom(i.intercept(ctxOf(), handler(10))));
    expect(JSON.stringify(warn.mock.calls[0][0])).not.toMatch(/secret-id|token=abc/);
  });

  it('is silent for a fast request', async () => {
    const i = new SlowRequestInterceptor(cfg(5_000));
    const warn = spy(i);
    await inRequest(() => lastValueFrom(i.intercept(ctxOf(), handler(0))));
    expect(warn).not.toHaveBeenCalled();
  });

  it('is off at 0 and passes the response through untouched', async () => {
    const i = new SlowRequestInterceptor(cfg(0));
    const warn = spy(i);
    const value = await lastValueFrom(i.intercept(ctxOf(), handler(30, { a: 1 })));
    expect(value).toEqual({ a: 1 });
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs a slow failure with the error status and still rethrows', async () => {
    const i = new SlowRequestInterceptor(cfg(10));
    const warn = spy(i);
    const failing: CallHandler = { handle: () => timer(30).pipe(switchMap(() => throwError(() => new HttpException('nope', 409)))) };
    await expect(inRequest(() => lastValueFrom(i.intercept(ctxOf(), failing)))).rejects.toThrow('nope');
    expect(warn.mock.calls[0][0]).toMatchObject({ status: 409 });
  });

  it('ignores non-HTTP contexts (queue jobs, sockets)', async () => {
    const i = new SlowRequestInterceptor(cfg(1));
    const warn = spy(i);
    await lastValueFrom(i.intercept(ctxOf('rpc'), handler(10)));
    expect(warn).not.toHaveBeenCalled();
  });
});
