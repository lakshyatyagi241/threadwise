import {
  ERROR_CODES,
  type AppointmentStatus,
  type BookingReminderChannel,
  type BookingReminderKind,
  type BookingReminderRecordChannel,
  type BookingReminderStepKind,
} from '@crm/contracts';

/**
 * The pure rules of appointment reminders and follow-ups (BL-283): when a run is due, whether it still should go, what a refusal
 * means, what is written on the timeline. No database and no clock of its own: every function takes the instant, so the truth table
 * is a unit test.
 */

/** How long a held run waits when the channel, the wallet or the emergency halt stops it, before it asks again. */
export const REMINDER_RETRY_MS = 10 * 60_000;
/** A claim older than this was abandoned by a worker that died. */
export const REMINDER_STALE_LOCK_MS = 10 * 60_000;
/** A run that keeps being held is given up after this many tries. */
export const REMINDER_MAX_ATTEMPTS = 12;
/** A follow-up that could not go within a day of its time is dropped: "how was your visit" two days late is not one. */
export const FOLLOW_UP_GRACE_MS = 24 * 3_600_000;
/** A before-reminder is never sent in the last minutes before the start: it would arrive as the person walks in. */
export const REMINDER_MIN_LEAD_MS = 2 * 60_000;

/** What became of a run. `held` and `pending` are not final: the run is looked at again. */
export type RunStatus =
  'pending' | 'sending' | 'held' | 'sent' | 'skipped' | 'failed' | 'cancelled';

/** Stable codes stored on a run and shown (translated) next to it. Never a message, a number or an address. */
export const REMINDER_REASONS = [
  // cancelled: the run no longer applies
  'rule_removed',
  'rule_off',
  'rescheduled',
  'booking_cancelled',
  'booking_declined',
  'booking_no_show',
  'booking_not_confirmed',
  // skipped: it cannot go and will not
  'started',
  'expired',
  // the step's own skip rules
  'already_confirmed',
  'no_join_link',
  'already_rebooked',
  'visit_not_completed',
  'no_contact_point',
  'no_channel',
  'no_sender',
  // the workspace owner has not switched this channel on for appointment messages (BL-350)
  'channel_disabled',
  'template_required',
  'template_unavailable',
  'quiet_hours_too_late',
  'no_consent',
  'opted_out',
  'do_not_call',
  'minor',
  'processing_restricted',
  'plan_limit',
  // held: it goes by itself later
  'quiet_hours',
  'channel_unavailable',
  'wallet_empty',
  'send_halted',
  // used only in a step's channel log: why the next channel was used
  'not_delivered',
  'send_failed',
  // failed
  'provider_error',
  'interrupted',
  'internal_error',
] as const;
export type ReminderReason = (typeof REMINDER_REASONS)[number];

/** Where a rule's time lands: before the start, or after the end. */
export function dueAtOf(
  kind: BookingReminderKind,
  startsAt: Date,
  endsAt: Date,
  offsetMinutes: number,
): Date {
  if (kind === 'event') return startsAt;
  return kind === 'before'
    ? new Date(startsAt.getTime() - offsetMinutes * 60_000)
    : new Date(endsAt.getTime() + offsetMinutes * 60_000);
}


export interface RunFacts {
  runStatus: RunStatus;
  kind: BookingReminderKind;
  /** The step of the sequence (null for a rule saved before steps existed: it is read from its kind). */
  stepKind: BookingReminderStepKind | null;
  /** The rule as it is now; null when it was deleted since the claim. */
  rule: { isActive: boolean; skipIfConfirmed: boolean } | null;
  /** The booking's arming when the run was claimed, and now. A reschedule moves it. */
  runArmedAtMs: number;
  bookingArmedAtMs: number;
  bookingStatus: AppointmentStatus;
  startsAtMs: number;
  dueAtMs: number;
  nowMs: number;
  /** The customer tapped Confirm on a reminder. */
  customerConfirmed?: boolean;
  /** The visit is online and has a link that opens it (the 15 minute reminder needs one). */
  hasJoinLink?: boolean;
}

export type Gate =
  { go: true } | { go: false; status: 'cancelled' | 'skipped'; reason: ReminderReason };

/** A rebook (recall) message may be a day late; a long wait is its whole point. */
export const REBOOK_GRACE_MS = 24 * 3_600_000;

/**
 * Whether a claimed run should still go out, decided at delivery from the booking and the rule as they are now (a cancel, a decline, a
 * reschedule or a switched-off rule between the claim and the send must stop it). The skip rules of a step live here:
 *
 *  - a cancelled, declined or moved booking stops every step (a cancelled booking never gets a reminder);
 *  - a reminder is never sent at or after the start; the after-visit, no-show and rebook steps are the ones that come after it;
 *  - the 15 minute reminder needs an online visit with a join link, the 2 hour reminder can skip itself once the customer confirmed;
 *  - a rebook only follows a visit that was marked completed.
 */
export function gateRun(f: RunFacts): Gate {
  if (f.rule === null) return { go: false, status: 'cancelled', reason: 'rule_removed' };
  if (!f.rule.isActive) return { go: false, status: 'cancelled', reason: 'rule_off' };
  if (f.runArmedAtMs !== f.bookingArmedAtMs) {
    return { go: false, status: 'cancelled', reason: 'rescheduled' };
  }
  const step = f.stepKind;
  if (f.kind === 'event') {
    if (step === 'no_show') {
      return f.bookingStatus === 'no_show'
        ? { go: true }
        : { go: false, status: 'cancelled', reason: 'booking_not_confirmed' };
    }
    // The confirmation: a booking that is confirmed and has not started.
    if (f.bookingStatus !== 'confirmed') return statusStop(f.bookingStatus);
    if (f.nowMs >= f.startsAtMs) return { go: false, status: 'skipped', reason: 'started' };
    return { go: true };
  }
  if (f.kind === 'before') {
    if (f.bookingStatus !== 'confirmed') return statusStop(f.bookingStatus);
    // Never after (or as) the booking starts.
    if (f.nowMs >= f.startsAtMs - REMINDER_MIN_LEAD_MS) {
      return { go: false, status: 'skipped', reason: 'started' };
    }
    if (step === 'reminder_15m' && !f.hasJoinLink) {
      return { go: false, status: 'skipped', reason: 'no_join_link' };
    }
    if (f.rule.skipIfConfirmed && f.customerConfirmed) {
      return { go: false, status: 'skipped', reason: 'already_confirmed' };
    }
    return { go: true };
  }
  if (step === 'rebook') {
    if (f.bookingStatus !== 'completed') {
      return f.bookingStatus === 'confirmed'
        ? { go: false, status: 'skipped', reason: 'visit_not_completed' }
        : statusStop(f.bookingStatus);
    }
    if (f.nowMs > f.dueAtMs + REBOOK_GRACE_MS) {
      return { go: false, status: 'skipped', reason: 'expired' };
    }
    return { go: true };
  }
  // The follow-up: after a visit that took place. A booking nobody closed (confirmed) still counts; a no-show or a cancel does not.
  if (f.bookingStatus !== 'confirmed' && f.bookingStatus !== 'completed') {
    return statusStop(f.bookingStatus);
  }
  if (f.nowMs > f.dueAtMs + FOLLOW_UP_GRACE_MS) {
    return { go: false, status: 'skipped', reason: 'expired' };
  }
  return { go: true };
}

function statusStop(status: AppointmentStatus): Gate {
  const reason: ReminderReason =
    status === 'cancelled'
      ? 'booking_cancelled'
      : status === 'declined'
        ? 'booking_declined'
        : status === 'no_show'
          ? 'booking_no_show'
          : 'booking_not_confirmed';
  return { go: false, status: 'cancelled', reason };
}

/** An outcome of trying one channel. */
export type ChannelOutcome =
  | { status: 'sent'; providerMessageId?: string | undefined }
  | { status: 'skipped'; reason: ReminderReason }
  | { status: 'held'; reason: ReminderReason; until?: string | undefined }
  | { status: 'failed'; reason: ReminderReason };

/**
 * An `AppError` code from the conversation core, the consent gate, the plan or the wallet, as an outcome; null for a code we do not
 * know (the caller then treats it as a provider failure, never as a guess about consent).
 */
export function outcomeOfCode(code: string): ChannelOutcome | null {
  switch (code) {
    case ERROR_CODES.CONSENT_OPTED_OUT:
      return { status: 'skipped', reason: 'opted_out' };
    case ERROR_CODES.CONSENT_SEND_DENIED:
      return { status: 'skipped', reason: 'no_consent' };
    case ERROR_CODES.PLAN_LIMIT_REACHED:
    case ERROR_CODES.PLAN_FEATURE_LOCKED:
      return { status: 'skipped', reason: 'plan_limit' };
    case ERROR_CODES.WALLET_EMPTY:
      return { status: 'held', reason: 'wallet_empty' };
    case ERROR_CODES.AUTH_SEND_HALTED:
      return { status: 'held', reason: 'send_halted' };
    case ERROR_CODES.CHANNEL_DISCONNECTED:
      return { status: 'held', reason: 'channel_unavailable' };
    case ERROR_CODES.SERVICE_WINDOW_CLOSED:
    case ERROR_CODES.TEMPLATE_NOT_APPROVED:
      return { status: 'skipped', reason: 'template_required' };
    case ERROR_CODES.CHANNEL_CAPABILITY_UNSUPPORTED:
      return { status: 'skipped', reason: 'template_unavailable' };
    default:
      return null;
  }
}

/** The ConsentGate's `deny` reason as a skip. A withdrawal, a number on the do-not-call list and a minor read differently. */
export function outcomeOfDenial(reason: string): ChannelOutcome {
  if (reason === 'withdrawn') return { status: 'skipped', reason: 'opted_out' };
  if (reason === 'subject_minor') return { status: 'skipped', reason: 'minor' };
  if (reason === 'on_dnc_list') return { status: 'skipped', reason: 'do_not_call' };
  if (reason === 'legal_hold') return { status: 'skipped', reason: 'processing_restricted' };
  return { status: 'skipped', reason: 'no_consent' };
}

export interface Settled {
  status: Extract<RunStatus, 'sent' | 'skipped' | 'failed' | 'held'>;
  reason: ReminderReason | null;
  channel: BookingReminderChannel | null;
  /** Held only: when to look again. */
  until?: Date;
}

/** One line of a step's channel log: which channel was tried and what came of it. Codes only. */
export interface AttemptEntry {
  channel: BookingReminderRecordChannel;
  status: 'sent' | 'skipped' | 'held' | 'failed';
  reason: ReminderReason | null;
}

/** The log of a pass over the channels, in the order they were tried. */
export function attemptLogOf(
  tried: ReadonlyArray<{ channel: BookingReminderChannel; outcome: ChannelOutcome }>,
): AttemptEntry[] {
  return tried.map(({ channel, outcome }) => ({
    channel,
    status: outcome.status,
    reason: outcome.status === 'sent' ? null : outcome.reason,
  }));
}

/**
 * Combines the per-channel outcomes of a step's ordered preference (the fallback rule). The first channel that SENT wins and is the only
 * one used: a fallback is for a channel that cannot deliver, never a second copy. A channel that is SKIPPED (no number, no consent, the
 * WhatsApp template not approved yet) or FAILED (the provider refused it) hands over to the next channel. A HELD channel (quiet hours, a
 * channel that is down) stops the run: the same preference is tried again later, so a customer is not moved to a worse channel because
 * of a short hold. When no channel delivered, a failure is reported as the failure, otherwise the run says why it was skipped,
 * preferring the most telling reason.
 */
export function settleChannels(
  tried: ReadonlyArray<{ channel: BookingReminderChannel; outcome: ChannelOutcome }>,
  now: Date,
  retryMs = REMINDER_RETRY_MS,
): Settled {
  for (const { channel, outcome } of tried) {
    if (outcome.status === 'sent') return { status: 'sent', reason: null, channel };
    if (outcome.status === 'held') {
      const until = outcome.until ? new Date(outcome.until) : new Date(now.getTime() + retryMs);
      return { status: 'held', reason: outcome.reason, channel, until };
    }
  }
  if (tried.length === 0) return { status: 'skipped', reason: 'no_channel', channel: null };
  const failed = tried.find((t) => t.outcome.status === 'failed');
  if (failed && failed.outcome.status === 'failed') {
    return { status: 'failed', reason: failed.outcome.reason, channel: failed.channel };
  }
  // Every channel was skipped: the most informative reason is the first channel's that is not "nothing to send to".
  const skips = tried.flatMap((t) => (t.outcome.status === 'skipped' ? [t.outcome.reason] : []));
  const reason =
    skips.find((r) => r !== 'no_contact_point' && r !== 'no_sender' && r !== 'channel_disabled') ??
    skips[0] ??
    'no_channel';
  return { status: 'skipped', reason, channel: null };
}

/** The country-code-free digits of a number, for the engines that take digits. */
export const digitsOf = (v: string | null | undefined): string => (v ?? '').replace(/\D/g, '');

/** WhatsApp refuses a body parameter with a line break, a tab or four spaces in a row (error 132018). */
const BAD_PARAMETER = /[\n\r\t]| {4,}/;

/** The order a WhatsApp template's numbered variables are filled in: {{1}} the name, {{2}} the service, and so on. */
export const WA_VARIABLE_ORDER = [
  'name',
  'type',
  'date',
  'time',
  'location',
  'join_link',
  'manage_link',
] as const;

/**
 * A WhatsApp template's body values, in the template's own order, from the booking's variables. A value with nothing to say becomes a
 * dash (Meta refuses an empty parameter), and one with a line break is flattened. More variables than the order has is a template this
 * cannot fill: null, the caller skips with `template_unavailable`.
 */
export function waTemplateValues(
  tokenCount: number,
  vars: Readonly<Record<string, string>>,
): string[] | null {
  if (tokenCount > WA_VARIABLE_ORDER.length) return null;
  return WA_VARIABLE_ORDER.slice(0, tokenCount).map((key) => {
    const v = (vars[key] ?? '').replace(/\s+/g, ' ').trim();
    return v === '' || BAD_PARAMETER.test(v) ? '-' : v;
  });
}

/** Why a stored WhatsApp template cannot carry a reminder, or null. Mirrors what the other automatic sends refuse. */
export function templateProblem(
  t: {
    status: string;
    metaStatus: string | null;
    pausedUntil: Date | null;
    templateType: string | null;
    attachmentType: string | null;
    parameterFormat: string | null;
    headerTokenCount: number;
    dynamicButtonCount: number;
  },
  now: Date,
): ReminderReason | null {
  if (t.status !== 'approved' && t.status !== 'public') return 'template_unavailable';
  if (t.metaStatus !== null && t.metaStatus !== 'APPROVED') return 'template_unavailable';
  if (t.pausedUntil && t.pausedUntil.getTime() > now.getTime()) return 'template_unavailable';
  if (t.templateType === 'auth') return 'template_unavailable';
  if (t.parameterFormat === 'NAMED') return 'template_unavailable';
  if ((t.attachmentType ?? 'none') !== 'none') return 'template_unavailable';
  if (t.headerTokenCount > 0 || t.dynamicButtonCount > 0) return 'template_unavailable';
  return null;
}

// --- the timeline -----------------------------------------------------------------------------------------------------------------

/** Names for the channels in a delivery record. `sms` stays for the old runs that carry it as history; `voice` is reserved. */
const CHANNEL_NAME: Record<BookingReminderRecordChannel, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'email',
  voice: 'a call',
};

const REASON_TEXT: Record<ReminderReason, string> = {
  rule_removed: 'the reminder was removed',
  rule_off: 'the reminder was switched off',
  rescheduled: 'the booking was moved',
  booking_cancelled: 'the booking was cancelled',
  booking_declined: 'the booking was declined',
  booking_no_show: 'the booking was marked no-show',
  booking_not_confirmed: 'the booking is not confirmed',
  started: 'the booking had already started',
  expired: 'it was too late to send',
  already_confirmed: 'the customer had already confirmed',
  no_join_link: 'the visit has no join link',
  already_rebooked: 'the customer already has a later booking',
  visit_not_completed: 'the visit was not marked completed',
  no_contact_point: 'the contact has no number or address for it',
  no_channel: 'no channel could deliver it',
  no_sender: 'no connected sender',
  channel_disabled: 'the workspace has switched this channel off for appointment messages',
  template_required: 'WhatsApp needs an approved template outside the 24 hour window',
  template_unavailable: 'the chosen template cannot be sent',
  quiet_hours_too_late: 'quiet hours ran past the booking',
  no_consent: 'no recorded consent',
  opted_out: 'the contact opted out',
  do_not_call: 'the number is on the do-not-call list',
  minor: 'the contact is flagged as a minor',
  processing_restricted: 'processing of this contact is restricted',
  plan_limit: "the plan's limit is reached",
  quiet_hours: 'quiet hours',
  channel_unavailable: 'the channel is not connected',
  wallet_empty: 'the wallet is empty',
  send_halted: 'sending is halted',
  not_delivered: 'the earlier message was not delivered in time',
  send_failed: 'the earlier message failed to send',
  provider_error: 'the provider refused it',
  interrupted: 'it was interrupted',
  internal_error: 'an unexpected error',
};

/** What a step is called on the timeline, in English like every activity title the system writes. */
const STEP_NOUN: Record<BookingReminderStepKind, string> = {
  confirmation: 'Confirmation',
  reminder_24h: 'Reminder',
  reminder_2h: 'Reminder',
  reminder_15m: 'Reminder',
  reminder: 'Reminder',
  after_visit: 'Follow-up',
  no_show: 'No-show message',
  rebook: 'Rebook message',
};

/** Words on the contact's timeline. Never the message text or an address. */
export function timelineEntry(
  kind: BookingReminderKind,
  status: Settled['status'] | 'cancelled',
  channel: BookingReminderRecordChannel | null,
  reason: ReminderReason | null,
  until?: Date,
  stepKind?: BookingReminderStepKind | null,
): { title: string; body: string | null } {
  const noun = stepKind ? STEP_NOUN[stepKind] : kind === 'before' ? 'Reminder' : 'Follow-up';
  const via = channel ? ` on ${CHANNEL_NAME[channel]}` : '';
  const why = reason ? REASON_TEXT[reason] : null;
  switch (status) {
    case 'sent':
      return { title: `${noun} sent${via}`, body: null };
    case 'held':
      return {
        title: `${noun} waiting`,
        body: `${capital(why ?? 'held')}${until ? `; it goes after ${until.toISOString()}` : ''}.`,
      };
    case 'failed':
      return { title: `${noun} failed${via}`, body: `${capital(why ?? 'failed')}.` };
    case 'cancelled':
      return { title: `${noun} cancelled`, body: why ? `${capital(why)}.` : null };
    default:
      return { title: `${noun} not sent`, body: why ? `${capital(why)}.` : null };
  }
}

const capital = (s: string): string => (s === '' ? s : s.charAt(0).toUpperCase() + s.slice(1));

// --- what a booking shows ---------------------------------------------------------------------------------------------------------

export interface PlannedRule {
  kind: BookingReminderKind;
  stepKind?: BookingReminderStepKind | null;
  offsetMinutes: number;
  label: string | null;
  isActive: boolean;
}

export interface RecordedRun {
  kind: BookingReminderKind;
  stepKind?: BookingReminderStepKind | null;
  offsetMinutes: number;
  dueAt: Date;
  armedAt: Date;
  status: RunStatus;
  reason: string | null;
  channel: BookingReminderRecordChannel | null;
  sentAt: Date | null;
  attemptLog?: AttemptEntry[];
  delivery?: 'unknown' | 'delivered' | 'failed' | 'undelivered';
}

export interface ShownReminder {
  kind: BookingReminderKind;
  stepKind: BookingReminderStepKind | null;
  offsetMinutes: number;
  label: string | null;
  dueAt: Date;
  status: RunStatus | 'scheduled';
  reason: string | null;
  channel: BookingReminderRecordChannel | null;
  sentAt: Date | null;
  attempts: AttemptEntry[];
  delivery: 'unknown' | 'delivered' | 'failed' | 'undelivered';
}

/**
 * The steps of one booking for its detail: for the booking's current arming, every switched-on step (what was recorded for it, or
 * `scheduled` when its time has not come and it still would fire), plus what an earlier arming really delivered (a reminder sent for
 * the old time is history worth showing; one that was merely cancelled is not). An event step (the confirmation, the no-show message)
 * is shown only when it has a record: it has no time to be scheduled for.
 */
export function remindersOf(
  booking: { status: AppointmentStatus; startsAt: Date; endsAt: Date; armedAt: Date },
  rules: readonly PlannedRule[],
  runs: readonly RecordedRun[],
  nowMs: number,
): ShownReminder[] {
  const out: ShownReminder[] = [];
  const armed = booking.armedAt.getTime();
  const same = (a: { kind: string; offsetMinutes: number }, b: { kind: string; offsetMinutes: number }) =>
    a.kind === b.kind && a.offsetMinutes === b.offsetMinutes;
  const labelOf = (kind: BookingReminderKind, offset: number) =>
    rules.find((r) => r.kind === kind && r.offsetMinutes === offset)?.label ?? null;

  for (const run of runs) {
    const current = run.armedAt.getTime() === armed;
    if (!current && run.status !== 'sent' && run.status !== 'failed') continue;
    out.push({
      kind: run.kind,
      stepKind:
        run.stepKind ??
        rules.find((r) => same(r, run))?.stepKind ??
        null,
      offsetMinutes: run.offsetMinutes,
      label: labelOf(run.kind, run.offsetMinutes),
      dueAt: run.dueAt,
      status: run.status,
      reason: run.reason,
      channel: run.channel,
      sentAt: run.sentAt,
      attempts: run.attemptLog ?? [],
      delivery: run.delivery ?? 'unknown',
    });
  }
  const open =
    booking.status === 'pending' || booking.status === 'confirmed'
      ? true
      : booking.status === 'completed';
  for (const rule of rules) {
    if (!rule.isActive || rule.kind === 'event') continue;
    if (runs.some((r) => same(r, rule) && r.armedAt.getTime() === armed)) continue;
    const dueAt = dueAtOf(rule.kind, booking.startsAt, booking.endsAt, rule.offsetMinutes);
    const isRebook = rule.stepKind === 'rebook';
    const stillComing =
      rule.kind === 'before'
        ? (booking.status === 'pending' || booking.status === 'confirmed') &&
          dueAt.getTime() > nowMs &&
          dueAt.getTime() > armed
        : isRebook
          ? booking.status === 'completed' && dueAt.getTime() + REBOOK_GRACE_MS > nowMs
          : open &&
            booking.status !== 'pending' &&
            dueAt.getTime() + FOLLOW_UP_GRACE_MS > nowMs;
    if (!stillComing) continue;
    out.push({
      kind: rule.kind,
      stepKind: rule.stepKind ?? null,
      offsetMinutes: rule.offsetMinutes,
      label: rule.label,
      dueAt,
      status: 'scheduled',
      reason: null,
      channel: null,
      sentAt: null,
      attempts: [],
      delivery: 'unknown',
    });
  }
  return out.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}
