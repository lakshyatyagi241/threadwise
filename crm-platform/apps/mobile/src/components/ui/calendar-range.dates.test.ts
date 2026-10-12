import {
  addDays,
  addMonths,
  compareDates,
  compareMonths,
  daysBetween,
  daysInMonth,
  formatDate,
  isDateString,
  longDateLabel,
  monthGrid,
  monthOf,
  monthTitle,
  orderDates,
  parseDate,
  spanDays,
  weekdayNames,
  weekdayOf,
} from './calendar-range.dates';

describe('parseDate / isDateString', () => {
  it('reads a real day', () => {
    expect(parseDate('2026-10-12')).toEqual({ year: 2026, month: 10, day: 12 });
    expect(isDateString('2026-10-12')).toBe(true);
  });

  it('knows which Februaries have a 29th', () => {
    expect(isDateString('2024-02-29')).toBe(true);
    expect(isDateString('2000-02-29')).toBe(true);
    expect(isDateString('2023-02-29')).toBe(false);
    expect(isDateString('2100-02-29')).toBe(false);
  });

  it.each([
    '2026-02-30',
    '2026-13-01',
    '2026-00-10',
    '2026-10-00',
    '2026-10-32',
    '2026-4-05',
    '26-10-12',
    '2026-10-12T00:00:00Z',
    '',
    'tomorrow',
  ])('rejects %p', (value) => {
    expect(isDateString(value)).toBe(false);
    expect(parseDate(value)).toBeNull();
  });

  it('rejects what is not text', () => {
    expect(isDateString(null)).toBe(false);
    expect(isDateString(20261012)).toBe(false);
  });
});

describe('addDays', () => {
  it('crosses month ends', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-04-30', 1)).toBe('2026-05-01');
  });

  it('crosses year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('has a 29th of February in leap years only', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
    expect(addDays('2023-02-28', 1)).toBe('2023-03-01');
    expect(addDays('2100-02-28', 1)).toBe('2100-03-01');
    expect(addDays('2000-02-28', 1)).toBe('2000-02-29');
  });

  it('adds whole weeks, months and years of days', () => {
    expect(addDays('2026-10-12', 0)).toBe('2026-10-12');
    expect(addDays('2026-10-12', -29)).toBe('2026-09-13');
    expect(addDays('2026-10-12', 366)).toBe('2027-10-13');
    expect(addDays('2024-01-01', 366)).toBe('2025-01-01');
  });

  it('does not slip an hour over a clock change', () => {
    // 2026-03-29 and 2026-10-25 are the European clock changes; 2026-03-08 and 2026-11-01 the American ones.
    for (const day of ['2026-03-29', '2026-10-25', '2026-03-08', '2026-11-01']) {
      expect(addDays(addDays(day, 1), -1)).toBe(day);
      expect(daysBetween(day, addDays(day, 1))).toBe(1);
    }
  });

  it('refuses a text that is not a day instead of guessing', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
  });
});

describe('daysBetween / spanDays / compareDates / orderDates', () => {
  it('counts the days from one to the other, with a sign', () => {
    expect(daysBetween('2026-09-13', '2026-10-12')).toBe(29);
    expect(daysBetween('2026-10-12', '2026-09-13')).toBe(-29);
    expect(daysBetween('2026-10-12', '2026-10-12')).toBe(0);
  });

  it('counts across a leap day and across years', () => {
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2023-02-28', '2023-03-01')).toBe(1);
    expect(daysBetween('2023-01-01', '2024-01-01')).toBe(365);
    expect(daysBetween('2024-01-01', '2025-01-01')).toBe(366);
  });

  it('counts both ends of a range', () => {
    expect(spanDays('2026-10-12', '2026-10-12')).toBe(1);
    expect(spanDays('2026-09-13', '2026-10-12')).toBe(30);
    expect(spanDays('2026-10-12', '2026-09-13')).toBe(30);
  });

  it('compares days', () => {
    expect(compareDates('2026-10-11', '2026-10-12')).toBe(-1);
    expect(compareDates('2026-10-12', '2026-10-12')).toBe(0);
    expect(compareDates('2027-01-01', '2026-12-31')).toBe(1);
  });

  it('puts the earlier day first', () => {
    expect(orderDates('2026-10-12', '2026-10-05')).toEqual(['2026-10-05', '2026-10-12']);
    expect(orderDates('2026-10-05', '2026-10-12')).toEqual(['2026-10-05', '2026-10-12']);
    expect(orderDates('2026-10-05', '2026-10-05')).toEqual(['2026-10-05', '2026-10-05']);
  });
});

describe('months', () => {
  it('knows how long each month is', () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });

  it('writes a day with its zeros', () => {
    expect(formatDate(2026, 3, 4)).toBe('2026-03-04');
    expect(formatDate(985, 11, 30)).toBe('0985-11-30');
  });

  it('moves by months across years, both ways', () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths({ year: 2026, month: 10 }, 0)).toEqual({ year: 2026, month: 10 });
    expect(addMonths({ year: 2026, month: 10 }, 14)).toEqual({ year: 2027, month: 12 });
    expect(addMonths({ year: 2026, month: 10 }, -10)).toEqual({ year: 2025, month: 12 });
    expect(addMonths({ year: 2026, month: 1 }, -25)).toEqual({ year: 2023, month: 12 });
  });

  it('compares months', () => {
    expect(compareMonths({ year: 2026, month: 9 }, { year: 2026, month: 10 })).toBeLessThan(0);
    expect(compareMonths({ year: 2026, month: 10 }, { year: 2026, month: 10 })).toBe(0);
    expect(compareMonths({ year: 2027, month: 1 }, { year: 2026, month: 12 })).toBeGreaterThan(0);
  });

  it('names the month of a day', () => {
    expect(monthOf('2026-10-12')).toEqual({ year: 2026, month: 10 });
    expect(() => monthOf('nope')).toThrow(RangeError);
  });
});

describe('weekdayOf', () => {
  it('numbers the week from Sunday', () => {
    expect(weekdayOf('2023-01-01')).toBe(0);
    expect(weekdayOf('2026-10-12')).toBe(1);
    expect(weekdayOf('2026-02-28')).toBe(6);
    expect(weekdayOf('2024-02-29')).toBe(4);
  });
});

describe('monthGrid', () => {
  const days = (grid: (string | null)[][]) => grid.flat().filter((d): d is string => d !== null);

  it('is always six weeks of seven', () => {
    for (const [year, month] of [
      [2026, 10],
      [2026, 2],
      [2024, 2],
      [2026, 8],
      [2027, 1],
    ] as const) {
      const grid = monthGrid(year, month);
      expect(grid).toHaveLength(6);
      for (const week of grid) expect(week).toHaveLength(7);
    }
  });

  it('starts a month under its weekday, Sunday first, and pads with nulls', () => {
    const grid = monthGrid(2026, 10);
    // 1 October 2026 is a Thursday.
    expect(grid[0]).toEqual([null, null, null, null, '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(grid[1]?.[0]).toBe('2026-10-04');
    expect(grid[4]).toEqual([
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
    ]);
    expect(grid[5]?.every((d) => d === null)).toBe(true);
  });

  it('holds every day of the month once, in order', () => {
    for (const [year, month] of [
      [2026, 10],
      [2026, 12],
      [2024, 2],
      [2023, 2],
      [2026, 8],
    ] as const) {
      const all = days(monthGrid(year, month));
      expect(all).toHaveLength(daysInMonth(year, month));
      expect(all[0]).toBe(formatDate(year, month, 1));
      expect(all.at(-1)).toBe(formatDate(year, month, daysInMonth(year, month)));
      expect(all).toEqual([...all].sort());
    }
  });

  it('fits a 31-day month that starts on a Saturday into the sixth week', () => {
    const grid = monthGrid(2026, 8);
    expect(grid[0]?.[6]).toBe('2026-08-01');
    expect(grid[5]).toEqual(['2026-08-30', '2026-08-31', null, null, null, null, null]);
  });

  it('fills a 28-day February that starts on a Sunday into exactly four weeks', () => {
    const grid = monthGrid(2026, 2);
    expect(grid[0]?.[0]).toBe('2026-02-01');
    expect(grid[3]?.[6]).toBe('2026-02-28');
    expect(grid[4]?.every((d) => d === null)).toBe(true);
  });

  it('has the 29th in a leap February', () => {
    expect(days(monthGrid(2024, 2))).toContain('2024-02-29');
    expect(days(monthGrid(2023, 2))).not.toContain('2023-02-29');
  });
});

describe('names for the screen', () => {
  it('titles a month and names a day in full', () => {
    expect(monthTitle({ year: 2026, month: 10 }, 'en')).toBe('October 2026');
    expect(longDateLabel('2026-10-12', 'en')).toBe('Monday, October 12, 2026');
  });

  it('lists the weekdays Sunday first', () => {
    expect(weekdayNames('en')).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  });

  it('writes Hindi and Marathi with ordinary digits', () => {
    for (const language of ['hi', 'mr']) {
      const title = monthTitle({ year: 2026, month: 10 }, language);
      expect(title).toContain('2026');
      expect(title).not.toMatch(/October/);
      expect(longDateLabel('2026-10-12', language)).toMatch(/12/);
      expect(weekdayNames(language)).toHaveLength(7);
      expect(new Set(weekdayNames(language)).size).toBe(7);
    }
  });

  it('falls back to plain text for a language the runtime does not know', () => {
    expect(monthTitle({ year: 2026, month: 10 }, 'not a language')).toBe('2026-10');
    expect(longDateLabel('2026-10-12', 'not a language')).toBe('2026-10-12');
    expect(weekdayNames('not a language')).toEqual(['0', '1', '2', '3', '4', '5', '6']);
  });
});
