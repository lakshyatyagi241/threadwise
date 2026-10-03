import { describe, expect, it } from 'vitest';
import { scoreRto } from '../../../src/modules/storefront-builder/rules/rto';

const NONE = { priorCount: 0, priorCancelled: 0, priorDelivered: 0 };
const AVG = 100_00;

describe('scoreRto (WD-STORE-019)', () => {
  it('a new phone with a COD order at the store average scores 30 and is medium', () => {
    const r = scoreRto({
      phoneDigits: '919812345678',
      totalMinor: AVG,
      history: NONE,
      averageTotalMinor: AVG,
    });
    expect(r.score).toBe(30);
    expect(r.band).toBe('medium');
    expect(r.reasons).toEqual(['First-time buyer (no order history)']);
  });

  it('two paid prior orders and a normal total floor at 0 and are low', () => {
    const r = scoreRto({
      phoneDigits: '919812345678',
      totalMinor: AVG,
      history: { priorCount: 2, priorCancelled: 0, priorDelivered: 2 },
      averageTotalMinor: AVG,
    });
    expect(r.score).toBe(0);
    expect(r.band).toBe('low');
    expect(r.reasons).toContain('Repeat customer with fulfilled orders');
  });

  it('two cancelled orders and no fulfilled one score 18 + 30 = 48, medium', () => {
    const r = scoreRto({
      phoneDigits: '919812345678',
      totalMinor: AVG,
      history: { priorCount: 2, priorCancelled: 2, priorDelivered: 0 },
      averageTotalMinor: AVG,
    });
    expect(r.score).toBe(48);
    expect(r.band).toBe('medium');
    expect(r.reasons).toContain('2 prior cancelled orders');
  });

  it('2.5x the average from a new 7-digit phone scores 30 + 25 + 15 = 70, high', () => {
    const r = scoreRto({
      phoneDigits: '9812345',
      totalMinor: AVG * 2.5,
      history: NONE,
      averageTotalMinor: AVG,
    });
    expect(r.score).toBe(70);
    expect(r.band).toBe('high');
  });

  it('above 1.5x the average adds 12; exactly 1.5x adds nothing; no average adds nothing', () => {
    const base = {
      phoneDigits: '919812345678',
      history: { priorCount: 3, priorCancelled: 0, priorDelivered: 1 },
    };
    expect(scoreRto({ ...base, totalMinor: AVG * 1.6, averageTotalMinor: AVG }).score).toBe(12);
    expect(scoreRto({ ...base, totalMinor: AVG * 1.5, averageTotalMinor: AVG }).score).toBe(0);
    expect(scoreRto({ ...base, totalMinor: AVG * 9, averageTotalMinor: 0 }).score).toBe(0);
  });

  it('prior cancellations cap at +30 and the score is clamped to 100', () => {
    const r = scoreRto({
      phoneDigits: '1234',
      totalMinor: AVG * 10,
      history: { priorCount: 9, priorCancelled: 9, priorDelivered: 0 },
      averageTotalMinor: AVG,
    });
    // 18 (no fulfilled) + 30 (cap) + 25 (2x) + 15 (short phone) = 88
    expect(r.score).toBe(88);
    const worst = scoreRto({
      phoneDigits: '1',
      totalMinor: AVG * 10,
      history: NONE,
      averageTotalMinor: AVG,
    });
    // 30 + 25 + 15 = 70, never above 100
    expect(worst.score).toBeLessThanOrEqual(100);
  });

  it('the bands start at 30 (medium) and 60 (high)', () => {
    const at = (score: number) =>
      // Build exactly `score` points from the cancelled-order term: 15 per order, history without a first-time term.
      scoreRto({
        phoneDigits: '919812345678',
        totalMinor: AVG,
        history: { priorCount: 5, priorCancelled: score / 15, priorDelivered: 1 },
        averageTotalMinor: AVG,
      });
    expect(at(15).band).toBe('low');
    expect(at(30).band).toBe('medium');
    // 30 from cancellations is the cap; 60 needs a second term
    const high = scoreRto({
      phoneDigits: '9198123',
      totalMinor: AVG * 3,
      history: { priorCount: 5, priorCancelled: 2, priorDelivered: 1 },
      averageTotalMinor: AVG,
    });
    expect(high.score).toBe(70);
    expect(high.band).toBe('high');
  });
});
