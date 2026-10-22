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
export const hostOverride = (env, name, def) => (env.CHAT_ALLOW_ANY_HOST === '1' && env[name]) || def;

export function loadServiceAccount(env = process.env) {
  const raw = env.CHAT_APP_SA_JSON ?? (() => { try { return fs.readFileSync(env.CHAT_APP_SA_FILE ?? '/run/secrets/chat_app_sa_json', 'utf8'); } catch { return ''; } })();
  if (!raw.trim()) return null;
  try { const k = JSON.parse(raw); return k.client_email && k.private_key ? k : null; } catch { return null; }
}

export function createAppAuth({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  let cached = null;
  return async function getToken() {
    if (cached && cached.exp - 60_000 > now()) return cached.token;
    const key = loadServiceAccount(env);
    if (!key) throw new Error('chat app service account key missing');
    const url = hostOverride(env, 'CHAT_APP_TOKEN_URL', key.token_uri === GOOGLE_TOKEN_URL || !key.token_uri ? GOOGLE_TOKEN_URL : GOOGLE_TOKEN_URL);
    const iat = Math.floor(now() / 1000);
    const assertion = signJwt({ iss: key.client_email, scope: CHAT_SCOPE, aud: url, iat, exp: iat + 3600 }, key.private_key, { alg: 'RS256', typ: 'JWT', ...(key.private_key_id ? { kid: key.private_key_id } : {}) });
    const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }), signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`token endpoint ${r.status}`);
    const j = await r.json();
    if (!j.access_token) throw new Error('token endpoint: no access_token');
    cached = { token: j.access_token, exp: now() + Number(j.expires_in ?? 3600) * 1000 };
    return cached.token;
  };
}

const CERTS_URL = 'https://www.googleapis.com/service_accounts/v1/metadata/x509/chat@system.gserviceaccount.com';
export const CHAT_ISSUER = 'chat@system.gserviceaccount.com';
// Verifies the "project number" mode token (self-signed by chat@system.gserviceaccount.com). Returns claims or throws.
export function createTokenVerifier({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  let certs = null, at = 0;
  const load = async (force) => {
    if (!force && certs && now() - at < 3600e3) return certs;
    const r = await fetchImpl(hostOverride(env, 'CHAT_APP_CERTS_URL', CERTS_URL), { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error('certs fetch failed');
    certs = await r.json(); at = now(); return certs;
  };
  return async function verify(token) {
    const audience = env.CHAT_APP_AUDIENCE;
    if (!audience) throw new Error('CHAT_APP_AUDIENCE not set');
    const parts = typeof token === 'string' ? token.split('.') : [];
    if (parts.length !== 3) throw new Error('malformed');
    let header, claims; try { header = JSON.parse(Buffer.from(parts[0], 'base64url')); claims = JSON.parse(Buffer.from(parts[1], 'base64url')); } catch { throw new Error('malformed'); }
    if (header.alg !== 'RS256') throw new Error('alg');
    let pem = (await load(false))[header.kid]; if (!pem) pem = (await load(true))[header.kid]; // key rotation: one forced refetch
    if (!pem) throw new Error('unknown kid');
    if (!createVerify('RSA-SHA256').update(`${parts[0]}.${parts[1]}`).verify(createPublicKey(pem), parts[2], 'base64url')) throw new Error('signature');
    if (claims.iss !== CHAT_ISSUER) throw new Error('iss');
    if (claims.aud !== audience) throw new Error('aud');
    if (!(typeof claims.exp === 'number' && claims.exp * 1000 > now() - 30_000)) throw new Error('exp');
    return claims;
  };
}
