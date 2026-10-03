import { CALL_PERMISSION_DEFAULT_DAYS, type CallPermissionStatus } from '@crm/contracts';

/** Digits of a phone as Meta writes it (no plus, no spaces): the key of every lookup by number. */
export const digitsOf = (v: unknown): string => String(v ?? '').replace(/\D+/g, '');

/** The forms a number may have been stored in, for a lookup that has to match older rows (WD-CALL-008 rule 1). */
export const phoneForms = (v: unknown): string[] => {
  const raw = String(v ?? '').trim();
  const d = digitsOf(raw);
  return [...new Set([raw, d, `+${d}`].filter((x) => x !== '' && x !== '+'))];
};

export interface PermissionRow {
  status: CallPermissionStatus;
  expiresAt: Date | null;
}

/** A grant that is not past its expiry: the only kind that lets a call be placed (WD-CALL-006 rule 2). */
export function isUsable(row: PermissionRow | null | undefined, now: Date = new Date()): boolean {
  if (!row || row.status !== 'granted') return false;
  return row.expiresAt === null || row.expiresAt.getTime() > now.getTime();
}

/**
 * What the screens are told about a permission (WD-CALL-006, with its quirk fixed): a grant that has run out is `expired`, not
 * `granted`. WaDesk handed the raw column back, so a lapsed grant read as `granted` while the server refused to dial on it.
 */
export function permissionLabel(
  row: PermissionRow | null | undefined,
  now: Date = new Date(),
): CallPermissionStatus | null {
  if (!row) return null;
  if (row.status === 'granted') return isUsable(row, now) ? 'granted' : 'expired';
  return row.status;
}

/** Meta's epoch seconds (a string or a number) as a date; null when it is not one. */
export function metaTime(v: unknown): Date | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000);
}

/**
 * The customer's answer to a call-permission request (WD-CALL-006 rule 1). `accept` grants until Meta's expiry (a week when Meta sends
 * none); anything else is a decline with no dates.
 */
export function permissionFromUpdate(
  response: unknown,
  expirationTimestamp: unknown,
  now: Date = new Date(),
): { status: CallPermissionStatus; grantedAt: Date | null; expiresAt: Date | null } {
  if (String(response ?? '').toLowerCase() !== 'accept') {
    return { status: 'declined', grantedAt: null, expiresAt: null };
  }
  return {
    status: 'granted',
    grantedAt: now,
    expiresAt:
      metaTime(expirationTimestamp) ??
      new Date(now.getTime() + CALL_PERMISSION_DEFAULT_DAYS * 86_400_000),
  };
}

/** A number that shares its line with the WhatsApp Business app takes no calls (WD-CALL-004 rule 3). */
export function isCoexistenceNumber(meta: Record<string, unknown> | null | undefined): boolean {
  if (!meta) return false;
  if (meta.coexistence === true) return true;
  const t = String(meta.platform_type ?? '').toUpperCase();
  return t === 'COEXISTENCE' || t === 'SMB_APP';
}

export const COEXISTENCE_MESSAGE =
  'WhatsApp calling needs a number that is fully onboarded to the Cloud API. This number shares its line with the WhatsApp Business app (coexistence), which Meta does not allow calls on. Register it on the Cloud API only, or use another number.';

export const PREREQUISITE_MESSAGE =
  'Meta will not switch calling on yet. The number needs a daily messaging limit of at least 2,000 unique customers, and the app must be subscribed to the WhatsApp Business Account and to the "calls" webhook field with the whatsapp_business_messaging permission. A test number does not need the limit.';

/**
 * Meta's refusal to switch calling on or off, in words a person can act on (WD-CALL-004 rules 4 to 6). 141000 means the number is not a
 * Cloud API number; a message that names a prerequisite gets the long guidance.
 */
export function toggleRefusal(code: number | null, message: string, status: number): string {
  if (code === 141000) return COEXISTENCE_MESSAGE;
  if (/pre-?requisite/i.test(message)) return PREREQUISITE_MESSAGE;
  return `Meta refused the call toggle (${status}): ${message}`;
}

/** Meta says the business may already call this person: not a failure (code 138017, WD-CALL-005 rule 2). */
export const isAlreadyPermitted = (code: number | null): boolean => code === 138017;

/** A refusal that means "ask for permission first" (WD-CALL-008 rule 3). */
export const isPermissionRefusal = (message: string): boolean => /permission/i.test(message);

export const DEFAULT_PERMISSION_QUESTION = 'Can we give you a quick call?';

/** "N s", "M min", "M min S s" (WD-CALL-017). */
export function humanDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m} min` : `${m} min ${r} s`;
}

export type CallBubbleStatus = 'answered' | 'missed' | 'no_answer' | 'declined';

/**
 * How a finished call reads in the customer's thread (WD-CALL-017 rules 2 and 4): answered when it had a duration; otherwise declined
 * when it ended DECLINED or REJECTED; otherwise no answer for a call we placed, missed for one the customer placed.
 */
export function callBubble(input: {
  durationSec: number;
  endReason: string | null;
  direction: 'USER_INITIATED' | 'BUSINESS_INITIATED';
}): { label: string; callStatus: CallBubbleStatus; side: 'in' | 'out' } {
  const outbound = input.direction === 'BUSINESS_INITIATED';
  const side = outbound ? 'out' : 'in';
  if (input.durationSec > 0) {
    return {
      label: `Voice call - ${humanDuration(input.durationSec)}`,
      callStatus: 'answered',
      side,
    };
  }
  const reason = String(input.endReason ?? '').toUpperCase();
  if (reason === 'DECLINED' || reason === 'REJECTED') {
    return { label: 'Voice call declined', callStatus: 'declined', side };
  }
  return outbound
    ? { label: 'Voice call - no answer', callStatus: 'no_answer', side }
    : { label: 'Missed voice call', callStatus: 'missed', side };
}

/** The words for why a call we placed ended before it connected (WD-CALL-009 rule 7); the browser shows them. */
export const END_REASON_TEXT: Readonly<Record<string, string>> = {
  REJECTED: 'The customer declined the call.',
  DECLINED: 'The customer declined the call.',
  BUSY: 'The customer is on another call.',
  NO_ANSWER: 'The customer did not pick up.',
  MISSED: 'The customer missed the call.',
  CANCELLED: 'The call was cancelled.',
};

/** Whether an SDP is something a peer can use: long enough, and an offer is never handed back as an answer (WD-CALL-010 rule 1). */
export function usableAnswer(sdpType: unknown, sdp: unknown): string | null {
  const text = typeof sdp === 'string' ? sdp : '';
  if (text.length === 0) return null;
  return String(sdpType ?? '').toLowerCase() === 'offer' ? null : text;
}
