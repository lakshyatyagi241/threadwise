import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The signed tokens of the Microsoft consent round trip (BL-035). Two of them, both `base64url(JSON) . base64url(HMAC-SHA256)`, with a
 * key derived (HKDF) from the credentials key, a different key from the one that seals tokens, and a `purpose` that is signed too, so
 * one kind can never be replayed as the other, or as the Google state.
 *
 *  - the STATE rides through Microsoft's consent screen: it names the workspace and the admin who pressed Connect;
 *  - the TICKET is what the callback hands the browser after Microsoft answered: the same names plus the authorization code, sealed. Only
 *    the same signed-in admin, in the same workspace, can turn it into a connection (the code is exchanged only then). A forwarded link
 *    belongs to somebody else's session and is refused before Microsoft is asked for anything.
 */
export const STATE_TTL_SECONDS = 600;
/** The ticket outlives the code only briefly: Microsoft codes last about ten minutes, and the admin is looking at the confirm page. */
export const TICKET_TTL_SECONDS = 300;
const STATE_PURPOSE = 'appointments.microsoft-calendar.connect';
const TICKET_PURPOSE = 'appointments.microsoft-calendar.confirm';
const INFO = 'crm/appointments/microsoft-calendar-state/v1';

export interface MicrosoftState {
  orgId: number;
  userId: number | null;
  /** A path inside this app to return to (validated before it is signed). */
  returnTo: string;
  nonce: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface MicrosoftTicket {
  orgId: number;
  userId: number;
  returnTo: string;
  /** The authorization code, sealed with the credentials key. */
  sealedCode: string;
  expiresAt: number;
}

export type TokenCheck<T> =
  { ok: true; value: T } | { ok: false; reason: 'malformed' | 'signature' | 'expired' };

/** The signing key, from the base64 credentials key the app already holds. */
export function deriveMicrosoftKey(credentialsKeyBase64: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(credentialsKeyBase64, 'base64'), Buffer.alloc(0), INFO, 32),
  );
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const mac = (payload: string, key: Buffer) => createHmac('sha256', key).update(payload).digest();

function sign(body: Record<string, unknown>, key: Buffer): string {
  const payload = b64(JSON.stringify(body));
  return `${payload}.${b64(mac(payload, key))}`;
}

function open(token: string, key: Buffer): Record<string, unknown> | 'malformed' | 'signature' {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return 'malformed';
  const [payload, signature] = parts as [string, string];
  const given = Buffer.from(signature, 'base64url');
  const expected = mac(payload, key);
  // Length first: timingSafeEqual throws on unequal lengths.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return 'signature';
  try {
    const body: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : 'malformed';
  } catch {
    return 'malformed';
  }
}

export function newState(
  input: { orgId: number; userId: number | null; returnTo: string },
  nowMs: number,
): MicrosoftState {
  return {
    ...input,
    nonce: randomBytes(12).toString('base64url'),
    expiresAt: nowMs + STATE_TTL_SECONDS * 1000,
  };
}

export function signState(state: MicrosoftState, key: Buffer): string {
  return sign(
    {
      p: STATE_PURPOSE,
      o: state.orgId,
      u: state.userId,
      r: state.returnTo,
      n: state.nonce,
      e: state.expiresAt,
    },
    key,
  );
}

export function verifyState(token: string, key: Buffer, nowMs: number): TokenCheck<MicrosoftState> {
  const body = open(token, key);
  if (typeof body === 'string') return { ok: false, reason: body };
  if (
    body.p !== STATE_PURPOSE ||
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
  return {
    ok: true,
    value: { orgId: body.o, userId: body.u, returnTo: body.r, nonce: body.n, expiresAt: body.e },
  };
}

export function signTicket(ticket: MicrosoftTicket, key: Buffer): string {
  return sign(
    {
      p: TICKET_PURPOSE,
      o: ticket.orgId,
      u: ticket.userId,
      r: ticket.returnTo,
      k: ticket.sealedCode,
      e: ticket.expiresAt,
    },
    key,
  );
}

export function verifyTicket(
  token: string,
  key: Buffer,
  nowMs: number,
): TokenCheck<MicrosoftTicket> {
  const body = open(token, key);
  if (typeof body === 'string') return { ok: false, reason: body };
  if (
    body.p !== TICKET_PURPOSE ||
    typeof body.o !== 'number' ||
    !Number.isSafeInteger(body.o) ||
    typeof body.u !== 'number' ||
    typeof body.r !== 'string' ||
    typeof body.k !== 'string' ||
    typeof body.e !== 'number'
  ) {
    return { ok: false, reason: 'malformed' };
  }
  if (body.e <= nowMs) return { ok: false, reason: 'expired' };
  return {
    ok: true,
    value: {
      orgId: body.o,
      userId: body.u,
      returnTo: body.r,
      sealedCode: body.k,
      expiresAt: body.e,
    },
  };
}

/** The page the browser lands on, with the outcome the settings screen reads (`?calendar=connected`). */
export function returnUrl(
  webUrl: string,
  returnTo: string,
  params: Record<string, string>,
): string {
  const path = /^\/(?!\/)[^\s\\]*$/.test(returnTo) ? returnTo : '/appointments/settings';
  const query = new URLSearchParams(params).toString();
  const sep = path.includes('?') ? '&' : '?';
  return `${webUrl.replace(/\/$/, '')}${path}${sep}${query}`;
}
