import request from 'supertest';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import type { Harness } from './harness';

export const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

/** Signs a platform operator in and, when the account has no second factor yet, enrols one. Returns an access token. */
export async function operatorToken(h: Harness, email: string, password: string): Promise<string> {
  const api = () => request(h.app.getHttpServer());
  const first = await api().post('/v2/platform/auth/login').send({ email, password });
  const token = first.body.tokens?.accessToken as string;
  if (!token) throw new Error(`operator login failed: ${JSON.stringify(first.body)}`);
  if (first.body.mfaEnrolmentRequired) {
    const setup = await api().post('/v2/platform/auth/mfa/setup').set(bearer(token));
    const enabled = await api()
      .post('/v2/platform/auth/mfa/enable')
      .set(bearer(token))
      .send({ code: hotp(base32Decode(setup.body.secret), totpStep(Date.now())) });
    if (enabled.status !== 201)
      throw new Error(`mfa enrolment failed: ${JSON.stringify(enabled.body)}`);
  }
  return token;
}

/** The connection the harness gave the API, so a test can aim the "test connection" call at it. */
export function apiDatabase(): { host: string; port: number; database: string; username: string } {
  const u = new URL(process.env.DATABASE_URL as string);
  return {
    host: u.hostname,
    port: Number(u.port),
    database: u.pathname.slice(1),
    username: decodeURIComponent(u.username),
  };
}
