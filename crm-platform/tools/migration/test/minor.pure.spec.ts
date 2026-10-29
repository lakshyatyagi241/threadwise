import { describe, expect, it } from 'vitest';
import { minorOf, moneyString } from '../broadcast/rules';

describe('a campaign amount in hundredths', () => {
  it('rounds half up on the decimal text, never through a float', () => {
    expect(minorOf('979.581')).toBe(97958);
    expect(minorOf('507.199')).toBe(50720);
    expect(minorOf('1.005')).toBe(101);
    expect(minorOf('0.005')).toBe(1);
    expect(minorOf('0.004')).toBe(0);
    expect(minorOf('4.25')).toBe(425);
    expect(minorOf('0.941')).toBe(94);
    expect(minorOf('7')).toBe(700);
    expect(minorOf('0')).toBe(0);
  });

  it('is null for a missing, negative or unreadable amount', () => {
    expect(minorOf(null)).toBeNull();
    expect(minorOf('-3')).toBeNull();
    expect(minorOf('abc')).toBeNull();
    expect(minorOf('')).toBeNull();
  });

  it('reads what moneyString writes for the Waboo numbers', () => {
    expect(minorOf(moneyString(979.581))).toBe(97958);
    expect(minorOf(moneyString(1.7))).toBe(170);
    expect(minorOf(moneyString('429.096'))).toBe(42910);
    expect(minorOf(moneyString(null))).toBeNull();
  });
});
