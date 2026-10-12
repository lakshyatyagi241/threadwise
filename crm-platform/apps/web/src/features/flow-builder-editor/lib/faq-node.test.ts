import { describe, expect, it } from 'vitest';
import {
  FAQ_MIN_SCORE,
  faqSaveName,
  hasOwnMinScore,
  minScoreOutOfRange,
  readMinScore,
} from './faq-node';

describe('Answer from FAQ data helpers', () => {
  it('the bounds are the ones the contracts accept', () => {
    expect(FAQ_MIN_SCORE).toEqual({ min: 0.05, max: 0.99 });
  });

  it("a blank score means the workspace setting, a typed one (even half-typed) is the node's own", () => {
    expect(hasOwnMinScore(null)).toBe(false);
    expect(hasOwnMinScore(undefined)).toBe(false);
    expect(hasOwnMinScore(0.5)).toBe(true);
    expect(hasOwnMinScore('')).toBe(true);
    expect(readMinScore(null)).toBeNull();
    expect(readMinScore('')).toBeNull();
    expect(readMinScore('0.7')).toBe(0.7);
    expect(readMinScore('abc')).toBeNaN();
  });

  it('flags only what the graph validation flags', () => {
    for (const ok of [null, undefined, '', 0.05, 0.5, 0.99, '0.3'])
      expect(minScoreOutOfRange(ok)).toBe(false);
    for (const bad of [0, 0.049, 0.991, 1, -1, 'abc', Number.NaN, Infinity])
      expect(minScoreOutOfRange(bad), String(bad)).toBe(true);
  });

  it('the save name falls back to faq like the runtime does', () => {
    expect(faqSaveName('kb')).toBe('kb');
    expect(faqSaveName('  kb ')).toBe('kb');
    expect(faqSaveName('')).toBe('faq');
    expect(faqSaveName(undefined)).toBe('faq');
    expect(faqSaveName(3)).toBe('faq');
  });
});
