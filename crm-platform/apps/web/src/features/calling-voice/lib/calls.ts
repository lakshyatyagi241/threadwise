import { CALL_ERROR_CODES, ERROR_CODES, type PendingCall } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** Pure helpers of the calling screens and the call peer: timer text, end reasons, error mapping, ICE servers. */

// --- timer and labels (WD-CALL-018, 012) ------------------------------------------------------------------------------

/** `M:SS` of the seconds that went by since `startedAt`; empty before the call connects. */
export function elapsedText(startedAt: number | null, now: number): string {
  if (startedAt === null) return '';
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

export const digitsOf = (phone: string | null | undefined): string =>
  (phone ?? '').replace(/\D+/g, '');

/** Incoming toast name: the contact's name, else "Caller +<digits>" (the label is translated by the caller). */
export const callerName = (call: Pick<PendingCall, 'contactName'>): string | null =>
  call.contactName?.trim() || null;

/** The call the toast shows: the freshest ringing inbound call that this tab has not answered or declined yet. */
export function freshestRinging(
  calls: readonly PendingCall[],
  handled: ReadonlySet<string> = new Set(),
): PendingCall | null {
  const ringing = calls.filter((c) => c.direction === 'USER_INITIATED' && !handled.has(c.id));
  const at = (c: PendingCall) => (c.startedAt ? Date.parse(c.startedAt) || 0 : 0);
  return ringing.reduce<PendingCall | null>(
    (best, c) => (best === null || at(c) > at(best) ? c : best),
    null,
  );
}

// --- text the peer raises (English default; the screens translate by `kind`) ---------------------------------------------

export const END_REASONS = ['REJECTED', 'BUSY', 'NO_ANSWER', 'MISSED', 'CANCELLED'] as const;
export type EndReason = (typeof END_REASONS)[number];

/** WD-CALL-009 rule 7: what the dialling operator is told when the call ends before it connects. */
export const END_REASON_TEXT: Record<EndReason, string> = {
  REJECTED: 'The customer declined the call.',
  BUSY: 'The customer is on another call.',
  NO_ANSWER: 'No answer - the customer did not pick up.',
  MISSED: 'The customer missed the call.',
  CANCELLED: 'The call was cancelled.',
};

export function endReasonKind(reason: string | null | undefined): EndReason | null {
  const r = (reason ?? '').toUpperCase();
  return (END_REASONS as readonly string[]).includes(r) ? (r as EndReason) : null;
}

export const CALL_FAILURE_KINDS = [
  ...END_REASONS,
  'MIC_BLOCKED',
  'BUSY_SLOT',
  'INVALID_SDP',
  'LOCAL_SDP_EMPTY',
  'ENDED_EARLY',
  'ANSWER_FAILED',
] as const;
export type CallFailureKind = (typeof CALL_FAILURE_KINDS)[number];

/** The exact wording of WaDesk (WD-CALL-007, 009). `ANSWER_FAILED` carries the browser's own reason after a colon. */
export const CALL_FAILURE_TEXT: Record<CallFailureKind, string> = {
  ...END_REASON_TEXT,
  MIC_BLOCKED:
    'Microphone access blocked - the caller will not hear you. Grant mic permission in your browser and retry.',
  BUSY_SLOT: 'Another call is already active in this tab.',
  INVALID_SDP: 'Invalid SDP offer - missing v=0 or media line',
  LOCAL_SDP_EMPTY: 'Local SDP empty - ICE gathering failed',
  ENDED_EARLY: 'Call ended before it connected.',
  ANSWER_FAILED: 'Failed to apply WhatsApp answer',
};

/** A failure of the call itself (not a failed request): carries a stable `kind` and the default English text. */
export class CallError extends Error {
  constructor(
    readonly kind: CallFailureKind,
    readonly detail?: string,
  ) {
    super(detail ? `${CALL_FAILURE_TEXT[kind]}: ${detail}` : CALL_FAILURE_TEXT[kind]);
    this.name = 'CallError';
  }
}

/** The text of an end reason, with "Call ended before it connected." for an unknown or missing one. */
export function endReasonText(reason: string | null | undefined): string {
  const kind = endReasonKind(reason);
  return kind ? END_REASON_TEXT[kind] : CALL_FAILURE_TEXT.ENDED_EARLY;
}

// --- request errors (WD-CALL-007, 013, 004, 005) ----------------------------------------------------------------------------

export const CALL_ERROR_KEYS = [
  ...Object.values(CALL_ERROR_CODES),
  'FORBIDDEN',
  'PLAN_FEATURE_LOCKED',
  'NETWORK',
  'UNEXPECTED',
] as const;
export type CallErrorKey = (typeof CALL_ERROR_KEYS)[number];

/** Stable key of a failed request, chosen by the error `code` (never by its text). */
export function callErrorKey(error: unknown): CallErrorKey {
  if (!(error instanceof ApiError)) return 'NETWORK';
  if (error.code === ERROR_CODES.FORBIDDEN) return 'FORBIDDEN';
  if (error.code === ERROR_CODES.PLAN_FEATURE_LOCKED) return 'PLAN_FEATURE_LOCKED';
  const known = Object.values(CALL_ERROR_CODES) as string[];
  return known.includes(error.code) ? (error.code as CallErrorKey) : 'UNEXPECTED';
}

/**
 * Errors whose server text is already worded for a person (Meta's reason, the coexistence and prerequisite guidance): shown in
 * full instead of a fixed translation.
 */
const SERVER_WORDED: ReadonlySet<CallErrorKey> = new Set([
  CALL_ERROR_CODES.CALL_META_REFUSED,
  CALL_ERROR_CODES.CALL_COEXISTENCE_UNSUPPORTED,
]);

export function serverWorded(error: unknown): string | null {
  return error instanceof ApiError && SERVER_WORDED.has(callErrorKey(error)) && error.message.trim()
    ? error.message
    : null;
}

export const isPermissionRequested = (error: unknown): boolean =>
  error instanceof ApiError && error.code === CALL_ERROR_CODES.CALL_PERMISSION_REQUESTED;

/** Another teammate took the call first (HTTP 409): not a failure, nothing to reject. */
export const isStateConflict = (error: unknown): boolean =>
  error instanceof ApiError &&
  (error.status === 409 || error.code === CALL_ERROR_CODES.CALL_STATE_CONFLICT);

// --- ICE servers (WD-CALL-009 rule 1) -----------------------------------------------------------------------------------

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

function validServer(v: unknown): RTCIceServer | null {
  if (typeof v !== 'object' || v === null) return null;
  const { urls, username, credential } = v as Record<string, unknown>;
  const list = typeof urls === 'string' ? [urls] : Array.isArray(urls) ? urls : [];
  if (
    list.length === 0 ||
    !list.every((u) => typeof u === 'string' && /^(stun|turn|turns):/i.test(u))
  )
    return null;
  const server: RTCIceServer = { urls: typeof urls === 'string' ? urls : (urls as string[]) };
  if (typeof username === 'string') server.username = username;
  if (typeof credential === 'string') server.credential = credential;
  return server;
}

/** ICE servers from a settings value (a list, or its JSON text): bad entries are dropped; nothing usable gives the four public STUN servers. */
export function parseIceServers(value: unknown): RTCIceServer[] {
  let list: unknown = value;
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value);
    } catch {
      list = null;
    }
  }
  const servers = Array.isArray(list)
    ? list.flatMap((v) => {
        const s = validServer(v);
        return s ? [s] : [];
      })
    : [];
  return servers.length > 0 ? servers : DEFAULT_ICE_SERVERS;
}
