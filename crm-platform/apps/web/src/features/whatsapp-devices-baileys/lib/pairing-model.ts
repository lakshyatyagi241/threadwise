/**
 * The pairing read and what the link step shows (spec 7.2 and 8). Pure: the polling hook and the screens feed it the last
 * answer and the clock. The QR and the code are secrets for a few seconds: nothing here stores, logs or serialises them.
 */

/** The pairing read is polled every 2 seconds (the rate Reference used and the spec recommends). */
export const POLL_INTERVAL_MS = 2000;
/** After a 429 on the pairing read (1 request a second per person) the poll slows down instead of showing an error. */
export const POLL_SLOWDOWN_MS = 5000;
/** Baileys rotates the QR about every 20 seconds; the ring shows the time left in that window. */
export const QR_ROTATE_MS = 20_000;
/** How long a pairing code is valid after it is shown (spec 3.2: 180 s). */
export const CODE_VALID_S = 180;

/** The answer of `GET /v2/devices/:id/pairing`, as far as this model reads it. */
export interface PairingSnapshot {
  state: string;
  reason?: string | null;
  label?: string | null;
  progress?: number | null;
  qr?: string | null;
  qrAgeMs?: number | null;
  code?: string | null;
  codeExpiresIn?: number | null;
  startedAt?: string | null;
  deadlineAt?: string | null;
}

/**
 * The attempt's end on THIS machine's clock. The server sends `startedAt` and `deadlineAt` on its own clock, so the length of the
 * attempt is taken from them and counted from when this page first got an answer: a wrong clock on the computer can then neither
 * end the attempt early nor keep it open. (The server still ends it for real; this only makes the screen say so at once.)
 */
export function attemptDeadlineMs(
  first: Pick<PairingSnapshot, 'startedAt' | 'deadlineAt'>,
  receivedAt: number,
): number | null {
  const start = Date.parse(first.startedAt ?? '');
  const end = Date.parse(first.deadlineAt ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return receivedAt + (end - start);
}

export type PairingPhase =
  /** Asked for a QR or a code, nothing on screen yet. */
  | 'starting'
  /** A QR is shown and nobody has scanned it. */
  | 'waiting_scan'
  /** A code is shown and nobody has typed it. */
  | 'waiting_code'
  /** Scanned or typed: WhatsApp is syncing. Never "re-pair". */
  | 'linking'
  | 'connected'
  /** The overall deadline passed while still waiting. */
  | 'expired'
  /** The runtime ended the attempt (`error`, `logged_out`, `disconnected`). */
  | 'failed';

const TERMINAL: readonly PairingPhase[] = ['connected', 'expired', 'failed'];
export const isTerminalPhase = (phase: PairingPhase): boolean => TERMINAL.includes(phase);

/** Seconds from now to a deadline (an ISO string or a time in ms), never negative; `null` when there is none. */
export function secondsUntil(at: string | number | null | undefined, now: number): number | null {
  if (at == null || at === '') return null;
  const ms = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.ceil((ms - now) / 1000));
}

/**
 * Where the attempt is. `started` is false before the start call answered (then it is `starting`). A deadline that has passed
 * while the runtime still says "waiting" is `expired` at once, without waiting for the next poll to say `qr_timeout`.
 */
export function pairingPhase(
  snapshot: PairingSnapshot | null | undefined,
  now: number,
  started = true,
  /** The deadline on this machine's clock (`attemptDeadlineMs`); the server's `deadlineAt` is used when not given. */
  deadlineMs: number | null = null,
): PairingPhase {
  if (!started || !snapshot) return 'starting';
  switch (snapshot.state) {
    case 'connected':
      return 'connected';
    case 'connecting':
      return 'linking';
    case 'awaiting_qr':
    case 'awaiting_pairing_code': {
      const left = secondsUntil(deadlineMs ?? snapshot.deadlineAt, now);
      if (left === 0) return 'expired';
      if (snapshot.state === 'awaiting_pairing_code') {
        return snapshot.code ? 'waiting_code' : 'starting';
      }
      return snapshot.qr ? 'waiting_scan' : 'starting';
    }
    case 'error':
    case 'logged_out':
    case 'disconnected':
    case 'created':
      // `created` after a start means the attempt was ended (the runtime cleared it).
      return 'failed';
    default:
      return 'starting';
  }
}

/**
 * How often to read again, or `false` to stop. Stops when the dialog is closed, when the tab is hidden (the QR would rotate
 * unseen and each read is a request for nothing) and once the attempt has ended.
 */
export function nextPollDelay(input: {
  open: boolean;
  hidden: boolean;
  phase: PairingPhase;
  /** The last read was refused with 429: back off. */
  rateLimited?: boolean;
}): number | false {
  if (!input.open || input.hidden) return false;
  if (isTerminalPhase(input.phase)) return false;
  return input.rateLimited ? POLL_SLOWDOWN_MS : POLL_INTERVAL_MS;
}

/**
 * The time left in the current QR's rotation window: `qrAgeMs` is its age when the answer was produced, `receivedAt` is when this
 * page got it. Returns whole seconds (0 to 20) and a 0 to 1 fraction for the ring.
 */
export function qrWindow(
  qrAgeMs: number | null | undefined,
  receivedAt: number,
  now: number,
): { seconds: number; fraction: number } {
  const age = Math.max(0, (qrAgeMs ?? 0) + (now - receivedAt));
  const left = Math.max(0, QR_ROTATE_MS - age);
  return { seconds: Math.ceil(left / 1000), fraction: left / QR_ROTATE_MS };
}

/** Whether a new poll answer carries a different QR (the picture is redrawn, the ring restarts). */
export const qrChanged = (prev: string | null | undefined, next: string | null | undefined) =>
  (prev ?? null) !== (next ?? null);

/** The strip under the QR: Code shown, Scanned, Ready. `done` steps are filled, `current` pulses. */
export type StripStep = 'shown' | 'scanned' | 'ready';
export function progressStrip(phase: PairingPhase): Record<StripStep, 'done' | 'current' | 'todo'> {
  switch (phase) {
    case 'waiting_scan':
    case 'waiting_code':
      return { shown: 'current', scanned: 'todo', ready: 'todo' };
    case 'linking':
      return { shown: 'done', scanned: 'current', ready: 'todo' };
    case 'connected':
      return { shown: 'done', scanned: 'done', ready: 'done' };
    default:
      return { shown: 'todo', scanned: 'todo', ready: 'todo' };
  }
}

/**
 * Which outcome the last step shows when an attempt ends badly: a message key under `whatsapp-devices-baileys.result`.
 * Reasons never read "banned" (spec 6.4): we cannot tell a ban from an unlink.
 */
export function failureKind(
  phase: PairingPhase,
  state: string | undefined,
  reason: string | null | undefined,
):
  | 'timedOut'
  | 'phoneOffline'
  | 'loggedOut'
  | 'replaced'
  | 'mismatch'
  | 'limit'
  | 'proxy'
  | 'service'
  | 'failed' {
  if (phase === 'expired') return 'timedOut';
  if (state === 'logged_out') return 'loggedOut';
  switch (reason) {
    case 'qr_timeout':
      return 'timedOut';
    case 'worker_silent':
      return 'phoneOffline';
    case 'unlinked_on_phone':
    case 'forbidden':
      return 'loggedOut';
    case 'session_conflict':
      return 'replaced';
    case 'mismatch':
      return 'mismatch';
    case 'device_limit_reached':
      return 'limit';
    case 'proxy_unreachable':
      return 'proxy';
    case 'worker_unavailable':
      return 'service';
    default:
      return 'failed';
  }
}

/** Seconds as `m:ss` for the "expires in" lines. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Seconds a pairing code has left: its own validity counted from when this page got it. `null` when the server gave none. */
export function codeSecondsLeft(
  codeExpiresIn: number | null | undefined,
  receivedAt: number,
  now: number,
): number | null {
  if (codeExpiresIn == null) return null;
  return Math.max(0, Math.ceil(codeExpiresIn - (now - receivedAt) / 1000));
}
