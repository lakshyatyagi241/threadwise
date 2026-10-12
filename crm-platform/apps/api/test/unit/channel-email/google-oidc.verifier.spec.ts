import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GoogleOidcVerifier } from '../../../src/infra/providers/channel-email';
import { AUDIENCE, FakeJwks, newKey, SERVICE_ACCOUNT, signToken } from './google-push-token';

/** TW-MAIL-033: the push endpoint's credential. A locally generated RSA key stands in for Google's; nothing here reaches Google. */
const key = newKey('k1');
const other = newKey('k1'); // same kid, different key: a forged token
const expect_ = { audience: AUDIENCE, email: SERVICE_ACCOUNT };
let jwks: FakeJwks;
let v: GoogleOidcVerifier;
const saved = process.env.GOOGLE_OIDC_JWKS_URL;

beforeAll(async () => {
  jwks = await FakeJwks.start([key]);
  process.env.GOOGLE_OIDC_JWKS_URL = jwks.url;
});
afterAll(async () => {
  if (saved === undefined) delete process.env.GOOGLE_OIDC_JWKS_URL;
  else process.env.GOOGLE_OIDC_JWKS_URL = saved;
  await jwks.stop();
});
beforeEach(() => {
  v = new GoogleOidcVerifier();
  jwks.keys = [key];
  jwks.hits = 0;
  jwks.maxAge = 3600;
});

const reason = async (token: string, e = expect_, now?: number) => {
  const r = await v.verify(token, e, now);
  return r.ok ? 'ok' : r.reason;
};
const b64u = (s: string) => Buffer.from(s).toString('base64url');

describe('GoogleOidcVerifier', () => {
  it('accepts a valid token and returns its claims', async () => {
    const r = await v.verify(signToken(key), expect_);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.claims.email).toBe(SERVICE_ACCOUNT);
  });

  it('accepts the bare accounts.google.com issuer and a different case of the email', async () => {
    expect(await reason(signToken(key, { iss: 'accounts.google.com' }))).toBe('ok');
    expect(await reason(signToken(key, { email: SERVICE_ACCOUNT.toUpperCase() }))).toBe('ok');
  });

  it('refuses a wrong audience', async () => {
    expect(await reason(signToken(key, { aud: 'https://evil.example/push' }))).toBe('audience');
    expect(await reason(signToken(key, { aud: [AUDIENCE] }))).toBe('audience');
    expect(await reason(signToken(key), { audience: '', email: SERVICE_ACCOUNT })).toBe('audience');
  });

  it('refuses an expired token (beyond the skew) and accepts one inside it', async () => {
    const now = Math.floor(Date.now() / 1000);
    expect(await reason(signToken(key, { exp: now - 600 }))).toBe('expired');
    expect(await reason(signToken(key, { exp: now - 20 }))).toBe('ok');
    expect(await reason(signToken(key, { exp: undefined }))).toBe('expired');
  });

  it('refuses a token that is not valid yet', async () => {
    const now = Math.floor(Date.now() / 1000);
    expect(await reason(signToken(key, { nbf: now + 3600 }))).toBe('not_yet_valid');
  });

  it('refuses another service account, an unverified email and a missing email', async () => {
    expect(await reason(signToken(key, { email: 'someone@else.iam.gserviceaccount.com' }))).toBe(
      'email',
    );
    expect(await reason(signToken(key, { email: undefined }))).toBe('email');
    expect(await reason(signToken(key, { email_verified: false }))).toBe('email_unverified');
    expect(await reason(signToken(key, { email_verified: undefined }))).toBe('email_unverified');
    expect(await reason(signToken(key), { audience: AUDIENCE, email: '' })).toBe('email');
  });

  it('refuses another issuer', async () => {
    expect(await reason(signToken(key, { iss: 'https://evil.example' }))).toBe('issuer');
  });

  it('refuses a bad signature (a forged token under a known kid)', async () => {
    expect(await reason(signToken(other))).toBe('signature');
    const good = signToken(key);
    const [h, , s] = good.split('.');
    const swapped = `${h}.${b64u(JSON.stringify({ iss: 'accounts.google.com', aud: AUDIENCE, email: SERVICE_ACCOUNT, email_verified: true, exp: 9999999999 }))}.${s}`;
    expect(await reason(swapped)).toBe('signature');
  });

  it('refuses alg none, an HMAC token and any non-RS256 header', async () => {
    const claims = b64u(
      JSON.stringify({
        iss: 'https://accounts.google.com',
        aud: AUDIENCE,
        email: SERVICE_ACCOUNT,
        email_verified: true,
        exp: 9999999999,
      }),
    );
    const none = `${b64u(JSON.stringify({ alg: 'none', kid: 'k1' }))}.${claims}.`;
    expect(await reason(none)).toBe('malformed');
    expect(await reason(`${b64u(JSON.stringify({ alg: 'none', kid: 'k1' }))}.${claims}.AAAA`)).toBe(
      'alg',
    );
    const hdr = b64u(JSON.stringify({ alg: 'HS256', kid: 'k1' }));
    const mac = createHmac('sha256', JSON.stringify(key.jwk))
      .update(`${hdr}.${claims}`)
      .digest('base64url');
    expect(await reason(`${hdr}.${claims}.${mac}`)).toBe('alg');
    expect(await reason(signToken(key, {}, { alg: 'RS512' }))).toBe('alg');
  });

  it('refuses malformed input', async () => {
    for (const t of ['', 'abc', 'a.b', 'a.b.c.d', '!!.!!.!!', 'e30.e30.AAAA', 'x'.repeat(9000)]) {
      expect(['malformed', 'alg', 'unknown_key']).toContain(await reason(t));
    }
  });

  it('refuses a token with no kid or an unknown kid', async () => {
    expect(await reason(signToken(key, {}, { kid: undefined }))).toBe('unknown_key');
    expect(await reason(signToken({ ...key, kid: 'nope' }))).toBe('unknown_key');
  });

  it('caches the key set, and re-reads it (at most every 30 seconds) when a new kid appears: a rotation', async () => {
    const t0 = Date.now();
    expect(await reason(signToken(key), expect_, t0)).toBe('ok');
    expect(await reason(signToken(key), expect_, t0 + 1000)).toBe('ok');
    expect(jwks.hits).toBe(1);
    const rotated = newKey('k2');
    jwks.keys = [rotated];
    // Too soon after the last read: not fetched again, the new key is unknown.
    expect(await reason(signToken(rotated), expect_, t0 + 5000)).toBe('unknown_key');
    expect(jwks.hits).toBe(1);
    expect(await reason(signToken(rotated), expect_, t0 + 40_000)).toBe('ok');
    expect(jwks.hits).toBe(2);
  });

  it('re-reads the key set once max-age has passed', async () => {
    jwks.maxAge = 100;
    const t0 = Date.now();
    await v.verify(signToken(key), expect_, t0);
    await v.verify(signToken(key), expect_, t0 + 50_000);
    expect(jwks.hits).toBe(1);
    await v.verify(signToken(key), expect_, t0 + 101_000);
    expect(jwks.hits).toBe(2);
  });

  it('fails closed when Google keys cannot be read', async () => {
    const saved2 = process.env.GOOGLE_OIDC_JWKS_URL;
    process.env.GOOGLE_OIDC_JWKS_URL = 'http://127.0.0.1:1/certs';
    try {
      expect(await reason(signToken(key))).toBe('jwks_unavailable');
    } finally {
      process.env.GOOGLE_OIDC_JWKS_URL = saved2;
    }
  });
});
