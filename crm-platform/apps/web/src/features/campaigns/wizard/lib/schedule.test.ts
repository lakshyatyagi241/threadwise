import { describe, expect, it } from 'vitest';
import { NOW } from '../testing';
import {
  dateOnlyToDate,
  defaultRule,
  defaultTimeZone,
  launchKind,
  recurrenceFacts,
  ruleWithFrequency,
  scheduleForMode,
  timeZoneOptions,
  toggleWeekday,
  tomorrowIn,
  validRule,
  weekdayDate,
} from './schedule';

describe('schedule helpers', () => {
  it("starts in the person's zone (their own, else the workspace's), and UTC when there is none", () => {
    expect(defaultTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(defaultTimeZone('America/New_York')).toBe('America/New_York');
    expect(defaultTimeZone('Not/AZone')).toBe('UTC');
    expect(defaultTimeZone(null)).toBe('UTC');
    expect(defaultTimeZone(undefined)).toBe('UTC');
  });

  it('tomorrow is read on the clock of the zone', () => {
    // 08:00 UTC on 6 Oct is 13:30 in Kolkata and 21:00 on the 5th... in Honolulu (UTC-10 is 22:00 of the 5th)
    expect(tomorrowIn('Asia/Kolkata', NOW)).toBe('2026-10-07');
    expect(tomorrowIn('Pacific/Honolulu', NOW)).toBe('2026-10-06');
  });

  it('switching mode gives usable fields and keeps a mode already chosen', () => {
    const now = { mode: 'now' as const };
    const sched = scheduleForMode('scheduled', now, 'Asia/Kolkata', NOW);
    expect(sched).toEqual({
      mode: 'scheduled',
      date: '2026-10-07',
      time: '09:00',
      timezone: 'Asia/Kolkata',
    });
    expect(scheduleForMode('scheduled', sched, 'UTC', NOW)).toBe(sched);
    const rec = scheduleForMode('recurring', sched, 'Asia/Kolkata', NOW);
    expect(rec.mode === 'recurring' && rec.rule).toMatchObject({
      frequency: 'weekly',
      interval: 1,
      startDate: '2026-10-07',
      timezone: 'Asia/Kolkata',
      ends: { kind: 'never' },
    });
    expect(scheduleForMode('now', rec, 'UTC', NOW)).toEqual({ mode: 'now' });
  });

  it('names the launch button by mode', () => {
    expect(launchKind({ mode: 'now' })).toBe('now');
    expect(
      launchKind({ mode: 'scheduled', date: '2026-10-07', time: '09:00', timezone: 'UTC' }),
    ).toBe('schedule');
    expect(launchKind({ mode: 'recurring', rule: defaultRule('UTC', NOW) })).toBe('recurring');
  });

  it('changing frequency clears the fields of the other kinds', () => {
    const weekly = { ...defaultRule('UTC', NOW), weekdays: [1, 3] };
    const monthly = ruleWithFrequency({ ...weekly, monthDay: 31 }, 'monthly');
    expect(monthly).toMatchObject({ frequency: 'monthly', weekdays: [], monthDay: 31 });
    const daily = ruleWithFrequency(monthly, 'daily');
    expect(daily).toMatchObject({ frequency: 'daily', weekdays: [], monthDay: null });
    expect(ruleWithFrequency(weekly, 'weekly')).toBe(weekly);
  });

  it('toggles weekdays, sorted and without repeats', () => {
    let r = defaultRule('UTC', NOW);
    r = toggleWeekday(r, 3);
    r = toggleWeekday(r, 1);
    expect(r.weekdays).toEqual([1, 3]);
    r = toggleWeekday(r, 3);
    expect(r.weekdays).toEqual([1]);
  });

  it('describes a rule with the defaults the worker applies', () => {
    const r = defaultRule('UTC', NOW); // starts Wed 7 Oct 2026
    expect(recurrenceFacts(r)).toMatchObject({
      weekdays: [3],
      monthDay: 7,
      time: '09:00',
      zone: 'UTC',
    });
    expect(recurrenceFacts({ ...r, frequency: 'daily' }).weekdays).toEqual([]);
    expect(recurrenceFacts({ ...r, frequency: 'monthly', monthDay: 31 }).monthDay).toBe(31);
  });

  it('validRule is null for a rule the shared schema refuses', () => {
    const r = defaultRule('UTC', NOW);
    expect(validRule(r)).not.toBeNull();
    expect(validRule({ ...r, interval: 0 })).toBeNull();
    expect(validRule({ ...r, startDate: '' })).toBeNull();
    expect(validRule({ ...r, ends: { kind: 'on_date', date: '2026-01-01' } })).toBeNull();
  });

  it('date helpers', () => {
    expect(dateOnlyToDate('2026-10-06').toISOString()).toBe('2026-10-06T00:00:00.000Z');
    expect(weekdayDate(0).getUTCDay()).toBe(0);
    expect(weekdayDate(6).getUTCDay()).toBe(6);
    expect(timeZoneOptions('Asia/Kolkata')).toContain('Asia/Kolkata');
    expect(timeZoneOptions('Custom/Zone')).toContain('Custom/Zone');
    expect(timeZoneOptions('')).toContain('UTC');
  });
});
