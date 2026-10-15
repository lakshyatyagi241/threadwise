import { Controller, Get, Post, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join, relative, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PERMISSIONS_POLICY,
  SecurityHeadersMiddleware,
} from '../../../src/modules/auth/middleware-security-headers';
import {
  CUSTOMER_API_CORS,
  isCustomerApiPath,
} from '../../../src/modules/developer-rest-api-v1/http/v1-cors';
import { staffCorsOptions } from '../../../src/modules/platform-infrastructure/cors/cors-policy';

const ROUTES = [
  '/v2/auth/login',
  '/v2/account/me',
  '/v2/platform/users',
  '/v2/onboarding/x',
  '/v2/contacts',
  '/api/v1/contacts',
  '/widget/abc',
  '/v2/widget/abc',
  '/form-embed/x.js',
  '/docs/api.json',
];

@Controller()
class EchoController {
  @Get(ROUTES.map((r) => r.slice(1)))
  get() {
    return { ok: true };
  }
  @Post(ROUTES.map((r) => r.slice(1)))
  post() {
    return { ok: true };
  }
}

async function boot(
  origins: string[],
  nodeEnv: string,
): Promise<{ app: INestApplication; base: string }> {
  const mod = await Test.createTestingModule({ controllers: [EchoController] }).compile();
  const app = mod.createNestApplication();
  // The same wiring as main.ts: the real middleware, and the staff or customer policy chosen by path.
  const http = app.getHttpAdapter().getInstance() as { set(k: string, v: unknown): void };
  http.set('trust proxy', 1);
  app.use((req: never, res: never, next: () => void) =>
    new SecurityHeadersMiddleware().use(req, res, next),
  );
  const staff = staffCorsOptions(origins, nodeEnv);
  app.enableCors((req: { url?: string }, cb: (e: null, o: unknown) => void) =>
    cb(null, isCustomerApiPath(req.url) ? CUSTOMER_API_CORS : staff),
  );
  await app.listen(0, '127.0.0.1');
  return {
    app,
    base: `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`,
  };
}

describe('security headers over HTTP', () => {
  let s: Awaited<ReturnType<typeof boot>>;
  beforeAll(async () => {
    s = await boot(['https://app.example.com'], 'production');
  });
  afterAll(() => s.app.close());

  it.each(ROUTES)('%s: nosniff, referrer policy and permissions policy', async (path) => {
    const r = await fetch(s.base + path);
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(r.headers.get('permissions-policy')).toBe(PERMISSIONS_POLICY);
  });

  it.each(ROUTES.filter((r) => !/widget|form-embed/.test(r)))(
    '%s refuses framing and loads nothing',
    async (path) => {
      const r = await fetch(s.base + path);
      expect(r.headers.get('x-frame-options')).toBe('SAMEORIGIN');
      expect(r.headers.get('content-security-policy')).toBe(
        "default-src 'none'; frame-ancestors 'self'",
      );
    },
  );

  it.each(['/widget/abc', '/v2/widget/abc', '/form-embed/x.js'])(
    '%s may be embedded cross-origin',
    async (path) => {
      const r = await fetch(s.base + path);
      expect(r.headers.get('x-frame-options')).toBeNull();
      expect(r.headers.get('content-security-policy')).toBeNull();
    },
  );

  it.each(['/v2/auth/login', '/v2/account/me', '/v2/platform/users', '/v2/onboarding/x'])(
    '%s is never cached',
    async (path) => {
      const cc = (await fetch(s.base + path)).headers.get('cache-control') ?? '';
      expect(cc).toMatch(/no-store/);
      expect(cc).toMatch(/private/);
    },
  );

  it('HSTS only on a secure connection', async () => {
    expect(
      (await fetch(s.base + '/v2/contacts')).headers.get('strict-transport-security'),
    ).toBeNull();
    const r = await fetch(s.base + '/v2/contacts', { headers: { 'x-forwarded-proto': 'https' } });
    expect(r.headers.get('strict-transport-security')).toMatch(/max-age=31536000/);
  });
});

describe('CORS over HTTP: staff API, production, one allowed origin', () => {
  let s: Awaited<ReturnType<typeof boot>>;
  beforeAll(async () => {
    s = await boot(['https://app.example.com'], 'production');
  });
  afterAll(() => s.app.close());
  const call = (origin: string, method = 'GET', extra: Record<string, string> = {}) =>
    fetch(s.base + '/v2/contacts', { method, headers: { origin, ...extra } });

  it('answers the allowed origin with credentials and the exposed headers', async () => {
    const r = await call('https://app.example.com');
    expect(r.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    expect(r.headers.get('access-control-allow-credentials')).toBe('true');
    expect(r.headers.get('access-control-expose-headers')).toMatch(/x-request-id/);
    expect(r.headers.get('vary')).toMatch(/origin/i);
  });

  it.each([
    'https://evil.example',
    'null',
    'https://app.example.com.evil.example',
    'https://evilapp.example.com',
    'http://app.example.com',
    'https://app.example.com:8443',
    'https://sub.app.example.com',
    'https://APP.example.com',
    'https://app.example.com/',
    'https://app.example.com@evil.example',
    'file://',
    '*',
  ])('does not echo %j', async (origin) => {
    const r = await call(origin);
    // The `cors` library still sends Allow-Credentials here; a browser ignores it without a matching Allow-Origin.
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers the preflight of the allowed origin only', async () => {
    const ok = await call('https://app.example.com', 'OPTIONS', {
      'access-control-request-method': 'POST',
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    const bad = await call('https://evil.example', 'OPTIONS', {
      'access-control-request-method': 'POST',
    });
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('never answers a credentialed wildcard', async () => {
    for (const o of ['https://app.example.com', 'https://evil.example']) {
      const r = await call(o);
      expect(r.headers.get('access-control-allow-origin')).not.toBe('*');
    }
  });
});

describe('CORS over HTTP: production with no origins listed is closed', () => {
  let s: Awaited<ReturnType<typeof boot>>;
  beforeAll(async () => {
    s = await boot([], 'production');
  });
  afterAll(() => s.app.close());
  it.each(['https://app.example.com', 'https://evil.example', 'null'])(
    'no CORS headers for %j',
    async (origin) => {
      const r = await fetch(s.base + '/v2/contacts', { headers: { origin } });
      expect(r.headers.get('access-control-allow-origin')).toBeNull();
    },
  );
});

describe('CORS over HTTP: customer API', () => {
  let s: Awaited<ReturnType<typeof boot>>;
  beforeAll(async () => {
    s = await boot(['https://app.example.com'], 'production');
  });
  afterAll(() => s.app.close());

  it('answers every origin, never with credentials', async () => {
    for (const origin of ['https://evil.example', 'https://app.example.com', 'null']) {
      const r = await fetch(s.base + '/api/v1/contacts', { headers: { origin } });
      expect(r.headers.get('access-control-allow-origin')).toBe('*');
      expect(r.headers.get('access-control-allow-credentials')).toBeNull();
    }
  });

  it.each([
    '/v2/api/v1/contacts',
    '/api/v10/contacts',
    '/api/v1evil',
    '/API/V1/contacts',
    '/v2/contacts?x=/api/v1/',
  ])('%s keeps the staff policy', async (path) => {
    const r = await fetch(s.base + path, { headers: { origin: 'https://evil.example' } });
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('the path rule itself', () => {
    expect(isCustomerApiPath('/api/v1')).toBe(true);
    expect(isCustomerApiPath('/api/v1/x?y=1')).toBe(true);
    expect(isCustomerApiPath('/docs/api.json')).toBe(true);
    expect(isCustomerApiPath('/v2/auth/login')).toBe(false);
    expect(isCustomerApiPath(undefined)).toBe(false);
  });
});

/**
 * The API is bearer-only: a login lives in the `Authorization` header, never in a cookie, which is why it needs no CSRF token (the web
 * app's cookie lives in the Next.js proxy, guarded by isSameOrigin). If a handler or guard starts reading a cookie, that stops being true.
 */
describe('the API reads no cookie for authentication', () => {
  const SRC = join(__dirname, '../../../src');
  const COOKIE_READ = /req\.cookies|cookie-parser|cookieParser|headers\.cookie|headers\['cookie'\]/;
  const REVIEWED: Record<string, string> = {
    'modules/chatbot-widget/widget-public.service.ts': 'anonymous visitor id of the public chat widget, not a login',
    'modules/chatbot-widget/widget-public.controller.ts': 'passes the widget visitor cookie to the service',
    'modules/platform-infrastructure/observability/sentry.ts': 'removes cookies before an error report is sent',
  };
  function* ts(dir: string): Generator<string> {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) yield* ts(p);
      else if (p.endsWith('.ts')) yield p;
    }
  }
  const readers = [...ts(SRC)]
    .filter((p) => COOKIE_READ.test(readFileSync(p, 'utf8')))
    .map((p) => relative(SRC, p).split(sep).join('/'));
  it('only reviewed files touch a request cookie', () => {
    expect(readers.filter((f) => !(f in REVIEWED))).toEqual([]);
  });
  it('the review list has no stale entries', () => {
    expect(Object.keys(REVIEWED).filter((f) => !readers.includes(f))).toEqual([]);
  });
});

describe('CORS: development with no origins listed (documented, loud at boot)', () => {
  let s: Awaited<ReturnType<typeof boot>>;
  beforeAll(async () => {
    s = await boot([], 'development');
  });
  afterAll(() => s.app.close());
  it('reflects any origin WITH credentials, which is why a shared server must set NODE_ENV=production', async () => {
    const r = await fetch(s.base + '/v2/contacts', { headers: { origin: 'https://evil.example' } });
    expect(r.headers.get('access-control-allow-origin')).toBe('https://evil.example');
    expect(r.headers.get('access-control-allow-credentials')).toBe('true');
  });
});
