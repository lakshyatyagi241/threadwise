import { describe, expect, it } from 'vitest';
import { zoneOptions } from './zone-select';

describe('zoneOptions', () => {
  const zones = ['Europe/London', 'Asia/Kolkata', 'America/New_York', 'UTC'];

  it('labels every zone with its bare id, with no UTC offset', () => {
    for (const o of zoneOptions([], zones)) {
      expect(o.label).toBe(o.value);
      expect(o.label).not.toMatch(/\(UTC/);
    }
  });

  it('lists the zones alphabetically', () => {
    expect(zoneOptions([], zones).map((o) => o.value)).toEqual([
      'America/New_York',
      'Asia/Kolkata',
      'Europe/London',
      'UTC',
    ]);
  });

  it('always offers the extra zones (current value, platform default), without repeats', () => {
    const out = zoneOptions(['Pacific/Auckland', 'Asia/Kolkata', null, undefined], zones);
    expect(out.map((o) => o.value)).toContain('Pacific/Auckland');
    expect(out.filter((o) => o.value === 'Asia/Kolkata')).toHaveLength(1);
  });

  it('searches by the id with underscores read as spaces', () => {
    const ny = zoneOptions([], zones).find((o) => o.value === 'America/New_York');
    expect(ny?.search).toBe('america/new york');
  });

  it('uses the modern spelling of an old alias', () => {
    const out = zoneOptions(['Asia/Calcutta'], []);
    expect(out.map((o) => o.value)).toEqual(['Asia/Kolkata']);
  });
});
