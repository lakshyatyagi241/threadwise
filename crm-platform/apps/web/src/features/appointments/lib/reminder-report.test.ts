import { describe, expect, it } from 'vitest';
import type { ReminderReport, ReminderReportStep } from '@crm/contracts';
import {
  customWindow,
  percentOf,
  presetWindow,
  reasonsOf,
  reportIsEmpty,
  totalsOf,
  visibleTypes,
} from './reminder-report';

const step = (over: Partial<ReminderReportStep> = {}): ReminderReportStep => ({
  stepKind: 'reminder_24h',
  sent: 0,
  delivered: 0,
  failed: 0,
  skipped: 0,
  fallbackUsed: 0,
  buttons: null,
  skippedReasons: {},
  confirmationRate: null,
  cancelRate: null,
  noShowRate: null,
  ...over,
});
const report = (steps: ReminderReportStep[]): ReminderReport => ({
  from: '2030-01-01T00:00:00.000Z',
  to: '2030-02-01T00:00:00.000Z',
  buttonsIncluded: true,
  data: [
    {
      bookingTypeId: '11111111-1111-4111-8111-111111111111',
      bookingTypeName: 'Consultation',
      appointments: 3,
      confirmationRate: null,
      cancelRate: null,
      noShowRate: null,
      steps,
    },
  ],
});

describe('the report window', () => {
  it('ends now and starts N days earlier', () => {
    const now = new Date('2030-03-31T12:00:00.000Z');
    expect(presetWindow(7, now)).toEqual({
      from: '2030-03-24T12:00:00.000Z',
      to: '2030-03-31T12:00:00.000Z',
    });
  });
  it('takes two typed dates inclusively (the end is the start of the next day)', () => {
    expect(customWindow('2030-01-01', '2030-01-31')).toEqual({
      from: '2030-01-01T00:00:00.000Z',
      to: '2030-02-01T00:00:00.000Z',
    });
  });
  it('refuses a missing, backwards or too long window', () => {
    expect(customWindow('', '2030-01-31')).toBeNull();
    expect(customWindow('2030-02-01', '2030-01-31')).toBeNull();
    expect(customWindow('2028-01-01', '2030-01-31')).toBeNull();
  });
});

describe('the numbers', () => {
  it('rounds a rate to a whole percent and keeps "nothing sent" as null', () => {
    expect(percentOf(0.5)).toBe(50);
    expect(percentOf(0.3333)).toBe(33);
    expect(percentOf(0)).toBe(0);
    expect(percentOf(null)).toBeNull();
  });
  it('sums steps, and has no button totals when the plan counts none', () => {
    const t = totalsOf([
      step({ sent: 4, delivered: 3, fallbackUsed: 1 }),
      step({ sent: 2, failed: 1 }),
    ]);
    expect(t).toMatchObject({ sent: 6, delivered: 3, failed: 1, fallbackUsed: 1, buttons: null });
    const b = totalsOf([
      step({ buttons: { confirmed: 2, rescheduled: 1, cancelled: 0 } }),
      step({ buttons: { confirmed: 1, rescheduled: 0, cancelled: 1 } }),
    ]);
    expect(b.buttons).toEqual({ confirmed: 3, rescheduled: 1, cancelled: 1 });
  });
  it('is empty when no step has a record, and shows only steps that have one', () => {
    expect(reportIsEmpty(report([step()]))).toBe(true);
    const r = report([step(), step({ stepKind: 'reminder_2h', sent: 2 })]);
    expect(reportIsEmpty(r)).toBe(false);
    expect(visibleTypes(r)[0]!.steps.map((s) => s.stepKind)).toEqual(['reminder_2h']);
    expect(visibleTypes(report([step()]))).toEqual([]);
  });
  it('lists skip reasons, the most frequent first', () => {
    expect(
      reasonsOf(
        step({ skippedReasons: { no_join_link: 1, already_confirmed: 4, quiet_hours: 1 } }),
      ),
    ).toEqual([
      { reason: 'already_confirmed', count: 4 },
      { reason: 'no_join_link', count: 1 },
      { reason: 'quiet_hours', count: 1 },
    ]);
  });
});
