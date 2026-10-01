import { describe, expect, it } from 'vitest';
import { effectiveRateLimit } from '../../../src/modules/public-api/api-key.guard';

describe('effectiveRateLimit', () => {
  it('holds a key to its own limit when that is below the platform ceiling', () => {
    expect(effectiveRateLimit(120, 600)).toBe(120);
  });

  it('never lets a key exceed the platform ceiling', () => {
    expect(effectiveRateLimit(5000, 600)).toBe(600);
  });

  it('gives a key with no limit of its own the ceiling', () => {
    expect(effectiveRateLimit(0, 600)).toBe(600);
  });

  it('treats a zero ceiling as no ceiling and zero for both as unlimited', () => {
    expect(effectiveRateLimit(120, 0)).toBe(120);
    expect(effectiveRateLimit(0, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});
