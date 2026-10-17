import { describe, expect, it } from 'vitest';
import {
  updateWorkingHoursSchema,
  type BusinessHours,
  type BusinessHoursDayInput,
} from '@crm/contracts';
import {
  addHoliday,
  addWindow,
  checkDraft,
  copyMondayToWeekdays,
  draftFrom,
  hasProblems,
  isAllDay,
  isOvernight,
  removeWindow,
  setAllDay,
  toRequest,
} from './working-hours';

const day = (enabled: boolean, extra?: BusinessHoursDayInput['extra']): BusinessHoursDayInput => ({
  enabled,
  from: '09:00',
  to: '18:00',
  ...(extra ? { extra } : {}),
});

const hours: BusinessHours = {
  timezone: 'Asia/Kolkata',
  canEditTimezone: true,
  days: {
    mon: day(true, [{ from: '19:00', to: '21:00' }]),
    tue: day(true),
    wed: day(true),
    thu: day(true),
    fri: day(true),
    sat: day(false),
    sun: day(false),
  },
  holidays: [{ date: '2026-12-25', label: 'Christmas' }],
};

describe('working hours draft', () => {
  it('holds the first window and the extra windows as one list', () => {
    const d = draftFrom(hours);
    expect(d.days.mon.windows).toEqual([
      { from: '09:00', to: '18:00' },
      { from: '19:00', to: '21:00' },
    ]);
    expect(d.days.tue.windows).toHaveLength(1);
    expect(d.holidays).toEqual([{ date: '2026-12-25', label: 'Christmas' }]);
  });

  it('round-trips into a request the server schema accepts, unchanged', () => {
    const body = toRequest(draftFrom(hours));
    expect(updateWorkingHoursSchema.safeParse(body).success).toBe(true);
    expect(body.days.mon.extra).toEqual([{ from: '19:00', to: '21:00' }]);
    expect(body.days.tue).toEqual({ enabled: true, from: '09:00', to: '18:00' });
    expect(body.holidays).toEqual([{ date: '2026-12-25', label: 'Christmas' }]);
  });

  it('has no problems for a valid schedule and drops blank holiday labels', () => {
    const d = addHoliday(draftFrom(hours), '2027-01-01', '  ');
    expect(hasProblems(checkDraft(d))).toBe(false);
    expect(toRequest(d).holidays).toEqual([
      { date: '2026-12-25', label: 'Christmas' },
      { date: '2027-01-01' },
    ]);
  });
});

describe('working hours checks', () => {
  it('flags an empty time, equal times and overlapping windows', () => {
    const d = draftFrom(hours);
    d.days.tue.windows[0]!.to = '';
    d.days.wed.windows[0] = { from: '10:00', to: '10:00' };
    d.days.thu.windows.push({ from: '17:00', to: '20:00' });
    expect(checkDraft(d).days).toEqual({ tue: 'required', wed: 'same', thu: 'overlap' });
  });

  it('allows an overnight window and a window that ends at 24:00', () => {
    const d = draftFrom(hours);
    d.days.fri.windows = [{ from: '22:00', to: '06:00' }];
    d.days.sat.windows = [{ from: '00:00', to: '24:00' }];
    expect(hasProblems(checkDraft(d))).toBe(false);
    expect(isOvernight({ from: '22:00', to: '06:00' })).toBe(true);
    expect(isOvernight({ from: '09:00', to: '24:00' })).toBe(false);
    expect(updateWorkingHoursSchema.safeParse(toRequest(d)).success).toBe(true);
  });

  it('flags a holiday that is not a real date or is listed twice', () => {
    const d = addHoliday(addHoliday(draftFrom(hours), '2026-02-30', ''), '2026-12-25', '');
    const p = checkDraft(d).holidays;
    expect(Object.values(p).sort()).toEqual(['date', 'duplicate']);
  });
});

describe('editing helpers', () => {
  it('adds up to three windows a day and never removes the last one', () => {
    let d = draftFrom(hours).days.tue;
    d = addWindow(addWindow(addWindow(d)));
    expect(d.windows).toHaveLength(3);
    expect(removeWindow(removeWindow(removeWindow(d, 2), 1), 0).windows).toHaveLength(1);
  });

  it('keeps an added window inside the day', () => {
    const d = draftFrom(hours).days.tue;
    d.windows = [{ from: '09:00', to: '23:00' }];
    const w = addWindow(d).windows[1]!;
    expect(w.from <= w.to).toBe(true);
    expect(w.to <= '23:59').toBe(true);
  });

  it('toggles open all day', () => {
    const on = setAllDay(draftFrom(hours).days.sat, true);
    expect(isAllDay(on)).toBe(true);
    expect(isAllDay(setAllDay(on, false))).toBe(false);
  });

  it('copies Monday to the other weekdays', () => {
    const d = copyMondayToWeekdays(draftFrom(hours));
    expect(d.days.fri.windows).toEqual(d.days.mon.windows);
    expect(d.days.fri.windows).not.toBe(d.days.mon.windows);
    expect(d.days.sat.enabled).toBe(false);
  });
});
