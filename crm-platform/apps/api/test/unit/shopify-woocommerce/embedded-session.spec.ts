import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyShopifySessionToken } from '../../../src/modules/shopify-woocommerce/embedded-session';

/** Shopify App Bridge session tokens (TW-ECOM-038): every accept and refuse case, with tokens signed here (no real Shopify). */
const CLIENT_ID = 'client-id-1';
const SECRET = 'client-secret-1';
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const sec = NOW / 1000;
const SHOP = 'acme-store.myshopify.com';

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

function claimsFor(over: Record<string, unknown> = {}) {
  return {
    iss: `https://${SHOP}/admin`,
    dest: `https://${SHOP}`,
    aud: CLIENT_ID,
    sub: '42',
    exp: sec + 60,
    nbf: sec - 5,
    iat: sec - 5,
    jti: 'abc',
    sid: 'sid',
    ...over,
  };
}

function token(
  over: Record<string, unknown> = {},
  o: { secret?: string; header?: unknown; raw?: string } = {},
): string {
  const head = b64(o.header ?? { alg: 'HS256', typ: 'JWT' });
  const body = o.raw ?? b64(claimsFor(over));
  const sig = createHmac('sha256', o.secret ?? SECRET)
    .update(`${head}.${body}`)
    .digest('base64url');
  return `${head}.${body}.${sig}`;
}

const verify = (t: string, extra: Partial<Parameters<typeof verifyShopifySessionToken>[1]> = {}) =>
  verifyShopifySessionToken(t, {
    clientId: CLIENT_ID,
    clientSecret: SECRET,
    now: NOW,
    ...extra,
  });

const reason = (t: string, extra = {}) => {
  const r = verify(t, extra);
  return r.ok ? 'ok' : r.reason;
};

describe('verifyShopifySessionToken: accepted', () => {
  it('accepts a well-formed token and reads the shop', () => {
    const r = verify(token());
    expect(r).toEqual({ ok: true, claims: { shop: SHOP, sub: '42', exp: sec + 60 } });
  });

  it('accepts a trailing slash on the issuer and an upper-case host (hosts are case-insensitive)', () => {
    expect(
      reason(token({ iss: `https://${SHOP.toUpperCase()}/admin/`, dest: `https://${SHOP}` })),
    ).toBe('ok');
  });

  it('accepts a token with no nbf and no sub', () => {
    const r = verify(token({ nbf: undefined, sub: undefined }));
    expect(r.ok && r.claims.sub).toBeNull();
  });

  it('accepts a token that expired a few seconds ago, and one not yet valid by a few seconds (clock skew)', () => {
    expect(reason(token({ exp: sec - 5 }))).toBe('ok');
    expect(reason(token({ nbf: sec + 5 }))).toBe('ok');
  });

  it('accepts when the shop the page says matches (a bare handle or a pasted address is normalised)', () => {
    expect(reason(token(), { expectedShop: SHOP })).toBe('ok');
    expect(reason(token(), { expectedShop: 'ACME-store' })).toBe('ok');
    expect(reason(token(), { expectedShop: `https://${SHOP}/admin` })).toBe('ok');
  });
});

describe('verifyShopifySessionToken: refused', () => {
  it('refuses a bad signature, and a token signed with another secret', () => {
    expect(reason(token({}, { secret: 'other-secret' }))).toBe('signature');
    const [h, p] = token().split('.');
    expect(reason(`${h}.${p}.${'A'.repeat(43)}`)).toBe('signature');
  });

  it('refuses a payload changed after signing', () => {
    const [h, , s] = token().split('.');
    const forged = b64(
      claimsFor({
        dest: 'https://victim.myshopify.com',
        iss: 'https://victim.myshopify.com/admin',
      }),
    );
    expect(reason(`${h}.${forged}.${s}`)).toBe('signature');
  });

  it('refuses a truncated or empty signature', () => {
    const [h, p, s] = token().split('.');
    expect(reason(`${h}.${p}.${s!.slice(0, 20)}`)).toBe('signature');
    expect(reason(`${h}.${p}.`)).toBe('malformed');
  });

  it('refuses any algorithm other than HS256, including none', () => {
    expect(reason(token({}, { header: { alg: 'none' } }))).toBe('algorithm');
    expect(reason(token({}, { header: { alg: 'HS512' } }))).toBe('algorithm');
    expect(reason(token({}, { header: { alg: 'RS256' } }))).toBe('algorithm');
    expect(reason(token({}, { header: { typ: 'JWT' } }))).toBe('algorithm');
    expect(reason(`${b64({ alg: 'none' })}.${b64(claimsFor())}.`)).toBe('malformed');
  });

  it('refuses an expired token (beyond the allowed skew) and one not valid yet', () => {
    expect(reason(token({ exp: sec - 11 }))).toBe('expired');
    expect(reason(token({ exp: sec - 3600 }))).toBe('expired');
    expect(reason(token({ nbf: sec + 11 }))).toBe('not_yet_valid');
  });

  it('refuses a token with no or a non-numeric exp, or a non-numeric nbf', () => {
    expect(reason(token({ exp: undefined }))).toBe('malformed');
    expect(reason(token({ exp: '9999999999' }))).toBe('malformed');
    expect(reason(token({ nbf: 'soon' }))).toBe('malformed');
  });

  it('honours a stricter skew', () => {
    expect(reason(token({ exp: sec - 5 }), { leewaySeconds: 0 })).toBe('expired');
  });

  it('refuses another app (wrong audience), a missing audience and an array audience', () => {
    expect(reason(token({ aud: 'someone-elses-app' }))).toBe('audience');
    expect(reason(token({ aud: undefined }))).toBe('audience');
    expect(reason(token({ aud: [CLIENT_ID] }))).toBe('audience');
  });

  it('refuses a destination that is not a plain https Shopify shop', () => {
    for (const dest of [
      'http://acme-store.myshopify.com',
      'https://acme-store.example.com',
      'https://evil.com/acme-store.myshopify.com',
      'https://acme-store.myshopify.com.evil.com',
      'https://acme-store.myshopify.com:8443',
      'https://user@acme-store.myshopify.com',
      'https://acme-store.myshopify.com/path',
      'https://acme-store.myshopify.com?x=1',
      'acme-store.myshopify.com',
      '',
    ]) {
      expect(reason(token({ dest, iss: `${dest}/admin` })), dest).toBe('destination');
    }
    expect(reason(token({ dest: 42 }))).toBe('destination');
    expect(reason(token({ dest: undefined }))).toBe('destination');
  });

  it('refuses an issuer from another shop, or not the admin path', () => {
    expect(reason(token({ iss: 'https://other-store.myshopify.com/admin' }))).toBe('issuer');
    expect(reason(token({ iss: `https://${SHOP}` }))).toBe('issuer');
    expect(reason(token({ iss: `https://${SHOP}/other` }))).toBe('issuer');
    expect(reason(token({ iss: `http://${SHOP}/admin` }))).toBe('issuer');
    expect(reason(token({ iss: undefined }))).toBe('issuer');
  });

  it('refuses a token for another shop than the page says', () => {
    expect(reason(token(), { expectedShop: 'other-store.myshopify.com' })).toBe('other_shop');
    expect(reason(token(), { expectedShop: '' })).toBe('other_shop');
    expect(reason(token(), { expectedShop: 'acme-store.myshopify.com.evil.com' })).toBe(
      'other_shop',
    );
  });

  it('refuses malformed input without throwing', () => {
    for (const t of [
      '',
      'abc',
      'a.b',
      'a.b.c.d',
      'not base64!.x.y',
      `${b64({ alg: 'HS256' })}.${Buffer.from('not json').toString('base64url')}.x`,
    ]) {
      expect(['malformed', 'signature']).toContain(reason(t));
    }
    // A correctly signed body that is a JSON array or a string is not a claim set.
    expect(reason(token({}, { raw: b64([1, 2]) }))).toBe('malformed');
    expect(reason(token({}, { raw: b64('x') }))).toBe('malformed');
  });

  it('refuses everything while the app has no client id or secret', () => {
    expect(reason(token(), { clientId: '' })).toBe('not_configured');
    expect(reason(token(), { clientSecret: '' })).toBe('not_configured');
    // An empty secret must not accept a token signed with the empty key.
    expect(reason(token({}, { secret: '' }), { clientSecret: '' })).toBe('not_configured');
  });
});
