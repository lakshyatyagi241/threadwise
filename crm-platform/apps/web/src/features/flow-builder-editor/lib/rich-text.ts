/**
 * The live (what-you-see) side of the message box. The flow keeps WhatsApp's own marks as the text (`*bold*`, `_italic_`, `~strike~`,
 * three backticks for monospace); the box shows them as bold, italic, struck and monospace words with no marks in sight. These are the
 * pure halves: marks -> HTML for the box, and the box's DOM -> marks again.
 */

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A `{{variable}}` is taken whole first, so the underscore in `{{first_name}}` is never read as italic. A mark opens and closes only at
// a word edge, as WhatsApp's does: the underscores in `snake_case_name` are not italic.
const TOKEN =
  /(\{\{[^}\n]*\}\})|```([^\n]+?)```|(?<![\p{L}\p{N}])\*(?=\S)([^*\n]*?\S)\*(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])_(?=\S)([^_\n]*?\S)_(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])~(?=\S)([^~\n]*?\S)~(?![\p{L}\p{N}])/gu;

/** The code-span look inside the message box and on the closed step card. */
export const RICH_TEXT_CLASS =
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12px]';

function inline(line: string): string {
  let out = '';
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    out += esc(line.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] !== undefined) out += esc(m[1]);
    else if (m[2] !== undefined) out += `<code>${esc(m[2])}</code>`;
    else if (m[3] !== undefined) out += `<b>${inline(m[3])}</b>`;
    else if (m[4] !== undefined) out += `<i>${inline(m[4])}</i>`;
    else out += `<s>${inline(m[5] ?? '')}</s>`;
  }
  return out + esc(line.slice(last));
}

/** The box's content for a text with marks: one line per `<br>`, and a final empty line gets its own `<br>` so the caret can sit on it. */
export function marksToHtml(text: string): string {
  const html = text.split('\n').map(inline).join('<br>');
  return text.endsWith('\n') ? `${html}<br>` : html;
}

const MARK: Readonly<Record<string, string>> = {
  B: '*',
  STRONG: '*',
  I: '_',
  EM: '_',
  S: '~',
  STRIKE: '~',
  DEL: '~',
  CODE: '```',
};
const BLOCK = new Set(['DIV', 'P']);

/** The marks of what the box shows (the inverse of `marksToHtml`). */
export function htmlToMarks(root: Node): string {
  let out = '';
  const walk = (node: Node, isLast: boolean): void => {
    if (node.nodeType === 3) {
      out += (node.nodeValue ?? '').replace(/ /g, ' ');
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (el.tagName === 'BR') {
      // The last `<br>` of the box only holds the caret on a final empty line.
      if (!isLast) out += '\n';
      return;
    }
    const mark = MARK[el.tagName] ?? weightOrSlant(el);
    const before = out.length;
    const kids = Array.from(el.childNodes);
    if (BLOCK.has(el.tagName) && out.length > 0 && !out.endsWith('\n')) out += '\n';
    kids.forEach((k, i) => walk(k, isLast && i === kids.length - 1));
    if (mark && out.length > before) {
      const inner = out.slice(before);
      // A mark closes on a word, never on a space or a line break, so the pair stays a pair.
      const lead = /^\s*/.exec(inner)?.[0] ?? '';
      const tail = /\s*$/.exec(inner.slice(lead.length))?.[0] ?? '';
      const core = inner.slice(lead.length, inner.length - tail.length);
      out = out.slice(0, before) + lead + (core ? mark + core + mark : '') + tail;
    }
  };
  const kids = Array.from(root.childNodes);
  kids.forEach((k, i) => walk(k, i === kids.length - 1));
  return out;
}

/** A pasted or styled span (`font-weight`, `font-style`, `text-decoration`) counts as its mark. */
function weightOrSlant(el: Element): string | undefined {
  if (el.tagName !== 'SPAN') return undefined;
  const st = (el as HTMLElement).style;
  if (!st) return undefined;
  if (st.fontWeight === 'bold' || Number(st.fontWeight) >= 600) return '*';
  if (st.fontStyle === 'italic') return '_';
  if (st.textDecorationLine === 'line-through' || st.textDecoration.includes('line-through'))
    return '~';
  return undefined;
}

/** How many characters of the box's text (a line break counts as one) lie before this point. */
export function visibleOffset(root: Node, node: Node, offset: number): number {
  const range = document.createRange();
  range.setStart(root, 0);
  range.setEnd(node, offset);
  const count = (n: Node): number => {
    if (n.nodeType === 3) return (n.nodeValue ?? '').length;
    if (n.nodeName === 'BR') return 1;
    return Array.from(n.childNodes).reduce((s, c) => s + count(c), 0);
  };
  return count(range.cloneContents());
}

/** The caret at `n` characters into the box's text. */
export function placeCaret(root: Node, n: number): Range {
  const range = document.createRange();
  let left = n;
  let done = false;
  const walk = (node: Node): void => {
    if (done) return;
    if (node.nodeType === 3) {
      const len = (node.nodeValue ?? '').length;
      if (left <= len) {
        range.setStart(node, left);
        done = true;
      } else left -= len;
      return;
    }
    if (node.nodeName === 'BR') {
      if (left === 0 && node.parentNode) {
        range.setStart(
          node.parentNode,
          Array.from(node.parentNode.childNodes).indexOf(node as ChildNode),
        );
        done = true;
      } else left -= 1;
      return;
    }
    node.childNodes.forEach(walk);
  };
  walk(root);
  if (!done) {
    range.selectNodeContents(root);
    range.collapse(false);
  } else range.collapse(true);
  return range;
}
