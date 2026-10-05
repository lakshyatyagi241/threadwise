import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { syncInstallation } from './api';
import { ID } from './test-fixtures';

/** "Sync now": which address, which method, what is parsed, and how the refusals reach the screen. `fetch` stands in for the API. */

const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (body === undefined ? '' : JSON.stringify(body)),
  headers: { get: () => null },
});

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => reply(status, body));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const lastCall = (fn: ReturnType<typeof stubFetch>) => {
  const [url, init] = fn.mock.calls.at(-1) as unknown as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
};

const problem = (status: number, code: string) => ({
  type: 'about:blank',
  code,
  title: 'x',
  status,
  detail: 'x',
});

afterEach(() => vi.unstubAllGlobals());

describe('syncInstallation', () => {
  it('posts to the installation sync address with no body and parses the answer', async () => {
    const fn = stubFetch(200, {
      status: 'scheduled',
      runAt: '2026-10-04T10:05:00.000Z',
      minIntervalSeconds: 300,
    });
    const out = await syncInstallation(ID(50));
    const { url, init, headers } = lastCall(fn);
    expect(url).toBe(`/api/v2/marketplace/installations/${ID(50)}/sync`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(headers['Idempotency-Key']).toBeTypeOf('string');
    expect(out).toEqual({
      status: 'scheduled',
      runAt: '2026-10-04T10:05:00.000Z',
      minIntervalSeconds: 300,
    });
  });

  it('refuses an answer that is not the contract', async () => {
    stubFetch(200, { status: 'done', runAt: 'tomorrow', minIntervalSeconds: 'five' });
    await expect(syncInstallation(ID(50))).rejects.toThrow();
  });

  for (const [status, code] of [
    [409, 'MKT_NO_CONNECTION'],
    [409, 'MKT_INSTALLATION_DISABLED'],
    [409, 'MKT_INSTALLATION_KILLED'],
    [403, 'FORBIDDEN'],
  ] as const) {
    it(`throws the problem with its code for the screens to branch on: ${status} ${code}`, async () => {
      stubFetch(status, problem(status, code));
      const error = await syncInstallation(ID(50)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe(code);
      expect((error as ApiError).status).toBe(status);
    });
  }
});
