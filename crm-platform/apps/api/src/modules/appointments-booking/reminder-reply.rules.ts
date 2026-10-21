import type { AppointmentStatus } from '@crm/contracts';
import type { ReplyAction } from './appointment-reminders.repository';

/**
 * The customer's quick reply to a reminder (BL-426), as pure rules: the token on a button, what a tap means, and the words that answer
 * it. No database and no clock of its own, so the security rules (one use, bound to a person, expiring) are unit tests.
 *
 * The token is the encrypted, authenticated pair of the run and a random nonce the run remembers (`appointment_reminder_runs.reply_state`):
 * it cannot be forged or edited, it is bound to one booking step and one button, and it is used once. A second tap of the same button is
 * answered again with the same words and does nothing twice (idempotent). It is also bound to the person: the tap must arrive in the
 * thread of the contact the booking belongs to, so a forwarded button does nothing.
 */

export const REPLY_PREFIX = 'ap1:';
/** A quick-reply payload is at most 256 characters on WhatsApp. */
export const REPLY_PAYLOAD_MAX = 256;
export const REPLY_ACTIONS: readonly ReplyAction[] = ['confirm', 'reschedule', 'cancel'];

export interface ReplyToken {
  /** The workspace. */
  o: number;
  /** The run (this step of this booking). */
  r: number;
  a: ReplyAction;
  n: string;
}

export function sealReplyToken(seal: (plain: string) => string, t: ReplyToken): string {
  return `${REPLY_PREFIX}${seal(JSON.stringify(t))}`;
}

/** The token a button payload carries, or null when it is not ours or has been tampered with. */
export function openReplyToken(open: (cipher: string) => string, payload: string): ReplyToken | null {
  if (!payload.startsWith(REPLY_PREFIX)) return null;
  try {
    const t = JSON.parse(open(payload.slice(REPLY_PREFIX.length))) as Partial<ReplyToken>;
    if (
      typeof t.o !== 'number' ||
      typeof t.r !== 'number' ||
      typeof t.n !== 'string' ||
      !REPLY_ACTIONS.includes(t.a as ReplyAction)
    ) {
      return null;
    }
    return { o: t.o, r: t.r, a: t.a as ReplyAction, n: t.n };
  } catch {
    return null;
  }
}

export type ReplyOutcome =
  | 'confirmed'
  | 'already_confirmed'
  | 'cancelled'
  | 'already_cancelled'
  | 'reschedule_link'
  | 'expired'
  | 'not_available';

export type ReplyEffect = 'none' | 'confirm' | 'cancel';

export interface ReplyFacts {
  action: ReplyAction;
  /** The tap arrived in the thread of the contact the booking belongs to. */
  sameContact: boolean;
  /** The outcome stored when this very button was used before; null = not used yet. */
  usedOutcome: ReplyOutcome | null;
  status: AppointmentStatus;
  startsAtMs: number;
  nowMs: number;
  customerConfirmed: boolean;
}

export type ReplyDecision =
  | { kind: 'ignore' }
  | { kind: 'repeat'; outcome: ReplyOutcome }
  | { kind: 'act'; outcome: ReplyOutcome; effect: ReplyEffect; remember: boolean };

/**
 * What a tap does. Order matters: a person who is not the booking's contact is ignored before anything else is revealed; a button
 * that was used is answered again without acting; a booking that is over, closed or not active cannot be changed from a button.
 */
export function decideReply(f: ReplyFacts): ReplyDecision {
  if (!f.sameContact) return { kind: 'ignore' };
  if (f.usedOutcome !== null) return { kind: 'repeat', outcome: f.usedOutcome };
  if (f.status === 'cancelled') {
    return {
      kind: 'act',
      outcome: f.action === 'cancel' ? 'already_cancelled' : 'not_available',
      effect: 'none',
      remember: false,
    };
  }
  if (f.status !== 'confirmed' && f.status !== 'pending') {
    return { kind: 'act', outcome: 'not_available', effect: 'none', remember: false };
  }
  // At or after the start nothing can be changed from a reminder.
  if (f.nowMs >= f.startsAtMs) return { kind: 'act', outcome: 'expired', effect: 'none', remember: false };
  switch (f.action) {
    case 'confirm':
      return f.customerConfirmed
        ? { kind: 'act', outcome: 'already_confirmed', effect: 'none', remember: true }
        : { kind: 'act', outcome: 'confirmed', effect: 'confirm', remember: true };
    case 'cancel':
      return { kind: 'act', outcome: 'cancelled', effect: 'cancel', remember: true };
    default:
      return { kind: 'act', outcome: 'reschedule_link', effect: 'none', remember: true };
  }
}

/** The words of the answer. English or Hindi (a machine draft, like the pack); other languages read the English. */
export function replyText(
  outcome: ReplyOutcome,
  language: string | null,
  v: { date: string; time: string; manageLink: string | null },
): string {
  const hi = (language ?? '').toLowerCase().startsWith('hi');
  switch (outcome) {
    case 'confirmed':
    case 'already_confirmed':
      return hi
        ? `धन्यवाद, ${v.date} को ${v.time} बजे का आपका अपॉइंटमेंट पक्का है।`
        : `Thank you, your appointment on ${v.date} at ${v.time} is confirmed.`;
    case 'cancelled':
      return hi
        ? `${v.date} को ${v.time} बजे का आपका अपॉइंटमेंट रद्द कर दिया गया है।`
        : `Your appointment on ${v.date} at ${v.time} has been cancelled.`;
    case 'already_cancelled':
      return hi ? 'यह अपॉइंटमेंट पहले ही रद्द हो चुका है।' : 'This appointment was already cancelled.';
    case 'reschedule_link':
      return v.manageLink
        ? hi
          ? `नया समय चुनने के लिए यहाँ जाएँ: ${v.manageLink}`
          : `You can choose a new time here: ${v.manageLink}`
        : hi
          ? 'नया समय चुनने के लिए कृपया हमें यहाँ संदेश भेजें।'
          : 'To choose a new time, please send us a message here.';
    case 'expired':
      return hi ? 'यह रिमाइंडर अब सक्रिय नहीं है।' : 'This reminder is no longer active.';
    default:
      return hi
        ? 'इस अपॉइंटमेंट को यहाँ से अब बदला नहीं जा सकता।'
        : 'This appointment can no longer be changed from here.';
  }
}
