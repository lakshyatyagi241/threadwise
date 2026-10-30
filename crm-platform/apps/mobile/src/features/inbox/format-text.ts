/**
 * The composer's formatting buttons for a plain chat message (the same rules as the web inbox's `format-text.ts`). WhatsApp reads `*bold*`, `_italic_` and `~strike~` and shows lines that
 * start with `- ` or `1. ` as lists, so the buttons write those marks into the text; there is no underline (WhatsApp has none).
 */
/** A letter, a digit or `_`: a mark only opens and closes at a word edge. */
const WORD_CHAR = /[\p{L}\p{N}_]/u;

/**
 * Widens a selection to whole words, for an editor that puts a mark on it: a mark round part of a word would stay plain text in
 * WhatsApp. A selection that already starts and ends at word edges, or is empty, comes back as it is.
 */
function widenToWords(text: string, start: number, end: number): { start: number; end: number } {
  if (start === end) return { start, end };
  let s = start;
  while (s > 0 && WORD_CHAR.test(text.charAt(s - 1)) && WORD_CHAR.test(text.charAt(s))) s -= 1;
  let e = end;
  while (e < text.length && WORD_CHAR.test(text.charAt(e)) && WORD_CHAR.test(text.charAt(e - 1)))
    e += 1;
  return { start: s, end: e };
}

export interface Edit {
  text: string;
  /** The selection after the edit. */
  start: number;
  end: number;
}

export type Mark = '*' | '_' | '~';

/**
 * Wraps the selection in `mark`, or takes the mark off when the selection is already wrapped (inside the selection or just around
 * it). With nothing selected it puts a pair of marks at the caret and leaves the caret between them. A partly selected word is widened
 * to the whole word first: WhatsApp shows a mark only at a word edge.
 */
export function toggleMark(text: string, from: number, to: number, mark: Mark): Edit {
  if (from === to) {
    // The caret is inside a pair of this mark (the word is bold and the person is typing in it): the button ends the formatting, so
    // what is typed next is plain. The text does not change; the caret goes past the closing mark.
    const line0 = text.lastIndexOf('\n', from - 1) + 1;
    const nl = text.indexOf('\n', from);
    const line = text.slice(line0, nl === -1 ? text.length : nl);
    let closing = -1;
    for (const m of line.matchAll(PAIR)) {
      const s = line0 + (m.index ?? 0);
      const e = s + m[0].length;
      if (m[1] === mark && from > s && from < e) closing = e;
    }
    if (closing !== -1) return { text, start: closing, end: closing };
  }
  const { start, end } = widenToWords(text, from, to);
  const sel = text.slice(start, end);
  if (sel.length >= 2 && sel.startsWith(mark) && sel.endsWith(mark)) {
    const inner = sel.slice(1, -1);
    return {
      text: text.slice(0, start) + inner + text.slice(end),
      start,
      end: start + inner.length,
    };
  }
  if (start > 0 && text[start - 1] === mark && text[end] === mark && start !== end) {
    return {
      text: text.slice(0, start - 1) + sel + text.slice(end + 1),
      start: start - 1,
      end: end - 1,
    };
  }
  const next = text.slice(0, start) + mark + sel + mark + text.slice(end);
  return start === end
    ? { text: next, start: start + 1, end: start + 1 }
    : { text: next, start: start + 1, end: end + 1 };
}

/** The combining low line: drawn under the letter before it. WhatsApp has no underline mark, so this is how the button underlines. */
const UNDERLINE = '\u0332';

/**
 * Underlines the selection by putting a combining low line after each character; the same button on an underlined selection takes
 * the lines off. With nothing selected it does nothing (there is no pair of marks to leave at the caret).
 */
export function toggleUnderline(text: string, start: number, end: number): Edit {
  const sel = text.slice(start, end);
  if (sel === '') return { text, start, end };
  const done = sel.includes(UNDERLINE);
  const out = done
    ? sel.split(UNDERLINE).join('')
    : Array.from(sel)
        .map((c) => (c === '\n' || c === ' ' ? c : c + UNDERLINE))
        .join('');
  return { text: text.slice(0, start) + out + text.slice(end), start, end: start + out.length };
}

const BULLET = /^- /;
const NUMBER = /^\d+\. /;

/** Turns the lines under the selection into a bulleted or numbered list; the same list kind again takes it off. */
export function toggleList(
  text: string,
  start: number,
  end: number,
  kind: 'bullet' | 'number',
): Edit {
  const from = text.lastIndexOf('\n', start - 1) + 1;
  const nl = text.indexOf('\n', end);
  const to = nl === -1 ? text.length : nl;
  const lines = text.slice(from, to).split('\n');
  const mark = kind === 'bullet' ? BULLET : NUMBER;
  const strip = (l: string) => l.replace(BULLET, '').replace(NUMBER, '');
  const allOn = lines.every((l) => l === '' || mark.test(l));
  let n = 0;
  const out = lines.map((l) => {
    if (allOn) return strip(l);
    if (l === '') return l;
    n += 1;
    return (kind === 'bullet' ? '- ' : `${n}. `) + strip(l);
  });
  const joined = out.join('\n');
  return {
    text: text.slice(0, from) + joined + text.slice(to),
    start: from,
    end: from + joined.length,
  };
}

export interface ActiveFormats {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  underline: boolean;
  bullets: boolean;
  numbers: boolean;
}

/** A pair of marks round some text: it opens at a word edge, holds no space next to either mark, and closes at a word edge. */
const PAIR = /(?<![\p{L}\p{N}])([*_~])(?=\S)(.+?)(?<=\S)\1(?![\p{L}\p{N}])/gu;

/** Marks whose pair (marks included) holds `[from, to]` of `line`, looking inside the pairs too. */
function marksAround(
  line: string,
  from: number,
  to: number,
  offset = 0,
  found = new Set<string>(),
): Set<string> {
  for (const m of line.matchAll(PAIR)) {
    const s = offset + (m.index ?? 0);
    const e = s + m[0].length;
    if (from >= s && to <= e) {
      found.add(m[1]!);
      marksAround(m[2]!, from, to, s + 1, found);
    }
  }
  return found;
}

/** Which of the formatting buttons are "on" at the caret or the selection, so the toolbar can show them pressed. */
export function activeFormats(text: string, start: number, end: number): ActiveFormats {
  const from = text.lastIndexOf('\n', start - 1) + 1;
  const nl = text.indexOf('\n', end);
  const lineEnd = nl === -1 ? text.length : nl;
  const line = text.slice(from, lineEnd);
  const marks = marksAround(line, start - from, end - from);
  const near = text.slice(Math.max(0, start - 1), end + 1);
  return {
    bold: marks.has('*'),
    italic: marks.has('_'),
    strike: marks.has('~'),
    underline: (start === end ? near : text.slice(start, end)).includes(UNDERLINE),
    bullets: BULLET.test(line),
    numbers: NUMBER.test(line),
  };
}

/** One stretch of a message: either a mark (drawn hidden or not at all) or words, with the formatting that applies to them. */
export interface Run {
  text: string;
  /** True for the `*`, `_` or `~` that opens or closes a pair. */
  mark: boolean;
  bold: boolean;
  italic: boolean;
  strike: boolean;
}

interface Style {
  bold: boolean;
  italic: boolean;
  strike: boolean;
}

function walk(text: string, base: Style, out: Run[]): void {
  let at = 0;
  for (const m of text.matchAll(PAIR)) {
    const i = m.index ?? 0;
    if (i < at) continue;
    if (i > at) out.push({ text: text.slice(at, i), mark: false, ...base });
    const mark = m[1]!;
    const inner: Style = {
      bold: base.bold || mark === '*',
      italic: base.italic || mark === '_',
      strike: base.strike || mark === '~',
    };
    out.push({ text: mark, mark: true, ...inner });
    walk(m[2]!, inner, out);
    out.push({ text: mark, mark: true, ...inner });
    at = i + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), mark: false, ...base });
}

/**
 * A message as WhatsApp draws it: the text cut into runs, each with the formatting that applies (`*bold*`, `_italic_`, `~strike~`,
 * nested too). The marks are runs of their own, so a screen can hide them and still know where every character of the text is. The
 * runs always add up to exactly `text`.
 */
export function markedRuns(text: string): Run[] {
  const out: Run[] = [];
  walk(text, { bold: false, italic: false, strike: false }, out);
  return out;
}

/**
 * The text without an empty pair of marks at its very end (`hi **`), which Bold leaves when it is pressed and nothing is typed. Only the
 * end is cleaned: a `**` inside a message (`2 ** 3`, `__init__`) is the person's own text.
 */
export function dropEmptyMarks(text: string): string {
  let out = text.trimEnd();
  for (;;) {
    const next = out.replace(/(?<![\p{L}\p{N}])([*_~])\1$/u, '').trimEnd();
    if (next === out) return out;
    out = next;
  }
}

/** True for the two marks of a pair that holds nothing yet (`**`, `__`, `~~`): what a formatting button leaves at the caret. */
export const isEmptyPair = (two: string): boolean => /^([*_~])\1$/.test(two);

/**
 * A pair of marks that a formatting button put at the caret and that is still "on": what is typed right after it goes inside it, so
 * pressing Bold and then typing gives bold text. The pair occupies `[start, end)` of the text: a mark at `start`, a mark at `end - 1`.
 */
export interface Armed {
  start: number;
  end: number;
  mark: Mark;
}

/** What changed between two texts: the common start, what was taken out and what was put in. */
function changeBetween(before: string, after: string) {
  let p = 0;
  const shortest = Math.min(before.length, after.length);
  while (p < shortest && before.charAt(p) === after.charAt(p)) p += 1;
  let s = 0;
  while (
    s < shortest - p &&
    before.charAt(before.length - 1 - s) === after.charAt(after.length - 1 - s)
  ) {
    s += 1;
  }
  return {
    p,
    removed: before.slice(p, before.length - s),
    inserted: after.slice(p, after.length - s),
  };
}

/**
 * Follows an edit of the box while a pair is "on" (`armed`), and answers the text to keep and the pair's new place (null once it is
 * over). Text typed right after the pair is moved inside it; a backspace that would take the closing mark takes the last letter in
 * the pair instead; an edit before the pair moves it; an edit anywhere else ends it (an empty pair is then taken out).
 * Android puts the caret at the end whenever the text is redrawn, so this does not rely on where the caret is.
 */
export function followEdit(
  before: string,
  after: string,
  armed: Armed | null,
): { text: string; armed: Armed | null } {
  if (!armed) return { text: after, armed: null };
  const { start, end, mark } = armed;
  const { p, removed, inserted } = changeBetween(before, after);
  if (p === before.length && removed === '' && inserted === '') return { text: after, armed };
  const empty = end - start === 2;
  const withoutPair = (text: string) => text.slice(0, start) + text.slice(start + 2);

  // Typed (or pasted) right after the closing mark: it belongs inside the pair.
  if (removed === '' && inserted !== '' && p === end) {
    if (inserted.includes('\n')) {
      return { text: empty ? withoutPair(after) : after, armed: null };
    }
    // Spaces before any letter would not be bold (WhatsApp wants a letter next to the mark): they stay outside, the pair stays on.
    if (empty && inserted.trim() === '') return { text: after, armed };
    return {
      text: before.slice(0, end - 1) + inserted + before.slice(end - 1),
      armed: { start, end: end + inserted.length, mark },
    };
  }
  // A backspace that would take the closing mark: take the last letter of the pair instead (or the whole pair, when it is empty).
  if (removed === mark && inserted === '' && p === end - 1) {
    if (empty) return { text: before.slice(0, start) + before.slice(end), armed: null };
    return {
      text: before.slice(0, end - 2) + before.slice(end - 1),
      armed: { start, end: end - 1, mark },
    };
  }
  const delta = inserted.length - removed.length;
  // Inside the pair (between its marks): the pair grows or shrinks.
  if (p > start && p + removed.length <= end - 1) {
    return { text: after, armed: { start, end: end + delta, mark } };
  }
  // Before the pair: it moves.
  if (p + removed.length <= start) {
    return { text: after, armed: { start: start + delta, end: end + delta, mark } };
  }
  // After it, or across it: it is over.
  return { text: p >= end && empty ? withoutPair(after) : after, armed: null };
}

/**
 * Moves the spaces that sit just inside a closing mark to just outside it (`*wow *` to `*wow* `): WhatsApp shows a pair only when
 * its marks touch the words, and a space typed while a button was "on" goes inside.
 */
export function tidyMarks(text: string): string {
  return text.replace(
    /(?<![\p{L}\p{N}])([*_~])(?=\S)([^\n]*?\S)([ \t]+)\1(?![\p{L}\p{N}])/gu,
    '$1$2$1$3',
  );
}
