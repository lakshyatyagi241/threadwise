import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { SecurityHeadersMiddleware } from '../../../src/modules/auth/middleware-security-headers';

function run(path: string, secure = false, requestHeaders: Record<string, string> = {}) {
  const headers = new Map<string, string>();
  const req = { originalUrl: path, secure, headers: requestHeaders } as unknown as Request;
  const res = {
    setHeader: (k: string, v: string) => headers.set(k.toLowerCase(), v),
  } as unknown as Response;
  new SecurityHeadersMiddleware().use(req, res, (() => undefined) as NextFunction);
  return headers;
}

/** TW-AUTH-020/045: pages and endpoints that carry credentials are never cached, by any cache. */
describe('response hardening headers', () => {
  it.each([
    '/v2/auth/login',
    '/v2/auth/registration-config',
    '/v2/auth/password-policy',
    '/v2/auth/forgot-password',
    '/v2/auth/reset-password',
    '/v2/auth/logout',
    '/v2/account/sessions?limit=10',
    '/v2/platform/auth/login',
    '/v2/onboarding',
  ])('forbids caching of %s, with Pragma for old proxies', (path) => {
    const h = run(path);
    const cc = h.get('cache-control') ?? '';
    expect(cc).toContain('no-store');
    expect(cc).toContain('no-cache');
    expect(cc).toContain('must-revalidate');
    expect(cc).toContain('private');
    expect(h.get('pragma')).toBe('no-cache');
  });

  it.each([{ authorization: 'Bearer t' }, { cookie: 'sid=1' }])(
    'a request that carries a credential (%o) is private and not stored by a shared cache',
    (rh) => {
      const cc = run('/v2/contacts', false, rh as unknown as Record<string, string>).get(
        'cache-control',
      );
      expect(cc).toBe('private, no-store');
    },
  );

  it('leaves unrelated routes cacheable', () => {
    expect(run('/health').get('cache-control')).toBeUndefined();
    expect(run('/v2/contacts').get('pragma')).toBeUndefined();
  });

  it('refuses framing everywhere except the chat widget', () => {
    expect(run('/v2/auth/login').get('x-frame-options')).toBe('SAMEORIGIN');
    expect(run('/v2/auth/login').get('content-security-policy')).toContain(
      "frame-ancestors 'self'",
    );
    expect(run('/v2/widget/config').get('x-frame-options')).toBeUndefined();
  });

  it('sends HSTS only on secure connections and nosniff always', () => {
    expect(run('/v2/auth/login', true).get('strict-transport-security')).toContain('max-age=');
    expect(run('/v2/auth/login', false).get('strict-transport-security')).toBeUndefined();
    expect(run('/anything').get('x-content-type-options')).toBe('nosniff');
  });
});
