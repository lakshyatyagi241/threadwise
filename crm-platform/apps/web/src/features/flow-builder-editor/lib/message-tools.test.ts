import { describe, expect, it } from 'vitest';
import { searchEmoji } from './emoji-data';
import { clip, insertText, toggleList, toggleMark, variableToken } from './message-tools';

describe('message toolbar: formatting', () => {
  it('wraps the selection in WhatsApp marks and keeps it selected', () => {
    expect(toggleMark('say hello now', 4, 9, 'bold')).toEqual({
      text: 'say *hello* now',
      start: 5,
      end: 10,
    });
    expect(toggleMark('say hello now', 4, 9, 'italic').text).toBe('say _hello_ now');
    expect(toggleMark('say hello now', 4, 9, 'strike').text).toBe('say ~hello~ now');
    expect(toggleMark('code', 0, 4, 'mono').text).toBe('```code```');
  });

  it('with nothing selected it inserts the pair and leaves the caret between', () => {
    expect(toggleMark('ab', 1, 1, 'bold')).toEqual({ text: 'a**b', start: 2, end: 2 });
  });

  it('takes the mark off again, whether it is inside the selection or just around it', () => {
    expect(toggleMark('say *hello* now', 4, 11, 'bold')).toEqual({
      text: 'say hello now',
      start: 4,
      end: 9,
    });
    expect(toggleMark('say *hello* now', 5, 10, 'bold')).toEqual({
      text: 'say hello now',
      start: 4,
      end: 9,
    });
  });

  it('a caret at the very start of a text that begins with a newline works on that empty first line', () => {
    expect(toggleList('\nHello', 0, 0, 'bullet')).toEqual({ text: '- \nHello', start: 0, end: 2 });
  });

  it('makes bulleted and numbered lists of the touched lines, and undoes them', () => {
    expect(toggleList('one\ntwo\nthree', 0, 7, 'bullet').text).toBe('- one\n- two\nthree');
    expect(toggleList('one\ntwo', 0, 7, 'numbered').text).toBe('1. one\n2. two');
    expect(toggleList('- one\n- two', 0, 11, 'bullet').text).toBe('one\ntwo');
    expect(toggleList('- one', 0, 5, 'numbered').text).toBe('1. one');
  });
});

describe('message toolbar: insert and limits', () => {
  it('inserts at the caret or over the selection', () => {
    expect(insertText('Hi !', 3, 3, 'Asha')).toEqual({ text: 'Hi Asha!', start: 7, end: 7 });
    expect(insertText('Hi NAME', 3, 7, '{{name}}').text).toBe('Hi {{name}}');
    expect(variableToken(' phone ')).toBe('{{phone}}');
  });

  it('cuts an edit that would pass the limit', () => {
    expect(clip({ text: 'abcdef', start: 6, end: 6 }, 4)).toEqual({
      text: 'abcd',
      start: 4,
      end: 4,
    });
    expect(clip({ text: 'abc', start: 3, end: 3 }, 4).text).toBe('abc');
  });

  it('emoji are found by any word of their name, all words together', () => {
    expect(searchEmoji('heart').some((e) => e.emoji === '❤️')).toBe(true);
    expect(searchEmoji('thumbs up').map((e) => e.emoji)).toEqual(['👍']);
    expect(searchEmoji('zzzz-nothing')).toEqual([]);
    expect(searchEmoji('').length).toBeGreaterThan(150);
  });
});
