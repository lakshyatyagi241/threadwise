import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './harness';

/**
 * Work-email only, no disposable mail, mandatory mobile verification. The harness switches these off for
 * the other suites; this one switches them on through the settings row.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const PASSWORD = 'Str0ngPassw0rd#1';
let seq = 0;
const ip = () => `10.77.${Math.floor(seq / 250)}.${seq++ % 250}`;

async function setRegistration(patch: Record<string, unknown>) {
  // Settings are read through a 5-second snapshot; drop it so the next request sees the row below.
  const { PlatformSettingsService } =
    await import('../../../src/modules/auth/platform/platform-settings.service');
  await h.owner.query(
    `INSERT INTO platform_settings (key, value, is_secret) VALUES ('registration', $1::jsonb, false)
     ON CONFLICT (key) DO UPDATE SET value = platform_settings.value || $1::jsonb`,
    [JSON.stringify(patch)],
  );
  h.app.get(PlatformSettingsService).invalidate();
}
const signup = (email: string, extra: Record<string, unknown> = {}) =>
  api()
    .post('/v2/auth/signup')
    .set('x-forwarded-for', ip())
    .send({
      orgName: 'Policy Co',
      fullName: 'Pol Icy',
      email,
      password: PASSWORD,
      acceptTerms: true,
      phone: '+919876543299',
      ...extra,
    });

beforeAll(async () => {
  h = await startHarness();
}, 180_000);
afterAll(async () => {
  await h?.stop();
});

describe('sign-up email policy', () => {
  it('refuses free providers when work email is required', async () => {
    await setRegistration({ businessEmailOnly: true });
    const res = await signup('someone@gmail.com');
    expect(res.status).toBe(422);
    expect(res.body.errors[0]).toMatchObject({ path: 'email' });
    expect(res.body.detail).toMatch(/work email/i);
  });

  it('refuses disposable domains', async () => {
    await setRegistration({ businessEmailOnly: false, blockDisposableEmail: true });
    const res = await signup('x@mailinator.com');
    expect(res.status).toBe(422);
    expect(res.body.detail).toMatch(/disposable/i);
  });

  it('refuses operator-blocked domains', async () => {
    await setRegistration({ blockDisposableEmail: false, blockedEmailDomains: ['rival.test'] });
    const res = await signup('x@mail.rival.test');
    expect(res.status).toBe(422);
    expect(res.body.errors[0]).toMatchObject({ path: 'email' });
  });
});

describe('mandatory mobile verification', () => {
  it('fails closed when the code step cannot run', async () => {
    await setRegistration({
      businessEmailOnly: false,
      blockDisposableEmail: false,
      blockedEmailDomains: [],
      requirePhoneVerification: true,
    });
    const res = await signup('owner@acme-corp.test');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('AUTH_OTP_SEND_FAILED');
    const created = await h.owner.query(`SELECT 1 FROM users WHERE email = 'owner@acme-corp.test'`);
    expect(created.rowCount).toBe(0);
  });
});
