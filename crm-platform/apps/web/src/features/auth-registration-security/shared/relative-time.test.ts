import { describe, expect, it } from 'vitest';
import { formatRelative, relativeParts } from './relative-time';

const NOW = Date.parse('2026-06-01T12:00:00Z');
const ago = (seconds: number) => NOW - seconds * 1000;

describe('relativeParts', () => {
  it.each([
    [0, 0, 'second'],
    [9, 0, 'second'],
    [10, -10, 'second'],
    [59, -59, 'second'],
    [60, -1, 'minute'],
    [3599, -59, 'minute'],
    [3600, -1, 'hour'],
    [86_399, -23, 'hour'],
    [86_400, -1, 'day'],
    [29 * 86_400, -29, 'day'],
    [30 * 86_400, -1, 'month'],
    [364 * 86_400, -12, 'month'],
    [365 * 86_400, -1, 'year'],
    [800 * 86_400, -2, 'year'],
  ])('%i s ago -> %i %s', (seconds, value, unit) => {
    expect(relativeParts(ago(seconds), NOW)).toEqual({ value, unit });
  });

  it('treats a moment slightly in the future (clock skew) as now', () => {
    expect(relativeParts(NOW + 30_000, NOW)).toEqual({ value: 0, unit: 'second' });
  });
});

describe('formatRelative', () => {
  it('reads naturally in English', () => {
    expect(formatRelative(new Date(ago(5)), NOW, 'en')).toBe('now');
    expect(formatRelative(new Date(ago(3 * 60)), NOW, 'en')).toBe('3 minutes ago');
    expect(formatRelative(new Date(ago(86_400)), NOW, 'en')).toBe('yesterday');
    expect(formatRelative(new Date(ago(2 * 86_400)), NOW, 'en')).toBe('2 days ago');
  });

  it('localizes', () => {
    expect(formatRelative(new Date(ago(3 * 3600)), NOW, 'fr')).toMatch(/3\s*h/);
  });

  it('accepts ISO strings and survives bad input', () => {
    expect(formatRelative('2026-06-01T11:00:00Z', NOW, 'en')).toBe('1 hour ago');
    expect(formatRelative('not a date', NOW, 'en')).toBe('');
  });
});
