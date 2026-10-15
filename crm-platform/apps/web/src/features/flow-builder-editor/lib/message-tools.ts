/**
 * Pure text edits behind the message toolbar (formatting, emoji, variables). Each takes the text and the selection of the box and
 * returns the new text and where the selection goes, so the component only has to write them back. WhatsApp's own marks are used:
 * `*bold*`, `_italic_`, `~strike~`, three backticks for monospace, `- ` and `1. ` for lists.
 */
export interface TextEdit {
  text: string;
  start: number;
  end: number;
}

export type MarkKind = 'bold' | 'italic' | 'strike' | 'mono';
export type ListKind = 'bullet' | 'numbered';

export const MARKS: Readonly<Record<MarkKind, string>> = {
  bold: '*',
  italic: '_',
  strike: '~',
  mono: '```',
};

/** Puts `insert` over the selection and the caret after it. */
export function insertText(text: string, start: number, end: number, insert: string): TextEdit {
  const at = start + insert.length;
  return { text: text.slice(0, start) + insert + text.slice(end), start: at, end: at };
}

/**
 * Wraps the selection in a mark, or takes the mark off when the selection is already wrapped in it. With nothing selected the mark
 * pair is inserted and the caret is left between the two.
 */
export function toggleMark(text: string, start: number, end: number, kind: MarkKind): TextEdit {
  const m = MARKS[kind];
  const selected = text.slice(start, end);
  const wrapped = selected.length >= m.length * 2 && selected.startsWith(m) && selected.endsWith(m);
  if (wrapped) {
    const inner = selected.slice(m.length, selected.length - m.length);
    return {
      text: text.slice(0, start) + inner + text.slice(end),
      start,
      end: start + inner.length,
    };
  }
  const around = text.slice(start - m.length, start) === m && text.slice(end, end + m.length) === m;
  if (around && start !== end) {
    return {
      text: text.slice(0, start - m.length) + selected + text.slice(end + m.length),
      start: start - m.length,
      end: end - m.length,
    };
  }
  const next = text.slice(0, start) + m + selected + m + text.slice(end);
  return start === end
    ? { text: next, start: start + m.length, end: start + m.length }
    : { text: next, start: start + m.length, end: end + m.length };
}

const BULLET = /^(?:- |\* )/;
const NUMBERED = /^\d+\. /;

/**
 * Turns the lines the selection touches into a list, or back into plain lines when they all already are that list. Numbering starts at
 * 1 and follows the lines.
 */
export function toggleList(text: string, start: number, end: number, kind: ListKind): TextEdit {
  const from = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
  const nl = text.indexOf('\n', end);
  const to = nl === -1 ? text.length : nl;
  const lines = text.slice(from, to).split('\n');
  const has = kind === 'bullet' ? BULLET : NUMBERED;
  const all = lines.every((l) => has.test(l));
  const strip = (l: string) => l.replace(BULLET, '').replace(NUMBERED, '');
  const next = lines.map((l, i) =>
    all ? strip(l) : `${kind === 'bullet' ? '- ' : `${i + 1}. `}${strip(l)}`,
  );
  const body = next.join('\n');
  return {
    text: text.slice(0, from) + body + text.slice(to),
    start: from,
    end: from + body.length,
  };
}

/** The first `{{tag}}` form of a variable key: `name` becomes `{{name}}`. */
export const variableToken = (key: string): string => `{{${key.trim()}}}`;

/** Keeps `max` characters; the box never lets an edit run past the channel's limit. */
export const clip = (edit: TextEdit, max: number): TextEdit =>
  edit.text.length <= max
    ? edit
    : {
        text: edit.text.slice(0, max),
        start: Math.min(edit.start, max),
        end: Math.min(edit.end, max),
      };
