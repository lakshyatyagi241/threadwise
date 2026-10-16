import { formatDuration, parseDuration, wholeNumber } from './call-summary-support';

describe('formatDuration', () => {
  it('writes minutes and seconds with two digits each', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(75)).toBe('01:15');
    expect(formatDuration(4520)).toBe('75:20');
  });
  it('never goes below zero or shows fractions', () => {
    expect(formatDuration(-5)).toBe('00:00');
    expect(formatDuration(59.9)).toBe('00:59');
  });
});

describe('parseDuration', () => {
  it('reads mm:ss and h:mm:ss', () => {
    expect(parseDuration('02:30')).toBe(150);
    expect(parseDuration(' 2:05 ')).toBe(125);
    expect(parseDuration('1:02:03')).toBe(3723);
  });
  it('refuses anything else, including seconds past 59', () => {
    for (const text of ['', '150', '02:75', 'ab:cd', '1:2:3:4', '-1:00']) {
      expect(parseDuration(text)).toBeNull();
    }
  });
});

describe('wholeNumber', () => {
  it('reads digits and falls back for the rest', () => {
    expect(wholeNumber('1700000000000', 5)).toBe(1_700_000_000_000);
    expect(wholeNumber('', 5)).toBe(5);
    expect(wholeNumber('-3', 5)).toBe(5);
    expect(wholeNumber('12abc', 5)).toBe(5);
  });
});
