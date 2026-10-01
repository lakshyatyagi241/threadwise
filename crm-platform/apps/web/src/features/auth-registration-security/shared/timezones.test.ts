import { describe, expect, it } from 'vitest';
import {
  buildTimezoneOptions,
  filterOptions,
  formatUtcOffset,
  modernZoneId,
  parseOffsetName,
  supportedTimeZones,
  timezoneLabel,
  utcOffsetMinutes,
} from './timezones';

const JAN = new Date('2026-01-15T12:00:00Z');
const JUL = new Date('2026-07-15T12:00:00Z');

describe('parseOffsetName', () => {
  it.each([
    ['GMT', 0],
    ['GMT+5:30', 330],
    ['GMT+05:30', 330],
    ['GMT-08:00', -480],
    ['GMT-3', -180],
    ['GMT+14:00', 840],
    ['GMT−09:30', -570],
  ])('%s -> %i', (name, minutes) => expect(parseOffsetName(name)).toBe(minutes));

  it('rejects anything else', () => {
    expect(parseOffsetName('Pacific Standard Time')).toBeNull();
    expect(parseOffsetName('')).toBeNull();
  });
});

describe('formatUtcOffset', () => {
  it('formats whole, fractional, negative and zero offsets', () => {
    expect(formatUtcOffset(0)).toBe('UTC+00:00');
    expect(formatUtcOffset(330)).toBe('UTC+05:30');
    expect(formatUtcOffset(-480)).toBe('UTC-08:00');
    expect(formatUtcOffset(765)).toBe('UTC+12:45');
  });
});

describe('utcOffsetMinutes', () => {
  it('knows fixed offsets', () => {
    expect(utcOffsetMinutes('Asia/Kolkata', JAN)).toBe(330);
    expect(utcOffsetMinutes('Asia/Dubai', JAN)).toBe(240);
    expect(utcOffsetMinutes('UTC', JAN)).toBe(0);
  });
  it('follows daylight saving time', () => {
    expect(utcOffsetMinutes('America/New_York', JAN)).toBe(-300);
    expect(utcOffsetMinutes('America/New_York', JUL)).toBe(-240);
    expect(utcOffsetMinutes('Europe/London', JUL)).toBe(60);
  });
  it('returns null for an unknown zone', () => {
    expect(utcOffsetMinutes('Mars/Olympus', JAN)).toBeNull();
  });
});

describe('timezone options', () => {
  it('lists the zones with UTC present and sorted', () => {
    const zones = supportedTimeZones();
    expect(zones).toContain('UTC');
    expect(zones).toContain('Asia/Kolkata');
    expect(zones).toEqual([...zones].sort((a, b) => a.localeCompare(b)));
  });

  it('shows modern ids for zones ICU lists under an old name', () => {
    const zones = supportedTimeZones();
    expect(zones).not.toContain('Asia/Calcutta');
    expect(zones).toContain('Asia/Kolkata');
    expect(modernZoneId('Asia/Calcutta')).toBe('Asia/Kolkata');
    expect(modernZoneId('Europe/Kiev')).toBe('Europe/Kyiv');
    expect(modernZoneId('Asia/Dubai')).toBe('Asia/Dubai');
  });

  it('labels each zone with its offset', () => {
    expect(timezoneLabel('Asia/Kolkata', JAN)).toBe('Asia/Kolkata (UTC+05:30)');
    expect(timezoneLabel('Mars/Olympus', JAN)).toBe('Mars/Olympus');
  });

  it('always includes the extra zones (current value, default) even when unlisted', () => {
    const opts = buildTimezoneOptions(['Asia/Kolkata'], JAN, ['Pacific/Apia', null, undefined]);
    expect(opts.map((o) => o.value)).toEqual(['Asia/Kolkata', 'Pacific/Apia']);
    expect(buildTimezoneOptions([], JAN, ['Asia/Calcutta']).map((o) => o.value)).toEqual([
      'Asia/Kolkata',
    ]);
  });

  it('searches names and offsets, ignoring case and underscores', () => {
    const opts = buildTimezoneOptions(['America/New_York', 'Asia/Kolkata', 'Europe/London'], JAN);
    expect(filterOptions(opts, 'new york').map((o) => o.value)).toEqual(['America/New_York']);
    expect(filterOptions(opts, 'KOLK').map((o) => o.value)).toEqual(['Asia/Kolkata']);
    expect(filterOptions(opts, '+05:30').map((o) => o.value)).toEqual(['Asia/Kolkata']);
    expect(filterOptions(opts, 'europe lon').map((o) => o.value)).toEqual(['Europe/London']);
    expect(filterOptions(opts, '')).toHaveLength(3);
    expect(filterOptions(opts, 'zzz')).toHaveLength(0);
  });

  it('ranks a label that starts with the query ahead of one that only contains it', () => {
    const items = [
      { search: 'british indian ocean territory british indian +246', id: 'IO' },
      { search: 'india in +91', id: 'IN' },
      { search: 'indonesia id +62', id: 'ID' },
      { search: 'west india house wi +1', id: 'WI' },
    ];
    expect(filterOptions(items, 'india').map((o) => o.id)).toEqual(['IN', 'IO', 'WI']);
    expect(filterOptions(items, 'ind').map((o) => o.id)).toEqual(['IN', 'ID', 'IO', 'WI']);
  });

  it('keeps the list order between equally good matches', () => {
    const opts = buildTimezoneOptions(['Asia/Dubai', 'Asia/Dhaka', 'Asia/Kabul'], JAN);
    expect(filterOptions(opts, 'asia').map((o) => o.value)).toEqual([
      'Asia/Dhaka',
      'Asia/Dubai',
      'Asia/Kabul',
    ]);
  });
});

describe('timezoneOptions (cached list)', () => {
  it('is stable between calls and merges unlisted extras', async () => {
    const { timezoneOptions } = await import('./timezones');
    const a = timezoneOptions();
    expect(timezoneOptions()).toBe(a);
    const withExtra = timezoneOptions(['Mars/Olympus']);
    expect(withExtra.some((o) => o.value === 'Mars/Olympus')).toBe(true);
    expect(withExtra.length).toBe(a.length + 1);
    // An old alias of a listed zone adds nothing.
    expect(timezoneOptions(['Asia/Calcutta'])).toBe(a);
  });
});
