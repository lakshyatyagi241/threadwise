import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { GOOGLE_CAPABILITIES, type GoogleCapability } from '@crm/contracts';

/**
 * The OAuth `state` of the Google consent round trip (TW-APPT-028). Reference held a random string in the browser session and compared it on
 * return. Here the callback is a public route that has no session, so the state IS the session: a signed, short-lived token that names
 * the workspace and the admin who started the connection. A callback whose state does not verify is refused before any call to Google.
 *
 * Format: `base64url(JSON payload) . base64url(HMAC-SHA256)`. The key is derived (HKDF) from the credentials key, so it is a different
 * key from the one that seals tokens, and a state signed for another purpose cannot be replayed here (the `purpose` is signed too).
 */
export const STATE_TTL_SECONDS = 600;
const PURPOSE = 'appointments.google-calendar.connect';
const INFO = 'crm/appointments/google-calendar-state/v1';

export interface CalendarState {
  orgId: number;
  /** The admin who pressed Connect; the connection and its audit row are theirs. */
  userId: number | null;
  /** A path inside this app to return to (validated before it is signed). */
  returnTo: string;
  /** What this consent asked Google for: the callback insists the grant covers all of it. A state signed before capabilities existed is a calendar consent. */
  capabilities: GoogleCapability[];
  nonce: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export type StateCheck =
  { ok: true; state: CalendarState } | { ok: false; reason: 'malformed' | 'signature' | 'expired' };

/** The signing key, from the base64 credentials key the app already holds. */
export function deriveStateKey(credentialsKeyBase64: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(credentialsKeyBase64, 'base64'), Buffer.alloc(0), INFO, 32),
  );
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const mac = (payload: string, key: Buffer) => createHmac('sha256', key).update(payload).digest();

export function newState(
  input: {
    orgId: number;
    userId: number | null;
    returnTo: string;
    capabilities?: GoogleCapability[];
  },
  nowMs: number,
): CalendarState {
  return {
    ...input,
    capabilities: input.capabilities ?? ['calendar'],
    nonce: randomBytes(12).toString('base64url'),
    expiresAt: nowMs + STATE_TTL_SECONDS * 1000,
  };
}

export function signState(state: CalendarState, key: Buffer): string {
  const payload = b64(
    JSON.stringify({
      p: PURPOSE,
      o: state.orgId,
      u: state.userId,
      r: state.returnTo,
      c: state.capabilities,
      n: state.nonce,
      e: state.expiresAt,
    }),
  );
  return `${payload}.${b64(mac(payload, key))}`;
}

export function verifyState(token: string, key: Buffer, nowMs: number): StateCheck {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  const [payload, signature] = parts as [string, string];
  const given = Buffer.from(signature, 'base64url');
  const expected = mac(payload, key);
  // Length first: timingSafeEqual throws on unequal lengths.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'signature' };
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (
    body.p !== PURPOSE ||
    typeof body.o !== 'number' ||
    !Number.isSafeInteger(body.o) ||
    (body.u !== null && typeof body.u !== 'number') ||
    typeof body.r !== 'string' ||
    typeof body.n !== 'string' ||
    typeof body.e !== 'number'
  ) {
    return { ok: false, reason: 'malformed' };
  }
  if (body.e <= nowMs) return { ok: false, reason: 'expired' };
  const known = new Set<string>(GOOGLE_CAPABILITIES);
  const capabilities =
    body.c === undefined
      ? (['calendar'] as GoogleCapability[])
      : Array.isArray(body.c) && body.c.length > 0 && body.c.every((c) => known.has(String(c)))
        ? (body.c as GoogleCapability[])
        : null;
  if (!capabilities) return { ok: false, reason: 'malformed' };
  return {
    ok: true,
    state: {
      orgId: body.o,
      userId: body.u,
      returnTo: body.r,
      capabilities,
      nonce: body.n,
      expiresAt: body.e,
    },
  };
}

/** The page the browser lands on, with the outcome the settings screen reads (`?calendar=connected`). */
export function returnUrl(webUrl: string, returnTo: string, outcome: string): string {
  const path = /^\/(?!\/)[^\s\\]*$/.test(returnTo) ? returnTo : '/appointments/settings';
  const sep = path.includes('?') ? '&' : '?';
  return `${webUrl.replace(/\/$/, '')}${path}${sep}calendar=${encodeURIComponent(outcome)}`;
}
