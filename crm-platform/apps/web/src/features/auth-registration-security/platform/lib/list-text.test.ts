import { describe, expect, it } from 'vitest';
import { appendEntry, formatList, parseList, sameList } from './list-text';

describe('parseList', () => {
  it('splits on newlines and commas, trims, and drops empties', () => {
    expect(parseList('forex, quick money\nloan')).toEqual(['forex', 'quick money', 'loan']);
    expect(parseList('  a ,, b\r\n\r\n c  ')).toEqual(['a', 'b', 'c']);
  });
  it('turns an empty or blank textarea into an empty list', () => {
    expect(parseList('')).toEqual([]);
    expect(parseList(' \n , \n')).toEqual([]);
  });
  it('keeps duplicates', () => expect(parseList('a\na')).toEqual(['a', 'a']));
});

describe('formatList / sameList / appendEntry', () => {
  it('round-trips one entry per line', () =>
    expect(parseList(formatList(['a', 'b c']))).toEqual(['a', 'b c']));
  it('compares order-sensitively', () => {
    expect(sameList(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameList(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameList(['a'], ['a', 'b'])).toBe(false);
  });
  it('appends once', () => {
    expect(appendEntry('10.0.0.0/8', '203.0.113.9')).toBe('10.0.0.0/8\n203.0.113.9');
    expect(appendEntry('203.0.113.9', '203.0.113.9')).toBe('203.0.113.9');
    expect(appendEntry('', '203.0.113.9')).toBe('203.0.113.9');
  });
});
