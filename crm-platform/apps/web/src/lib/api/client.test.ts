import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError } from './errors';
import { apiFetch } from './client';

const problem = (status: number, code: string, errors: Array<{ path: string; message: string }>) =>
  new Response(
    JSON.stringify({ type: 'about:blank', title: 'x', status, code, requestId: 'req-7', errors }),
    { status, headers: { 'content-type': 'application/problem+json' } },
  );

describe('apiFetch', () => {
  const assign = vi.fn();
  const fetchMock = vi.fn();

  beforeEach(() => {
    assign.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      location: { pathname: '/contacts', search: '?tab=all', assign },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends the person to sign-in with the idle notice when the session ended for inactivity', async () => {
    fetchMock.mockResolvedValue(
      problem(401, 'UNAUTHENTICATED', [
        { path: 'reason', message: 'idle' },
        { path: 'idleMinutes', message: '30' },
      ]),
    );
    await expect(apiFetch('/contacts')).rejects.toBeInstanceOf(ApiError);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(
      '/login?expired=idle&minutes=30&next=%2Fcontacts%3Ftab%3Dall',
    );
  });

  it('does not redirect for an ordinary 401, a 403 or a validation error', async () => {
    for (const res of [
      problem(401, 'UNAUTHENTICATED', []),
      problem(403, 'FORBIDDEN', [{ path: 'reason', message: 'idle' }]),
      problem(422, 'VALIDATION_FAILED', [{ path: 'email', message: 'Invalid' }]),
    ]) {
      fetchMock.mockResolvedValueOnce(res);
      await expect(apiFetch('/contacts')).rejects.toBeInstanceOf(ApiError);
    }
    expect(assign).not.toHaveBeenCalled();
  });

  it('does not redirect from the sign-in page itself', async () => {
    vi.stubGlobal('window', { location: { pathname: '/login', search: '', assign } });
    fetchMock.mockResolvedValue(
      problem(401, 'UNAUTHENTICATED', [
        { path: 'reason', message: 'idle' },
        { path: 'idleMinutes', message: '30' },
      ]),
    );
    await expect(apiFetch('/auth/session')).rejects.toBeInstanceOf(ApiError);
    expect(assign).not.toHaveBeenCalled();
  });

  it('still parses a good answer at the boundary', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ n: 3 }), { status: 200 }));
    await expect(apiFetch('/x', { schema: z.object({ n: z.number() }) })).resolves.toEqual({
      n: 3,
    });
  });

  it('takes a schema with defaults and returns its parsed output', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    const schema = z.object({ extra: z.record(z.string()).default({}) });
    const out = await apiFetch('/x', { schema });
    expect(out.extra).toEqual({});
  });
});
