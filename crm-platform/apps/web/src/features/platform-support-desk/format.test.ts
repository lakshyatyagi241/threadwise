import { describe, expect, it } from 'vitest';
import { minutesLabel, relativeTime, shortDate } from './lib/format';

describe('support desk formatting', () => {
  it('prints minutes and a dash for zero or missing', () => {
    expect(minutesLabel(45)).toBe('45m');
    expect(minutesLabel(0)).toBe('—');
    expect(minutesLabel(null)).toBe('—');
  });

  it('says how long ago in the viewer language', () => {
    const now = Date.parse('2026-10-05T12:00:00Z');
    expect(relativeTime('2026-10-05T09:00:00Z', 'en', now)).toBe('3 hours ago');
    expect(relativeTime('2026-10-03T12:00:00Z', 'en', now)).toBe('2 days ago');
    expect(relativeTime('2026-10-05T12:00:20Z', 'en', now)).toBe('now');
  });

  it('splits a timestamp into the day and the time Reference stacks in the When column', () => {
    const d = shortDate('2026-10-05T14:05:00Z', 'en');
    expect(d.day).toMatch(/Oct/);
    expect(d.time).toMatch(/\d{2}:\d{2}|\d{1,2}:\d{2}/);
  });
});
