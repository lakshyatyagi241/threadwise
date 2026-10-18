import { describe, expect, it } from 'vitest';
import { formatBytes } from './format';

describe('formatBytes', () => {
  it('uses the largest unit that keeps the number readable', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB');
    expect(formatBytes(5 * 1024 ** 4)).toBe('5.0 TB');
  });
  it('shows nothing odd for a missing or negative size', () => {
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(-4)).toBe('0 B');
  });
});
