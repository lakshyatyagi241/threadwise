import {
  activeFormats,
  dropEmptyMarks,
  followEdit,
  isEmptyPair,
  tidyMarks,
  markedRuns,
  toggleList,
  toggleMark,
  toggleUnderline,
} from './format-text';

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
  it('marks the whole word when the selection covers part of one', () => {
    expect(toggleMark('Hello wonderful world', 9, 12, '*')).toEqual({
      text: 'Hello *wonderful* world',
      start: 7,
      end: 16,
    });
  });
  it('takes the mark off the whole word when only part of it is selected', () => {
    expect(toggleMark('Hello *wonderful* world', 10, 13, '*')).toEqual({
      text: 'Hello wonderful world',
      start: 6,
      end: 15,
    });
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

describe('markedRuns', () => {
  const shown = (text: string) =>
    markedRuns(text)
      .filter((r) => !r.mark)
      .map((r) => r.text)
      .join('');

  it('cuts a message into marks and words, and the pieces add up to the text', () => {
    const runs = markedRuns('say *hello* now');
    expect(runs.map((r) => r.text)).toEqual(['say ', '*', 'hello', '*', ' now']);
    expect(runs.map((r) => r.mark)).toEqual([false, true, false, true, false]);
    expect(runs.find((r) => r.text === 'hello')).toMatchObject({ bold: true, italic: false });
    expect(runs.map((r) => r.text).join('')).toBe('say *hello* now');
  });

  it('reads italic and strikethrough, and formatting inside formatting', () => {
    const runs = markedRuns('~old~ and *bold _both_*');
    expect(runs.find((r) => r.text === 'old')).toMatchObject({ strike: true });
    expect(runs.find((r) => r.text === 'both')).toMatchObject({ bold: true, italic: true });
    expect(shown('~old~ and *bold _both_*')).toBe('old and bold both');
  });

  it('leaves text that is not a pair of marks alone', () => {
    for (const text of ['2 ** 3', 'snake_case_name', 'a * b', '5*3*2', '*not closed']) {
      expect(markedRuns(text).every((r) => !r.mark)).toBe(true);
      expect(shown(text)).toBe(text);
    }
  });

  it('does not format across a line break', () => {
    expect(shown('*one\ntwo*')).toBe('*one\ntwo*');
  });
});

describe('ending a formatting with the same button', () => {
  it('moves the caret past the closing mark when it is inside the formatted word, and changes no text', () => {
    const text = '*hello* world';
    expect(toggleMark(text, 3, 3, '*')).toEqual({ text, start: 7, end: 7 });
  });

  it('still puts a pair at the caret when it is not inside a pair of that mark', () => {
    expect(toggleMark('*hello* world', 10, 10, '*')).toMatchObject({
      text: '*hello* wo**rld',
    });
    expect(toggleMark('_x_ y', 1, 1, '*').text).toBe('_**x_ y');
  });
});

describe('dropEmptyMarks', () => {
  it('takes an empty pair off the end, which Bold leaves when nothing is typed', () => {
    expect(dropEmptyMarks('hi **')).toBe('hi');
    expect(dropEmptyMarks('**')).toBe('');
    expect(dropEmptyMarks('hi ~~  ')).toBe('hi');
  });

  it('keeps a message that holds such marks as its own text', () => {
    expect(dropEmptyMarks('2 ** 3')).toBe('2 ** 3');
    expect(dropEmptyMarks('__init__')).toBe('__init__');
    expect(dropEmptyMarks('a**')).toBe('a**');
  });

  it('knows an empty pair', () => {
    expect(isEmptyPair('**')).toBe(true);
    expect(isEmptyPair('*_')).toBe(false);
  });
});

describe('followEdit: Bold pressed with nothing selected, then typing', () => {
  const armed = { start: 4, end: 6, mark: '*' as const };

  it('moves what is typed after the pair inside it, whatever the caret did', () => {
    const first = followEdit('say **', 'say **w', armed);
    expect(first).toEqual({ text: 'say *w*', armed: { start: 4, end: 7, mark: '*' } });
    const next = followEdit(first.text, 'say *w*o', first.armed);
    expect(next).toEqual({ text: 'say *wo*', armed: { start: 4, end: 8, mark: '*' } });
  });

  it('takes the last letter of the pair on a backspace, not its closing mark', () => {
    const a = { start: 4, end: 8, mark: '*' as const };
    expect(followEdit('say *wo*', 'say *wo', a)).toEqual({
      text: 'say *w*',
      armed: { start: 4, end: 7, mark: '*' },
    });
  });

  it('takes the whole pair out when a backspace empties it', () => {
    expect(followEdit('say **', 'say *', armed)).toEqual({ text: 'say ', armed: null });
  });

  it('keeps spaces typed before any letter outside the pair, and the pair on', () => {
    expect(followEdit('say **', 'say ** ', armed)).toEqual({ text: 'say ** ', armed });
  });

  it('lets a space go inside once there are letters, for a bold phrase', () => {
    const a = { start: 4, end: 7, mark: '*' as const };
    expect(followEdit('say *w*', 'say *w* ', a).text).toBe('say *w *');
  });

  it('ends at a line break, and takes an empty pair out then', () => {
    expect(followEdit('say **', 'say **\n', armed)).toEqual({ text: 'say \n', armed: null });
  });

  it('moves with the pair when something is typed before it', () => {
    expect(followEdit('say **', 'oh say **', armed)).toEqual({
      text: 'oh say **',
      armed: { start: 7, end: 9, mark: '*' },
    });
  });

  it('follows typing inside the pair', () => {
    const a = { start: 4, end: 7, mark: '*' as const };
    expect(followEdit('say *w*', 'say *wx*', a)).toEqual({
      text: 'say *wx*',
      armed: { start: 4, end: 8, mark: '*' },
    });
  });

  it('is over once the edit is somewhere else, and an empty pair is removed', () => {
    expect(followEdit('say ** there', 'say ** there!', armed)).toEqual({
      text: 'say  there!',
      armed: null,
    });
  });

  it('does nothing without a pair that is on', () => {
    expect(followEdit('a', 'ab', null)).toEqual({ text: 'ab', armed: null });
  });
});

describe('tidyMarks', () => {
  it('moves spaces from inside the closing mark to outside it', () => {
    expect(tidyMarks('say *big wow * now')).toBe('say *big wow*  now');
    expect(tidyMarks('_a _')).toBe('_a_ ');
  });

  it('leaves text that is already fine, and text that is not a pair', () => {
    for (const text of ['say *wow* now', '2 * 3 * 4', 'snake_case_name', 'plain']) {
      expect(tidyMarks(text)).toBe(text);
    }
  });
});
