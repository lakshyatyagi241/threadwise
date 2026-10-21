import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import {
  FOLLOW_UP_GRACE_MS,
  attemptLogOf,
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
  stepKind: null,
  rule: { isActive: true, skipIfConfirmed: false },
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
    expect(gateRun(facts({ rule: { isActive: false, skipIfConfirmed: false } }))).toEqual({
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
  const skip = (
    reason: Extract<ChannelOutcome, { status: 'skipped' }>['reason'],
  ): ChannelOutcome => ({
    status: 'skipped',
    reason,
  });

  it('uses the first channel that sent and records it, never a second copy', () => {
    expect(
      settleChannels(
        [
          { channel: 'whatsapp', outcome: skip('template_required') },
          { channel: 'email', outcome: sent },
        ],
        NOW,
      ),
    ).toEqual({ status: 'sent', reason: null, channel: 'email' });
  });

  it('holds on a held channel and keeps the preference, with the time it gave or a retry delay', () => {
    const until = '2026-11-09T14:00:00.000Z';
    expect(
      settleChannels(
        [{ channel: 'whatsapp', outcome: { status: 'held', reason: 'quiet_hours', until } }],
        NOW,
      ),
    ).toMatchObject({
      status: 'held',
      reason: 'quiet_hours',
      channel: 'whatsapp',
      until: T(until),
    });
    const noTime = settleChannels(
      [{ channel: 'email', outcome: { status: 'held', reason: 'channel_unavailable' } }],
      NOW,
    );
    expect(noTime.status === 'held' && noTime.until?.getTime()).toBe(
      NOW.getTime() + REMINDER_RETRY_MS,
    );
  });

  it('falls to the next channel when one fails (the owner chose failure as a reason to fall back), and logs both', () => {
    const tried = [
      { channel: 'whatsapp' as const, outcome: { status: 'failed', reason: 'provider_error' } as ChannelOutcome },
      { channel: 'email' as const, outcome: sent },
    ];
    expect(settleChannels(tried, NOW)).toEqual({ status: 'sent', reason: null, channel: 'email' });
    expect(attemptLogOf(tried)).toEqual([
      { channel: 'whatsapp', status: 'failed', reason: 'provider_error' },
      { channel: 'email', status: 'sent', reason: null },
    ]);
  });

  it('reports the failure when every channel failed', () => {
    const r = settleChannels(
      [
        { channel: 'whatsapp', outcome: { status: 'failed', reason: 'provider_error' } },
        { channel: 'email', outcome: skip('no_sender') },
      ],
      NOW,
    );
    expect(r).toEqual({ status: 'failed', reason: 'provider_error', channel: 'whatsapp' });
  });

  it('when every channel is skipped, says the most telling reason, not "nothing to send to"', () => {
    expect(
      settleChannels(
        [
          { channel: 'whatsapp', outcome: skip('opted_out') },
          { channel: 'email', outcome: skip('no_sender') },
        ],
        NOW,
      ),
    ).toEqual({ status: 'skipped', reason: 'opted_out', channel: null });
    expect(settleChannels([], NOW)).toEqual({
      status: 'skipped',
      reason: 'no_channel',
      channel: null,
    });
  });
});

describe('outcomes', () => {
  it('maps the conversation core and consent codes', () => {
    expect(outcomeOfCode(ERROR_CODES.CONSENT_OPTED_OUT)).toEqual({
      status: 'skipped',
      reason: 'opted_out',
    });
    expect(outcomeOfCode(ERROR_CODES.WALLET_EMPTY)).toEqual({
      status: 'held',
      reason: 'wallet_empty',
    });
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
    expect(outcomeOfDenial('no_consent_recorded')).toEqual({
      status: 'skipped',
      reason: 'no_consent',
    });
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
    channel: 'whatsapp' as const,
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
    const shown = remindersOf(
      booking(),
      [rule('before', 1440)],
      [run()],
      T('2026-11-09T12:00:00Z').getTime(),
    );
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ status: 'sent', channel: 'whatsapp' });
  });

  it('does not schedule a before-rule that is already past or that falls before the booking was made', () => {
    const past = remindersOf(
      booking(),
      [rule('before', 1440)],
      [],
      T('2026-11-09T12:00:00Z').getTime(),
    );
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
      [
        run({ armedAt: old, status: 'sent' }),
        run({ armedAt: old, offsetMinutes: 60, status: 'cancelled' }),
      ],
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
    expect(
      timelineEntry('after', 'held', 'whatsapp', 'quiet_hours', T('2026-11-09T14:00:00Z')).body,
    ).toContain('2026-11-09T14:00:00.000Z');
    expect(timelineEntry('before', 'failed', 'whatsapp', 'provider_error').title).toBe(
      'Reminder failed on WhatsApp',
    );
  });
});

describe('gateRun: the steps of a sequence', () => {
  const NOW_AT = T('2026-11-09T10:01:00Z').getTime();
  const step = (stepKind: RunFacts['stepKind'], kind: RunFacts['kind'], patch: Partial<RunFacts> = {}) =>
    facts({ stepKind, kind, nowMs: NOW_AT, ...patch });

  it('the 15 minute reminder needs a join link and is skipped without one', () => {
    expect(gateRun(step('reminder_15m', 'before', { hasJoinLink: true }))).toEqual({ go: true });
    expect(gateRun(step('reminder_15m', 'before', { hasJoinLink: false }))).toEqual({
      go: false,
      status: 'skipped',
      reason: 'no_join_link',
    });
  });

  it('"skip Reminder 2 if already confirmed" only skips when the rule asks for it and the customer confirmed', () => {
    const asks = { isActive: true, skipIfConfirmed: true };
    expect(gateRun(step('reminder_2h', 'before', { rule: asks, customerConfirmed: true }))).toEqual({
      go: false,
      status: 'skipped',
      reason: 'already_confirmed',
    });
    expect(gateRun(step('reminder_2h', 'before', { rule: asks, customerConfirmed: false }))).toEqual({
      go: true,
    });
    expect(gateRun(step('reminder_2h', 'before', { customerConfirmed: true }))).toEqual({ go: true });
  });

  it('a reminder is never sent at or after the start', () => {
    const g = gateRun(step('reminder_24h', 'before', { nowMs: START.getTime() }));
    expect(g).toEqual({ go: false, status: 'skipped', reason: 'started' });
  });

  it('a cancel, a decline or a move stops every step of the sequence', () => {
    for (const [stepKind, kind] of [
      ['reminder_24h', 'before'],
      ['after_visit', 'after'],
      ['rebook', 'after'],
      ['confirmation', 'event'],
    ] as const) {
      const g = gateRun(step(stepKind, kind, { bookingStatus: 'cancelled' }));
      expect(g).toMatchObject({ go: false, status: 'cancelled', reason: 'booking_cancelled' });
    }
    expect(gateRun(step('reminder_24h', 'before', { bookingArmedAtMs: ARMED.getTime() + 1 }))).toMatchObject({
      reason: 'rescheduled',
    });
  });

  it('the confirmation goes for a confirmed booking that has not started, never after the start', () => {
    expect(gateRun(step('confirmation', 'event'))).toEqual({ go: true });
    expect(gateRun(step('confirmation', 'event', { nowMs: START.getTime() + 1 }))).toMatchObject({
      reason: 'started',
    });
  });

  it('the no-show message goes only when the booking was marked no-show', () => {
    expect(gateRun(step('no_show', 'event', { bookingStatus: 'no_show' }))).toEqual({ go: true });
    expect(gateRun(step('no_show', 'event', { bookingStatus: 'confirmed' }))).toMatchObject({
      go: false,
      reason: 'booking_not_confirmed',
    });
  });

  it('a rebook follows a completed visit only, and may be a day late, not more', () => {
    const due = T('2027-05-09T10:00:00Z').getTime();
    const base = { dueAtMs: due, nowMs: due + 60_000 };
    expect(gateRun(step('rebook', 'after', { ...base, bookingStatus: 'completed' }))).toEqual({ go: true });
    expect(gateRun(step('rebook', 'after', { ...base, bookingStatus: 'confirmed' }))).toMatchObject({
      reason: 'visit_not_completed',
    });
    expect(
      gateRun(step('rebook', 'after', { dueAtMs: due, nowMs: due + 25 * 3_600_000, bookingStatus: 'completed' })),
    ).toMatchObject({ reason: 'expired' });
  });
});

describe('the channel log: why a channel was used or skipped', () => {
  const NOW = T('2026-11-09T10:00:00Z');
  const cases: Array<[string, ChannelOutcome]> = [
    ['no_contact_point', { status: 'skipped', reason: 'no_contact_point' }],
    ['no_consent', { status: 'skipped', reason: 'no_consent' }],
    ['template_unavailable', { status: 'skipped', reason: 'template_unavailable' }],
    ['provider_error', { status: 'failed', reason: 'provider_error' }],
  ];
  it.each(cases)('WhatsApp %s hands over to email and the log says why', (reason, outcome) => {
    const tried = [
      { channel: 'whatsapp' as const, outcome },
      { channel: 'email' as const, outcome: { status: 'sent' } as ChannelOutcome },
    ];
    expect(settleChannels(tried, NOW)).toEqual({ status: 'sent', reason: null, channel: 'email' });
    expect(attemptLogOf(tried)).toEqual([
      { channel: 'whatsapp', status: outcome.status, reason },
      { channel: 'email', status: 'sent', reason: null },
    ]);
  });

  it('quiet hours HOLD: the run waits with its preference and does not move to email', () => {
    const tried = [
      {
        channel: 'whatsapp' as const,
        outcome: { status: 'held', reason: 'quiet_hours', until: '2026-11-09T14:00:00.000Z' } as ChannelOutcome,
      },
    ];
    expect(settleChannels(tried, NOW)).toMatchObject({ status: 'held', channel: 'whatsapp', reason: 'quiet_hours' });
  });

  it('the timeline wording for a fallback reason is readable', () => {
    expect(timelineEntry('before', 'sent', 'email', null, undefined, 'reminder_24h').title).toBe('Reminder sent on email');
    expect(timelineEntry('event', 'skipped', null, 'no_consent', undefined, 'no_show').title).toBe('No-show message not sent');
  });
});

describe('a stored rule that still lists the removed SMS', () => {
  it('reads without it: a rule with only sms falls back to WhatsApp then email, one with others keeps them in order', async () => {
    const { liveChannels } = await import(
      '../../../src/modules/appointments-booking/appointment-reminders.repository'
    );
    expect(liveChannels(['sms'])).toEqual(['whatsapp', 'email']);
    expect(liveChannels(['sms', 'email'])).toEqual(['email']);
    expect(liveChannels(['email', 'sms', 'whatsapp'])).toEqual(['email', 'whatsapp']);
    expect(liveChannels(null)).toEqual(['whatsapp', 'email']);
  });
});
