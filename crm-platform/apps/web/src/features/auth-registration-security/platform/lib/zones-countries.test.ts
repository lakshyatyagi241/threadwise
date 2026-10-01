import { describe, expect, it } from 'vitest';
import { countryOptions, timeZoneOptions } from './zones-countries';

describe('timeZoneOptions', () => {
  it('lists zones sorted, with UTC and the saved value always present', () => {
    const zones = timeZoneOptions('Mars/Olympus');
    expect(zones).toContain('UTC');
    expect(zones).toContain('Mars/Olympus');
    expect(zones).toContain('Europe/London');
    expect([...zones].sort((a, b) => a.localeCompare(b))).toEqual(zones);
  });
});

describe('countryOptions', () => {
  it('offers ISO codes with names in the requested language', () => {
    const en = countryOptions('en');
    expect(en.find((c) => c.code === 'IN')?.name).toBe('India');
    expect(en.find((c) => c.code === 'AE')?.name).toBe('United Arab Emirates');
    const ar = countryOptions('ar');
    expect(ar.find((c) => c.code === 'IN')?.name).not.toBe('India');
  });
  it('is sorted by name and has unique codes', () => {
    const en = countryOptions('en');
    expect(new Set(en.map((c) => c.code)).size).toBe(en.length);
    const names = en.map((c) => c.name);
    expect([...names].sort((a, b) => a.localeCompare(b, 'en'))).toEqual(names);
  });
});
