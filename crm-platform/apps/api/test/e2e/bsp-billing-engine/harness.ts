import { VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Redis } from 'ioredis';
import { Client } from 'pg';
import request from 'supertest';
import { expect } from 'vitest';
import {
  CAPTCHA_PORT,
  type CaptchaPort,
} from '../../../src/infra/providers/auth-registration-security/captcha.port';
import {
  MAIL_PORT,
  type MailMessage,
  type MailPort,
} from '../../../src/infra/providers/auth-registration-security/mail.port';
import {
  SOCIAL_OAUTH_PROVIDERS,
  type SocialOAuthProvider,
  type SocialProfile,
} from '../../../src/infra/providers/auth-registration-security/social-oauth.port';
import { MetaCreditSource } from '../../../src/infra/providers/bsp-billing-engine/meta-credit-source';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { APP_URL, OWNER_URL } from '../../integration/bsp-billing-engine/live-db';
import { Api, PASSWORD, bearer, type Tenant } from '../contacts-attributes-tags/support';
import { startStubs } from '../auth-registration-security/stubs';
import type { Harness } from '../auth-registration-security/harness';

export { PASSWORD, bearer, type Tenant };

export const OPERATOR_PASSWORD = 'Op3rator!Pass#2026';

/** What a test queues for the stand-in Graph API: the next replies, by request. */
export interface GraphSeen {
  method: string;
  path: string;
  query: URLSearchParams;
  auth: string | undefined;
}

type Reply = { status: number; body?: unknown };

/** A Meta that accepts everything: it shares the credit line, owns one credit line, and revokes. */
function acceptEverything(req: GraphSeen): Reply {
  if (req.method === 'POST' && req.path.endsWith('/whatsapp_credit_sharing_and_attach')) {
    return { status: 200, body: { allocation_config_id: `alloc-${req.query.get('waba_id')}` } };
  }
  if (req.method === 'GET' && req.path.endsWith('/extendedcredits')) {
    return { status: 200, body: { data: [{ id: 'credit-line-1' }] } };
  }
  if (req.method === 'DELETE') return { status: 200, body: { success: true } };
  return { status: 404, body: { error: { message: 'unexpected call' } } };
}

export class GraphStub {
  seen: GraphSeen[] = [];
  /** Decides each reply; a test replaces it, `reset` puts the default back. */
  respond: (req: GraphSeen) => Reply = acceptEverything;
  private server!: Server;
  url = '';

  async start(): Promise<this> {
    this.server = createServer((req: IncomingMessage, res) => {
      const u = new URL(req.url ?? '/', 'http://x');
      const seen: GraphSeen = {
        method: req.method ?? '',
        path: u.pathname,
        query: u.searchParams,
        auth: req.headers.authorization,
      };
      this.seen.push(seen);
      const r = this.respond(seen);
      res.statusCode = r.status;
      res.setHeader('content-type', 'application/json');
      res.end(r.body === undefined ? '' : JSON.stringify(r.body));
    });
    await new Promise<void>((ok) => this.server.listen(0, '127.0.0.1', ok));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  /** Forget what was seen and answer like a Meta that accepts everything again. */
  reset(): void {
    this.seen = [];
    this.respond = acceptEverything;
  }

  /** Back to the default replies, keeping what was seen. */
  restore(): void {
    this.respond = acceptEverything;
  }

  calls(method: string, suffix: string): GraphSeen[] {
    return this.seen.filter((s) => s.method === method && s.path.endsWith(suffix));
  }

  stop(): Promise<void> {
    return new Promise((ok) => this.server.close(() => ok()));
  }
}

export interface BspHarness extends Harness {
  graph: GraphStub;
  source: MetaCreditSource;
  /** Organizations and operators the test made; removed by `stop`. */
  track: { orgs: number[]; operators: number[] };
  api: Api;
  superToken: string;
  supportToken: string;
}

let ipCounter = 100;
const nextIp = () => `10.91.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;

/**
 * The real AppModule against the worktree's own database (no testcontainers: containers are off limits in the swarm) as the
 * restricted application role, the real Redis on a database index of its own, and a local stand-in for Meta's Graph API behind the
 * credit-source adapter. Everything the tests create is removed by `stop`.
 */
export async function startBspHarness(): Promise<BspHarness> {
  const owner = new Client({ connectionString: OWNER_URL });
  await owner.connect();

  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    PORT: '3998',
    APP_URL: 'http://localhost:3998',
    WEB_APP_URL: 'http://localhost:3001',
    APP_NAME: 'Test CRM',
    TRUST_PROXY: 'loopback',
    DATABASE_URL: APP_URL,
    MIGRATION_DATABASE_URL: OWNER_URL,
    DATABASE_REPLICA_URL: APP_URL,
    REDIS_URL: 'redis://127.0.0.1:6379/13',
    JWT_ACCESS_SECRET: 'access-secret-for-tests-0123456789abcdef',
    JWT_REFRESH_SECRET: 'refresh-secret-for-tests-0123456789abcdef',
    CLERK_SECRET_KEY: 'sk_test_unused',
    CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  });

  const redis = new Redis(process.env.REDIS_URL!);
  await redis.flushdb(); // database 13 is this suite's alone

  const mail: MailMessage[] = [];
  const stubs = await startStubs();
  const graph = await new GraphStub().start();
  const captchaValid = { token: 'good-token' };
  const socialProfiles = new Map<string, SocialProfile>();
  const fakeMail: MailPort = { send: async (m) => void mail.push(m) };
  const fakeCaptcha: CaptchaPort = { verify: async (_c, i) => i.token === captchaValid.token };
  const fakeSocial = (name: 'google' | 'facebook'): SocialOAuthProvider => ({
    name,
    authorizeUrl: () => `https://idp.test/${name}`,
    fetchProfile: async () => {
      throw new Error('unused');
    },
  });

  const { AppModule } = await import('../../../src/app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAIL_PORT)
    .useValue(fakeMail)
    .overrideProvider(CAPTCHA_PORT)
    .useValue(fakeCaptcha)
    .overrideProvider(SOCIAL_OAUTH_PROVIDERS)
    .useValue([fakeSocial('google'), fakeSocial('facebook')])
    .compile();
  const app = moduleRef.createNestApplication({ rawBody: true, logger: false });
  (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set(
    'trust proxy',
    'loopback',
  );
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '2' });
  await app.init();

  const source = app.get(MetaCreditSource);
  source.transport = { baseUrl: graph.url };

  const track = { orgs: [] as number[], operators: [] as number[] };
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const operatorEmail = `bsp-ops-${suffix}@platform.test`;
  const supportEmail = `bsp-support-${suffix}@platform.test`;
  for (const [email, name, role] of [
    [operatorEmail, 'Ops', 'super_admin'],
    [supportEmail, 'Support', 'support'],
  ] as const) {
    const r = await owner.query(
      `INSERT INTO platform_operators (email, full_name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id`,
      [email, name, await hash(OPERATOR_PASSWORD), role],
    );
    track.operators.push(Number(r.rows[0].id));
  }

  const http = () => request(app.getHttpServer());
  // The super admin must enrol two-factor authentication before the console lets them in.
  const first = await http()
    .post('/v2/platform/auth/login')
    .set('x-forwarded-for', nextIp())
    .send({ email: operatorEmail, password: OPERATOR_PASSWORD });
  expect(first.body).toMatchObject({ status: 'authenticated', mfaEnrolmentRequired: true });
  const token = first.body.tokens.accessToken as string;
  const setup = await http().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  const enabled = await http()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: hotp(base32Decode(setup.body.secret), totpStep(Date.now())) });
  expect(enabled.status).toBe(201);
  const supportLogin = await http()
    .post('/v2/platform/auth/login')
    .set('x-forwarded-for', nextIp())
    .send({ email: supportEmail, password: OPERATOR_PASSWORD });
  expect(supportLogin.body.status).toBe('authenticated');

  const h: BspHarness = {
    app,
    owner,
    redis,
    mail,
    get otps() {
      return [];
    },
    stubs,
    captchaValid,
    socialProfiles,
    graph,
    source,
    track,
    api: undefined as unknown as Api,
    superToken: token,
    supportToken: supportLogin.body.tokens.accessToken as string,
    stop: async () => {
      try {
        // The platform settings the tests wrote, every organization they created (everything under it cascades), the usage rows
        // (no foreign key to an organization) and the operators.
        await owner.query(`DELETE FROM platform_settings WHERE key IN ('bsp.reseller', 'bsp.system_user_token', 'billing.pay_per_message')`);
        if (track.orgs.length) {
          await owner.query(`DELETE FROM usage_charges WHERE org_id = ANY($1)`, [track.orgs]);
          await owner.query(`DELETE FROM organizations WHERE id = ANY($1)`, [track.orgs]);
        }
        await owner.query(`DELETE FROM message_rates WHERE country_code IN ('QQ', 'ZZ')`);
        if (track.operators.length) {
          await owner.query(`DELETE FROM platform_sessions WHERE operator_id = ANY($1)`, [track.operators]);
          await owner.query(`DELETE FROM platform_operators WHERE id = ANY($1)`, [track.operators]);
        }
      } finally {
        await app.close();
        await Promise.all([stubs.graph.close(), stubs.twilio.close(), stubs.bridge.close(), graph.stop()]);
        await redis.flushdb();
        redis.disconnect();
        await owner.end();
      }
    },
  };
  h.api = new Api(h);
  return h;
}

/** A tenant (organization plus admin) that the harness removes at the end. */
export async function newTenant(h: BspHarness, label: string): Promise<Tenant> {
  void nextIp;
  const t = await h.api.signup(label);
  h.track.orgs.push(t.orgId);
  return t;
}
