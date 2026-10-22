import { describe, expect, it } from 'vitest';
import { dateFilterOf } from './date-range';

describe('library date filter', () => {
  it('is all time when the address names no range or an unknown one', () => {
    expect(dateFilterOf(null, null, null)).toEqual({ range: 'all', from: '', to: '' });
    expect(dateFilterOf('yesterday', '2026-10-01', '2026-10-02')).toEqual({
      range: 'all',
      from: '',
      to: '',
    });
  });

  it('keeps the days of a custom range', () => {
    expect(dateFilterOf('custom', '2026-10-01', '2026-10-22')).toEqual({
      range: 'custom',
      from: '2026-10-01',
      to: '2026-10-22',
    });
  });

  it('leaves a side open when its day is missing or not a real day', () => {
    expect(dateFilterOf('custom', null, '2026-10-22')).toEqual({
      range: 'custom',
      from: '',
      to: '2026-10-22',
    });
    expect(dateFilterOf('custom', '2026-02-31', '2026-10-22')).toEqual({
      range: 'custom',
      from: '',
      to: '2026-10-22',
    });
  });

  it('drops any days when the range is a preset', () => {
    expect(dateFilterOf('7d', '2026-10-01', '2026-10-22')).toEqual({
      range: '7d',
      from: '',
      to: '',
    });
  });
});
