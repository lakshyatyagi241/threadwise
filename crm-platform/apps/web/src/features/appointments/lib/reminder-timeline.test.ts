import { describe, expect, it } from 'vitest';
import {
  addStep,
  buildStep,
  choiceState,
  fallbackNote,
  groupTimeline,
  hasFallbackWait,
  hasReplyOptions,
  laneOf,
  offsetParts,
  timedSteps,
  whatsappState,
  STEP_CHOICES,
  type StepChoice,
} from './reminder-timeline';
import { remindersToInput, stepKindOf, validateReminders, newReminder } from './reminder-rules';

const built = (...choices: StepChoice[]) => choices.map((c) => buildStep(c));

describe('lanes', () => {
  it('puts the confirmation at booking, reminders before, the rest after the visit', () => {
    expect(laneOf(buildStep('confirmation'))).toBe('booked');
    expect(laneOf(buildStep('reminder_24h'))).toBe('before');
    expect(laneOf(buildStep('custom'))).toBe('before');
    expect(laneOf(buildStep('after_visit'))).toBe('after');
    expect(laneOf(buildStep('no_show'))).toBe('after');
    expect(laneOf(buildStep('rebook'))).toBe('after');
  });

  it('orders reminders furthest first and the after lane as follow-up, no-show, rebook', () => {
    const rules = built('reminder_15m', 'rebook', 'reminder_24h', 'no_show', 'after_visit', 'reminder_2h');
    const g = groupTimeline(rules);
    expect(g.before.map(stepKindOf)).toEqual(['reminder_24h', 'reminder_2h', 'reminder_15m']);
    expect(g.after.map(stepKindOf)).toEqual(['after_visit', 'no_show', 'rebook']);
    expect(g.booked).toEqual([]);
  });

  it('keeps a row without a time at the end of its lane', () => {
    const g = groupTimeline(built('custom', 'reminder_2h'));
    expect(g.before.map(stepKindOf)).toEqual(['reminder_2h', 'reminder']);
  });
});

describe('the Add step menu', () => {
  it('offers everything on an empty list', () => {
    for (const c of STEP_CHOICES) expect(choiceState([], c)).toBe('available');
  });

  it('marks a step that is already there, once', () => {
    const rules = built('confirmation', 'reminder_24h', 'no_show', 'after_visit');
    expect(choiceState(rules, 'confirmation')).toBe('present');
    expect(choiceState(rules, 'reminder_24h')).toBe('present');
    expect(choiceState(rules, 'no_show')).toBe('present');
    expect(choiceState(rules, 'after_visit')).toBe('present');
    expect(choiceState(rules, 'reminder_2h')).toBe('available');
  });

  it('stops timed steps at five, but event steps still come on top', () => {
    const five = built('reminder_24h', 'reminder_2h', 'reminder_15m', 'after_visit', 'rebook');
    expect(timedSteps(five)).toBe(5);
    expect(choiceState(five, 'custom')).toBe('cap');
    expect(choiceState(five, 'rebook')).toBe('cap');
    expect(choiceState(five, 'confirmation')).toBe('available');
    expect(choiceState(five, 'no_show')).toBe('available');
    expect(addStep(five, 'custom')).toHaveLength(5);
    expect(addStep(five, 'confirmation')).toHaveLength(6);
  });

  it('adds nothing twice', () => {
    const once = addStep([], 'reminder_24h');
    expect(addStep(once, 'reminder_24h')).toHaveLength(1);
  });
});

describe('a built step', () => {
  it('starts OFF, with both channels, and saves as the step it names', () => {
    const input = remindersToInput(built('confirmation', 'reminder_24h', 'reminder_2h', 'reminder_15m', 'after_visit', 'no_show', 'rebook'));
    expect(input.map((i) => [i.stepKind, i.kind, i.offsetMinutes, i.isActive])).toEqual([
      ['confirmation', 'event', 0, false],
      ['no_show', 'event', 1, false],
      ['reminder_24h', 'before', 1440, false],
      ['reminder_2h', 'before', 120, false],
      ['reminder_15m', 'before', 15, false],
      ['after_visit', 'after', 120, false],
      ['rebook', 'after', 43_200, false],
    ]);
    for (const i of input) expect(i.channels).toEqual(['whatsapp', 'email']);
  });

  it('skips the 2 hour reminder when the customer already confirmed, by default', () => {
    expect(buildStep('reminder_2h').skipIfConfirmed).toBe(true);
    expect(buildStep('reminder_24h').skipIfConfirmed).toBe(false);
  });

  it('is valid as built, and a rebook may wait longer than 30 days', () => {
    const r = { ...buildStep('rebook'), offset: '90', unit: 'days' as const };
    expect(validateReminders([r])).toEqual({});
    const long = { ...buildStep('after_visit'), offset: '90', unit: 'days' as const };
    expect(Object.values(validateReminders([long]))).toEqual(['offsetInvalid']);
  });

  it('a custom step has no time until the owner types one', () => {
    expect(offsetParts(buildStep('custom'))).toBeNull();
    expect(validateReminders([{ ...newReminder(), offset: '' }])).toEqual({});
  });
});

describe('offsetParts', () => {
  it('shows the largest exact unit', () => {
    expect(offsetParts(buildStep('reminder_24h'))).toEqual({ count: 1, unit: 'days' });
    expect(offsetParts(buildStep('reminder_2h'))).toEqual({ count: 2, unit: 'hours' });
    expect(offsetParts(buildStep('reminder_15m'))).toEqual({ count: 15, unit: 'minutes' });
    expect(offsetParts(buildStep('rebook'))).toEqual({ count: 30, unit: 'days' });
  });
});

describe('options and the WhatsApp state', () => {
  it('buttons and skip rules belong to reminders before the visit', () => {
    expect(hasReplyOptions(buildStep('reminder_24h'))).toBe(true);
    expect(hasReplyOptions(buildStep('after_visit'))).toBe(false);
    expect(hasReplyOptions(buildStep('confirmation'))).toBe(false);
  });

  it('a wait before the next channel needs a next channel', () => {
    expect(hasFallbackWait({ channels: ['whatsapp', 'email'] })).toBe(true);
    expect(hasFallbackWait({ channels: ['email'] })).toBe(false);
  });

  it('reads the template state live, and falls back for the unapproved', () => {
    const base = { channels: ['whatsapp', 'email'] as ('whatsapp' | 'email')[], waTemplateId: '', waTemplateStatus: null };
    expect(whatsappState(base)).toBe('none');
    expect(whatsappState({ ...base, waTemplateStatus: 'pending' })).toBe('pending');
    expect(whatsappState({ ...base, waTemplateId: 'x' })).toBe('approved');
    expect(whatsappState({ ...base, channels: ['email'] })).toBe('na');
    expect(fallbackNote({ ...base, waTemplateStatus: 'pending' })).toBe('email');
    expect(fallbackNote({ ...base, waTemplateStatus: 'rejected', channels: ['whatsapp'] })).toBe('window');
    expect(fallbackNote({ ...base, waTemplateStatus: 'approved' })).toBe('ok');
    expect(fallbackNote({ ...base, channels: ['email'] })).toBe('ok');
  });
});
