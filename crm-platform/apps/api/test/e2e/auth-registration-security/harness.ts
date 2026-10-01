import { VersioningType, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { hash } from '@node-rs/argon2';
import { Redis } from 'ioredis';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { runMigrations } from '@crm/db';
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

import { sentCodes, startStubs, type SentCode, type Stubs } from './stubs';

export const OPERATOR_EMAIL = 'ops@platform.test';
export const OPERATOR_PASSWORD = 'Op3rator!Pass#2026';

export interface Harness {
  app: INestApplication;
  /** Owner connection: bypasses RLS, for arranging and inspecting state. */
  owner: Client;
  redis: Redis;
  mail: MailMessage[];
  /**
   * Every sign-up code delivered so far, oldest first, read back from what the
   * stub servers received (the real senders run; only the far end is fake).
   */
  readonly otps: SentCode[];
  /** Stand-ins for Meta's Graph API, Twilio and the Node bridge. */
  stubs: Stubs;
  captchaValid: { token: string };
  /** What the fake identity provider returns for a given authorization `code`. */
  socialProfiles: Map<string, SocialProfile>;
  stop(): Promise<void>;
}

/**
 * A hermetic copy of the API: real Postgres (restricted role, real migrations),
 * real Redis, the real AppModule. Only the outbound edges are faked: mail,
 * captcha and the OAuth providers capture what they were asked to do, and the
 * sign-up code goes through the REAL composite sender to local HTTP stubs of
 * Meta, Twilio and the bridge, so tests follow the codes a person would receive.
 */
export async function startHarness(): Promise<Harness> {
  const pg: StartedPostgreSqlContainer = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('crm')
    .withUsername('crm')
    .withPassword('crm')
    .start();
  const redis: StartedTestContainer = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .start();

  const owner = new Client({ connectionString: pg.getConnectionUri() });
  await owner.connect();
  await owner.query(
    `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
  );
  await runMigrations(pg.getConnectionUri(), {
    dir: resolve(__dirname, '../../../../../packages/db/migrations'),
    log: () => undefined,
  });

  await owner.query(
    `INSERT INTO platform_operators (email, full_name, password_hash, role) VALUES ($1, 'Ops', $2, 'super_admin'), ('support@platform.test', 'Support', $2, 'support')`,
    [OPERATOR_EMAIL, await hash(OPERATOR_PASSWORD)],
  );

  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    PORT: '3999',
    APP_URL: 'http://localhost:3999',
    WEB_APP_URL: 'http://localhost:3001',
    APP_NAME: 'Test CRM',
    TRUST_PROXY: 'loopback',
    DATABASE_URL: `postgres://crm_app_user:test@${pg.getHost()}:${pg.getPort()}/crm`,
    MIGRATION_DATABASE_URL: pg.getConnectionUri(),
    REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
    JWT_ACCESS_SECRET: 'access-secret-for-tests-0123456789abcdef',
    JWT_REFRESH_SECRET: 'refresh-secret-for-tests-0123456789abcdef',
    CLERK_SECRET_KEY: 'sk_test_unused',
    CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  });

  const mail: MailMessage[] = [];
  const stubs = await startStubs();
  const captchaValid = { token: 'good-token' };
  const socialProfiles = new Map<string, SocialProfile>();

  const fakeMail: MailPort = { send: async (m) => void mail.push(m) };
  const fakeCaptcha: CaptchaPort = { verify: async (_c, i) => i.token === captchaValid.token };
  const fakeSocial = (name: 'google' | 'facebook'): SocialOAuthProvider => ({
    name,
    authorizeUrl: (c, redirect, state) =>
      `https://idp.test/${name}?client_id=${c.clientId}&redirect_uri=${encodeURIComponent(redirect)}&state=${state}`,
    fetchProfile: async (_c, _r, code) => {
      const p = socialProfiles.get(code);
      if (!p) throw new Error('bad code');
      return p;
    },
  });

  // Imported after the environment is set: AppModule reads configuration at import.
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

  const redisClient = new Redis(process.env.REDIS_URL!);
  return {
    app,
    owner,
    redis: redisClient,
    mail,
    get otps() {
      return [
        ...sentCodes('graph', stubs.graph.requests),
        ...sentCodes('twilio', stubs.twilio.requests),
        ...sentCodes('bridge', stubs.bridge.requests),
      ].sort((a, b) => a.seq - b.seq);
    },
    stubs,
    captchaValid,
    socialProfiles,
    stop: async () => {
      await app.close();
      await Promise.all([stubs.graph.close(), stubs.twilio.close(), stubs.bridge.close()]);
      redisClient.disconnect();
      await owner.end();
      await redis.stop();
      await pg.stop();
    },
  };
}
