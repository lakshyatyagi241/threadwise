import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { channelEmailEnv } from '../../../config/domains/channel-email.env';
import { cacheMetrics } from '@crm/observability';

const cache = cacheMetrics('google_oidc_keys');

interface Jwk {
  kty?: string;
  kid?: string;
  use?: string;
  [field: string]: unknown;
}

/** What the verifier requires of a token (all of it comes from the platform's configuration, none from the request). */
export interface OidcExpectation {
  /** The token's `aud` must be exactly this. */
  audience: string;
  /** The token's `email` (the push subscription's service account) must be this, compared case-insensitively. */
  email: string;
}

export type OidcResult =
  | { ok: true; claims: Record<string, unknown> }
  | {
      ok: false;
      reason:
        | 'malformed'
        | 'alg'
        | 'unknown_key'
        | 'signature'
        | 'issuer'
        | 'audience'
        | 'expired'
        | 'not_yet_valid'
        | 'email'
        | 'email_unverified'
        | 'jwks_unavailable';
    };

const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
/** Clock skew tolerated on `exp` / `iat` / `nbf`, in seconds. */
const SKEW_SECONDS = 60;
/** Never accept a token bigger than this: a Google ID token is about 1 KB. */
const MAX_TOKEN_CHARS = 8 * 1024;
/** How long the key set is kept when Google does not say (seconds), and the bounds on what it says. */
const DEFAULT_TTL = 3600;
const MIN_TTL = 60;
const MAX_TTL = 24 * 3600;
/** An unknown key id forces a re-read of Google's keys, but never more often than this (a hostile kid cannot make us hammer Google). */
const MIN_REFETCH_MS = 30_000;

const b64json = (part: string): Record<string, unknown> | null => {
  try {
    const v: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/**
 * Verifies the OIDC ID token Google Pub/Sub attaches to a push request (TW-MAIL-033): RS256 against Google's published signing keys
 * (JWKS, cached for what `Cache-Control` allows and re-read when a token names a key we do not know, which is how Google rotates), then
 * issuer, audience, expiry, the service account's email and `email_verified`. Anything else, including `alg: none` or an HMAC token
 * signed with a public key, is refused. Fails closed: with no keys available nothing verifies.
 *
 * Written from Google's documentation (cloud.google.com/pubsub/docs/authenticate-push-subscriptions) and tested against a locally
 * generated key; not run against Google's live key set.
 */
@Injectable()
export class GoogleOidcVerifier {
  private readonly logger = new Logger(GoogleOidcVerifier.name);
  private keys = new Map<string, KeyObject>();
  private expiresAtMs = 0;
  private lastFetchMs = 0;
  private inflight: Promise<void> | null = null;

  async verify(token: string, expect: OidcExpectation, nowMs = Date.now()): Promise<OidcResult> {
    if (!token || token.length > MAX_TOKEN_CHARS) return { ok: false, reason: 'malformed' };
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p)) || !parts[2]) {
      return { ok: false, reason: 'malformed' };
    }
    const header = b64json(parts[0]!);
    const claims = b64json(parts[1]!);
    if (!header || !claims) return { ok: false, reason: 'malformed' };
    if (header.alg !== 'RS256') return { ok: false, reason: 'alg' };
    const kid = typeof header.kid === 'string' ? header.kid : '';
    if (!kid) return { ok: false, reason: 'unknown_key' };

    const key = await this.keyFor(kid, nowMs);
    if (key === 'unavailable') return { ok: false, reason: 'jwks_unavailable' };
    if (!key) return { ok: false, reason: 'unknown_key' };
    let good = false;
    try {
      good = cryptoVerify(
        'sha256',
        Buffer.from(`${parts[0]}.${parts[1]}`),
        key,
        Buffer.from(parts[2], 'base64url'),
      );
    } catch {
      good = false;
    }
    if (!good) return { ok: false, reason: 'signature' };

    const nowS = Math.floor(nowMs / 1000);
    if (typeof claims.iss !== 'string' || !ISSUERS.has(claims.iss)) {
      return { ok: false, reason: 'issuer' };
    }
    if (typeof claims.aud !== 'string' || !expect.audience || claims.aud !== expect.audience) {
      return { ok: false, reason: 'audience' };
    }
    if (typeof claims.exp !== 'number' || claims.exp + SKEW_SECONDS < nowS) {
      return { ok: false, reason: 'expired' };
    }
    if (
      (typeof claims.nbf === 'number' && claims.nbf - SKEW_SECONDS > nowS) ||
      (typeof claims.iat === 'number' && claims.iat - SKEW_SECONDS > nowS)
    ) {
      return { ok: false, reason: 'not_yet_valid' };
    }
    if (
      typeof claims.email !== 'string' ||
      !expect.email ||
      claims.email.toLowerCase() !== expect.email.toLowerCase()
    ) {
      return { ok: false, reason: 'email' };
    }
    if (claims.email_verified !== true && claims.email_verified !== 'true') {
      return { ok: false, reason: 'email_unverified' };
    }
    return { ok: true, claims };
  }

  /** Forgets the cached keys (a test, or a rotation noticed elsewhere). */
  reset(): void {
    this.keys = new Map();
    this.expiresAtMs = 0;
    this.lastFetchMs = 0;
  }

  private async keyFor(kid: string, nowMs: number): Promise<KeyObject | 'unavailable' | null> {
    const stale = nowMs >= this.expiresAtMs;
    if (stale) await this.refresh(nowMs);
    let key = this.keys.get(kid);
    if (!key && !stale && nowMs - this.lastFetchMs >= MIN_REFETCH_MS) {
      // A key we have not seen: Google may have rotated since we read the set.
      await this.refresh(nowMs);
      key = this.keys.get(kid);
    }
    if (key) {
      cache.hit();
      return key;
    }
    cache.miss();
    return this.keys.size === 0 ? 'unavailable' : null;
  }

  private refresh(nowMs: number): Promise<void> {
    this.inflight ??= this.load(nowMs).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async load(nowMs: number): Promise<void> {
    this.lastFetchMs = nowMs;
    try {
      const res = await fetch(channelEmailEnv().GOOGLE_OIDC_JWKS_URL, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as {
        keys?: Jwk[];
      };
      const next = new Map<string, KeyObject>();
      for (const jwk of body.keys ?? []) {
        if (jwk.kty !== 'RSA' || !jwk.kid || (jwk.use && jwk.use !== 'sig')) continue;
        try {
          next.set(jwk.kid, createPublicKey({ key: jwk as never, format: 'jwk' }));
        } catch {
          // an unusable key is skipped; the others still verify
        }
      }
      if (next.size === 0) throw new Error('no usable keys');
      const maxAge = /max-age=(\d+)/i.exec(res.headers.get('cache-control') ?? '')?.[1];
      const ttl = Math.min(MAX_TTL, Math.max(MIN_TTL, maxAge ? Number(maxAge) : DEFAULT_TTL));
      this.keys = next;
      this.expiresAtMs = nowMs + ttl * 1000;
    } catch (err) {
      // Keep what we have (a stale set still verifies signatures); try again at the next token after the refetch interval.
      this.logger.warn({ err: (err as Error).message }, "Google's signing keys could not be read");
      this.expiresAtMs = nowMs + MIN_REFETCH_MS;
    }
  }
}
