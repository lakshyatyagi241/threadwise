import { describe, expect, it } from 'vitest';
import { formatMinutes } from './analytics';

describe('formatMinutes', () => {
  it('writes minutes under an hour, hours and minutes from an hour, a dash for nothing', () => {
    expect(formatMinutes(0)).toBe('0m');
    expect(formatMinutes(4.4)).toBe('4m');
    expect(formatMinutes(59.6)).toBe('1h 0m');
    expect(formatMinutes(75)).toBe('1h 15m');
    expect(formatMinutes(null)).toBe('—');
    expect(formatMinutes(undefined)).toBe('—');
  });
});
