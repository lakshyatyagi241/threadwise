import { describe, expect, it } from 'vitest';
import { splitAudience, splitSizes } from '../../../src/modules/broadcasts/audience-split';

describe('splitSizes (WD-BCAST-014)', () => {
  it('splits evenly with equal weights', () => {
    expect(splitSizes(10, [1, 1])).toEqual([5, 5]);
  });

  it('follows asymmetric weights (7/3 of 10)', () => {
    expect(splitSizes(10, [7, 3])).toEqual([7, 3]);
  });

  it('gives the remainder to the largest fractional part, ties to the first sender', () => {
    // 10 / 3 = 3.33 each: one leftover, all fractions tie, so the first sender takes it.
    expect(splitSizes(10, [1, 1, 1])).toEqual([4, 3, 3]);
    // 7 across weights 1:2: exact 2.33 and 4.67, leftover goes to the 0.67.
    expect(splitSizes(7, [1, 2])).toEqual([2, 5]);
  });

  it('treats missing, zero, negative and non-numeric weights as 1', () => {
    expect(splitSizes(9, [0, -5, Number.NaN])).toEqual([3, 3, 3]);
  });

  it('always adds up to the total', () => {
    for (const total of [0, 1, 2, 7, 99, 1001]) {
      for (const weights of [[1], [1, 1], [3, 1, 2], [0.3, 0.3, 0.4], [1000, 1]]) {
        const sizes = splitSizes(total, weights);
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
  });

  it('returns nothing for no senders', () => {
    expect(splitSizes(5, [])).toEqual([]);
  });
});

describe('splitAudience', () => {
  it('slices sequentially so each contact lands in exactly one bucket', () => {
    const items = [1, 2, 3, 4, 5, 6, 7];
    const buckets = splitAudience(items, [1, 1]);
    expect(buckets).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7],
    ]);
    expect(buckets.flat()).toEqual(items);
  });

  it('leaves a bucket empty when there are fewer contacts than senders', () => {
    expect(splitAudience(['a'], [1, 1])).toEqual([['a'], []]);
  });
});
