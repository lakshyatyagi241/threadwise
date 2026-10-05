/**
 * What the socket runtime does when a WhatsApp connection closes (WD-NODE-011 rules 7, 8 and 12). Pure: the table the
 * inventory asks for, in one place, so it can be read and tested without a socket.
 *
 * The codes are the WhatsApp Web ones Baileys reports in `DisconnectReason`.
 */

export const CLOSE = {
  loggedOut: 401,
  forbidden: 403,
  timedOut: 408,
  multideviceMismatch: 411,
  connectionClosed: 428,
  connectionReplaced: 440,
  badSession: 500,
  restartRequired: 515,
  unavailableService: 503,
} as const;

/** A short human reason for a close, from its code and (when the library gives one) its message. */
export function closeLabel(code: number | undefined, message?: string): string {
  const m = (message ?? '').toLowerCase();
  if (/could(?:n't| not) link/.test(m)) return 'device limit reached';
  if (/qr refs? attempts? ended|qr ref/.test(m)) return 'QR expired';
  if (/timed out/.test(m)) return 'timed out';
  switch (code) {
    case CLOSE.loggedOut:
      return 'logged out';
    case CLOSE.forbidden:
      return 'forbidden';
    case CLOSE.timedOut:
      return 'timed out';
    case CLOSE.multideviceMismatch:
      return 'multi-device mismatch';
    case CLOSE.connectionClosed:
      return 'connection closed';
    case CLOSE.connectionReplaced:
      return 'connection replaced';
    case CLOSE.badSession:
      return 'bad session';
    case CLOSE.restartRequired:
      return 'restart required';
    case CLOSE.unavailableService:
      return 'service unavailable';
    default:
      return code === undefined ? 'connection lost' : `code ${code}`;
  }
}

/** Only the pair-failure labels are cut: 32 characters, 29 and an ellipsis (WaDesk `shortStatus`). */
export const shortStatus = (s: string): string => (s.length <= 32 ? s : `${s.slice(0, 29)}...`);

export type CloseDecision =
  /** The process is shutting down: leave the session files, do nothing else. */
  | { action: 'ignore' }
  /** A first-time pairing that never opened: give up, delete the files, say why. */
  | { action: 'abort-pair'; status: string }
  /** The phone unlinked the device (or WhatsApp refused it): stop for good, unlink, delete the session. */
  | { action: 'logged-out' }
  /** A corrupt session: delete the files, then connect again from the QR. */
  | { action: 'reset-session'; delayMs: number }
  /** Everything else: connect again after `delayMs`, for ever. `status` is what to report on the next "connecting". */
  | { action: 'reconnect'; delayMs: number; status: ConnectStatus };

export interface ConnectStatus {
  label: string;
  progress: number;
}

export interface CloseInput {
  code: number | undefined;
  message?: string;
  /** The socket has reached `open` at least once since the device was created. */
  everOpened: boolean;
  shuttingDown: boolean;
  /** Reconnect attempts since the last open; shapes the delay only, never ends the retries. */
  retries: number;
  random: () => number;
}

const BASE_MS = 3_000;
const MAX_DELAY_MS = 30_000;
const MAX_FACTOR = 10;
const JITTER_MS = 1_500;

/** The wait before the next connection attempt: a base by code, grown by 1.5 per retry up to 10x, plus jitter, capped at 30 s. */
export function backoffMs(code: number | undefined, retries: number, random: () => number): number {
  const base =
    code === CLOSE.restartRequired
      ? 2_000
      : code === CLOSE.badSession || code === CLOSE.connectionClosed
        ? 4_000
        : code === CLOSE.timedOut || code === CLOSE.connectionReplaced
          ? 6_000
          : BASE_MS;
  const factor = Math.min(1.5 ** retries, MAX_FACTOR);
  return Math.min(Math.round(base * factor + random() * JITTER_MS), MAX_DELAY_MS);
}

/** The status the next "connecting" reports: a post-pairing restart is "Syncing data", other drops are "Reconnecting". */
function reconnectStatus(code: number | undefined): ConnectStatus {
  if (code === CLOSE.restartRequired) return { label: 'Syncing data', progress: 75 };
  return { label: 'Reconnecting', progress: 50 };
}

export function decideClose(i: CloseInput): CloseDecision {
  if (i.shuttingDown) return { action: 'ignore' };
  const code = i.code;

  // Never opened and not the normal "restart after the scan" (515) or "bad session" (500): the first pairing failed.
  if (!i.everOpened && code !== CLOSE.restartRequired && code !== CLOSE.badSession) {
    if (code === CLOSE.loggedOut || code === CLOSE.forbidden) return { action: 'logged-out' };
    return {
      action: 'abort-pair',
      status: shortStatus(`Pair failed: ${closeLabel(code, i.message)}`),
    };
  }
  if (code === CLOSE.loggedOut || code === CLOSE.forbidden) return { action: 'logged-out' };
  if (code === CLOSE.badSession) {
    return { action: 'reset-session', delayMs: backoffMs(code, i.retries, i.random) };
  }
  return {
    action: 'reconnect',
    delayMs: backoffMs(code, i.retries, i.random),
    status: reconnectStatus(code),
  };
}

/** WhatsApp's id for the linked account (`919876543210:12@s.whatsapp.net`) as plain digits. */
export const linkedDigits = (id: string | undefined): string =>
  (id ?? '').split('@')[0]!.split(':')[0]!.replace(/\D+/g, '');

/** The scan was made with a different phone than the one this device was created for (WD-NODE-011 rule 6). */
export const isMismatch = (linkedId: string | undefined, expectedDigits: string): boolean =>
  linkedDigits(linkedId) !== expectedDigits.replace(/\D+/g, '');

/** QR codes closer together than this are rotations of the same attempt and are ignored (WD-NODE-011 rule 5). */
export const QR_MIN_GAP_MS = 5_000;
/** A first pairing with no scan for this long is abandoned. Measured from the first QR, not reset by the ~20 s rotations. */
export const QR_STALL_MS = 90_000;
