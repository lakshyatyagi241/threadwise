import { z } from 'zod';
import { getSnapshot, resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { apiFetch } from './client';
import { ApiError } from './errors';

const okSchema = z.object({ ok: z.boolean() });
const problem = (status: number, code: string) => ({ type: 'x', title: 'x', status, code });

const hangsUntilAborted = (init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    (init.signal as AbortSignal).addEventListener('abort', () => reject(new Error('aborted')));
  });

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});
afterEach(() => jest.useRealTimers());

describe('apiFetch requests', () => {
  it('sends the bearer token and the client headers, and no Idempotency-Key on a read', async () => {
    const f = mockFetch(jsonResponse(200, { ok: true }));
    await apiFetch('/v2/things', {
      query: { limit: 5, q: undefined, empty: '' },
      schema: okSchema,
    });
    const [call] = f.calls;
    expect(call?.url).toBe('http://api.test/v2/things?limit=5');
    expect(call?.headers).toMatchObject({
      Authorization: 'Bearer access-1',
      Accept: 'application/json',
      'X-App-Version': '1.2.3',
      'X-App-Build': '45',
    });
    expect(call?.headers['X-Request-Id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(call?.headers['Idempotency-Key']).toBeUndefined();
  });

  it('sends a JSON body and an Idempotency-Key on a mutation, and honours a caller-supplied key', async () => {
    const f = mockFetch(jsonResponse(200, { ok: true }), jsonResponse(200, { ok: true }));
    await apiFetch('/v2/things', { method: 'POST', body: { a: 1 }, schema: okSchema });
    await apiFetch('/v2/things', {
      method: 'POST',
      body: { a: 1 },
      schema: okSchema,
      idempotencyKey: 'mine',
    });
    expect(f.calls[0]?.headers['Content-Type']).toBe('application/json');
    expect(f.calls[0]?.body).toEqual({ a: 1 });
    expect(f.calls[0]?.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(f.calls[1]?.headers['Idempotency-Key']).toBe('mine');
  });

  it('sends no bearer token to a public door (auth: false)', async () => {
    const f = mockFetch(jsonResponse(200, { ok: true }));
    await apiFetch('/v2/auth/login', { method: 'POST', body: {}, schema: okSchema, auth: false });
    expect(f.calls[0]?.headers.Authorization).toBeUndefined();
  });

  it('returns undefined for a call without a schema (204)', async () => {
    mockFetch(jsonResponse(204));
    await expect(apiFetch('/v2/things/1', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});

describe('apiFetch errors', () => {
  it('turns problem+json into an ApiError carrying the stable code', async () => {
    mockFetch(jsonResponse(403, problem(403, 'RBAC_FORBIDDEN'), { 'x-request-id': 'req-9' }));
    const e = await apiFetch('/v2/things', { schema: okSchema }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 403, code: 'RBAC_FORBIDDEN' });
  });

  it('maps a dropped connection to a connectivity error', async () => {
    mockFetch(new TypeError('Network request failed'));
    await expect(apiFetch('/v2/things', { schema: okSchema })).rejects.toMatchObject({
      code: 'CLIENT_NETWORK',
      isConnectivity: true,
    });
  });

  it('times out a request that never answers', async () => {
    jest.useFakeTimers();
    mockFetch(hangsUntilAborted);
    const result = apiFetch('/v2/things', { schema: okSchema, timeoutMs: 1000 }).catch(
      (x: unknown) => x,
    );
    await jest.advanceTimersByTimeAsync(1001);
    expect(await result).toMatchObject({ code: 'CLIENT_TIMEOUT' });
  });

  it('reports a caller cancellation as ABORTED, not as a network failure', async () => {
    const controller = new AbortController();
    mockFetch(hangsUntilAborted);
    const result = apiFetch('/v2/things', { schema: okSchema, signal: controller.signal }).catch(
      (x: unknown) => x,
    );
    await Promise.resolve();
    controller.abort();
    expect(await result).toMatchObject({ code: 'CLIENT_ABORTED' });
  });

  it('refuses an answer that does not match the contract', async () => {
    mockFetch(jsonResponse(200, { ok: 'yes' }));
    await expect(apiFetch('/v2/things', { schema: okSchema })).rejects.toMatchObject({
      code: 'CLIENT_CONTRACT_MISMATCH',
    });
  });
});

describe('apiFetch token rotation', () => {
  it('rotates once on a 401 and repeats the request with the new token and the same Idempotency-Key', async () => {
    const f = mockFetch(
      jsonResponse(401, problem(401, 'AUTH_TOKEN_INVALID')),
      jsonResponse(200, TOKEN_PAIR(2)),
      jsonResponse(200, { ok: true }),
    );
    await expect(
      apiFetch('/v2/things', { method: 'POST', body: {}, schema: okSchema }),
    ).resolves.toEqual({
      ok: true,
    });
    expect(f.calls.map((c) => c.url)).toEqual([
      'http://api.test/v2/things',
      'http://api.test/v2/auth/refresh',
      'http://api.test/v2/things',
    ]);
    expect(f.calls[0]?.headers.Authorization).toBe('Bearer access-1');
    expect(f.calls[2]?.headers.Authorization).toBe('Bearer access-2');
    expect(f.calls[2]?.headers['Idempotency-Key']).toBe(f.calls[0]?.headers['Idempotency-Key']);
  });

  it('does not loop: a second 401 after rotating is an error', async () => {
    const f = mockFetch(
      jsonResponse(401, problem(401, 'AUTH_TOKEN_INVALID')),
      jsonResponse(200, TOKEN_PAIR(2)),
      jsonResponse(401, problem(401, 'AUTH_TOKEN_INVALID')),
    );
    await expect(apiFetch('/v2/things', { schema: okSchema })).rejects.toMatchObject({
      status: 401,
    });
    expect(f.fn).toHaveBeenCalledTimes(3);
  });

  it('signs the person out when the server refuses the refresh token', async () => {
    mockFetch(
      jsonResponse(401, problem(401, 'AUTH_TOKEN_INVALID')),
      jsonResponse(401, problem(401, 'AUTH_TOKEN_INVALID')),
    );
    await expect(apiFetch('/v2/things', { schema: okSchema })).rejects.toMatchObject({
      status: 401,
    });
    expect(getSnapshot().status).toBe('signedOut');
  });

  it('shares one rotation between requests that fail together', async () => {
    const f = mockFetch(
      jsonResponse(401, problem(401, 'AUTH_TOKEN_INVALID')),
      jsonResponse(401, problem(401, 'AUTH_TOKEN_INVALID')),
      jsonResponse(200, TOKEN_PAIR(2)),
      jsonResponse(200, { ok: true }),
      jsonResponse(200, { ok: true }),
    );
    await Promise.all([
      apiFetch('/v2/a', { schema: okSchema }),
      apiFetch('/v2/b', { schema: okSchema }),
    ]);
    expect(f.calls.filter((c) => c.url.endsWith('/v2/auth/refresh'))).toHaveLength(1);
  });

  it('surfaces a connectivity error when the rotation cannot reach the server, and stays signed in', async () => {
    mockFetch(
      jsonResponse(401, problem(401, 'AUTH_TOKEN_INVALID')),
      new TypeError('Network request failed'),
    );
    await expect(apiFetch('/v2/things', { schema: okSchema })).rejects.toMatchObject({
      code: 'CLIENT_NETWORK',
    });
    expect(getSnapshot().status).toBe('signedIn');
  });

  it('does not try to rotate for a public door', async () => {
    const f = mockFetch(jsonResponse(401, problem(401, 'AUTH_INVALID_CREDENTIALS')));
    await expect(
      apiFetch('/v2/auth/login', { method: 'POST', body: {}, schema: okSchema, auth: false }),
    ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
    expect(f.fn).toHaveBeenCalledTimes(1);
  });
});
