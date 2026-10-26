import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { signJwt, createTokenVerifier, CHAT_ISSUER } from './chat-app-auth.mjs';

const kp = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const other = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const { createPublicKey } = await import('node:crypto');
const jwk = { ...createPublicKey(kp.publicKey).export({ format: 'jwk' }), kid: 'o1', alg: 'RS256', use: 'sig' };
const URL_ = 'https://prometheus-desk.wabo.ai/chat-app/events';
const env = { CHAT_ALLOW_ANY_HOST: '1', CHAT_APP_AUDIENCE: '1234567890', CHAT_APP_ENDPOINT_URL: URL_, CHAT_APP_CERTS_URL: 'http://fake/x509', CHAT_APP_JWKS_URL: 'http://fake/jwks' };
const fetchImpl = async (u) => ({ ok: true, json: async () => (String(u).endsWith('/jwks') ? { keys: [jwk] } : { g1: kp.publicKey }) });
const tok = (c, key = kp.privateKey, kid = 'o1') => signJwt({ exp: Math.floor(Date.now() / 1000) + 300, ...c }, key, { alg: 'RS256', kid });
const oidc = (o = {}) => ({ iss: 'https://accounts.google.com', aud: URL_, email: CHAT_ISSUER, email_verified: true, ...o });

test('OIDC ID token (HTTP endpoint URL kind) from Google Chat is accepted', async () => {
  const v = createTokenVerifier({ env, fetchImpl });
  assert.equal((await v(tok(oidc()))).email, CHAT_ISSUER);
  assert.equal((await v(tok(oidc({ iss: 'accounts.google.com' })))).email, CHAT_ISSUER);
});
test('OIDC token: wrong audience, wrong email, unverified email, bad signature, expired, unknown kid are all refused', async () => {
  const v = createTokenVerifier({ env, fetchImpl });
  for (const [c, key, kid] of [[oidc({ aud: 'https://evil.example/' })], [oidc({ email: 'someone@gmail.com' })], [oidc({ email_verified: false })], [oidc(), other.privateKey], [oidc({ exp: 1 })], [oidc(), kp.privateKey, 'nope']])
    await assert.rejects(() => v(tok(c, key, kid)));
});
test('OIDC kind is off while CHAT_APP_ENDPOINT_URL is unset; the project-number kind still works', async () => {
  const noUrl = createTokenVerifier({ env: { ...env, CHAT_APP_ENDPOINT_URL: undefined }, fetchImpl });
  await assert.rejects(() => noUrl(tok(oidc())));
  const v = createTokenVerifier({ env, fetchImpl });
  assert.equal((await v(tok({ iss: CHAT_ISSUER, aud: '1234567890' }, kp.privateKey, 'g1'))).iss, CHAT_ISSUER);
  await assert.rejects(() => v(tok({ iss: CHAT_ISSUER, aud: 'other' }, kp.privateKey, 'g1')));
  await assert.rejects(() => v(tok({ iss: 'https://evil.example', aud: URL_ })));
});
