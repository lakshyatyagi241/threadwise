import { describe, expect, it } from 'vitest';
import { formatDelta, formatExact, formatNumber } from './number-format';

describe('formatNumber', () => {
  it('groups by the locale', () => {
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
    expect(formatNumber(1234.5, 'de')).toBe('1.234,5');
  });
  it('is lossless by default and compact only when asked (axis ticks)', () => {
    expect(formatNumber(1_200_000, 'en')).toBe('1,200,000');
    expect(formatNumber(12_345.678, 'en')).toBe('12,345.678');
    expect(formatNumber(1_200_000, 'en', {}, { compact: true })).toBe('1.2M');
    expect(formatNumber(999, 'en', {}, { compact: true })).toBe('999');
  });
  it('adds prefix, suffix and unit; a percent sits against the number', () => {
    expect(formatNumber(42, 'en', { prefix: '$' })).toBe('$42');
    expect(formatNumber(42.5, 'en', { unit: '%' })).toBe('42.5%');
    expect(formatNumber(300, 'en', { unit: 'msgs' })).toBe('300 msgs');
    expect(formatNumber(5, 'en', { suffix: 'k' })).toBe('5k');
  });
  it('writes a dash, never NaN, for anything that is not a finite number', () => {
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, null, undefined, '']) {
      expect(formatNumber(v as never, 'en')).toBe('–');
    }
    expect(formatNumber(Number.NaN, 'en', { unit: '%' })).not.toContain('NaN');
  });
  it('keeps text as written', () => {
    expect(formatNumber('about 12k', 'en')).toBe('about 12k');
  });
});

describe('formatExact', () => {
  it('never compacts', () => {
    expect(formatExact(1_200_000, 'en')).toBe('1,200,000');
  });
});

describe('formatDelta', () => {
  it('signs a number as a percent and keeps text', () => {
    expect(formatDelta(12.34, 'en')).toBe('+12.3%');
    expect(formatDelta(-3, 'en')).toBe('-3%');
    expect(formatDelta('+12% vs last period', 'en')).toBe('+12% vs last period');
  });
  it('is null when there is nothing to say', () => {
    expect(formatDelta(undefined, 'en')).toBeNull();
    expect(formatDelta(Number.NaN, 'en')).toBeNull();
    expect(formatDelta('  ', 'en')).toBeNull();
  });
});
