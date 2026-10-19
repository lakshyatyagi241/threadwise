import { describe, expect, it } from 'vitest';
import { flbExtractTrigger, flbTriggerConfig } from '@crm/contracts';
import {
  dueDay,
  dueOccurrence,
  localMoment,
  minutesOf,
} from '../../../src/modules/flow-runtime-engine/triggers/schedule-rules';

const cfg = (over: Record<string, unknown>) => ({
  frequency: 'daily' as const,
  time: '09:00',
  date: '',
  weekdays: [] as number[],
  day: 1,
  ...over,
});

describe('local moment', () => {
  it('reads the wall clock of a zone, and falls back to UTC for an unknown one', () => {
    const at = localMoment(new Date('2026-10-08T22:00:00Z'), 'Asia/Kolkata');
    expect(at).toMatchObject({
      date: '2026-10-09',
      minutes: 3 * 60 + 30,
      weekday: 5,
      day: 9,
      daysInMonth: 31,
    });
    expect(localMoment(new Date('2026-10-08T22:00:00Z'), 'Nowhere/Land').date).toBe('2026-10-08');
    expect(localMoment(new Date('2026-02-10T00:00:00Z'), 'UTC').daysInMonth).toBe(28);
  });
  it('reads HH:MM', () => {
    expect(minutesOf('09:30')).toBe(570);
    expect(minutesOf('junk')).toBe(540);
  });
});

describe('due occurrence', () => {
  const at = (date: string, minutes: number, weekday = 1, day = 8, daysInMonth = 31) => ({
    date,
    minutes,
    weekday,
    day,
    daysInMonth,
  });

  it('daily: waits for the time, fires once a day', () => {
    expect(dueOccurrence(cfg({}), at('2026-10-08', 8 * 60), null)).toBeNull();
    expect(dueOccurrence(cfg({}), at('2026-10-08', 9 * 60), null)).toBe('2026-10-08');
    expect(dueOccurrence(cfg({}), at('2026-10-08', 23 * 60), '2026-10-08')).toBeNull();
    expect(dueOccurrence(cfg({}), at('2026-10-09', 9 * 60), '2026-10-08')).toBe('2026-10-09');
  });

  it('weekly: only on the chosen weekdays; none chosen never fires', () => {
    const w = cfg({ frequency: 'weekly', weekdays: [1, 3] });
    expect(dueOccurrence(w, at('2026-10-05', 600, 1), null)).toBe('2026-10-05');
    expect(dueOccurrence(w, at('2026-10-06', 600, 2), null)).toBeNull();
    expect(dueOccurrence(cfg({ frequency: 'weekly' }), at('2026-10-05', 600, 1), null)).toBeNull();
  });

  it('monthly: on the day, and the 31st lands on the last day of a short month', () => {
    const m = cfg({ frequency: 'monthly', day: 31 });
    expect(dueOccurrence(m, at('2026-10-31', 600, 6, 31, 31), null)).toBe('2026-10-31');
    expect(dueOccurrence(m, at('2026-11-30', 600, 1, 30, 30), null)).toBe('2026-11-30');
    expect(dueOccurrence(m, at('2026-11-29', 600, 0, 29, 30), null)).toBeNull();
  });

  it('once: on its date after its time, late for a day, never for an old date, never twice', () => {
    const o = cfg({ frequency: 'once', date: '2026-10-08' });
    expect(dueOccurrence(o, at('2026-10-08', 8 * 60), null)).toBeNull();
    expect(dueOccurrence(o, at('2026-10-08', 9 * 60), null)).toBe('2026-10-08');
    expect(dueOccurrence(o, at('2026-10-09', 60), null)).toBe('2026-10-08');
    expect(dueOccurrence(o, at('2026-10-10', 60), null)).toBeNull();
    expect(dueOccurrence(o, at('2026-10-08', 9 * 60), '2026-10-08')).toBeNull();
    expect(dueOccurrence(cfg({ frequency: 'once' }), at('2026-10-08', 600), null)).toBeNull();
  });

  it('a daily check runs once after its time', () => {
    expect(dueDay('09:00', at('2026-10-08', 500), null)).toBeNull();
    expect(dueDay('09:00', at('2026-10-08', 541), null)).toBe('2026-10-08');
    expect(dueDay('09:00', at('2026-10-08', 600), '2026-10-08')).toBeNull();
  });
});

describe('trigger settings from the editor', () => {
  it('cleans each kind and falls back to safe defaults', () => {
    expect(
      flbTriggerConfig('field_match', { field: '{{ city }}', operator: 'bogus', value: ' Pune ' }),
    ).toEqual({
      field: 'city',
      operator: 'equals',
      value: 'Pune',
      conditionGroup: null,
    });
    expect(
      flbTriggerConfig('field_match', {
        conditionGroup: {
          op: 'or',
          items: [
            { variable: '{{ city }}', operator: 'is_not_empty', value: '' },
            {
              op: 'and',
              items: [{ variable: 'plan', operator: 'is_empty', value: 'ignored' }],
            },
          ],
        },
      }),
    ).toEqual({
      field: 'city',
      operator: 'is_not_empty',
      value: '',
      conditionGroup: {
        op: 'or',
        items: [
          { variable: 'city', operator: 'is_not_empty', value: '' },
          { op: 'and', items: [{ variable: 'plan', operator: 'is_empty', value: 'ignored' }] },
        ],
      },
    });
    expect(
      flbTriggerConfig('date_field_match', {
        field: 'dob',
        direction: 'before',
        days: '3',
        time: '7:05',
        yearly: true,
      }),
    ).toEqual({
      field: 'dob',
      direction: 'before',
      days: 3,
      time: '07:05',
      yearly: true,
    });
    expect(
      flbTriggerConfig('schedule', {
        frequency: 'weekly',
        weekdays: [3, '1', 9, 'x', 1],
        audience: { kind: 'group', ref: 'g' },
        time: '25:00',
      }),
    ).toMatchObject({
      frequency: 'weekly',
      weekdays: [1, 3],
      time: '09:00',
      audience: { kind: 'group', ref: 'g' },
    });
    expect(flbTriggerConfig('shopify_event', { event: 'nope', productId: ' 12 ' })).toEqual({
      event: 'checkout_started',
      productId: '12',
    });
    expect(flbTriggerConfig('keyword', {})).toBeNull();
  });

  it('extracts the new kinds: list leave carries a group, the others a zero value and their settings', () => {
    const node = (data: Record<string, unknown>) =>
      ({ flowNodes: [{ id: 't', type: 'trigger', data }] }) as never;
    expect(flbExtractTrigger(node({ kind: 'group_leave', groupId: 'g1' }))).toMatchObject({
      kind: 'group_leave',
      valueKind: 'group',
      valueRef: 'g1',
    });
    expect(flbExtractTrigger(node({ kind: 'segment_join', segmentId: 's1' }))).toMatchObject({
      kind: 'segment_join',
      valueKind: 'zero',
      config: { segmentId: 's1' },
    });
    expect(flbExtractTrigger(node({ kind: 'contact_updated' }))).toMatchObject({
      valueKind: 'zero',
      config: null,
    });
  });
});
