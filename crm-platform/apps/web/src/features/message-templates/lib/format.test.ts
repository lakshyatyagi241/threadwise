import { describe, expect, it } from 'vitest';
import { counter, wrapSelection } from './format';

describe('template text', () => {
  it('counts characters against a limit', () => {
    expect(counter('abc', 2)).toEqual({ used: 3, max: 2, over: true });
    expect(counter('ab', 2).over).toBe(false);
  });

  it('wraps a selection, or inserts the fallback word', () => {
    expect(wrapSelection('hello world', 6, 11, '*')).toEqual({
      value: 'hello *world*',
      start: 7,
      end: 12,
    });
    expect(wrapSelection('', 0, 0, '_', 'text')).toEqual({ value: '_text_', start: 1, end: 5 });
  });
});
