// Google Chat app auth with node:crypto only. (1) service-account access token via the JWT bearer grant (scope chat.bot), cached until
// near expiry; (2) strict verification of the RS256 bearer token Google sends with every event. Never logs keys or tokens.
import fs from 'node:fs';
import { createSign, createVerify, createPublicKey } from 'node:crypto';

const b64u = (b) => Buffer.from(b).toString('base64url');
export const signJwt = (claims, pem, header = { alg: 'RS256', typ: 'JWT' }) => {
  const data = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`;
  return `${data}.${createSign('RSA-SHA256').update(data).sign(pem, 'base64url')}`;
};
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const CHAT_SCOPE = 'https://www.googleapis.com/auth/chat.bot';
// Test hooks (token/certs/API URLs) are honoured only with CHAT_ALLOW_ANY_HOST=1, so a typo in prod can never send a key assertion elsewhere.
export const hostOverride = (env, name, def) =>
  (env.CHAT_ALLOW_ANY_HOST === '1' && env[name]) || def;

export function loadServiceAccount(env = process.env) {
  const raw =
    env.CHAT_APP_SA_JSON ??
    (() => {
      try {
        return fs.readFileSync(env.CHAT_APP_SA_FILE ?? '/run/secrets/chat_app_sa_json', 'utf8');
      } catch {
        return '';
      }
    })();
  if (!raw.trim()) return null;
  try {
    const k = JSON.parse(raw);
    return k.client_email && k.private_key ? k : null;
  } catch {
    return null;
  }
}

export function createAppAuth({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  let cached = null;
  return async function getToken() {
    if (cached && cached.exp - 60_000 > now()) return cached.token;
    const key = loadServiceAccount(env);
    if (!key) throw new Error('chat app service account key missing');
    const url = hostOverride(env, 'CHAT_APP_TOKEN_URL', GOOGLE_TOKEN_URL);
    const iat = Math.floor(now() / 1000);
    const assertion = signJwt(
      { iss: key.client_email, scope: CHAT_SCOPE, aud: url, iat, exp: iat + 3600 },
      key.private_key,
      { alg: 'RS256', typ: 'JWT', ...(key.private_key_id ? { kid: key.private_key_id } : {}) },
    );
    const r = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`token endpoint ${r.status}`);
    const j = await r.json();
    if (!j.access_token) throw new Error('token endpoint: no access_token');
    cached = { token: j.access_token, exp: now() + Number(j.expires_in ?? 3600) * 1000 };
    return cached.token;
  };
}

const CERTS_URL =
  'https://www.googleapis.com/service_accounts/v1/metadata/x509/chat@system.gserviceaccount.com';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
export const CHAT_ISSUER = 'chat@system.gserviceaccount.com';
const OIDC_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
// Verifies what Google Chat sends to the events endpoint. Two kinds exist, chosen in the Chat API console:
//  - "Project Number": a JWT self-signed by chat@system.gserviceaccount.com (iss), audience = the project number (CHAT_APP_AUDIENCE);
//  - "HTTP endpoint URL": a Google OIDC ID token (iss accounts.google.com), audience = the endpoint URL (CHAT_APP_ENDPOINT_URL), with
//    email = chat@system.gserviceaccount.com. Disabled while CHAT_APP_ENDPOINT_URL is unset.
// Returns claims or throws.
export function createTokenVerifier({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const cache = { x509: { v: null, at: 0 }, jwks: { v: null, at: 0 } };
  const load = async (kind, force) => {
    const c = cache[kind];
    if (!force && c.v && now() - c.at < 3600e3) return c.v;
    const r = await fetchImpl(hostOverride(env, kind === 'x509' ? 'CHAT_APP_CERTS_URL' : 'CHAT_APP_JWKS_URL', kind === 'x509' ? CERTS_URL : JWKS_URL), {
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error('certs fetch failed');
    c.v = await r.json();
    c.at = now();
    return c.v;
  };
  const publicKey = async (kind, kid) => {
    const find = (set) => (kind === 'x509' ? set[kid] : (set.keys ?? []).find((k) => k.kid === kid));
    let k = find(await load(kind, false));
    if (!k) k = find(await load(kind, true)); // key rotation: one forced refetch
    if (!k) throw new Error('unknown kid');
    return createPublicKey(kind === 'x509' ? k : { key: k, format: 'jwk' });
  };
  return async function verify(token) {
    const parts = typeof token === 'string' ? token.split('.') : [];
    if (parts.length !== 3) throw new Error('malformed');
    let header, claims;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    } catch {
      throw new Error('malformed');
    }
    if (header.alg !== 'RS256') throw new Error('alg');
    const oidc = OIDC_ISSUERS.includes(claims.iss);
    if (!oidc && claims.iss !== CHAT_ISSUER) throw new Error('iss');
    const audience = oidc ? env.CHAT_APP_ENDPOINT_URL : env.CHAT_APP_AUDIENCE;
    if (!audience) throw new Error(oidc ? 'CHAT_APP_ENDPOINT_URL not set' : 'CHAT_APP_AUDIENCE not set');
    const key = await publicKey(oidc ? 'jwks' : 'x509', header.kid);
    if (!createVerify('RSA-SHA256').update(`${parts[0]}.${parts[1]}`).verify(key, parts[2], 'base64url')) throw new Error('signature');
    if (claims.aud !== audience) throw new Error('aud');
    if (oidc && (claims.email !== CHAT_ISSUER || claims.email_verified === false)) throw new Error('email'); // only Google Chat itself, not any Google account
    if (!(typeof claims.exp === 'number' && claims.exp * 1000 > now() - 30_000)) throw new Error('exp');
    return claims;
  };
}
