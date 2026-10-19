import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: vi.fn(),
    delete: vi.fn(),
  }),
  headers: async () => new Headers(),
}));

import { cookieNames } from './cookies';
import { proxyRequest } from './proxy';
import { UPSTREAM_TIMEOUT_MS, upstreamFetch } from './upstream';

const get = () =>
  new Request('http://app.test/api/v2/contacts', { method: 'GET', headers: { host: 'app.test' } });

/** The web app is the front door: when the API behind it is down or silent, the browser must get an answer it can act on. */
describe('the proxy when the API is unavailable', () => {
  beforeEach(() => {
    jar.clear();
    jar.set(cookieNames('user').access, 'tok-secret');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('a refused connection becomes 502, not an unhandled exception', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
      }),
    );
    const res = await proxyRequest(get(), ['contacts'], 'user');
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(JSON.stringify(body)).not.toMatch(/tok-secret|Bearer|127\.0\.0\.1|ECONNREFUSED/);
  });

  it('a silent API is cut off at the deadline with 504', async () => {
    vi.useFakeTimers();
    let sawSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_ok, fail) => {
            sawSignal = init.signal ?? undefined;
            init.signal?.addEventListener('abort', () =>
              fail(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            );
          }),
      ),
    );
    const pending = proxyRequest(get(), ['contacts'], 'user');
    await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT_MS + 1);
    const res = await pending;
    expect(sawSignal, 'the call carried no abort signal').toBeDefined();
    expect(res.status).toBe(504);
    expect((await res.json()).code).toBe('UPSTREAM_TIMEOUT');
  });

  it('a refresh that works followed by a retry that fails is still an answer', async () => {
    jar.set(cookieNames('user').refresh, 'refresh-secret');
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        if (calls.length === 1) return new Response('{}', { status: 401 });
        if (url.includes('/auth/refresh'))
          return new Response(
            JSON.stringify({ accessToken: 'a2', refreshToken: 'r2', expiresIn: 900 }),
            { status: 200 },
          );
        throw new TypeError('fetch failed');
      }),
    );
    const res = await proxyRequest(get(), ['contacts'], 'user');
    expect(res.status).toBe(502);
  });
});

describe('upstreamFetch', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('the deadline covers the first byte only: a body that is still streaming is not cut off', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return new Response('ok');
      }),
    );
    const res = await upstreamFetch('http://api.test/x');
    await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT_MS * 4);
    expect(res.status).toBe(200);
    expect(signal?.aborted).toBe(false);
  });

  it('leaves no timer behind after a fast answer', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('ok')),
    );
    await upstreamFetch('http://api.test/x');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no timer behind after a failure', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    await expect(upstreamFetch('http://api.test/x')).rejects.toThrow('fetch failed');
    expect(vi.getTimerCount()).toBe(0);
  });
});
