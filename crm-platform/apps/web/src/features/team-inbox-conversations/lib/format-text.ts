/**
 * The composer's formatting buttons for a plain chat message. WhatsApp reads `*bold*`, `_italic_` and `~strike~` and shows lines that
 * start with `- ` or `1. ` as lists, so the buttons write those marks into the text; there is no underline (WhatsApp has none).
 */
export interface Edit {
  text: string;
  /** The selection after the edit. */
  start: number;
  end: number;
}

export type Mark = '*' | '_' | '~';

/**
 * Wraps the selection in `mark`, or takes the mark off when the selection is already wrapped (inside the selection or just around
 * it). With nothing selected it puts a pair of marks at the caret and leaves the caret between them.
 */
export function toggleMark(text: string, start: number, end: number, mark: Mark): Edit {
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

const PAIR = /([*_~])(?=\S)(.+?)(?<=\S)\1(?![\p{L}\p{N}])/gu;

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
