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

export interface HarnessOptions {
  /** Runs on the Nest application before `init()`: where a spec that needs sockets installs its WebSocket adapter. */
  configureApp?: (app: INestApplication) => void | Promise<void>;
  /**
   * Modules added next to AppModule: how a spec runs the worker-side processors (a worker module is not part of the HTTP app) inside the
   * same process, against the same database and Redis. A loader, so the modules are imported after the environment is set, like AppModule.
   */
  loadModules?: () => Promise<unknown[]>;
  /**
   * Whether the platform's unofficial WhatsApp engine switch (`wa.unofficial.enabled`) starts ON. Production defaults to OFF; the
   * suites written before the switch existed exercise the engine itself, so the harness turns it on unless a spec asks for the
   * real default with `false`.
   *
   * Owner decision 2026-10-06: a workspace also needs a row on the allow-list (`unofficial_whatsapp_workspaces`). By default (`true`)
   * the harness allows EVERY test workspace: a test-only trigger adds the row when an organization is created, so the older suites
   * keep working. `'platform-only'` turns the platform switch on but allows nobody (the production behaviour once a super admin
   * turned the platform switch on), and a spec then allows workspaces through the admin API. `false` leaves both off.
   */
  unofficialWhatsapp?: boolean | 'platform-only';
}

/**
 * Opens one more workspace for an email that already has an account, for the multi-workspace
 * scenarios (workspace picker, switch). Every public sign-up route now refuses that with
 * AUTH_IDENTITY_EXISTS, so this skips those routes' checks and runs the same provisioning step a
 * sign-up runs once its checks pass, giving a real organization, owner, session and mails.
 */
export async function seedAnotherWorkspace(
  h: Harness,
  input: {
    email: string;
    orgName: string;
    password: string;
    fullName?: string;
    referralCode?: string;
  },
  meta: { ip?: string; userAgent?: string } = {},
): Promise<{ orgSlug: string; tokens: { accessToken: string; refreshToken: string } }> {
  const { SignupService } = await import('../../../src/modules/auth/flows/signup.service');
  const { PasswordService } = await import('../../../src/modules/auth/security/password.service');
  const { slugify } = await import('../../../src/modules/auth/support/text');
  const result = await h.app.get(SignupService).create(
    {
      orgName: input.orgName,
      slug: slugify(input.orgName),
      slugExplicit: false,
      fullName: input.fullName ?? 'Test Person',
      email: input.email,
      phoneE164: null,
      passwordHash: await h.app.get(PasswordService).hash(input.password),
      referralCode: input.referralCode ?? null,
    },
    { phoneVerified: false },
    meta,
  );
  return { orgSlug: result.orgSlug, tokens: result.tokens };
}

/**
 * A hermetic copy of the API: real Postgres (restricted role, real migrations),
 * real Redis, the real AppModule. Only the outbound edges are faked: mail,
 * captcha and the OAuth providers capture what they were asked to do, and the
 * sign-up code goes through the REAL composite sender to local HTTP stubs of
 * Meta, Twilio and the bridge, so tests follow the codes a person would receive.
 */
export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
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
  // These suites were written when super admins always had to enrol two-factor; the switch has been off by default since
  // commit 5f741143, so the precondition they rely on is set explicitly (the switch's own behaviour is tested separately).
  await owner.query(
    `INSERT INTO platform_settings (key, value, is_secret) VALUES ('security.policy', '{"requireMfaForSuperAdmins": true}'::jsonb, false)
     ON CONFLICT (key) DO UPDATE SET value = platform_settings.value || '{"requireMfaForSuperAdmins": true}'::jsonb`,
  );

  // The suites sign up with made-up domains and, unless they switch the code on, no mobile number. The work-email,
  // disposable-mail and mandatory-phone rules default on, so they are off here; signup-email-phone-policy.e2e.spec.ts covers them.
  await owner.query(
    `INSERT INTO platform_settings (key, value, is_secret) VALUES ('registration', '{"businessEmailOnly": false, "blockDisposableEmail": false, "requirePhoneVerification": false}'::jsonb, false)
     ON CONFLICT (key) DO UPDATE SET value = platform_settings.value || '{"businessEmailOnly": false, "blockDisposableEmail": false, "requirePhoneVerification": false}'::jsonb`,
  );

  if (options.unofficialWhatsapp !== false) {
    await owner.query(
      `INSERT INTO platform_settings (key, value, is_secret) VALUES ('wa.unofficial.enabled', 'true'::jsonb, false)
       ON CONFLICT (key) DO UPDATE SET value = 'true'::jsonb`,
    );
  }
  if (options.unofficialWhatsapp !== false && options.unofficialWhatsapp !== 'platform-only') {
    // Test-only: every workspace created from here on is on the allow-list (SECURITY DEFINER because the table is operator-written).
    await owner.query(`
      CREATE FUNCTION test_allow_unofficial() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
      BEGIN
        INSERT INTO unofficial_whatsapp_workspaces (org_id, note) VALUES (NEW.id, 'test harness') ON CONFLICT DO NOTHING;
        RETURN NEW;
      END $$;
      CREATE TRIGGER trg_test_allow_unofficial AFTER INSERT ON organizations
        FOR EACH ROW EXECUTE FUNCTION test_allow_unofficial();`);
  }

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
  const extraModules = (await options.loadModules?.()) ?? [];
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ...(extraModules as never[])],
  })
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
  await options.configureApp?.(app);
  await app.init();
  if (options.unofficialWhatsapp !== false && options.unofficialWhatsapp !== 'platform-only') {
    // The allow-all trigger adds a row behind the service's back, so the 5 s allow-list cache would miss a workspace created a moment ago.
    const { UnofficialWhatsappSwitch } =
      await import('../../../src/modules/auth/platform/unofficial-whatsapp-switch');
    app.get(UnofficialWhatsappSwitch).allowCacheMs = 0;
  }

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
