import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
    const seed = await api()
      .post('/v2/auth/signup')
      .send({
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
    const res = await api()
      .post('/v2/auth/signup')
      .send({
        orgName: 'Fresh Org',
        fullName: 'Abandoned User',
        email,
        password: 'Str0ngPassw0rd#1',
        acceptTerms: true,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });
});
