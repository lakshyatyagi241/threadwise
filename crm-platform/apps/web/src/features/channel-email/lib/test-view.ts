import type { MailTestReason, MailTestSide } from '@crm/contracts';
import { ERROR_CODES } from '@crm/contracts';

/** One side of a test as the screen words it: ok (with the INBOX count for IMAP), or the failure reason (a key under `email.imap.test.reasons`). */
export type SideView =
  { ok: true; inboxMessages: number | null } | { ok: false; reason: MailTestReason };

export const sideView = (s: MailTestSide): SideView =>
  s.ok
    ? { ok: true, inboxMessages: s.inboxMessages }
    : { ok: false, reason: s.reason ?? 'unknown' };

/** A refused run (rate limit) is its own message; everything else that is not a test result is the generic one. */
export const testErrorKey = (code: string): 'tooMany' | 'failed' =>
  code === ERROR_CODES.MAIL_RATE_LIMITED ? 'tooMany' : 'failed';

/** How far behind a mailbox is, in the unit a person reads: under a minute, minutes, or hours. */
export function lagView(
  seconds: number | null | undefined,
): { key: 'lagUnderMinute' } | { key: 'lagMinutes' | 'lagHours'; count: number } | null {
  if (seconds === null || seconds === undefined) return null;
  if (seconds < 60) return { key: 'lagUnderMinute' };
  if (seconds < 3_600) return { key: 'lagMinutes', count: Math.floor(seconds / 60) };
  return { key: 'lagHours', count: Math.floor(seconds / 3_600) };
}

/** A delay worth warning about: a sync runs about every minute, so more than ten minutes behind on a connected mailbox is a problem. */
export const lagIsHigh = (seconds: number | null | undefined): boolean =>
  seconds !== null && seconds !== undefined && seconds > 600;
