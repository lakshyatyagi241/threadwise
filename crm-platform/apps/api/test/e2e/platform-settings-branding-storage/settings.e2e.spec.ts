import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  publicSiteConfigSchema,
  setExportResponseSchema,
  setGroupResponseSchema,
  setHubResponseSchema,
} from '@crm/contracts';
import {
  MailError,
  MAIL_PORT,
} from '../../../src/infra/providers/auth-registration-security/mail.port';
import { PusherProbe } from '../../../src/infra/providers/platform-settings-branding-storage/pusher.probe';
import { PlatformSettingsService } from '../../../src/modules/auth';
import { MailRuntimeService } from '../../../src/modules/platform-settings-branding-storage/mail-runtime.service';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/**
 * The platform settings slice end to end through HTTP (WD-SET-001, 002, 003, 004, 005, 008, 024, 025, 039,
 * 041 and the public projection): real Postgres with the restricted role, real Redis, the real AppModule.
 * Only the outbound edges are faked: the mail port, a local S3 stand-in, a local Pusher stand-in.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));
let superToken = '';
let supportToken = '';

type Method = 'get' | 'post' | 'patch';
const ops = (m: Method, path: string) =>
  api()[m](`/v2/platform/settings${path}`).set(bearer(superToken));
const support = (m: Method, path: string) =>
  api()[m](`/v2/platform/settings${path}`).set(bearer(supportToken));

async function group(name: string) {
  const res = await ops('get', `/groups/${name}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return setGroupResponseSchema.parse(res.body);
}
async function save(
  name: string,
  values: Record<string, unknown>,
  secrets: Record<string, string | null> = {},
) {
  const current = await group(name);
  const res = await ops('patch', `/groups/${name}`).send({
    rowVersion: current.rowVersion,
    values,
    secrets,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return setGroupResponseSchema.parse(res.body);
}
const events = async (like: string) =>
  (
    await h.owner.query(
      `SELECT event, actor_type, status, payload FROM security_events WHERE event LIKE $1 ORDER BY id`,
      [like],
    )
  ).rows as Array<{
    event: string;
    actor_type: string;
    status: string;
    payload: { fields: string[]; rows: number; ok?: boolean };
  }>;

/** Wipes every settings row so each test starts from "nothing saved". */
const reset = async () => {
  await h.owner.query(`DELETE FROM platform_settings WHERE key LIKE 'set.%'`);
  h.app.get(PlatformSettingsService).invalidate(); // this process caches reads for a few seconds
};

let stub: Server;
let stubUrl = '';
let stubStatus = 200;
let stubBody = '';
const stubSeen: Array<{ method: string; url: string }> = [];

let tenantToken = '';

beforeAll(async () => {
  h = await startHarness();

  const first = await api()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  const setup = await api().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  const enabled = await api()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: totp(setup.body.secret) });
  expect(enabled.status).toBe(201);
  superToken = token;
  const sup = await api()
    .post('/v2/platform/auth/login')
    .send({ email: 'support@platform.test', password: OPERATOR_PASSWORD });
  supportToken = sup.body.tokens.accessToken as string;

  const signup = await api()
    .post('/v2/auth/signup')
    .set('x-forwarded-for', '10.9.0.1')
    .send({
      orgName: 'Settings Org',
      fullName: 'Plan Person',
      email: `set${Date.now()}@example.test`,
      password: 'Str0ngPassw0rd#1',
      acceptTerms: true,
    });
  expect(signup.status, JSON.stringify(signup.body)).toBe(201);
  tenantToken = signup.body.tokens.accessToken as string;

  stub = createServer((req, res) => {
    stubSeen.push({ method: req.method!, url: req.url! });
    req.resume();
    req.on('end', () => res.writeHead(stubStatus).end(stubBody));
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
}, 180_000);

afterAll(async () => {
  await new Promise((r) => stub?.close(r));
  await h?.stop();
});

beforeEach(async () => {
  await reset();
  h.mail.length = 0;
  stubSeen.length = 0;
  stubStatus = 200;
  stubBody = '';
});

describe('WD-SET-002 access', () => {
  it('refuses callers with no token, with a workspace token, and writes by a non-super operator', async () => {
    expect((await api().get('/v2/platform/settings/groups')).status).toBe(401);
    expect((await api().get('/v2/platform/settings/groups').set(bearer(tenantToken))).status).toBe(
      401,
    );
    expect((await support('get', '/groups')).status).toBe(200);
    expect((await support('get', '/groups/general')).status).toBe(200);
    const res = await support('patch', '/groups/general').send({
      rowVersion: 0,
      values: { appName: 'X' },
    });
    expect(res.status).toBe(403);
    expect((await support('get', '/export')).status).toBe(403);
    expect((await support('post', '/mail/test').send({ to: 'a@b.test' })).status).toBe(403);
    expect((await group('general')).values.appName).not.toBe('X');
  });

  it('an unknown group is a validation error, not a 500', async () => {
    expect((await ops('get', '/groups/nope')).status).toBe(422);
  });
});

describe('WD-SET-001 / 005 store and general settings', () => {
  it('a never-saved group reads its defaults at rowVersion 0 and takes the app name from .env', async () => {
    const g = await group('general');
    expect(g).toMatchObject({
      rowVersion: 0,
      updatedAt: null,
      values: { appName: 'Test CRM', defaultTimezone: 'UTC' },
    });
    const rows = await h.owner.query(`SELECT 1 FROM platform_settings WHERE key = 'set.general'`);
    expect(rows.rowCount).toBe(0); // reading creates no row
  });

  it('an empty app name and an invalid URL are refused and nothing is persisted', async () => {
    const res = await ops('patch', '/groups/general').send({
      rowVersion: 0,
      values: { appName: '', appUrl: 'nonsense' },
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors.map((e: { path: string }) => e.path).sort()).toEqual([
      'values.appName',
      'values.appUrl',
    ]);
    expect((await group('general')).rowVersion).toBe(0);
  });

  it('saves, bumps the version, and the next read returns the new value', async () => {
    const saved = await save('general', { appName: 'Acme Chat', defaultTimezone: 'Asia/Kolkata' });
    expect(saved.rowVersion).toBe(1);
    expect(saved.values).toMatchObject({ appName: 'Acme Chat', defaultTimezone: 'Asia/Kolkata' });
    expect(saved.updatedAt).not.toBeNull();
    expect((await group('general')).values.appName).toBe('Acme Chat');
    expect((await save('general', { supportEmail: 'help@acme.test' })).rowVersion).toBe(2);
    // The partial patch kept what it did not mention.
    expect((await group('general')).values.appName).toBe('Acme Chat');
  });

  it('a stale rowVersion is a 409 ROW_VERSION_CONFLICT and changes nothing', async () => {
    await save('general', { appName: 'One' });
    const res = await ops('patch', '/groups/general').send({
      rowVersion: 0,
      values: { appName: 'Two' },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ROW_VERSION_CONFLICT');
    expect((await group('general')).values.appName).toBe('One');
  });

  it('two saves racing on the same version: exactly one wins', async () => {
    const results = await Promise.all(
      ['A', 'B', 'C'].map((n) =>
        ops('patch', '/groups/general').send({ rowVersion: 0, values: { appName: `Race ${n}` } }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect((await group('general')).rowVersion).toBe(1);
  });

  it('a patch that changes nothing does not bump the version or write an audit event', async () => {
    await save('general', { appName: 'Same' });
    const before = (await events('platform.settings.general_updated')).length;
    const res = await ops('patch', '/groups/general').send({
      rowVersion: 1,
      values: { appName: 'Same' },
    });
    expect(res.status).toBe(200);
    expect(res.body.rowVersion).toBe(1);
    expect((await events('platform.settings.general_updated')).length).toBe(before);
  });

  it('records one audit event per save with the changed field NAMES and never the values', async () => {
    const before = (await events('platform.settings.general_updated')).length;
    await save('general', { appName: 'Audit Me Inc', supportEmail: 'private@acme.test' });
    const ev = await events('platform.settings.general_updated');
    expect(ev).toHaveLength(before + 1);
    const last = ev.at(-1)!;
    expect(last).toMatchObject({ actor_type: 'platform_operator', status: 'info' });
    expect(last.payload.fields.sort()).toEqual(['appName', 'supportEmail']);
    expect(JSON.stringify(last.payload)).not.toContain('Audit Me Inc');
    expect(JSON.stringify(last.payload)).not.toContain('private@acme.test');
  });

  it('refuses unknown fields and unknown secret names', async () => {
    expect(
      (await ops('patch', '/groups/general').send({ rowVersion: 0, values: { nope: 1 } })).status,
    ).toBe(422);
    expect(
      (await ops('patch', '/groups/general').send({ rowVersion: 0, secrets: { password: 'x' } }))
        .status,
    ).toBe(422);
  });
});

describe('secrets (WD-SET-001 rule 5, 024 rule 2)', () => {
  it('stores ciphertext, never returns the value, keeps it on blank and removes it on null', async () => {
    const plaintext = 'smtp-Pa55word-xyz';
    const saved = await save('mail', { host: 'smtp.acme.test' }, { password: plaintext });
    expect(saved.secrets).toEqual({ password: { isSet: true } });
    expect(JSON.stringify(saved)).not.toContain(plaintext);
    expect(JSON.stringify(await group('mail'))).not.toContain(plaintext);

    const row = await h.owner.query(
      `SELECT value, is_secret FROM platform_settings WHERE key = 'set.mail.password'`,
    );
    expect(row.rows[0].is_secret).toBe(true);
    expect(JSON.stringify(row.rows[0].value)).not.toContain(plaintext);

    // blank keeps
    await save('mail', { port: 2525 }, { password: '' });
    expect((await group('mail')).secrets.password!.isSet).toBe(true);
    // the audit trail names the field but not the value
    const ev = await events('platform.settings.mail_updated');
    expect(JSON.stringify(ev.map((e) => e.payload))).not.toContain(plaintext);
    expect(ev[0]!.payload.fields).toContain('password');
    // null removes
    await save('mail', {}, { password: null });
    expect((await group('mail')).secrets.password!.isSet).toBe(false);
    expect(
      (await h.owner.query(`SELECT 1 FROM platform_settings WHERE key = 'set.mail.password'`))
        .rowCount,
    ).toBe(0);
  });

  it('a secret-only change still bumps the version and is audited', async () => {
    const a = await save('realtime', {}, { appSecret: 's1' });
    expect(a.rowVersion).toBe(1);
    expect((await events('platform.settings.realtime_updated')).at(-1)!.payload.fields).toEqual([
      'appSecret',
    ]);
  });
});

describe('WD-SET-004 export and WD-SET-003 hub', () => {
  it('redacts secrets and account identifiers, keeps ordinary values, and audits the export', async () => {
    await save('general', { appName: 'Acme Chat' });
    await save(
      'mail',
      { host: 'smtp.acme.test', username: 'mailer-user' },
      { password: 'pw-secret-1' },
    );
    await save(
      'storage',
      { accessKeyId: 'AKIAEXPOSED', bucket: 'media' },
      { secret: 'bucket-secret' },
    );
    const res = await ops('get', '/export');
    expect(res.status).toBe(200);
    const out = setExportResponseSchema.parse(res.body);
    expect(out.app).toBe('Acme Chat');
    const text = JSON.stringify(out);
    for (const leak of ['pw-secret-1', 'bucket-secret', 'AKIAEXPOSED', 'mailer-user']) {
      expect(text, leak).not.toContain(leak);
    }
    expect(out.settings.find((s) => s.key === 'set.mail.password')).toMatchObject({
      value: '[REDACTED]',
      secret: true,
    });
    expect(out.settings.find((s) => s.key === 'set.mail')!.value).toMatchObject({
      host: 'smtp.acme.test',
      username: '[REDACTED]',
    });
    expect(out.settings.find((s) => s.key === 'set.storage')!.value).toMatchObject({
      bucket: 'media',
      accessKeyId: '[REDACTED]',
    });
    expect((await events('platform.settings.exported')).at(-1)!.payload.rows).toBe(
      out.settings.length,
    );
  });

  it('on an empty store the hub reads zero saved groups, nothing to test, no last update', async () => {
    const hub = setHubResponseSchema.parse((await ops('get', '/groups')).body);
    expect(hub.kpis).toMatchObject({
      savedGroups: 0,
      totalGroups: 11,
      needsTest: [],
      secretFields: 0,
      lastUpdatedAt: null,
    });
  });

  it('counts saved groups and secret fields, and lists mail under "needs test" until a test succeeds', async () => {
    await save('general', { appName: 'Acme Chat' });
    await save('mail', { host: 'smtp.acme.test' }, { password: 'x' });
    let hub = setHubResponseSchema.parse((await ops('get', '/groups')).body);
    expect(hub.kpis).toMatchObject({ savedGroups: 2, needsTest: ['mail'], secretFields: 1 });
    expect(hub.kpis.lastUpdatedAt).not.toBeNull();

    const t = await ops('post', '/mail/test').send({ to: 'me@acme.test' });
    expect(t.body.ok).toBe(true);
    hub = setHubResponseSchema.parse((await ops('get', '/groups')).body);
    expect(hub.kpis.needsTest).toEqual([]);
  });
});

describe('WD-SET-024 / 025 mail', () => {
  it('the saved settings become the SMTP runtime: decrypted password, sender, encryption mode', async () => {
    const runtime = h.app.get(MailRuntimeService);
    expect(await runtime.resolve()).toBeNull(); // nothing saved: .env rules
    await save(
      'mail',
      {
        host: 'smtp.acme.test',
        port: 465,
        encryption: 'ssl',
        username: 'u',
        fromName: 'Acme',
        fromAddress: 'no-reply@acme.test',
      },
      { password: 'the-password' },
    );
    expect(await runtime.resolve()).toEqual({
      mode: 'smtp',
      host: 'smtp.acme.test',
      port: 465,
      secure: true,
      requireTls: undefined,
      ignoreTls: undefined,
      user: 'u',
      pass: 'the-password',
      fromName: 'Acme',
      fromAddress: 'no-reply@acme.test',
    });
    await save('mail', { mailer: 'log' });
    expect(await runtime.resolve()).toEqual({ mode: 'log' });
    await save('mail', { mailer: 'postmark' });
    expect(await runtime.resolve()).toEqual({ mode: 'unsupported' });
  });

  it('a blank password on a later save leaves the stored one in effect', async () => {
    await save('mail', { host: 'h.test' }, { password: 'keep-me' });
    await save('mail', { host: 'h2.test' }, { password: '' });
    expect((await h.app.get(MailRuntimeService).resolve())!.pass).toBe('keep-me');
  });

  it('sends a test email, records success in the audit trail', async () => {
    await save('general', { appName: 'Acme Chat' });
    const res = await ops('post', '/mail/test').send({ to: 'me@acme.test' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, message: 'Test email sent to me@acme.test.' });
    expect(h.mail).toHaveLength(1);
    expect(h.mail[0]).toMatchObject({ to: 'me@acme.test', subject: 'Mail settings test' });
    expect(h.mail[0]!.text).toContain('Acme Chat');
    const ev = await events('platform.settings.mail_test');
    expect(ev.at(-1)).toMatchObject({ status: 'success' });
  });

  it('reports a transport failure as a reason (no server text) and writes a failure event', async () => {
    const port = h.app.get<{ send: (m: unknown) => Promise<void> }>(MAIL_PORT);
    const spy = vi.spyOn(port, 'send').mockRejectedValueOnce(new MailError('auth_failed', 'x'));
    const res = await ops('post', '/mail/test').send({ to: 'me@acme.test' });
    spy.mockRestore();
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      ok: false,
      message: 'Test email failed: the server refused the username or password.',
    });
    expect((await events('platform.settings.mail_test')).at(-1)).toMatchObject({
      status: 'failure',
    });
    // a failed test does not clear "needs test"
    await save('mail', { host: 'h.test' });
    const hub = setHubResponseSchema.parse((await ops('get', '/groups')).body);
    expect(hub.kpis.needsTest).toEqual(['mail']);
  });

  it('refuses an invalid recipient', async () => {
    expect((await ops('post', '/mail/test').send({ to: 'not-an-email' })).status).toBe(422);
    expect(h.mail).toHaveLength(0);
  });
});

describe('WD-SET-039 storage test', () => {
  it('writes and deletes a probe object against the saved bucket, signed, and records success', async () => {
    await save(
      'storage',
      {
        provider: 'minio',
        endpoint: stubUrl,
        bucket: 'media',
        accessKeyId: 'AKID',
        basePath: 'platform',
        enabled: true,
      },
      { secret: 'bucket-secret' },
    );
    const res = await ops('post', '/storage/test');
    expect(res.body).toEqual({
      ok: true,
      message: 'Connection successful - the bucket is reachable and writable.',
    });
    expect(stubSeen.map((s) => s.method)).toEqual(['PUT', 'DELETE']);
    expect(stubSeen[0]!.url).toMatch(/^\/media\/platform\/connection-tests\//);
    expect((await events('platform.settings.storage_test')).at(-1)).toMatchObject({
      status: 'success',
    });
    const hub = setHubResponseSchema.parse((await ops('get', '/groups')).body);
    expect(hub.kpis.needsTest).toEqual([]);
  });

  it('reports incomplete configuration, and a provider rejection without leaking the secret', async () => {
    expect((await ops('post', '/storage/test')).body).toEqual({
      ok: false,
      message: 'Storage configuration is incomplete - fill in every required field first.',
    });
    await save(
      'storage',
      { provider: 'minio', endpoint: stubUrl, bucket: 'media', accessKeyId: 'AKID' },
      { secret: 'bucket-secret' },
    );
    stubStatus = 403;
    stubBody = '<Error><Code>AccessDenied</Code></Error>';
    const res = await ops('post', '/storage/test');
    expect(res.body).toEqual({ ok: false, message: 'Connection failed: HTTP 403 AccessDenied' });
    expect(JSON.stringify(res.body)).not.toContain('bucket-secret');
    expect((await events('platform.settings.storage_test')).at(-1)).toMatchObject({
      status: 'failure',
    });
  });
});

describe('WD-SET-041 real-time test', () => {
  it('asks for credentials first, then reports Pusher accepting or rejecting the event', async () => {
    const probe = h.app.get(PusherProbe);
    vi.spyOn(probe, 'baseUrl').mockReturnValue(stubUrl);
    expect((await ops('post', '/realtime/test')).body).toEqual({
      ok: false,
      message: 'Fill in App ID, Key and Secret first.',
    });
    await save(
      'realtime',
      { enabled: true, appId: '42', appKey: 'key', cluster: 'eu' },
      { appSecret: 'shh' },
    );
    const ok = await ops('post', '/realtime/test');
    expect(ok.body.ok).toBe(true);
    expect(stubSeen[0]!.method).toBe('POST');
    expect(stubSeen[0]!.url).toContain('/apps/42/events?auth_key=key');
    expect(stubSeen[0]!.url).not.toContain('shh');
    stubStatus = 401;
    stubBody = 'bad signature';
    const bad = await ops('post', '/realtime/test');
    expect(bad.body).toEqual({
      ok: false,
      message: 'Pusher rejected the credentials: HTTP 401 bad signature',
    });
    vi.restoreAllMocks();
  });
});

describe('public projection (WD-SET-011, 023, 027, 030, 033, 034, 036, 028)', () => {
  it('needs no token, carries the saved brand and no secrets', async () => {
    await save('general', { appName: 'Acme Chat', platformFooter: 'Sent via Acme' });
    await save('mail', { host: 'smtp.private.test' }, { password: 'topsecret-pw' });
    await save('analytics', { googleGa4: 'G-ABC123' });
    await save('customCode', { enabled: false, js: 'steal()' });
    const res = await api().get('/v2/public/site-config');
    expect(res.status).toBe(200);
    const cfg = publicSiteConfigSchema.parse(res.body);
    expect(cfg.brand).toMatchObject({ name: 'Acme Chat', platformFooter: 'Sent via Acme' });
    expect(cfg.analytics).toEqual({
      googleGa4: 'G-ABC123',
      posthogHost: 'https://app.posthog.com',
    });
    expect(cfg.customCode).toEqual({ css: '', js: '' });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('topsecret-pw');
    expect(text).not.toContain('smtp.private.test');
  });

  it('changing the brand colour is reflected in the theme CSS on the next request', async () => {
    expect((await api().get('/v2/public/site-config')).body.themeCss).toBe('');
    await save('branding', { colors: { 'wa-deep': '#7C3AED' } });
    expect((await api().get('/v2/public/site-config')).body.themeCss).toContain(
      '--color-wa-deep:#7C3AED',
    );
  });

  it('manifest is 404 until the PWA switch is on, then names the app', async () => {
    expect((await api().get('/v2/public/manifest.webmanifest')).status).toBe(404);
    await save('general', { appName: 'Acme Chat' });
    await save('pwa', { enabled: true, shortName: 'Acme' });
    const res = await api().get('/v2/public/manifest.webmanifest');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/manifest+json');
    expect(res.body).toMatchObject({
      name: 'Acme Chat',
      short_name: 'Acme',
      display: 'standalone',
      start_url: '/',
    });
  });

  it('robots.txt follows the SEO robots directive', async () => {
    expect((await api().get('/v2/public/robots.txt')).text).toBe('User-agent: *\nAllow: /\n');
    await save('seo', { robots: 'noindex, nofollow' });
    expect((await api().get('/v2/public/robots.txt')).text).toBe('User-agent: *\nDisallow: /\n');
  });
});

describe('WD-SET-008 maintenance mode', () => {
  const tenantGet = () => api().get('/v2/plans').set(bearer(tenantToken));

  it('off: the workspace API works; on: it answers 503 with Retry-After and a stable code', async () => {
    expect((await tenantGet()).status).toBe(200);
    await save('general', { maintenanceMode: true });
    const res = await tenantGet();
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('3600');
    expect(res.body.code).toBe('SET_MAINTENANCE');
    // an anonymous caller is turned away by sign-in before maintenance matters
    expect((await api().get('/v2/contacts')).status).toBe(401);
  });

  it('keeps the operator console, sign-in, the public projection and the public API reachable', async () => {
    await save('general', { maintenanceMode: true });
    expect((await ops('get', '/groups')).status).toBe(200);
    const login = await api()
      .post('/v2/auth/login')
      .send({ email: 'x@y.test', password: 'whatever' });
    expect(login.status).not.toBe(503);
    expect((await api().get('/v2/public/site-config')).status).toBe(200);
    expect((await api().get('/health')).status).not.toBe(503);
    expect((await api().get('/public/v1/leads')).status).not.toBe(503);
  });

  it('an operator bypasses it on workspace routes (like a platform admin impersonating)', async () => {
    await save('general', { maintenanceMode: true });
    const res = await api().get('/v2/plans').set(bearer(superToken));
    expect(res.status).not.toBe(503);
  });

  it('switching it off restores service on the next request', async () => {
    await save('general', { maintenanceMode: true });
    expect((await tenantGet()).status).toBe(503);
    await save('general', { maintenanceMode: false });
    expect((await tenantGet()).status).toBe(200);
  });
});
