import { describe, expect, it } from 'vitest';
import { formatWhen, localDateTime, parseTime, timezoneList, wallToEpoch } from './time';

describe('time zones', () => {
  it('lists UTC first, then real zones, without repeats', () => {
    const z = timezoneList();
    expect(z[0]).toBe('UTC');
    expect(z.some((x) => x === 'Asia/Kolkata' || x === 'Asia/Calcutta')).toBe(true);
    expect(new Set(z).size).toBe(z.length);
  });

  it('reads 24 hour and 12 hour times', () => {
    expect(parseTime('14:30')).toBe(870);
    expect(parseTime('2:30 PM')).toBe(870);
    expect(parseTime('12:05 am')).toBe(5);
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('13:00 PM')).toBeNull();
    expect(parseTime('nine')).toBeNull();
  });

  it('turns wall time in a zone into the right instant', () => {
    expect(wallToEpoch('2026-10-10', '10:00', 'UTC')).toBe(Date.UTC(2026, 9, 10, 10, 0));
    // Kolkata is UTC+5:30 with no daylight saving.
    expect(wallToEpoch('2026-10-10', '10:00', 'Asia/Kolkata')).toBe(Date.UTC(2026, 9, 10, 4, 30));
    // New York is UTC-4 on 10 October (daylight time) and UTC-5 in January.
    expect(wallToEpoch('2026-10-10', '10:00', 'America/New_York')).toBe(
      Date.UTC(2026, 9, 10, 14, 0),
    );
    expect(wallToEpoch('2026-01-10', '10:00', 'America/New_York')).toBe(
      Date.UTC(2026, 0, 10, 15, 0),
    );
  });

  it('is null for unreadable input or a zone it does not know', () => {
    expect(wallToEpoch('10/10/2026', '10:00', 'UTC')).toBeNull();
    expect(wallToEpoch('2026-10-10', 'x', 'UTC')).toBeNull();
    expect(wallToEpoch('2026-10-10', '10:00', 'Not/AZone')).toBeNull();
  });

  it('round trips an instant through a zone', () => {
    const ms = Date.UTC(2026, 9, 10, 4, 30);
    expect(localDateTime(ms, 'Asia/Kolkata')).toEqual({ date: '2026-10-10', time: '10:00' });
    expect(wallToEpoch('2026-10-10', '10:00', 'Asia/Kolkata')).toBe(ms);
  });

  it('words a time as the list shows it', () => {
    expect(formatWhen('2026-10-10T04:30:00.000Z', 'Asia/Kolkata')).toBe('Oct 10 · 10:00');
    expect(formatWhen('nope', 'UTC')).toBe('—');
  });
});
