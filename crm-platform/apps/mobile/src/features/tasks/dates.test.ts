import { createTaskSchema } from '@crm/contracts';
import {
  formatIsoWithOffset,
  formatMoment,
  fromDueAt,
  parseDateText,
  parseTimeText,
  toDueAt,
} from './dates';

describe('parseDateText', () => {
  it('accepts a real day and pads single digits', () => {
    expect(parseDateText('2026-10-31')).toBe('2026-10-31');
    expect(parseDateText(' 2026-1-5 ')).toBe('2026-01-05');
  });

  it('refuses text that is not a day on the calendar', () => {
    expect(parseDateText('')).toBeNull();
    expect(parseDateText('31-10-2026')).toBeNull();
    expect(parseDateText('2026-13-01')).toBeNull();
    expect(parseDateText('2026-02-30')).toBeNull();
    expect(parseDateText('2025-02-29')).toBeNull();
    expect(parseDateText('2024-02-29')).toBe('2024-02-29');
  });
});

describe('parseTimeText', () => {
  it('accepts a time on a 24-hour clock and pads the hour', () => {
    expect(parseTimeText('14:30')).toBe('14:30');
    expect(parseTimeText('9:05')).toBe('09:05');
    expect(parseTimeText('00:00')).toBe('00:00');
    expect(parseTimeText('23:59')).toBe('23:59');
  });

  it('refuses anything else', () => {
    expect(parseTimeText('')).toBeNull();
    expect(parseTimeText('24:00')).toBeNull();
    expect(parseTimeText('12:60')).toBeNull();
    expect(parseTimeText('1230')).toBeNull();
    expect(parseTimeText('12:3')).toBeNull();
    expect(parseTimeText('2 PM')).toBeNull();
  });
});

describe('formatIsoWithOffset', () => {
  // 2026-10-12 10:00 UTC.
  const instant = new Date(Date.UTC(2026, 9, 12, 10, 0, 0));

  it('writes the wall clock of the offset, east of UTC', () => {
    expect(formatIsoWithOffset(instant, 330)).toBe('2026-10-12T15:30:00+05:30');
  });

  it('writes a negative offset with a minus sign', () => {
    expect(formatIsoWithOffset(instant, -300)).toBe('2026-10-12T05:00:00-05:00');
  });

  it('writes +00:00 for UTC', () => {
    expect(formatIsoWithOffset(instant, 0)).toBe('2026-10-12T10:00:00+00:00');
  });

  it('rolls the day over when the offset crosses midnight', () => {
    expect(formatIsoWithOffset(new Date(Date.UTC(2026, 9, 12, 20, 0, 0)), 330)).toBe(
      '2026-10-13T01:30:00+05:30',
    );
  });

  it('is an instant the API accepts', () => {
    for (const offset of [330, -300, 0, 545, -720]) {
      const parsed = createTaskSchema.safeParse({
        title: 'x',
        dueAt: formatIsoWithOffset(instant, offset),
      });
      expect(parsed.success).toBe(true);
    }
  });
});

describe('toDueAt', () => {
  it('turns the typed day and time into the phone wall clock with its UTC offset', () => {
    const iso = toDueAt('2026-10-12', '15:30');
    expect(iso).toMatch(/^2026-10-12T15:30:00[+-]\d{2}:\d{2}$/);
    // The same instant as the phone's own idea of that moment.
    expect(new Date(iso as string).getTime()).toBe(new Date(2026, 9, 12, 15, 30).getTime());
  });

  it('gives a due date the API accepts', () => {
    const dueAt = toDueAt('2026-01-05', '9:05');
    expect(createTaskSchema.safeParse({ title: 'x', dueAt }).success).toBe(true);
  });

  it('is null when the day or the time is not valid', () => {
    expect(toDueAt('2026-02-30', '10:00')).toBeNull();
    expect(toDueAt('2026-02-20', '25:00')).toBeNull();
    expect(toDueAt('', '10:00')).toBeNull();
    expect(toDueAt('2026-02-20', '')).toBeNull();
  });
});

describe('fromDueAt', () => {
  it('splits a stored instant into the two fields on the phone clock', () => {
    const local = new Date(2026, 9, 12, 7, 5);
    expect(fromDueAt(local.toISOString())).toEqual({ date: '2026-10-12', time: '07:05' });
  });

  it('round-trips with toDueAt', () => {
    const iso = toDueAt('2026-12-31', '23:45') as string;
    expect(fromDueAt(iso)).toEqual({ date: '2026-12-31', time: '23:45' });
  });

  it('leaves both fields empty without a due date', () => {
    expect(fromDueAt(null)).toEqual({ date: '', time: '' });
    expect(fromDueAt('not a date')).toEqual({ date: '', time: '' });
  });
});

describe('formatMoment', () => {
  it('reads "DD MMM, YYYY hh:mm A"', () => {
    const local = new Date(2026, 9, 12, 15, 30);
    expect(formatMoment(local.toISOString(), 'en')).toBe('12 Oct, 2026 03:30 PM');
    expect(formatMoment(new Date(2026, 0, 5, 9, 5).toISOString(), 'en')).toBe(
      '05 Jan, 2026 09:05 AM',
    );
  });

  it('is empty without a date or with one that is not', () => {
    expect(formatMoment(null, 'en')).toBe('');
    expect(formatMoment(undefined, 'en')).toBe('');
    expect(formatMoment('nonsense', 'en')).toBe('');
  });
});
