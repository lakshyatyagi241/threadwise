import { describe, expect, it } from 'vitest';
import { activeFormats, toggleList, toggleMark, toggleUnderline } from './format-text';

describe('toggleMark', () => {
  it('wraps the selection and keeps it selected', () => {
    expect(toggleMark('say hello now', 4, 9, '*')).toEqual({
      text: 'say *hello* now',
      start: 5,
      end: 10,
    });
  });
  it('puts a pair at the caret when nothing is selected', () => {
    expect(toggleMark('hi ', 3, 3, '_')).toEqual({ text: 'hi __', start: 4, end: 4 });
  });
  it('takes the mark off when the selection or its surroundings carry it', () => {
    expect(toggleMark('a *b* c', 2, 5, '*')).toEqual({ text: 'a b c', start: 2, end: 3 });
    expect(toggleMark('a *b* c', 3, 4, '*')).toEqual({ text: 'a b c', start: 2, end: 3 });
  });
});

describe('toggleList', () => {
  it('makes bullets of every line under the selection, and takes them off again', () => {
    const on = toggleList('one\ntwo\nthree', 0, 7, 'bullet');
    expect(on.text).toBe('- one\n- two\nthree');
    expect(toggleList(on.text, on.start, on.end, 'bullet').text).toBe('one\ntwo\nthree');
  });
  it('numbers the lines in order and switches a bullet list to numbers', () => {
    const n = toggleList('a\nb', 0, 3, 'number');
    expect(n.text).toBe('1. a\n2. b');
    expect(toggleList('- a\n- b', 0, 7, 'number').text).toBe('1. a\n2. b');
  });
  it('works on the line at the caret', () => {
    expect(toggleList('x\nyz\nw', 3, 3, 'bullet').text).toBe('x\n- yz\nw');
  });
});

describe('toggleUnderline', () => {
  it('puts a combining line under every letter of the selection (not under spaces), and takes it off again', () => {
    const on = toggleUnderline('say hi now', 4, 6);
    expect(on.text).toBe('say h\u0332i\u0332 now');
    expect(on.start).toBe(4);
    expect(on.end).toBe(8);
    expect(toggleUnderline(on.text, on.start, on.end).text).toBe('say hi now');
  });
  it('leaves the text alone when nothing is selected', () => {
    expect(toggleUnderline('abc', 1, 1)).toEqual({ text: 'abc', start: 1, end: 1 });
  });
});

describe('activeFormats', () => {
  it('knows which marks surround the caret or the selection', () => {
    const t = 'say *bold _both_* and ~gone~';
    expect(activeFormats(t, 7, 7)).toMatchObject({ bold: true, italic: false, strike: false });
    expect(activeFormats(t, 13, 13)).toMatchObject({ bold: true, italic: true });
    expect(activeFormats(t, 1, 1)).toMatchObject({ bold: false, italic: false });
    expect(activeFormats(t, 25, 25)).toMatchObject({ strike: true });
  });
  it('knows a list line and an underlined selection', () => {
    expect(activeFormats('- a\nb', 1, 1)).toMatchObject({ bullets: true, numbers: false });
    expect(activeFormats('- a\nb', 5, 5)).toMatchObject({ bullets: false });
    expect(activeFormats('1. a', 2, 2)).toMatchObject({ numbers: true });
    expect(activeFormats('h\u0332i\u0332', 0, 4)).toMatchObject({ underline: true });
    expect(activeFormats('plain', 0, 3)).toMatchObject({ underline: false });
  });
});
