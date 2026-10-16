import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// The cookie jar the proxy reads; each test fills it.
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

import { proxyRequest } from './proxy';

/**
 * The web app is a same-origin proxy in front of the API (the "BFF" of tenancy control MT-009). The tenant must come from the credential
 * the API verifies, never from anything the browser can write, so this pins what crosses the proxy: which headers are forwarded, where
 * the credential comes from, that the two identity pools never mix, and that a cross-origin write is refused before it is sent.
 */
describe('the API proxy carries the credential, never a tenant chosen by the browser', () => {
  const upstreamCalls: Array<{ url: string; headers: Headers }> = [];

  beforeEach(() => {
    jar.clear();
    upstreamCalls.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { headers: Headers }) => {
        upstreamCalls.push({ url, headers: init.headers });
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );
  });

  const browserRequest = (headers: Record<string, string>, method = 'GET') =>
    new Request('https://app.example.test/api/v2/contacts', { method, headers });

  it('sends the access token from the httpOnly cookie as the bearer, and nothing the browser put in Authorization', async () => {
    jar.set('crm_at', 'COOKIE-TOKEN');
    await proxyRequest(
      browserRequest({ authorization: 'Bearer ATTACKER-TOKEN' }),
      ['contacts'],
      'user',
    );
    expect(upstreamCalls).toHaveLength(1);
    expect(upstreamCalls[0]!.headers.get('authorization')).toBe('Bearer COOKIE-TOKEN');
  });

  it('drops any tenant, workspace or cookie header the browser sends', async () => {
    jar.set('crm_at', 'COOKIE-TOKEN');
    await proxyRequest(
      browserRequest({
        'x-org-id': '999',
        'x-tenant-id': '999',
        'x-workspace-id': '999',
        'x-forwarded-host': 'evil.example.test',
        cookie: 'crm_at=ATTACKER',
        'content-type': 'application/json',
      }),
      ['contacts'],
      'user',
    );
    const sent = upstreamCalls[0]!.headers;
    for (const name of [
      'x-org-id',
      'x-tenant-id',
      'x-workspace-id',
      'x-forwarded-host',
      'cookie',
    ]) {
      expect(sent.get(name), name).toBeNull();
    }
    expect(sent.get('content-type')).toBe('application/json');
  });

  it('keeps the two identity pools apart: a user request never carries the operator token', async () => {
    jar.set('crm_at', 'USER-TOKEN');
    jar.set('crm_op_at', 'OPERATOR-TOKEN');
    await proxyRequest(browserRequest({}), ['contacts'], 'user');
    expect(upstreamCalls[0]!.headers.get('authorization')).toBe('Bearer USER-TOKEN');
    expect(upstreamCalls[0]!.url).toContain('/v2/contacts');

    upstreamCalls.length = 0;
    await proxyRequest(browserRequest({}), ['workspaces'], 'operator');
    expect(upstreamCalls[0]!.headers.get('authorization')).toBe('Bearer OPERATOR-TOKEN');
    expect(upstreamCalls[0]!.url).toContain('/v2/platform/workspaces');
  });

  it('sends no credential at all when the browser has no session cookie', async () => {
    await proxyRequest(
      browserRequest({ authorization: 'Bearer ATTACKER-TOKEN' }),
      ['contacts'],
      'user',
    );
    expect(upstreamCalls[0]!.headers.get('authorization')).toBeNull();
  });

  it('refuses a cross-origin write before anything is sent upstream', async () => {
    jar.set('crm_at', 'COOKIE-TOKEN');
    const res = await proxyRequest(
      browserRequest({ origin: 'https://evil.example.test', host: 'app.example.test' }, 'POST'),
      ['contacts'],
      'user',
    );
    expect(res.status).toBe(403);
    expect(upstreamCalls).toHaveLength(0);
  });

  it('never relays a token-issuing endpoint to page JavaScript', async () => {
    jar.set('crm_at', 'COOKIE-TOKEN');
    const res = await proxyRequest(
      browserRequest({}, 'POST'),
      ['auth', 'workspaces', 'switch'],
      'user',
    );
    expect(res.status).toBe(404);
    expect(upstreamCalls).toHaveLength(0);
  });

  it("never relays the three-step signup flow's account-creating endpoint either", async () => {
    jar.set('crm_at', 'COOKIE-TOKEN');
    const res = await proxyRequest(
      browserRequest({}, 'POST'),
      ['auth', 'signup', 'set-password'],
      'user',
    );
    expect(res.status).toBe(404);
    expect(upstreamCalls).toHaveLength(0);
  });
});
