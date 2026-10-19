import {
  ERROR_CODES,
  type LeadFirstReplyReason,
  type LeadFirstReplyStatus,
  type SpeedToLeadChannel,
} from '@crm/contracts';
import { isOutsideBusinessHours } from '../../common/business-hours';

/**
 * The pure rules of the automatic first message (BL-014, spec L-16): when it is due, when business hours open, what a refusal means.
 * No database, no clock of its own: every function takes the instant, so the truth table is a unit test.
 */

/** A held message that has not gone within a day is dropped (`failed / expired`): a "speed to lead" message a day late is not one. */
export const FIRST_REPLY_EXPIRY_MS = 24 * 3_600_000;
/** How long a message waits when the channel, the wallet or the emergency halt stops it, before it asks again. */
export const FIRST_REPLY_RETRY_MS = 10 * 60_000;
/** A worker's claim older than this was abandoned by a process that died. */
export const FIRST_REPLY_STALE_CLAIM_MS = 10 * 60_000;
/** A claim that keeps being abandoned or retried is given up after this many tries. */
export const FIRST_REPLY_MAX_ATTEMPTS = 5;

export const dueAtOf = (now: Date, delayMinutes: number): Date =>
  new Date(now.getTime() + delayMinutes * 60_000);

/**
 * Whether a lead is too old for an automatic first message: it was submitted at the provider more than `maxAgeMinutes` before the moment
 * the pipeline scheduled its message. The age is taken at scheduling, not at sending, so the source's own delay (up to an hour) and a
 * hold for business hours never make a fresh lead "old". A lead whose submission time is in the future (a skewed provider clock) is fresh.
 */
export function isLeadTooOld(
  leadReceivedAt: Date,
  scheduledAt: Date,
  maxAgeMinutes: number,
): boolean {
  return scheduledAt.getTime() - leadReceivedAt.getTime() > maxAgeMinutes * 60_000;
}

const STEP_MS = 15 * 60_000;
const LOOKAHEAD_STEPS = 8 * 24 * 4;

/**
 * The first instant (to the quarter hour) at or after `at` when the workspace is open, or null when the hours never open within eight
 * days (every day switched off): the caller then sends nothing and says so rather than waiting forever. `at` itself when it is open.
 */
export function nextBusinessOpening(hours: unknown, timeZone: string, at: Date): Date | null {
  if (!isOutsideBusinessHours(hours, timeZone, at)) return at;
  // Walk to the next quarter-hour boundary first so the answer is a tidy "09:00", then step.
  const start = Math.ceil(at.getTime() / STEP_MS) * STEP_MS;
  for (let i = 0; i < LOOKAHEAD_STEPS; i++) {
    const t = new Date(start + i * STEP_MS);
    if (!isOutsideBusinessHours(hours, timeZone, t)) return t;
  }
  return null;
}

/** What a refusal from the dispatcher means for this lead's message. `held` ones are asked again later, the others are final. */
export interface Verdict {
  status: Extract<LeadFirstReplyStatus, 'held' | 'blocked' | 'skipped' | 'failed'>;
  reason: LeadFirstReplyReason;
}

/** An `AppError` code from the conversation core, the consent gate, the plan or the wallet, as a verdict; null for a code we do not know. */
export function verdictOfCode(code: string): Verdict | null {
  switch (code) {
    case ERROR_CODES.CONSENT_OPTED_OUT:
      return { status: 'blocked', reason: 'opted_out' };
    case ERROR_CODES.CONSENT_SEND_DENIED:
      return { status: 'blocked', reason: 'no_consent' };
    case ERROR_CODES.PLAN_LIMIT_REACHED:
    case ERROR_CODES.PLAN_FEATURE_LOCKED:
      return { status: 'blocked', reason: 'plan_limit' };
    case ERROR_CODES.WALLET_EMPTY:
      return { status: 'held', reason: 'wallet_empty' };
    case ERROR_CODES.AUTH_SEND_HALTED:
      return { status: 'held', reason: 'send_halted' };
    case ERROR_CODES.CHANNEL_DISCONNECTED:
      return { status: 'held', reason: 'channel_unavailable' };
    case ERROR_CODES.CHANNEL_CAPABILITY_UNSUPPORTED:
      return { status: 'skipped', reason: 'template_unavailable' };
    default:
      return null;
  }
}

/** The ConsentGate's `deny` reason as a verdict. A withdrawal, a minor and "no recorded grant" are different sentences for the reader. */
export function verdictOfDenial(reason: string): Verdict {
  if (reason === 'withdrawn') return { status: 'blocked', reason: 'opted_out' };
  if (reason === 'subject_minor') return { status: 'blocked', reason: 'minor' };
  return { status: 'blocked', reason: 'no_consent' };
}

/** The ConsentGate's channel for each speed-to-lead channel (WhatsApp Cloud is the only WhatsApp channel a template goes through). */
export const CONSENT_CHANNEL: Record<SpeedToLeadChannel, string> = {
  whatsapp: 'whatsapp_cloud',
  sms: 'sms',
  email: 'email',
};

/** Words on the contact's timeline, in English like every activity title the system writes. Never a template text or an address. */
const CHANNEL_NAME: Record<SpeedToLeadChannel, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'email',
};

const REASON_TEXT: Record<LeadFirstReplyReason, string> = {
  quiet_hours: 'quiet hours',
  outside_business_hours: 'outside business hours',
  channel_unavailable: 'the channel is not connected',
  opted_out: 'the contact opted out',
  no_consent: 'no recorded consent',
  minor: 'the contact is flagged as a minor',
  plan_limit: "the plan's limit is reached",
  wallet_empty: 'the wallet is empty',
  send_halted: 'sending is halted',
  disabled: 'the setting was switched off',
  source_paused: 'the lead source is paused',
  no_contact_point: 'the contact has no number or address for this channel',
  no_sender: 'no connected sender',
  template_unavailable: 'the template cannot be sent',
  missing_value: 'a template value is missing for this contact',
  lead_too_old: 'the lead is older than the setting allows',
  provider_error: 'the provider refused it',
  interrupted: 'it was interrupted',
  expired: 'it waited too long',
  internal_error: 'an internal error',
};

export const reasonText = (reason: string | null): string =>
  reason && reason in REASON_TEXT ? REASON_TEXT[reason as LeadFirstReplyReason] : 'unknown reason';

/** The timeline entry of one outcome: a title and a short body. `until` is when a held message may go. */
export function timelineEntry(
  status: LeadFirstReplyStatus,
  channel: SpeedToLeadChannel,
  reason: string | null,
  until?: Date,
): { title: string; body: string | null } {
  const name = CHANNEL_NAME[channel];
  switch (status) {
    case 'sent':
      return { title: `First message sent by ${name}`, body: null };
    case 'held':
      return {
        title: `First message by ${name} held`,
        body: `Waiting: ${reasonText(reason)}${until ? `. Next try ${until.toISOString()}` : ''}`,
      };
    case 'blocked':
      return {
        title: `First message by ${name} not sent`,
        body: `Blocked: ${reasonText(reason)}`,
      };
    case 'skipped':
      return {
        title: `First message by ${name} skipped`,
        body: `Skipped: ${reasonText(reason)}`,
      };
    case 'failed':
      return { title: `First message by ${name} failed`, body: `Failed: ${reasonText(reason)}` };
    default:
      return { title: `First message by ${name} scheduled`, body: null };
  }
}

/** The facts of a stored WhatsApp template the send rules look at. */
export interface TemplateFacts {
  status: string;
  metaStatus: string | null;
  pausedUntil: Date | null;
  templateType: string;
  attachmentType: string | null;
  header: string | null;
  parameterFormat: string;
  buttons: unknown;
  /** The `{{tokens}}` of the header; empty when none. */
  headerTokens: string[];
  /** The tokens in the URL of each button. */
  buttonUrlTokens: string[][];
}

/**
 * Why an approved template cannot be the first message, or null. A first message fills the body's variables from the contact and
 * nothing else; a template that also needs a file, a variable in its header or in a button link has nothing to take that from, so it is
 * refused with a reason rather than sent half built (Meta would refuse it with 132000 or 132012 and nobody would see why).
 */
export function templateProblem(t: TemplateFacts, now: Date): string | null {
  if (t.status !== 'approved' && t.status !== 'public') return 'not_approved';
  if (t.metaStatus !== null && t.metaStatus !== 'APPROVED') return 'not_approved';
  if (t.pausedUntil && t.pausedUntil.getTime() > now.getTime()) return 'paused';
  if (t.templateType === 'auth') return 'authentication';
  if (t.parameterFormat === 'NAMED') return 'named_variables';
  if ((t.attachmentType ?? 'none') !== 'none') return 'media_header';
  if (t.headerTokens.length > 0) return 'header_variable';
  if (t.buttonUrlTokens.some((tokens) => tokens.length > 0)) return 'dynamic_button';
  return null;
}
