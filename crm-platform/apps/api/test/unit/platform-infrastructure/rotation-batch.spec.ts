import { describe, expect, it } from 'vitest';
import { rotationBatchSize } from '../../../src/modules/platform-infrastructure/crypto-rotation/rotate-keys';

/**
 * The key-rotation tool writes its batch size into SQL text (`FETCH ${batch} FROM rot`; a cursor FETCH takes no bound parameter), so it
 * is the one number that must be proven safe rather than trusted (QA task 30). A bad value is refused, never coerced.
 */
describe('rotationBatchSize', () => {
  it('defaults to 500 when none is given', () => {
    expect(rotationBatchSize(undefined)).toBe(500);
    expect(rotationBatchSize(null as unknown as undefined)).toBe(500);
  });

  it('accepts a whole number from 1 to 10000', () => {
    for (const n of [1, 2, 500, 9999, 10_000]) expect(rotationBatchSize(n)).toBe(n);
  });

  it('refuses zero, negatives and anything over the maximum', () => {
    for (const n of [0, -1, -500, 10_001, 1_000_000])
      expect(() => rotationBatchSize(n)).toThrow(/integer from 1 to 10000/);
  });

  it('refuses a fraction, NaN and infinity instead of rounding them', () => {
    for (const n of [1.5, 0.1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => rotationBatchSize(n)).toThrow(/integer from 1 to 10000/);
    }
  });

  it('refuses a string that slipped past the types, so it can never reach the SQL text', () => {
    // A caller outside TypeScript (a script, a config file) could pass text. This is the value an injection would arrive as.
    for (const bad of ['500', '1; DROP TABLE users', '10 FROM rot; --', {}, [5]]) {
      expect(() => rotationBatchSize(bad as unknown as number)).toThrow();
    }
  });

  it('the error names the value it refused', () => {
    expect(() => rotationBatchSize(-3)).toThrow(/got -3/);
  });
});
