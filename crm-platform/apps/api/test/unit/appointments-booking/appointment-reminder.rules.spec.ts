import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import {
  FOLLOW_UP_GRACE_MS,
  REMINDER_MIN_LEAD_MS,
  REMINDER_RETRY_MS,
  dueAtOf,
  gateRun,
  outcomeOfCode,
  outcomeOfDenial,
  remindersOf,
  settleChannels,
  templateProblem,
  timelineEntry,
  waTemplateValues,
  type ChannelOutcome,
  type RunFacts,
} from '../../../src/modules/appointments-booking/appointment-reminder.rules';

const T = (iso: string) => new Date(iso);
const START = T('2026-11-10T10:00:00Z');
const END = T('2026-11-10T10:30:00Z');
const ARMED = T('2026-11-01T08:00:00Z');

const facts = (patch: Partial<RunFacts> = {}): RunFacts => ({
  runStatus: 'sending',
  kind: 'before',
  rule: { isActive: true },
  runArmedAtMs: ARMED.getTime(),
  bookingArmedAtMs: ARMED.getTime(),
  bookingStatus: 'confirmed',
  startsAtMs: START.getTime(),
  dueAtMs: T('2026-11-09T10:00:00Z').getTime(),
  nowMs: T('2026-11-09T10:01:00Z').getTime(),
  ...patch,
});

describe('dueAtOf', () => {
  it('counts a before-rule back from the start and an after-rule forward from the END', () => {
    expect(dueAtOf('before', START, END, 1440)).toEqual(T('2026-11-09T10:00:00Z'));
    expect(dueAtOf('before', START, END, 60)).toEqual(T('2026-11-10T09:00:00Z'));
    expect(dueAtOf('after', START, END, 120)).toEqual(T('2026-11-10T12:30:00Z'));
  });
});

describe('gateRun', () => {
  it('lets a reminder for a confirmed, not-started booking go', () => {
    expect(gateRun(facts())).toEqual({ go: true });
  });

  it('cancels a run whose rule was deleted or switched off since the claim', () => {
    expect(gateRun(facts({ rule: null }))).toEqual({
      go: false,
      status: 'cancelled',
      reason: 'rule_removed',
    });
    expect(gateRun(facts({ rule: { isActive: false } }))).toEqual({
      go: false,
      status: 'cancelled',
      reason: 'rule_off',
    });
  });

  it('cancels a run claimed for an earlier time when the booking was rescheduled', () => {
    expect(gateRun(facts({ bookingArmedAtMs: ARMED.getTime() + 1000 }))).toEqual({
      go: false,
      status: 'cancelled',
      reason: 'rescheduled',
    });
  });

  it.each([
    ['cancelled', 'booking_cancelled'],
    ['declined', 'booking_declined'],
    ['no_show', 'booking_no_show'],
    ['pending', 'booking_not_confirmed'],
    ['completed', 'booking_not_confirmed'],
  ] as const)('stops a reminder for a %s booking', (status, reason) => {
    expect(gateRun(facts({ bookingStatus: status }))).toEqual({
      go: false,
      status: 'cancelled',
      reason,
    });
  });

  it('never sends a reminder at or after the start, nor in the last minutes before it', () => {
    const started = gateRun(facts({ nowMs: START.getTime() }));
    expect(started).toEqual({ go: false, status: 'skipped', reason: 'started' });
    const late = gateRun(facts({ nowMs: START.getTime() - REMINDER_MIN_LEAD_MS + 1 }));
    expect(late).toEqual({ go: false, status: 'skipped', reason: 'started' });
    const early = gateRun(facts({ nowMs: START.getTime() - REMINDER_MIN_LEAD_MS - 1 }));
    expect(early).toEqual({ go: true });
  });

  describe('the follow-up', () => {
    const due = T('2026-11-10T11:30:00Z');
    const after = (patch: Partial<RunFacts> = {}) =>
      facts({ kind: 'after', dueAtMs: due.getTime(), nowMs: due.getTime() + 60_000, ...patch });

    it('goes for a completed booking and for one nobody closed (confirmed)', () => {
      expect(gateRun(after({ bookingStatus: 'completed' }))).toEqual({ go: true });
      expect(gateRun(after({ bookingStatus: 'confirmed' }))).toEqual({ go: true });
    });

    it('does not go after a no-show, a cancel or a decline', () => {
      for (const s of ['no_show', 'cancelled', 'declined'] as const) {
        const g = gateRun(after({ bookingStatus: s }));
        expect(g.go).toBe(false);
      }
    });

    it('is dropped when it is more than a day late, and goes right up to the limit', () => {
      expect(gateRun(after({ nowMs: due.getTime() + FOLLOW_UP_GRACE_MS }))).toEqual({ go: true });
      expect(gateRun(after({ nowMs: due.getTime() + FOLLOW_UP_GRACE_MS + 1 }))).toEqual({
        go: false,
        status: 'skipped',
        reason: 'expired',
      });
    });

    it('is not blocked by the start having passed (it is after the visit)', () => {
      expect(gateRun(after())).toEqual({ go: true });
    });
  });
});

describe('settleChannels', () => {
  const NOW = T('2026-11-09T10:00:00Z');
  const sent: ChannelOutcome = { status: 'sent' };
  const skip = (reason: Extract<ChannelOutcome, { status: 'skipped' }>['reason']): ChannelOutcome => ({
    status: 'skipped',
    reason,
  });

  it('uses the first channel that sent and records it, never a second copy', () => {
    expect(
      settleChannels(
        [
          { channel: 'whatsapp', outcome: skip('template_required') },
          { channel: 'sms', outcome: sent },
        ],
        NOW,
      ),
    ).toEqual({ status: 'sent', reason: null, channel: 'sms' });
  });

  it('holds on a held channel and keeps the preference, with the time it gave or a retry delay', () => {
    const until = '2026-11-09T14:00:00.000Z';
    expect(
      settleChannels(
        [{ channel: 'whatsapp', outcome: { status: 'held', reason: 'quiet_hours', until } }],
        NOW,
      ),
    ).toMatchObject({ status: 'held', reason: 'quiet_hours', channel: 'whatsapp', until: T(until) });
    const noTime = settleChannels(
      [{ channel: 'sms', outcome: { status: 'held', reason: 'channel_unavailable' } }],
      NOW,
    );
    expect(noTime.status === 'held' && noTime.until?.getTime()).toBe(
      NOW.getTime() + REMINDER_RETRY_MS,
    );
  });

  it('stops at a failure instead of falling to another channel (it may already have gone)', () => {
    const r = settleChannels(
      [
        { channel: 'sms', outcome: { status: 'failed', reason: 'provider_error' } },
        { channel: 'email', outcome: sent },
      ],
      NOW,
    );
    expect(r).toEqual({ status: 'failed', reason: 'provider_error', channel: 'sms' });
  });

  it('when every channel is skipped, says the most telling reason, not "nothing to send to"', () => {
    expect(
      settleChannels(
        [
          { channel: 'whatsapp', outcome: skip('no_contact_point') },
          { channel: 'sms', outcome: skip('opted_out') },
          { channel: 'email', outcome: skip('no_sender') },
        ],
        NOW,
      ),
    ).toEqual({ status: 'skipped', reason: 'opted_out', channel: null });
    expect(settleChannels([], NOW)).toEqual({ status: 'skipped', reason: 'no_channel', channel: null });
  });
});

describe('outcomes', () => {
  it('maps the conversation core and consent codes', () => {
    expect(outcomeOfCode(ERROR_CODES.CONSENT_OPTED_OUT)).toEqual({
      status: 'skipped',
      reason: 'opted_out',
    });
    expect(outcomeOfCode(ERROR_CODES.WALLET_EMPTY)).toEqual({ status: 'held', reason: 'wallet_empty' });
    expect(outcomeOfCode(ERROR_CODES.CHANNEL_DISCONNECTED)).toEqual({
      status: 'held',
      reason: 'channel_unavailable',
    });
    expect(outcomeOfCode(ERROR_CODES.SERVICE_WINDOW_CLOSED)).toEqual({
      status: 'skipped',
      reason: 'template_required',
    });
    expect(outcomeOfCode('SOMETHING_ELSE')).toBeNull();
  });

  it('reads the ConsentGate denials', () => {
    expect(outcomeOfDenial('withdrawn')).toEqual({ status: 'skipped', reason: 'opted_out' });
    expect(outcomeOfDenial('on_dnc_list')).toEqual({ status: 'skipped', reason: 'do_not_call' });
    expect(outcomeOfDenial('subject_minor')).toEqual({ status: 'skipped', reason: 'minor' });
    expect(outcomeOfDenial('legal_hold')).toEqual({
      status: 'skipped',
      reason: 'processing_restricted',
    });
    expect(outcomeOfDenial('no_consent_recorded')).toEqual({ status: 'skipped', reason: 'no_consent' });
  });
});

describe('WhatsApp template values', () => {
  const vars = {
    name: 'Ada',
    type: 'Consultation',
    date: 'Tuesday 10 November',
    time: '10:00 AM',
    location: '',
    join_link: 'https://meet.test/x',
    manage_link: 'https://app.test/m/1',
  };

  it('fills {{1}}, {{2}}... from name, service, date, time, place, join link, manage link', () => {
    expect(waTemplateValues(4, vars)).toEqual([
      'Ada',
      'Consultation',
      'Tuesday 10 November',
      '10:00 AM',
    ]);
  });

  it('turns an empty value into a dash (Meta refuses an empty parameter) and flattens line breaks', () => {
    expect(waTemplateValues(5, vars)?.[4]).toBe('-');
    expect(waTemplateValues(1, { name: 'Ada\nL' })).toEqual(['Ada L']);
  });

  it('cannot fill a template with more variables than it has an order for', () => {
    expect(waTemplateValues(8, vars)).toBeNull();
  });
});

describe('templateProblem', () => {
  const ok = {
    status: 'approved',
    metaStatus: 'APPROVED',
    pausedUntil: null,
    templateType: 'standard',
    attachmentType: 'none',
    parameterFormat: 'POSITIONAL',
    headerTokenCount: 0,
    dynamicButtonCount: 0,
  };
  const now = T('2026-11-09T10:00:00Z');
  it('accepts an approved text template and refuses what it cannot fill', () => {
    expect(templateProblem(ok, now)).toBeNull();
    expect(templateProblem({ ...ok, status: 'draft' }, now)).toBe('template_unavailable');
    expect(templateProblem({ ...ok, metaStatus: 'REJECTED' }, now)).toBe('template_unavailable');
    expect(templateProblem({ ...ok, pausedUntil: T('2026-11-10T00:00:00Z') }, now)).toBe(
      'template_unavailable',
    );
    expect(templateProblem({ ...ok, attachmentType: 'image' }, now)).toBe('template_unavailable');
    expect(templateProblem({ ...ok, headerTokenCount: 1 }, now)).toBe('template_unavailable');
    expect(templateProblem({ ...ok, dynamicButtonCount: 1 }, now)).toBe('template_unavailable');
    expect(templateProblem({ ...ok, parameterFormat: 'NAMED' }, now)).toBe('template_unavailable');
  });
});

describe('remindersOf (what a booking shows)', () => {
  const rule = (kind: 'before' | 'after', offsetMinutes: number, isActive = true) => ({
    kind,
    offsetMinutes,
    label: null,
    isActive,
  });
  const booking = (status: 'confirmed' | 'completed' | 'cancelled' | 'pending' = 'confirmed') => ({
    status,
    startsAt: START,
    endsAt: END,
    armedAt: ARMED,
  });
  const run = (patch: Record<string, unknown> = {}) => ({
    kind: 'before' as const,
    offsetMinutes: 1440,
    dueAt: T('2026-11-09T10:00:00Z'),
    armedAt: ARMED,
    status: 'sent' as const,
    reason: null,
    channel: 'sms' as const,
    sentAt: T('2026-11-09T10:00:05Z'),
    ...patch,
  });

  it('shows a switched-on rule that has not come due as scheduled, in time order, and hides a switched-off one', () => {
    const now = T('2026-11-05T00:00:00Z').getTime();
    const shown = remindersOf(
      booking(),
      [rule('after', 60), rule('before', 1440), rule('before', 60, false)],
      [],
      now,
    );
    expect(shown.map((r) => [r.kind, r.offsetMinutes, r.status])).toEqual([
      ['before', 1440, 'scheduled'],
      ['after', 60, 'scheduled'],
    ]);
  });

  it('shows the recorded outcome instead of "scheduled"', () => {
    const shown = remindersOf(booking(), [rule('before', 1440)], [run()], T('2026-11-09T12:00:00Z').getTime());
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ status: 'sent', channel: 'sms' });
  });

  it('does not schedule a before-rule that is already past or that falls before the booking was made', () => {
    const past = remindersOf(booking(), [rule('before', 1440)], [], T('2026-11-09T12:00:00Z').getTime());
    expect(past).toEqual([]);
    const madeLate = remindersOf(
      { ...booking(), armedAt: T('2026-11-09T20:00:00Z') },
      [rule('before', 1440)],
      [],
      T('2026-11-09T21:00:00Z').getTime(),
    );
    expect(madeLate).toEqual([]);
  });

  it('schedules nothing for a cancelled booking, and keeps an earlier arming only when it really went out', () => {
    expect(remindersOf(booking('cancelled'), [rule('before', 60)], [], 0)).toEqual([]);
    const old = T('2026-10-30T08:00:00Z');
    const shown = remindersOf(
      booking(),
      [],
      [run({ armedAt: old, status: 'sent' }), run({ armedAt: old, offsetMinutes: 60, status: 'cancelled' })],
      T('2026-11-09T12:00:00Z').getTime(),
    );
    expect(shown.map((r) => r.status)).toEqual(['sent']);
  });
});

describe('timelineEntry', () => {
  it('names the outcome, the channel and the reason, never a message or an address', () => {
    expect(timelineEntry('before', 'sent', 'whatsapp', null)).toEqual({
      title: 'Reminder sent on WhatsApp',
      body: null,
    });
    expect(timelineEntry('after', 'sent', 'email', null).title).toBe('Follow-up sent on email');
    expect(timelineEntry('before', 'skipped', null, 'opted_out')).toEqual({
      title: 'Reminder not sent',
      body: 'The contact opted out.',
    });
    expect(timelineEntry('after', 'held', 'sms', 'quiet_hours', T('2026-11-09T14:00:00Z')).body).toContain(
      '2026-11-09T14:00:00.000Z',
    );
    expect(timelineEntry('before', 'failed', 'sms', 'provider_error').title).toBe(
      'Reminder failed on SMS',
    );
  });
});
