import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The OAuth `state` of the Google mail consent round trip (TW-MAIL-020). The callback is a public route with no session, so the state IS the
 * session: a signed, short-lived token that names the workspace, the admin who pressed Connect and, for a reconnect, the mailbox. A callback
 * whose state does not verify is refused before any call to Google.
 *
 * Format: `base64url(JSON payload) . base64url(HMAC-SHA256)`. The key is derived (HKDF) from the credentials key with a label of its own, so
 * it is a different key from the one that seals tokens AND from Google Calendar's state key, and the signed `purpose` makes a state minted
 * for the calendar unusable here (and the other way round).
 */
export const STATE_TTL_SECONDS = 600;
const PURPOSE = 'email.google-mail.connect';
const INFO = 'crm/channel-email/google-mail-state/v1';

export interface MailState {
  orgId: number;
  /** The admin who pressed Connect; the mailbox and its audit row are theirs. */
  userId: number | null;
  /** A path inside this app to return to (validated before it is signed). */
  returnTo: string;
  /** The mailbox being reconnected, when the admin pressed Reconnect on one. */
  mailboxId: string | null;
  nonce: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export type StateCheck =
  { ok: true; state: MailState } | { ok: false; reason: 'malformed' | 'signature' | 'expired' };

export function deriveStateKey(credentialsKeyBase64: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(credentialsKeyBase64, 'base64'), Buffer.alloc(0), INFO, 32),
  );
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const mac = (payload: string, key: Buffer) => createHmac('sha256', key).update(payload).digest();

export function newState(
  input: { orgId: number; userId: number | null; returnTo: string; mailboxId?: string | null },
  nowMs: number,
): MailState {
  return {
    orgId: input.orgId,
    userId: input.userId,
    returnTo: input.returnTo,
    mailboxId: input.mailboxId ?? null,
    nonce: randomBytes(12).toString('base64url'),
    expiresAt: nowMs + STATE_TTL_SECONDS * 1000,
  };
}

export function signState(state: MailState, key: Buffer): string {
  const payload = b64(
    JSON.stringify({
      p: PURPOSE,
      o: state.orgId,
      u: state.userId,
      r: state.returnTo,
      m: state.mailboxId,
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
    (body.m !== null && typeof body.m !== 'string') ||
    typeof body.n !== 'string' ||
    typeof body.e !== 'number'
  ) {
    return { ok: false, reason: 'malformed' };
  }
  if (body.e <= nowMs) return { ok: false, reason: 'expired' };
  return {
    ok: true,
    state: {
      orgId: body.o,
      userId: body.u as number | null,
      returnTo: body.r,
      mailboxId: body.m as string | null,
      nonce: body.n,
      expiresAt: body.e,
    },
  };
}

/** The page the browser lands on, with the outcome the screen reads (`?email=connected`). */
export function returnUrl(webUrl: string, returnTo: string, outcome: string): string {
  const path = /^\/(?!\/)[^\s\\]*$/.test(returnTo) ? returnTo : '/email';
  const sep = path.includes('?') ? '&' : '?';
  return `${webUrl.replace(/\/$/, '')}${path}${sep}email=${encodeURIComponent(outcome)}`;
}
