import { spanDays } from '@/components/ui/calendar-range.dates';
import {
  DEFAULT_PRESET,
  MAX_SPAN_DAYS,
  PRESETS,
  isValidRange,
  presetOf,
  presetRange,
  todayIn,
} from './date-range';

describe('todayIn', () => {
  const evening = new Date('2026-10-12T20:00:00.000Z');

  it('reads the day in the workspace zone, which can be a day ahead of UTC', () => {
    expect(todayIn('UTC', evening)).toBe('2026-10-12');
    // India is 5 hours 30 minutes ahead: 20:00 UTC is already 01:30 the next day.
    expect(todayIn('Asia/Kolkata', evening)).toBe('2026-10-13');
    expect(todayIn('Pacific/Kiritimati', evening)).toBe('2026-10-13');
  });

  it('reads the day in a zone behind UTC', () => {
    expect(todayIn('America/Los_Angeles', new Date('2026-10-12T05:00:00.000Z'))).toBe('2026-10-11');
    expect(todayIn('America/Los_Angeles', evening)).toBe('2026-10-12');
  });

  it('turns over exactly at local midnight', () => {
    expect(todayIn('Asia/Kolkata', new Date('2026-10-12T18:29:59.000Z'))).toBe('2026-10-12');
    expect(todayIn('Asia/Kolkata', new Date('2026-10-12T18:30:00.000Z'))).toBe('2026-10-13');
  });

  it('turns over the year and the leap day', () => {
    expect(todayIn('Asia/Kolkata', new Date('2026-12-31T23:30:00.000Z'))).toBe('2027-01-01');
    expect(todayIn('Asia/Kolkata', new Date('2024-02-28T20:00:00.000Z'))).toBe('2024-02-29');
    expect(todayIn('Asia/Kolkata', new Date('2023-02-28T20:00:00.000Z'))).toBe('2023-03-01');
  });

  it('falls back to UTC for a missing or unknown zone', () => {
    expect(todayIn(undefined, evening)).toBe('2026-10-12');
    expect(todayIn('', evening)).toBe('2026-10-12');
    expect(todayIn('Not/AZone', evening)).toBe('2026-10-12');
    expect(todayIn('Not/AZone', new Date('2026-10-12T23:59:00.000Z'))).toBe('2026-10-12');
  });

  it('uses the current time when none is given', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-12T20:00:00.000Z'));
    try {
      expect(todayIn('Asia/Kolkata')).toBe('2026-10-13');
      expect(todayIn(undefined)).toBe('2026-10-12');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('presetRange', () => {
  const today = '2026-10-12';

  it('is the day itself for today and the day before for yesterday', () => {
    expect(presetRange('today', today)).toEqual({ from: today, to: today });
    expect(presetRange('yesterday', today)).toEqual({ from: '2026-10-11', to: '2026-10-11' });
  });

  it('counts the last N days back from today, today included', () => {
    expect(presetRange('last7', today)).toEqual({ from: '2026-10-06', to: today });
    expect(presetRange('last30', today)).toEqual({ from: '2026-09-13', to: today });
    expect(presetRange('last90', today)).toEqual({ from: '2026-07-15', to: today });
  });

  it('covers exactly N days whatever the month lengths', () => {
    for (const day of ['2026-10-12', '2026-03-01', '2024-03-01', '2026-01-03', '2024-12-31']) {
      const r = (p: (typeof PRESETS)[number]) => presetRange(p, day);
      expect(spanDays(r('last7').from, r('last7').to)).toBe(7);
      expect(spanDays(r('last30').from, r('last30').to)).toBe(30);
      expect(spanDays(r('last90').from, r('last90').to)).toBe(90);
    }
  });

  it('steps over month ends, leap days and year ends', () => {
    expect(presetRange('yesterday', '2026-03-01').from).toBe('2026-02-28');
    expect(presetRange('yesterday', '2024-03-01').from).toBe('2024-02-29');
    expect(presetRange('yesterday', '2027-01-01').from).toBe('2026-12-31');
    expect(presetRange('last7', '2026-01-03').from).toBe('2025-12-28');
    expect(presetRange('last30', '2024-03-01').from).toBe('2024-02-01');
    expect(presetRange('last30', '2023-03-01').from).toBe('2023-01-31');
    expect(presetRange('last90', '2024-03-01').from).toBe('2023-12-03');
  });
});

describe('presetOf', () => {
  const today = '2026-10-12';

  it('finds the preset a range equals', () => {
    for (const preset of PRESETS) {
      expect(presetOf(presetRange(preset, today), today)).toBe(preset);
    }
  });

  it('is null for a range of the person own', () => {
    expect(presetOf({ from: '2026-10-01', to: '2026-10-12' }, today)).toBeNull();
    expect(presetOf({ from: '2026-09-13', to: '2026-10-11' }, today)).toBeNull();
    expect(presetOf({ from: '2026-09-12', to: '2026-10-12' }, today)).toBeNull();
    expect(presetOf({ from: '2026-10-06', to: '2026-10-12' }, '2026-10-13')).toBeNull();
  });

  it('follows the day: last night range is no longer "last 30 days" tomorrow', () => {
    const range = presetRange('last30', today);
    expect(presetOf(range, '2026-10-13')).toBeNull();
  });
});

describe('constants', () => {
  it('opens on the last 30 days and allows a year and a day', () => {
    expect(DEFAULT_PRESET).toBe('last30');
    expect(MAX_SPAN_DAYS).toBe(366);
    expect(PRESETS).toEqual(['today', 'yesterday', 'last7', 'last30', 'last90']);
  });
});

describe('isValidRange', () => {
  const today = '2026-10-12';

  it('accepts a normal range, a single day and the presets', () => {
    expect(isValidRange({ from: '2026-09-13', to: '2026-10-12' }, today)).toBe(true);
    expect(isValidRange({ from: '2026-10-05', to: '2026-10-05' }, today)).toBe(true);
    for (const preset of PRESETS)
      expect(isValidRange(presetRange(preset, today), today)).toBe(true);
  });

  it('refuses a range that ends before it starts', () => {
    expect(isValidRange({ from: '2026-10-12', to: '2026-10-11' }, today)).toBe(false);
  });

  it('refuses a future day', () => {
    expect(isValidRange({ from: '2026-10-12', to: '2026-10-13' }, today)).toBe(false);
    expect(isValidRange({ from: '2026-10-13', to: '2026-10-13' }, today)).toBe(false);
  });

  it('allows 366 days and not 367', () => {
    expect(isValidRange({ from: '2025-10-12', to: today }, today)).toBe(true); // 366 days counting both ends
    expect(isValidRange({ from: '2025-10-11', to: today }, today)).toBe(false); // 367 days
    // A leap year in between: 366 days from 2023-10-12 ends on 2024-10-11, 367 on 2024-10-12.
    expect(isValidRange({ from: '2023-10-12', to: '2024-10-11' }, '2024-10-11')).toBe(true);
    expect(isValidRange({ from: '2023-10-12', to: '2024-10-12' }, '2024-10-12')).toBe(false);
  });

  it('refuses days that do not exist', () => {
    expect(isValidRange({ from: '2026-02-30', to: '2026-03-01' }, today)).toBe(false);
    expect(isValidRange({ from: '2026-09-13', to: 'later' }, today)).toBe(false);
    expect(isValidRange({ from: '2026-09-13', to: '2026-10-12' }, 'now')).toBe(false);
  });
});
