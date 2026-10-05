import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../auth-registration-security/harness';

/**
 * The request throttle inside the real application (WD-INFRA-010): the guard is registered, sits after authentication, is
 * a no-op until a limit is set, and never touches the probes. A default of 3 a minute makes every undecorated route limited.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const from = (n: number) => `10.77.${n}.1`;

beforeAll(async () => {
  process.env.INFRA_RATE_LIMIT_DEFAULT_PER_MINUTE = '3';
  h = await startHarness();
}, 180_000);

afterAll(async () => {
  delete process.env.INFRA_RATE_LIMIT_DEFAULT_PER_MINUTE;
  await h?.stop();
});

const login = (ip: string) =>
  api()
    .post('/v2/auth/login')
    .set('x-forwarded-for', ip)
    .send({ email: 'nobody@example.test', password: 'Str0ngPassw0rd#1' });

describe('request throttle in the application', () => {
  it('answers 429 problem+json once a caller passes the environment default', async () => {
    const ip = from(1);
    for (let i = 0; i < 3; i++) {
      const res = await login(ip);
      expect(res.status, JSON.stringify(res.body)).not.toBe(429);
      expect(res.headers['x-ratelimit-limit']).toBe('3');
    }
    const refused = await login(ip);
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(refused.headers['content-type']).toContain('application/problem+json');
    expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  });

  it('counts another address on its own', async () => {
    expect((await login(from(2))).status).not.toBe(429);
  });

  it('never limits the liveness and readiness probes', async () => {
    for (let i = 0; i < 8; i++) {
      await api().get('/health').set('x-forwarded-for', from(3)).expect(200);
    }
    const ready = await api().get('/ready').set('x-forwarded-for', from(3));
    expect(ready.status).toBe(200);
    expect(ready.headers['x-ratelimit-limit']).toBeUndefined();
  });
});
