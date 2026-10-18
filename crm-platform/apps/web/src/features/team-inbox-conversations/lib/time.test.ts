import { describe, expect, it } from 'vitest';
import {
  snoozeLeft,
  snoozeLeftMessage,
  avatarColor,
  clockTime,
  dayKey,
  dayLabel,
  daysAgo,
  fullStamp,
  humanSize,
  initials,
  listTime,
} from './time';

const NOW = new Date(2026, 9, 2, 15, 0, 0).getTime();
const local = (d: number, h = 12, m = 0) => new Date(2026, 9, d, h, m).toISOString();

describe('days', () => {
  it('groups by local calendar day', () => {
    expect(dayKey(local(2, 0, 5))).toBe(dayKey(local(2, 23, 55)));
    expect(dayKey(local(2))).not.toBe(dayKey(local(1)));
  });

  it('counts calendar days, not 24 hour blocks', () => {
    expect(daysAgo(local(2, 0, 1), NOW)).toBe(0);
    expect(daysAgo(local(1, 23, 59), NOW)).toBe(1);
    expect(daysAgo(new Date(2026, 8, 25, 12).toISOString(), NOW)).toBe(7);
  });

  it('labels today and yesterday in words and older days as dates', () => {
    expect(dayLabel(local(2), NOW, 'en').toLowerCase()).toBe('today');
    expect(dayLabel(local(1), NOW, 'en').toLowerCase()).toBe('yesterday');
    expect(dayLabel(new Date(2026, 8, 20, 12).toISOString(), NOW, 'en')).toMatch(
      /20 Sept|Sept 20|Sep 20|20 Sep/,
    );
  });
});

describe('in a named time zone', () => {
  // 20:30 UTC on 2 Oct is 02:00 on 3 Oct in Kolkata (UTC+05:30) and 16:30 on 2 Oct in New York (UTC-04:00).
  const at = '2026-10-02T20:30:00Z';
  const now = Date.parse('2026-10-03T06:00:00Z'); // 11:30 on 3 Oct in Kolkata, 02:00 in New York

  it("puts the same instant on each zone's own calendar day", () => {
    expect(dayKey(at, 'UTC')).toBe('2026-10-2');
    expect(dayKey(at, 'Asia/Kolkata')).toBe('2026-10-3');
    expect(dayKey(at, 'America/New_York')).toBe('2026-10-2');
  });

  it("counts calendar days on that zone's calendar", () => {
    expect(daysAgo(at, now, 'Asia/Kolkata')).toBe(0);
    expect(daysAgo(at, now, 'America/New_York')).toBe(1);
    expect(daysAgo(at, Date.parse('2026-10-03T12:00:00Z'), 'America/New_York')).toBe(1);
    expect(daysAgo(at, Date.parse('2026-10-03T12:00:00Z'), 'Asia/Kolkata')).toBe(0);
  });

  it('shows clock times and stamps in that zone', () => {
    expect(clockTime(at, 'en', 'Asia/Kolkata')).toMatch(/0?2:00/);
    expect(clockTime(at, 'en', 'UTC')).toMatch(/0?8:30/);
    expect(fullStamp(at, 'en', 'Asia/Kolkata')).toMatch(/Oct 3, 2026|3 Oct 2026/);
    expect(fullStamp(at, 'en', 'America/New_York')).toMatch(/Oct 2, 2026|2 Oct 2026/);
    expect(dayLabel(at, now, 'en', 'Asia/Kolkata').toLowerCase()).toBe('today');
  });

  it('lists the clock for today in that zone', () => {
    expect(listTime(at, now, 'en', 'Asia/Kolkata')).toMatch(/0?2:00/);
  });
});

describe('listTime', () => {
  it('says now for the last seconds and minutes ago after that', () => {
    expect(listTime(new Date(NOW - 10_000).toISOString(), NOW, 'en').toLowerCase()).toContain(
      'now',
    );
    expect(listTime(new Date(NOW - 5 * 60_000).toISOString(), NOW, 'en')).toMatch(/5/);
  });

  it('shows the clock for earlier today and a date after a week', () => {
    expect(listTime(local(2, 1, 5), NOW, 'en')).toMatch(/1:05|01:05/);
    expect(listTime(new Date(2026, 8, 1, 12).toISOString(), NOW, 'en')).toMatch(/1|Sep/);
  });

  it('is empty for no date', () => {
    expect(listTime(null, NOW, 'en')).toBe('');
  });
});

describe('small helpers', () => {
  it('formats sizes', () => {
    expect(humanSize(512)).toBe('512 B');
    expect(humanSize(2048)).toBe('2.0 KB');
    expect(humanSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('takes initials from the first and last word', () => {
    expect(initials('Asha Verma')).toBe('AV');
    expect(initials('  madonna ')).toBe('M');
    expect(initials('')).toBe('?');
    expect(initials('+91 98765 43210')).toBe('94');
    expect(initials('+918858734844')).toBe('9');
  });

  it('gives the same person the same colour', () => {
    expect(avatarColor('abc')).toBe(avatarColor('abc'));
  });
});

describe('snoozeLeft: how long a snooze still has', () => {
  const now = Date.parse('2026-10-16T10:00:00.000Z');
  const at = (ms: number) => new Date(now + ms).toISOString();

  it('is due when the time has come or passed', () => {
    expect(snoozeLeft(at(0), now)).toEqual({ kind: 'due' });
    expect(snoozeLeft(at(-60_000), now)).toEqual({ kind: 'due' });
  });

  it('counts minutes under an hour, hours under a day, then days', () => {
    expect(snoozeLeft(at(20_000), now)).toEqual({ kind: 'minutes', count: 1 });
    expect(snoozeLeft(at(45 * 60_000), now)).toEqual({ kind: 'minutes', count: 45 });
    expect(snoozeLeft(at(2 * 3_600_000), now)).toEqual({ kind: 'hours', count: 2 });
    expect(snoozeLeft(at(5 * 86_400_000), now)).toEqual({ kind: 'days', count: 5 });
  });

  it('maps to the message key and count the row and the header translate', () => {
    expect(snoozeLeftMessage({ kind: 'due' })).toEqual({ key: 'snoozeLeft.due', values: {} });
    expect(snoozeLeftMessage({ kind: 'hours', count: 3 })).toEqual({
      key: 'snoozeLeft.hours',
      values: { count: 3 },
    });
  });
});
