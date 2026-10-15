import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const jar = new Map<string, string>([['crm_at', 'tok']]);
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

import { isSameOrigin, proxyRequest } from './proxy';

const req = (headers: Record<string, string>, method = 'POST') =>
  new Request('http://app.test/api/v2/contacts', {
    method,
    headers: { host: 'app.test', ...headers },
  });

/** The CSRF guard for cookie-authenticated writes: a browser that says the call is not from this site is refused. */
describe('isSameOrigin (staff and operator console)', () => {
  it.each([
    ['same origin', { origin: 'http://app.test' }],
    [
      'same origin, Fetch Metadata agrees',
      { origin: 'http://app.test', 'sec-fetch-site': 'same-origin' },
    ],
    ['address typed in the bar', { 'sec-fetch-site': 'none' }],
    [
      'behind a proxy: forwarded host wins',
      { origin: 'https://crm.example.com', 'x-forwarded-host': 'crm.example.com, internal' },
    ],
    ['no browser headers at all (a server-side caller)', {}],
  ])('accepts %s', (_n, h) => expect(isSameOrigin(req(h))).toBe(true));

  it.each([
    ['another site', { origin: 'https://evil.example' }],
    ['a look-alike host', { origin: 'http://app.test.evil.example' }],
    ['a different port', { origin: 'http://app.test:8080' }],
    ['the opaque origin of a sandboxed frame', { origin: 'null' }],
    ['an unparseable origin', { origin: 'not a url' }],
    ['userinfo trick', { origin: 'http://app.test@evil.example' }],
    [
      'a sibling subdomain (same-site, cross-origin)',
      { origin: 'http://evil.app.test', 'sec-fetch-site': 'same-site' },
    ],
    ['Fetch Metadata says cross-site, Origin missing', { 'sec-fetch-site': 'cross-site' }],
    [
      'Fetch Metadata says cross-site, Origin forged to match',
      { origin: 'http://app.test', 'sec-fetch-site': 'cross-site' },
    ],
    ['Fetch Metadata says same-site only', { 'sec-fetch-site': 'same-site' }],
    [
      'forwarded host does not match the origin',
      { origin: 'http://app.test', 'x-forwarded-host': 'crm.example.com' },
    ],
  ])('refuses %s', (_n, h) => expect(isSameOrigin(req(h))).toBe(false));
});

describe('the proxy refuses a cross-site write before anything is sent upstream', () => {
  const sent = vi.fn();
  beforeEach(() => {
    sent.mockReset();
    vi.stubGlobal('fetch', sent);
  });

  it.each([
    ['user', 'POST'],
    ['user', 'PUT'],
    ['user', 'PATCH'],
    ['user', 'DELETE'],
    ['operator', 'POST'],
    ['operator', 'DELETE'],
  ] as const)('%s pool, %s', async (kind, method) => {
    const res = await proxyRequest(
      req({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, method),
      ['contacts'],
      kind,
    );
    expect(res.status).toBe(403);
    expect(sent).not.toHaveBeenCalled();
  });

  it('lets a same-origin write through with the credential', async () => {
    sent.mockResolvedValue(new Response('{}', { status: 200 }));
    const res = await proxyRequest(
      req({ origin: 'http://app.test', 'sec-fetch-site': 'same-origin' }, 'POST'),
      ['contacts'],
      'user',
    );
    expect(res.status).toBe(200);
    expect(sent).toHaveBeenCalledOnce();
  });
});

const APP = join(__dirname, '../../app');
function* routes(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* routes(p);
    else if (name === 'route.ts') yield p;
  }
}

/**
 * Every route handler that can change state must run the cross-site check (directly or through the proxy / forwarder that does).
 * A new writer that is not on this list or does not call one of the guards fails here, so a CSRF hole cannot be added by accident.
 */
const GUARDS = /\b(isSameOrigin|proxyRequest|forwardPublicPost)\b/;
const MUTATING =
  /export\s+(?:async\s+function|const)\s+(POST|PUT|PATCH|DELETE)\b|export\s*\{[^}]*\bas\s+(POST|PUT|PATCH|DELETE)\b/;
const REVIEWED_WITHOUT_GUARD: Record<string, string> = {
  'webhooks/storefront-pay/route.ts':
    'Razorpay calls it server to server; the API verifies the signature, no cookie is involved',
  '(auth)/logout/route.ts':
    'sign-out by address is deliberate (TW-AUTH-012, as Reference); the worst a forged call does is end a session',
};

describe('every state-changing route handler has a cross-site guard', () => {
  const files = [...routes(APP)].map(
    (p) => [relative(APP, p).split(sep).join('/'), readFileSync(p, 'utf8')] as const,
  );
  const writers = files.filter(([, src]) => MUTATING.test(src));

  it('finds the handlers', () => expect(writers.length).toBeGreaterThan(8));
  it.each(writers.map(([f]) => f))('%s', (f) => {
    const src = files.find(([n]) => n === f)![1];
    if (f in REVIEWED_WITHOUT_GUARD) return;
    expect(src).toMatch(GUARDS);
  });
  it('the review list has no stale entries', () => {
    expect(
      Object.keys(REVIEWED_WITHOUT_GUARD).filter((f) => !writers.some(([n]) => n === f)),
    ).toEqual([]);
  });
});

describe('session cookies', () => {
  const src = readFileSync(join(__dirname, 'cookies.ts'), 'utf8');
  it('are httpOnly and SameSite=Lax, and Secure in production', () => {
    expect(src).toMatch(/httpOnly:\s*true/);
    expect(src).toMatch(/sameSite:\s*'lax'/);
    expect(src).toMatch(/secure:\s*process\.env\.NODE_ENV === 'production'/);
  });
});
