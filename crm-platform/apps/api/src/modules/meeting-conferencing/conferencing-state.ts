import { createHmac, hkdf, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { CONNECTED_VIDEO_PROVIDERS, type ConnectedVideoProvider } from '@crm/contracts';

/**
 * The OAuth `state` and the confirmation ticket of a person's Zoom / Teams consent round trip (BL-360), modelled on the Microsoft calendar
 * connection. The callback is a public route with no session, so the state IS the session: a signed, short-lived token naming the
 * workspace, the person who pressed Connect and the provider. A callback whose state does not verify is refused before any call to a provider.
 *
 * Nothing is exchanged at the callback. It hands the browser a signed TICKET carrying the sealed code; the code is exchanged only when the
 * same signed-in person, in that workspace, confirms. A consent link forwarded to somebody else ends on a page that refuses it, and no token
 * was ever requested for it: otherwise a person could be tricked into attaching THEIR Zoom to a colleague's seat.
 *
 * Format: `base64url(JSON payload) . base64url(HMAC-SHA256)`. The key is derived (HKDF) from the credentials key, so it is not the key that
 * seals tokens, and the signed `purpose` keeps a state from being replayed as a ticket.
 */
export const STATE_TTL_SECONDS = 600;
export const TICKET_TTL_SECONDS = 600;
const STATE_PURPOSE = 'conferencing.connect.state';
const TICKET_PURPOSE = 'conferencing.connect.ticket';
const INFO = 'crm/meeting-conferencing/state/v1';

export interface ConferencingState {
  orgId: number;
  userId: number | null;
  provider: ConnectedVideoProvider;
  returnTo: string;
  nonce: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface ConferencingTicket {
  orgId: number;
  userId: number;
  provider: ConnectedVideoProvider;
  returnTo: string;
  /** The provider's code, sealed with the credentials key. */
  sealedCode: string;
  expiresAt: number;
}

export type TokenCheck<T> =
  { ok: true; value: T } | { ok: false; reason: 'malformed' | 'signature' | 'expired' };

const hkdfAsync = promisify(hkdf);

/**
 * Async because the first caller is a request (the connect and callback routes), and HKDF on the event loop would stall every other one.
 * The output is unchanged (sha256, empty salt, the INFO label, 32 bytes), so a state signed before this change still verifies.
 */
export async function deriveStateKey(credentialsKeyBase64: string): Promise<Buffer> {
  return Buffer.from(
    await hkdfAsync(
      'sha256',
      Buffer.from(credentialsKeyBase64, 'base64'),
      Buffer.alloc(0),
      INFO,
      32,
    ),
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

const isProvider = (v: unknown): v is ConnectedVideoProvider =>
  typeof v === 'string' && (CONNECTED_VIDEO_PROVIDERS as readonly string[]).includes(v);

export function newState(
  input: {
    orgId: number;
    userId: number | null;
    provider: ConnectedVideoProvider;
    returnTo: string;
  },
  nowMs: number,
): ConferencingState {
  return {
    ...input,
    nonce: randomBytes(12).toString('base64url'),
    expiresAt: nowMs + STATE_TTL_SECONDS * 1000,
  };
}

export function signState(state: ConferencingState, key: Buffer): string {
  return sign(
    {
      p: STATE_PURPOSE,
      o: state.orgId,
      u: state.userId,
      v: state.provider,
      r: state.returnTo,
      n: state.nonce,
      e: state.expiresAt,
    },
    key,
  );
}

export function verifyState(
  token: string,
  key: Buffer,
  nowMs: number,
): TokenCheck<ConferencingState> {
  const body = open(token, key);
  if (typeof body === 'string') return { ok: false, reason: body };
  if (
    body.p !== STATE_PURPOSE ||
    typeof body.o !== 'number' ||
    !Number.isSafeInteger(body.o) ||
    (body.u !== null && typeof body.u !== 'number') ||
    !isProvider(body.v) ||
    typeof body.r !== 'string' ||
    typeof body.n !== 'string' ||
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
      provider: body.v,
      returnTo: body.r,
      nonce: body.n,
      expiresAt: body.e,
    },
  };
}

export function signTicket(ticket: ConferencingTicket, key: Buffer): string {
  return sign(
    {
      p: TICKET_PURPOSE,
      o: ticket.orgId,
      u: ticket.userId,
      v: ticket.provider,
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
): TokenCheck<ConferencingTicket> {
  const body = open(token, key);
  if (typeof body === 'string') return { ok: false, reason: body };
  if (
    body.p !== TICKET_PURPOSE ||
    typeof body.o !== 'number' ||
    !Number.isSafeInteger(body.o) ||
    typeof body.u !== 'number' ||
    !isProvider(body.v) ||
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
      provider: body.v,
      returnTo: body.r,
      sealedCode: body.k,
      expiresAt: body.e,
    },
  };
}

export const DEFAULT_RETURN = '/settings/video-meetings';

/** The page the browser lands on, with the outcome the connection page reads (`?video=connected&provider=zoom`). */
export function returnUrl(
  webUrl: string,
  returnTo: string,
  params: Record<string, string>,
): string {
  const path = /^\/(?!\/)[^\s\\]*$/.test(returnTo) ? returnTo : DEFAULT_RETURN;
  const query = new URLSearchParams(params).toString();
  const sep = path.includes('?') ? '&' : '?';
  return `${webUrl.replace(/\/$/, '')}${path}${sep}${query}`;
}
