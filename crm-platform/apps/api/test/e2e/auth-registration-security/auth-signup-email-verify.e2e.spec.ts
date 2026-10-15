import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MAIL_PORT,
  type MailPort,
} from '../../../src/infra/providers/auth-registration-security/mail.port';
import { startHarness, type Harness } from './harness';

/**
 * TW-AUTH-005-prep: the collect step of the three-step sign-up (collect -> verify email code ->
 * set password). Only `start()` exists so far (Task 5); the route itself lands in Task 8, so the
 * first two specs below stay RED (404) until then. The third spec exercises the existing, already
 * working `/v2/auth/signup` endpoint to prove the abandoned stage left no row behind.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
let n = 0;
const uniqueEmail = (tag = 'u') => `${tag}${Date.now()}${n++}@example.test`;

async function startAndReadCode(fullName: string, email: string) {
  const res = await api().post('/v2/auth/signup/start').send({ fullName, email });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const msg = h.mail.find((m) => m.to === email);
  if (!msg) throw new Error(`no mail sent to ${email}`);
  const match = msg.text.match(/\b(\d{6})\b/);
  if (!match) throw new Error(`no 6-digit code found in mail to ${email}: ${msg.text}`);
  return { token: res.body.token as string, code: match[1]! };
}

beforeAll(async () => {
  h = await startHarness();
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('POST /v2/auth/signup/start', () => {
  it('stages the signup and returns a masked email', async () => {
    const res = await api()
      .post('/v2/auth/signup/start')
      .send({ fullName: 'Ada Lovelace', email: uniqueEmail('ada') });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.maskedEmail).toMatch(/.+@.+/);
    expect(res.body.codeLength).toBe(6);
  });

  it('rejects when the email already has an account', async () => {
    const email = uniqueEmail('dup');
    // Seed a real existing account via the EXISTING, already-working /v2/auth/signup endpoint
    // (not the new one this task adds) — this creates a real org+user row, simulating "someone
    // already signed up" without depending on the new verify/set-password endpoints Tasks 6-7
    // haven't landed yet.
    const seed = await api().post('/v2/auth/signup').send({
      orgName: 'Existing Org',
      fullName: 'Existing User',
      email,
      password: 'Str0ngPassw0rd#1',
      acceptTerms: true,
    });
    expect(seed.status, JSON.stringify(seed.body)).toBe(201);

    const res = await api().post('/v2/auth/signup/start').send({ fullName: 'Dup User', email });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('AUTH_IDENTITY_EXISTS');
  });

  it('leaves no org or user row behind when the stage is abandoned before verification', async () => {
    const email = uniqueEmail('abandoned');
    await api().post('/v2/auth/signup/start').send({ fullName: 'Abandoned User', email });
    // Don't verify, don't set a password — confirm via the existing /v2/auth/signup endpoint's
    // own duplicate behavior: re-signing up fully with this exact email should succeed (201),
    // proving no row was created by the abandoned /start call alone.
    const res = await api().post('/v2/auth/signup').send({
      orgName: 'Fresh Org',
      fullName: 'Abandoned User',
      email,
      password: 'Str0ngPassw0rd#1',
      acceptTerms: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });
});

describe('POST /v2/auth/signup/verify-email-code', () => {
  it('marks the stage verified on a correct code', async () => {
    const { token, code } = await startAndReadCode('Ada', uniqueEmail('v'));
    const res = await api().post('/v2/auth/signup/verify-email-code').send({ token, code });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.token).toBe(token);
  });

  it('rejects a wrong code', async () => {
    const { token } = await startAndReadCode('Ada', uniqueEmail('w'));
    const res = await api()
      .post('/v2/auth/signup/verify-email-code')
      .send({ token, code: '000000' });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.code).toBe('AUTH_OTP_INVALID');
  });
});

describe('POST /v2/auth/signup/resend-email-code', () => {
  it('rejects a second resend inside the cooldown', async () => {
    const { token } = await startAndReadCode('Ada', uniqueEmail('r'));
    const first = await api().post('/v2/auth/signup/resend-email-code').send({ token });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const second = await api().post('/v2/auth/signup/resend-email-code').send({ token });
    expect(second.status, JSON.stringify(second.body)).toBe(429);
    expect(second.body.code).toBe('AUTH_OTP_RESEND_COOLDOWN');
  });

  it('leaves the old code still verifiable when the resend mail fails to send', async () => {
    const { token, code } = await startAndReadCode('Ada', uniqueEmail('resend-fail'));
    const port = h.app.get<MailPort>(MAIL_PORT);
    const realSend = port.send.bind(port);
    port.send = async () => {
      throw new Error('simulated mail outage');
    };
    try {
      const res = await api().post('/v2/auth/signup/resend-email-code').send({ token });
      expect(res.status, JSON.stringify(res.body)).toBe(502);
      expect(res.body.code).toBe('AUTH_OTP_SEND_FAILED');
    } finally {
      port.send = realSend;
    }
    // The old code must still be the one that works: the failed resend must not have
    // overwritten the stage's hash, attempts or cooldown timer.
    const verify = await api().post('/v2/auth/signup/verify-email-code').send({ token, code });
    expect(verify.status, JSON.stringify(verify.body)).toBe(200);
  });
});

describe('POST /v2/auth/signup/set-password', () => {
  async function startAndVerify(fullName: string, email: string) {
    const { token, code } = await startAndReadCode(fullName, email);
    const res = await api().post('/v2/auth/signup/verify-email-code').send({ token, code });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return token;
  }

  it('creates the account once verified, with an auto-generated workspace name', async () => {
    const token = await startAndVerify('Ada Lovelace', uniqueEmail('sp'));
    const res = await api()
      .post('/v2/auth/signup/set-password')
      .send({ token, password: 'Str0ngPassw0rd#1', acceptTerms: true });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('authenticated');
    expect(res.body.orgSlug).toMatch(/^ada-s-workspace/);
  });

  it('rejects when the email was never verified', async () => {
    const { token } = await startAndReadCode('Ada', uniqueEmail('nv'));
    const res = await api()
      .post('/v2/auth/signup/set-password')
      .send({ token, password: 'Str0ngPassw0rd#1', acceptTerms: true });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.code).toBe('AUTH_EMAIL_NOT_VERIFIED');
  });

  it('is single-use: a second set-password with the same token is refused', async () => {
    const token = await startAndVerify('Ada', uniqueEmail('once'));
    const first = await api()
      .post('/v2/auth/signup/set-password')
      .send({ token, password: 'Str0ngPassw0rd#1', acceptTerms: true });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const second = await api()
      .post('/v2/auth/signup/set-password')
      .send({ token, password: 'Str0ngPassw0rd#1', acceptTerms: true });
    expect(second.status, JSON.stringify(second.body)).toBe(400);
    expect(second.body.code).toBe('AUTH_SIGNUP_EXPIRED');
  });
});
