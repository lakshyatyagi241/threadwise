import { describe, expect, it } from 'vitest';
import {
  businessHoursDaySchema,
  businessHoursHolidaysSchema,
  updateBusinessHoursSchema,
  updateWorkingHoursSchema,
} from '@crm/contracts';
import { hasSplitDays, isOutsideBusinessHours } from '../../../src/common/business-hours';
import {
  defaultBusinessHoursDays,
  mergeBusinessHours,
  readBusinessHoursDays,
  readBusinessHoursHolidays,
  sameDays,
  sameHolidays,
} from '../../../src/common/business-hours-schedule';
import { addBusinessMinutes } from '../../../src/common/sla-time';
import { businessHoursFor } from '../../../src/modules/platform-support-desk/sla-calculator';

const at = (s: string) => new Date(s);
const days = (over: Record<string, unknown>) => JSON.stringify({ days: over });
const on = (from: string, to: string, extra?: Array<{ from: string; to: string }>) => ({
  enabled: true,
  from,
  to,
  ...(extra ? { extra } : {}),
});

describe('several windows a day', () => {
  // 09:00-12:00 and 13:00-18:00 on Monday (lunch break), UTC.
  const lunch = days({ mon: on('09:00', '12:00', [{ from: '13:00', to: '18:00' }]) });

  it('is open in each window and closed in the break and outside them', () => {
    expect(isOutsideBusinessHours(lunch, 'UTC', at('2026-10-05T10:00:00Z'))).toBe(false);
    expect(isOutsideBusinessHours(lunch, 'UTC', at('2026-10-05T12:30:00Z'))).toBe(true);
    expect(isOutsideBusinessHours(lunch, 'UTC', at('2026-10-05T13:00:00Z'))).toBe(false);
    expect(isOutsideBusinessHours(lunch, 'UTC', at('2026-10-05T18:00:00Z'))).toBe(true);
  });

  it('a switched-off day closes all its windows', () => {
    const off = days({
      mon: { enabled: false, from: '09:00', to: '12:00', extra: [{ from: '13:00', to: '18:00' }] },
    });
    expect(isOutsideBusinessHours(off, 'UTC', at('2026-10-05T10:00:00Z'))).toBe(true);
  });

  it('knows a schedule has a split day', () => {
    expect(hasSplitDays(lunch)).toBe(true);
    expect(hasSplitDays(days({ mon: on('09:00', '18:00') }))).toBe(false);
  });
});

describe('24:00 and overnight windows', () => {
  it('a window to 24:00 is open until the last minute of the day', () => {
    const h = days({ mon: on('08:00', '24:00') });
    expect(isOutsideBusinessHours(h, 'UTC', at('2026-10-05T23:59:00Z'))).toBe(false);
    expect(isOutsideBusinessHours(h, 'UTC', at('2026-10-06T00:00:00Z'))).toBe(true); // Tuesday
  });

  it('an overnight window runs into the next morning, even when that day is off', () => {
    const h = days({
      fri: on('22:00', '06:00'),
      sat: { enabled: false, from: '09:00', to: '18:00' },
    });
    expect(isOutsideBusinessHours(h, 'UTC', at('2026-10-09T23:00:00Z'))).toBe(false); // Friday night
    expect(isOutsideBusinessHours(h, 'UTC', at('2026-10-10T05:59:00Z'))).toBe(false); // Saturday small hours
    expect(isOutsideBusinessHours(h, 'UTC', at('2026-10-10T06:00:00Z'))).toBe(true);
  });

  it('an overnight window can be combined with a daytime one', () => {
    const h = days({ mon: on('09:00', '12:00', [{ from: '22:00', to: '02:00' }]) });
    expect(isOutsideBusinessHours(h, 'UTC', at('2026-10-05T23:30:00Z'))).toBe(false);
    expect(isOutsideBusinessHours(h, 'UTC', at('2026-10-06T01:00:00Z'))).toBe(false);
    expect(isOutsideBusinessHours(h, 'UTC', at('2026-10-06T03:00:00Z'))).toBe(true);
  });
});

describe('holidays', () => {
  const h = JSON.stringify({
    days: { fri: on('09:00', '18:00') },
    holidays: [{ date: '2026-12-25', label: 'Christmas' }],
  });

  it('closes a listed date all day, in the workspace zone', () => {
    // Friday 25 December: closed. The week before: open.
    expect(isOutsideBusinessHours(h, 'UTC', at('2026-12-25T10:00:00Z'))).toBe(true);
    expect(isOutsideBusinessHours(h, 'UTC', at('2026-12-18T10:00:00Z'))).toBe(false);
    // 04:00 UTC on 25 Dec is 09:30 in Kolkata (the 25th) and 20:00 on the 24th in Los Angeles: the date is read in the workspace zone.
    expect(isOutsideBusinessHours(h, 'Asia/Kolkata', at('2026-12-25T04:00:00Z'))).toBe(true);
    expect(isOutsideBusinessHours(h, 'America/Los_Angeles', at('2026-12-25T18:00:00Z'))).toBe(true); // 10:00 on the 25th
  });

  it('ignores a malformed holiday list', () => {
    const bad = JSON.stringify({ days: { mon: on('09:00', '18:00') }, holidays: 'soon' });
    expect(isOutsideBusinessHours(bad, 'UTC', at('2026-10-05T10:00:00Z'))).toBe(false);
  });
});

describe('daylight saving time', () => {
  const ny = days({ mon: on('09:00', '17:00') });

  it('reads the wall clock on both sides of the change', () => {
    // US clocks went forward on 8 March 2026: 09:00 Monday 9 March is 13:00 UTC; before the change it was 14:00 UTC.
    expect(isOutsideBusinessHours(ny, 'America/New_York', at('2026-03-09T13:00:00Z'))).toBe(false);
    expect(isOutsideBusinessHours(ny, 'America/New_York', at('2026-03-09T12:59:00Z'))).toBe(true);
    expect(isOutsideBusinessHours(ny, 'America/New_York', at('2026-03-02T13:59:00Z'))).toBe(true);
    expect(isOutsideBusinessHours(ny, 'America/New_York', at('2026-03-02T14:00:00Z'))).toBe(false);
  });

  it('an SLA clock across the change still counts open time as 09:00-17:00 local', () => {
    // Started Friday 6 March 2026 16:00 New York (EST, 21:00 UTC); 1h left Friday, resume Monday 09:00 EDT (13:00 UTC).
    const h = days({
      mon: on('09:00', '17:00'),
      tue: on('09:00', '17:00'),
      wed: on('09:00', '17:00'),
      thu: on('09:00', '17:00'),
      fri: on('09:00', '17:00'),
    });
    const due = addBusinessMinutes(at('2026-03-06T21:00:00Z'), 180, h, 'America/New_York');
    expect(due.toISOString()).toBe('2026-03-09T15:00:00.000Z'); // Monday 11:00 EDT: 1h Friday + 2h Monday
  });
});

describe('SLA clock with a break', () => {
  const lunch = days({
    mon: on('09:00', '12:00', [{ from: '12:30', to: '17:00' }]),
    tue: on('09:00', '12:00', [{ from: '12:30', to: '17:00' }]),
  });

  it('does not count the break', () => {
    // 2h from 11:00 Monday: one hour to 12:00, then the break, then 12:30-13:30.
    const due = addBusinessMinutes(at('2026-10-05T11:00:00Z'), 120, lunch, 'UTC');
    expect(due.toISOString()).toBe('2026-10-05T13:30:00.000Z');
  });

  it('counts across the end of the day into the next window', () => {
    const due = addBusinessMinutes(at('2026-10-05T16:00:00Z'), 120, lunch, 'UTC');
    expect(due.toISOString()).toBe('2026-10-06T10:00:00.000Z'); // 1h Monday, 1h from Tuesday 09:00
  });

  it('skips a holiday', () => {
    const h = JSON.stringify({
      days: { mon: on('09:00', '17:00'), tue: on('09:00', '17:00') },
      holidays: [{ date: '2026-10-06' }],
    });
    const due = addBusinessMinutes(at('2026-10-05T16:00:00Z'), 120, h, 'UTC');
    expect(due.toISOString()).toBe('2026-10-12T10:00:00.000Z'); // the Tuesday is closed: Monday 17:00 -> next Monday 10:00
  });
});

describe('the day and holiday contract', () => {
  it('accepts a window, extra windows, overnight and 24:00', () => {
    expect(businessHoursDaySchema.safeParse(on('09:00', '18:00')).success).toBe(true);
    expect(businessHoursDaySchema.safeParse(on('22:00', '06:00')).success).toBe(true);
    expect(businessHoursDaySchema.safeParse(on('00:00', '24:00')).success).toBe(true);
    expect(
      businessHoursDaySchema.safeParse(on('09:00', '12:00', [{ from: '13:00', to: '17:00' }]))
        .success,
    ).toBe(true);
  });

  it('rejects equal times, 24:00 as an opening time, overlaps and a fourth window', () => {
    expect(businessHoursDaySchema.safeParse(on('09:00', '09:00')).success).toBe(false);
    expect(businessHoursDaySchema.safeParse(on('24:00', '06:00')).success).toBe(false);
    expect(
      businessHoursDaySchema.safeParse(on('09:00', '13:00', [{ from: '12:00', to: '17:00' }]))
        .success,
    ).toBe(false);
    const w = (from: string, to: string) => ({ from, to });
    expect(
      businessHoursDaySchema.safeParse(
        on('01:00', '02:00', [w('03:00', '04:00'), w('05:00', '06:00'), w('07:00', '08:00')]),
      ).success,
    ).toBe(false);
  });

  it('checks holidays: real dates, once each, at most 100', () => {
    expect(businessHoursHolidaysSchema.safeParse([{ date: '2026-12-25' }]).success).toBe(true);
    expect(businessHoursHolidaysSchema.safeParse([{ date: '2026-02-30' }]).success).toBe(false);
    expect(businessHoursHolidaysSchema.safeParse([{ date: '25/12/2026' }]).success).toBe(false);
    expect(
      businessHoursHolidaysSchema.safeParse([{ date: '2026-12-25' }, { date: '2026-12-25' }])
        .success,
    ).toBe(false);
    const many = Array.from({ length: 101 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
    }));
    expect(businessHoursHolidaysSchema.safeParse(many).success).toBe(false);
  });

  it('the settings body needs seven days; holidays are optional; the Settings body takes no zone', () => {
    const week = Object.fromEntries(
      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, on('09:00', '18:00')]),
    );
    expect(updateBusinessHoursSchema.safeParse({ days: week }).success).toBe(true);
    expect(
      updateBusinessHoursSchema.safeParse({ days: { mon: on('09:00', '18:00') } }).success,
    ).toBe(false);
    expect(updateBusinessHoursSchema.safeParse({ days: week, timezone: 'Mars/Base' }).success).toBe(
      false,
    );
    expect(updateWorkingHoursSchema.safeParse({ days: week, holidays: [] }).success).toBe(true);
    expect(updateWorkingHoursSchema.safeParse({ days: week, timezone: 'UTC' }).success).toBe(false);
  });
});

describe('reading and saving the schedule', () => {
  it('keeps extra windows and an overnight window, and falls back for equal times', () => {
    const saved = days({
      mon: on('09:00', '12:00', [{ from: '13:00', to: '17:00' }]),
      tue: on('22:00', '06:00'),
      wed: { enabled: true, from: '10:00', to: '10:00' },
    });
    const d = readBusinessHoursDays(saved);
    expect(d.mon.extra).toEqual([{ from: '13:00', to: '17:00' }]);
    expect(d.tue).toEqual(on('22:00', '06:00'));
    expect(d.wed).toEqual(defaultBusinessHoursDays().wed);
  });

  it('reads holidays: drops malformed and duplicate ones, oldest first', () => {
    const raw = JSON.stringify({
      holidays: [
        { date: '2026-12-25', label: 'Christmas' },
        { date: 'x' },
        { date: '2026-01-01' },
        { date: '2026-12-25' },
      ],
    });
    expect(readBusinessHoursHolidays(raw)).toEqual([
      { date: '2026-01-01' },
      { date: '2026-12-25', label: 'Christmas' },
    ]);
    expect(readBusinessHoursHolidays(null)).toEqual([]);
    expect(readBusinessHoursHolidays('not json')).toEqual([]);
  });

  it('a save keeps unrelated keys and holidays when none are sent, and replaces them when sent', () => {
    const prior = JSON.stringify({
      days: defaultBusinessHoursDays(),
      holidays: [{ date: '2026-12-25' }],
      outside: { message: 'We are closed' },
    });
    const next = defaultBusinessHoursDays();
    next.sat = on('10:00', '14:00');
    const kept = JSON.parse(mergeBusinessHours(prior, next));
    expect(kept.outside).toEqual({ message: 'We are closed' });
    expect(kept.holidays).toEqual([{ date: '2026-12-25' }]);
    expect(kept.days.sat.enabled).toBe(true);
    const replaced = JSON.parse(
      mergeBusinessHours(prior, next, [{ date: '2027-01-01' }, { date: '2026-12-31' }]),
    );
    expect(replaced.holidays).toEqual([{ date: '2026-12-31' }, { date: '2027-01-01' }]);
    expect(JSON.parse(mergeBusinessHours(prior, next, [])).holidays).toBeUndefined();
  });

  it('notices a change in windows or holidays', () => {
    const a = defaultBusinessHoursDays();
    const b = defaultBusinessHoursDays();
    expect(sameDays(a, b)).toBe(true);
    b.mon = on('09:00', '12:00', [{ from: '13:00', to: '18:00' }]);
    expect(sameDays(a, b)).toBe(false);
    expect(sameHolidays([{ date: '2026-12-25' }], [{ date: '2026-12-25', label: 'x' }])).toBe(
      false,
    );
    expect(sameHolidays([{ date: '2026-12-25' }], [{ date: '2026-12-25' }])).toBe(true);
  });
});

describe('the helpdesk SLA reads the Settings shape', () => {
  it('takes the first window of an enabled day, closes a switched-off one and keeps the workspace zone', () => {
    const bh = businessHoursFor(
      days({
        mon: on('08:00', '16:00'),
        tue: { enabled: false, from: '09:00', to: '18:00' },
        wed: on('00:00', '24:00'),
      }),
      'Asia/Kolkata',
    );
    expect(bh.tz).toBe('Asia/Kolkata');
    expect(bh.days.mon).toEqual(['08:00', '16:00']);
    expect(bh.days.tue).toBeNull();
    expect(bh.days.wed).toEqual(['00:00', '23:59']);
  });

  it('still reads Reference pairs', () => {
    expect(
      businessHoursFor({ days: { mon: ['09:00', '17:00'], sat: null } }, null).days.mon,
    ).toEqual(['09:00', '17:00']);
  });
});
