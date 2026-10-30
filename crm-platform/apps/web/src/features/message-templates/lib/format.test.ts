import { describe, expect, it } from 'vitest';
import { counter, toggleSelection, wrapSelection } from './format';

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

  it('marks the whole word when the selection covers part of one', () => {
    expect(toggleSelection('hello wonderful', 9, 12, '*')).toEqual({
      value: 'hello *wonderful*',
      start: 7,
      end: 16,
    });
  });

  it('marks the whole word with every mark, the code block too, when part of a word is selected', () => {
    const v = 'this is a test message';
    const from = v.indexOf('test') + 1;
    for (const [marker, shown] of [
      ['*', '*test*'],
      ['_', '_test_'],
      ['~', '~test~'],
      ['```', '```test```'],
    ] as const)
      expect(toggleSelection(v, from, from + 2, marker).value, marker).toBe(
        `this is a ${shown} message`,
      );
  });

  it('removes a marker when the selection already includes it', () => {
    expect(toggleSelection('hello *world*', 6, 13, '*')).toEqual({
      value: 'hello world',
      start: 6,
      end: 11,
    });
  });

  it('removes a marker when it sits right outside the selection', () => {
    expect(toggleSelection('hello *world*', 7, 12, '*')).toEqual({
      value: 'hello world',
      start: 6,
      end: 11,
    });
  });

  it('toggles strikethrough and code markers off the same way', () => {
    expect(toggleSelection('~gone~', 0, 6, '~')).toEqual({ value: 'gone', start: 0, end: 4 });
    expect(toggleSelection('```x```', 3, 4, '```')).toEqual({ value: 'x', start: 0, end: 1 });
  });

  it('wraps again on the second click after unwrapping', () => {
    const once = toggleSelection('hello world', 6, 11, '*');
    const twice = toggleSelection(once.value, once.start, once.end, '*');
    expect(twice).toEqual({ value: 'hello world', start: 6, end: 11 });
    expect(toggleSelection(twice.value, twice.start, twice.end, '*').value).toBe('hello *world*');
  });

  it('does not unwrap a lone marker character that is the whole selection', () => {
    expect(toggleSelection('a*b', 1, 2, '*')).toEqual({ value: 'a***b', start: 2, end: 3 });
  });

  it('inserts the fallback word when nothing is selected', () => {
    expect(toggleSelection('', 0, 0, '_', 'text')).toEqual({ value: '_text_', start: 1, end: 5 });
  });
});
