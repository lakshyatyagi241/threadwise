import { randomBytes } from 'node:crypto';
import { VersioningType, type INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAPTCHA_PORT } from '../../../src/infra/providers/auth-registration-security/captcha.port';
import { MAIL_PORT } from '../../../src/infra/providers/auth-registration-security/mail.port';
import { SOCIAL_OAUTH_PROVIDERS } from '../../../src/infra/providers/auth-registration-security/social-oauth.port';
import { startTcpFaultProxy, type TcpFaultProxy } from '../../unit/network-failure/tcp-fault-proxy';
import { startNfInfra, type NfInfra } from './infra';

/**
 * The real AppModule with Postgres and Redis behind fault proxies. For each fault: the endpoints that matter answer inside a deadline
 * with a classifiable problem+json (never a hang, never a stack), and once the dependency is back the very same app instance serves
 * normally again. Endpoints: sign-in (auth), an authenticated read (contacts list), an authenticated write (contact create), readiness
 * and liveness.
 */
const PASSWORD = 'Str0ngPassw0rd#1';
let infra: NfInfra;
let pgProxy: TcpFaultProxy;
let redisProxy: TcpFaultProxy;
let owner: Client;
let app: INestApplication;
let slug: string;
let email: string;
let token: string;
let ip = 10;

const http = () => request(app.getHttpServer());
const nextIp = () => `10.77.0.${ip++ % 250}`;
const authed = (r: request.Test) =>
  r.set('authorization', `Bearer ${token}`).set('x-forwarded-for', nextIp());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const calls = {
  login: () =>
    http()
      .post('/v2/auth/login')
      .set('x-forwarded-for', nextIp())
      .send({ orgSlug: slug, email, password: PASSWORD }),
  session: () => authed(http().get('/v2/auth/session')),
  read: () => authed(http().get('/v2/contacts')),
  write: () =>
    authed(http().post('/v2/contacts')).send({
      firstName: 'Outage',
      phone: `+9199${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    }),
  ready: () => http().get('/ready'),
  health: () => http().get('/health'),
};

async function timedCall(name: keyof typeof calls) {
  const t0 = performance.now();
  const res = await calls[name]();
  return { res, ms: performance.now() - t0 };
}

/** Every failed response is a problem+json the client can classify; none carries an address, driver text or a stack. */
function expectClassifiable(res: request.Response, allowed: number[]) {
  expect(allowed, `${res.status} ${JSON.stringify(res.body)}`).toContain(res.status);
  const text = JSON.stringify(res.body);
  expect(text).not.toMatch(
    /127\.0\.0\.1|ECONN|at \w+ \(|node_modules|crm_app_user|Connection terminated/,
  );
  if (res.status >= 500)
    expect(res.body.code, text).toMatch(/^(SERVICE_UNAVAILABLE|AUTH_SERVICE_DEGRADED)$/);
}

beforeAll(async () => {
  Logger.overrideLogger(false);
  console.error = () => undefined;
  infra = await startNfInfra();
  pgProxy = await startTcpFaultProxy(infra.pg);
  redisProxy = await startTcpFaultProxy({ host: infra.redis.host, port: infra.redis.port });
  owner = new Client({ connectionString: infra.ownerUrl() });
  await owner.connect();
  await owner.query(
    `INSERT INTO platform_settings (key, value, is_secret) VALUES ('registration', '{"businessEmailOnly": false, "blockDisposableEmail": false, "requirePhoneVerification": false}'::jsonb, false)
     ON CONFLICT (key) DO UPDATE SET value = platform_settings.value || EXCLUDED.value`,
  );

  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    PORT: '3998',
    APP_URL: 'http://localhost:3998',
    WEB_APP_URL: 'http://localhost:3001',
    APP_NAME: 'Test CRM',
    TRUST_PROXY: 'loopback',
    DATABASE_URL: infra.appUrl('127.0.0.1', pgProxy.port),
    MIGRATION_DATABASE_URL: infra.ownerUrl(),
    REDIS_URL: `redis://127.0.0.1:${redisProxy.port}/${infra.redis.db}`,
    DB_STATEMENT_TIMEOUT_MS: '1000',
    JWT_ACCESS_SECRET: 'access-secret-for-tests-0123456789abcdef',
    JWT_REFRESH_SECRET: 'refresh-secret-for-tests-0123456789abcdef',
    CLERK_SECRET_KEY: 'sk_test_unused',
    CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  });
  delete process.env.AUTH_REDIS_FAILURE_MODE;
  const { AppModule } = await import('../../../src/app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAIL_PORT)
    .useValue({ send: async () => undefined })
    .overrideProvider(CAPTCHA_PORT)
    .useValue({ verify: async () => true })
    .overrideProvider(SOCIAL_OAUTH_PROVIDERS)
    .useValue([])
    .compile();
  app = moduleRef.createNestApplication({ rawBody: true, logger: false });
  (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set(
    'trust proxy',
    'loopback',
  );
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '2' });
  await app.init();

  email = `nf2${randomBytes(4).toString('hex')}@example.test`;
  const signup = await http()
    .post('/v2/auth/signup')
    .set('x-forwarded-for', nextIp())
    .send({
      orgName: `NF2 ${randomBytes(3).toString('hex')}`,
      fullName: 'Admin Person',
      email,
      password: PASSWORD,
      acceptTerms: true,
    });
  expect(signup.status, JSON.stringify(signup.body)).toBe(201);
  token = signup.body.tokens.accessToken;
  const session = await calls.session();
  slug = session.body.org.slug;
  void hash;
}, 600_000);

afterAll(async () => {
  await app?.close().catch(() => undefined);
  await owner?.end().catch(() => undefined);
  await pgProxy?.close();
  await redisProxy?.close();
  await infra?.stop();
});

async function backToNormal() {
  await pgProxy.setMode('pass');
  await redisProxy.setMode('pass');
  const end = Date.now() + 30_000;
  for (;;) {
    const r = await calls.ready();
    if (r.status === 200) break;
    if (Date.now() > end)
      throw new Error(`not ready 30 s after the dependencies returned: ${JSON.stringify(r.body)}`);
    await sleep(300);
  }
}

describe('baseline', () => {
  it('every endpoint works with both dependencies up', async () => {
    for (const name of ['login', 'session', 'read', 'ready', 'health'] as const) {
      const { res } = await timedCall(name);
      expect(res.status, `${name} ${JSON.stringify(res.body)}`).toBeLessThan(300);
    }
    expect((await timedCall('write')).res.status).toBe(201);
  });
});

describe('Postgres outage', () => {
  it.each(['refuse', 'reset', 'stall'] as const)(
    '%s: reads, writes, sign-in and readiness answer 503 in time; liveness stays 200; the app recovers by itself',
    async (mode) => {
      await pgProxy.setMode(mode);
      const slow = mode === 'stall' ? 14_000 : 4_000;
      for (const name of ['read', 'write', 'login', 'session'] as const) {
        const { res, ms } = await timedCall(name);
        expect(ms, `${name} took ${ms} ms`).toBeLessThan(slow);
        expectClassifiable(res, [503]);
      }
      const ready = await timedCall('ready');
      expect(ready.ms).toBeLessThan(3_500);
      expect(ready.res.status).toBe(503);
      expect(ready.res.body.checks.primary.status).toBe('down');
      expect((await timedCall('health')).res.status).toBe(200);

      await backToNormal();
      expect((await timedCall('read')).res.status).toBe(200);
      expect((await timedCall('write')).res.status).toBe(201);
      expect((await timedCall('login')).res.status).toBeLessThan(300);
    },
    120_000,
  );
});

describe('Redis outage, AUTH_REDIS_FAILURE_MODE=closed', () => {
  it.each(['refuse', 'reset', 'stall'] as const)(
    '%s: authenticated calls and sign-in answer 503 in time; readiness 503; recovers by itself',
    async (mode) => {
      process.env.AUTH_REDIS_FAILURE_MODE = 'closed';
      try {
        await redisProxy.setMode(mode);
        const slow = mode === 'stall' ? 14_000 : 6_000;
        for (const name of ['session', 'read', 'write', 'login'] as const) {
          const { res, ms } = await timedCall(name);
          expect(ms, `${name} took ${ms} ms`).toBeLessThan(slow);
          expectClassifiable(res, [503]);
        }
        const ready = await timedCall('ready');
        expect(ready.ms).toBeLessThan(3_500);
        expect(ready.res.status).toBe(503);
        expect(ready.res.body.checks.redis.status).toBe('down');
        expect((await timedCall('health')).res.status).toBe(200);
      } finally {
        delete process.env.AUTH_REDIS_FAILURE_MODE;
      }
      await backToNormal();
      process.env.AUTH_REDIS_FAILURE_MODE = 'closed';
      try {
        expect((await timedCall('read')).res.status).toBe(200);
        expect((await timedCall('write')).res.status).toBe(201);
      } finally {
        delete process.env.AUTH_REDIS_FAILURE_MODE;
      }
    },
    120_000,
  );
});

describe('Redis outage, AUTH_REDIS_FAILURE_MODE=open (the non-production default)', () => {
  it.each(['refuse', 'stall'] as const)(
    '%s: an authenticated read still ends in time with a good answer or a classifiable 503, and recovers',
    async (mode) => {
      await redisProxy.setMode(mode);
      const { res, ms } = await timedCall('read');
      // Open mode degrades check by check, and each check waits out its own Redis deadline, so a request is slow (not stuck) during the outage.
      expect(ms).toBeLessThan(mode === 'stall' ? 25_000 : 14_000);
      expectClassifiable(res, [200, 503]);
      const ready = await timedCall('ready');
      expect(ready.res.status).toBe(503);
      await backToNormal();
      expect((await timedCall('read')).res.status).toBe(200);
    },
    120_000,
  );
});
