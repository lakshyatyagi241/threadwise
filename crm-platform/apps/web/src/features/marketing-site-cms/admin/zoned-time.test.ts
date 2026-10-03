import { describe, expect, it } from 'vitest';
import { instantToLocal, localToInstant, zoneList } from './zoned-time';

describe('localToInstant', () => {
  it('reads the wall time in the chosen zone, not in the machine zone', () => {
    expect(localToInstant('2030-01-01T09:00', 'Asia/Kolkata')).toBe('2030-01-01T03:30:00.000Z');
    expect(localToInstant('2030-01-01T09:00', 'UTC')).toBe('2030-01-01T09:00:00.000Z');
    expect(localToInstant('2030-07-01T09:00', 'America/New_York')).toBe('2030-07-01T13:00:00.000Z');
    expect(localToInstant('2030-01-01T09:00', 'America/New_York')).toBe('2030-01-01T14:00:00.000Z');
  });
  it('is exact on the day clocks change', () => {
    // Europe/Berlin springs forward on 2030-03-31: 03:30 local is UTC+2.
    expect(localToInstant('2030-03-31T03:30', 'Europe/Berlin')).toBe('2030-03-31T01:30:00.000Z');
  });
  it('gives null for an empty or malformed value or an unknown zone', () => {
    expect(localToInstant('', 'UTC')).toBeNull();
    expect(localToInstant('tomorrow', 'UTC')).toBeNull();
    expect(localToInstant('2030-01-01T09:00', 'Not/AZone')).toBeNull();
  });
});

describe('instantToLocal', () => {
  it('is the inverse of localToInstant', () => {
    for (const zone of ['Asia/Kolkata', 'America/New_York', 'Australia/Sydney', 'UTC']) {
      const iso = localToInstant('2031-05-17T22:45', zone)!;
      expect(instantToLocal(iso, zone)).toBe('2031-05-17T22:45');
    }
    expect(instantToLocal(null, 'UTC')).toBe('');
  });
});

describe('zoneList', () => {
  it('puts the current zone first and lists it once', () => {
    const list = zoneList('Asia/Kolkata');
    expect(list[0]).toBe('Asia/Kolkata');
    expect(list.filter((z) => z === 'Asia/Kolkata')).toHaveLength(1);
  });
});
