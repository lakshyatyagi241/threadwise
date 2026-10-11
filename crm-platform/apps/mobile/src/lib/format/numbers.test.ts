import {
  barLength,
  clampPercent,
  compact,
  directionOf,
  formatCount,
  isGood,
  latinDigits,
  niceMax,
  signed,
} from './numbers';

describe('compact', () => {
  it('writes small numbers as they are and large ones with k and M', () => {
    expect(compact(0)).toBe('0');
    expect(compact(999)).toBe('999');
    expect(compact(1234)).toBe('1.2k');
    expect(compact(1500000)).toBe('1.5M');
    expect(compact(-2500)).toBe('-2.5k');
  });
});

describe('niceMax', () => {
  it('rounds an axis top up to 1, 2, 2.5, 5 or 10 times a power of ten', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-3)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(11)).toBe(20);
    expect(niceMax(23)).toBe(25);
    expect(niceMax(40)).toBe(50);
    expect(niceMax(87)).toBe(100);
  });
});

describe('barLength', () => {
  it('scales a value, keeps a non-zero value visible and never overflows', () => {
    expect(barLength(0, 100, 140)).toBe(0);
    expect(barLength(5, 0, 140)).toBe(0);
    expect(barLength(50, 100, 140)).toBe(70);
    expect(barLength(1, 1000, 140)).toBe(2);
    expect(barLength(500, 100, 140)).toBe(140);
  });
});

describe('clampPercent', () => {
  it('keeps a share inside 0..100 and treats nonsense as zero', () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(42.5)).toBe(42.5);
    expect(clampPercent(250)).toBe(100);
    expect(clampPercent(Number.NaN)).toBe(0);
  });
});

describe('signed, directionOf and isGood', () => {
  it('shows the sign for movement only', () => {
    expect(signed(12.5, '%')).toBe('+12.5%');
    expect(signed(-3, ' pp')).toBe('-3 pp');
    expect(signed(0, '%')).toBe('0%');
  });

  it('names the direction', () => {
    expect(directionOf(1)).toBe('up');
    expect(directionOf(-1)).toBe('down');
    expect(directionOf(0)).toBe('flat');
  });

  it('knows which way is good news', () => {
    expect(isGood(5)).toBe(true);
    expect(isGood(-5)).toBe(false);
    expect(isGood(0)).toBeNull();
    expect(isGood(-5, true)).toBe(true);
    expect(isGood(5, true)).toBe(false);
  });
});

describe('formatCount and latinDigits', () => {
  it('groups a count for the language but always with ordinary digits', () => {
    expect(formatCount(1250, 'en')).toBe('1,250');
    expect(formatCount(1250, 'hi')).toBe('1,250');
    // Marathi would write ‘१,२५०’ by default; a screen mixes it with plain numbers, so it is kept to plain digits.
    expect(formatCount(1250, 'mr')).toBe('1,250');
    expect(latinDigits('mr')).toBe('mr-u-nu-latn');
  });

  it('falls back to the bare number for a language tag the runtime rejects', () => {
    expect(formatCount(1250, 'not a tag')).toBe('1250');
  });
});
