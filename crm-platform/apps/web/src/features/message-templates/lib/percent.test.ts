import { describe, expect, it } from 'vitest';
import { percentOf } from '../components/template-stats-card';

describe('percentOf', () => {
  it('rounds to whole percent and is 0 when nothing was sent', () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(2, 3)).toBe(67);
    expect(percentOf(5, 5)).toBe(100);
    expect(percentOf(0, 0)).toBe(0);
  });
});
