import { createHmac, timingSafeEqual } from 'node:crypto';
import { SHOP_DOMAIN } from '../../infra/providers/ecom/ecom.port';
import { normalizeShop } from './ecom-rules';

/**
 * Shopify App Bridge session tokens (WD-ECOM-038). A token is a JWT signed HS256 with the app's client secret. Pure: no database,
 * no network, no clock of its own, so every accept and refuse case can be tested with generated tokens.
 *
 * Shopify's claims: `iss` = `https://<shop>/admin`, `dest` = `https://<shop>`, `aud` = the app's client id, `exp` and `nbf` in seconds.
 */

/** Why a token was refused. For logs only: the caller always sees the one stable error code. */
export type SessionTokenFailure =
  | 'not_configured'
  | 'malformed'
  | 'algorithm'
  | 'signature'
  | 'expired'
  | 'not_yet_valid'
  | 'audience'
  | 'destination'
  | 'issuer'
  | 'other_shop';

export interface SessionTokenClaims {
  /** The shop the token was issued for, as `<handle>.myshopify.com`. */
  shop: string;
  /** Shopify's user id for the merchant staff member (`sub`), when present. */
  sub: string | null;
  /** Expiry in seconds since the epoch. */
  exp: number;
}

export type SessionTokenResult =
  { ok: true; claims: SessionTokenClaims } | { ok: false; reason: SessionTokenFailure };

export interface SessionTokenOptions {
  clientId: string;
  clientSecret: string;
  /** Now, in milliseconds. */
  now: number;
  /** Clock skew allowed on `exp` and `nbf`, in seconds (Shopify advises a few seconds). Default 10. */
  leewaySeconds?: number;
  /** When set, the token must be for exactly this shop (a bare handle or a pasted address is normalised). */
  expectedShop?: string;
}

const SEGMENT = /^[A-Za-z0-9_-]+$/;
const fail = (reason: SessionTokenFailure): SessionTokenResult => ({ ok: false, reason });

function decodeJson(segment: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    return typeof v === 'object' && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The host of `https://<host>` and nothing else (no port, path, query or credentials), or null. */
function shopOrigin(value: unknown, path: '' | '/admin'): string | null {
  if (typeof value !== 'string') return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const trimmed = url.pathname.replace(/\/+$/, '');
  if (
    url.protocol !== 'https:' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    trimmed !== path ||
    !SHOP_DOMAIN.test(url.hostname)
  ) {
    return null;
  }
  return url.hostname.toLowerCase();
}

const isSeconds = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function verifyShopifySessionToken(
  token: string,
  opts: SessionTokenOptions,
): SessionTokenResult {
  if (opts.clientId === '' || opts.clientSecret === '') return fail('not_configured');
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every((p) => SEGMENT.test(p))) return fail('malformed');
  const [head, body, sig] = parts as [string, string, string];

  const header = decodeJson(head);
  if (!header) return fail('malformed');
  // Pinned: a token that names another algorithm (`none`, RS256 with the secret as a key) is refused before any signature is read.
  if (header.alg !== 'HS256') return fail('algorithm');

  const expected = createHmac('sha256', opts.clientSecret).update(`${head}.${body}`).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return fail('signature');

  const claims = decodeJson(body);
  if (!claims) return fail('malformed');

  const leeway = opts.leewaySeconds ?? 10;
  const nowSeconds = opts.now / 1000;
  if (!isSeconds(claims.exp)) return fail('malformed');
  if (claims.exp + leeway <= nowSeconds) return fail('expired');
  if (claims.nbf !== undefined) {
    if (!isSeconds(claims.nbf)) return fail('malformed');
    if (claims.nbf - leeway > nowSeconds) return fail('not_yet_valid');
  }

  if (claims.aud !== opts.clientId) return fail('audience');

  const shop = shopOrigin(claims.dest, '');
  if (!shop) return fail('destination');
  // The issuer must be the admin of the very shop the token is for.
  if (shopOrigin(claims.iss, '/admin') !== shop) return fail('issuer');

  if (opts.expectedShop !== undefined && normalizeShop(opts.expectedShop) !== shop)
    return fail('other_shop');

  return {
    ok: true,
    claims: {
      shop,
      sub: typeof claims.sub === 'string' ? claims.sub : null,
      exp: claims.exp,
    },
  };
}
