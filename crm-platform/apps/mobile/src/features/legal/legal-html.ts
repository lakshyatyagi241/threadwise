/** One stretch of text in a legal document, with the formatting it carries. */
export interface LegalRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Only an `https` or `mailto` address: anything else the document links to is shown as plain text. */
  href?: string;
}

export type LegalBlock =
  | { t: 'p'; runs: LegalRun[] }
  | { t: 'h'; level: 1 | 2 | 3; runs: LegalRun[] }
  /** One list item; `marker` is the bullet or the number, empty for a later paragraph of the same item. */
  | { t: 'li'; marker: string; depth: number; runs: LegalRun[] }
  | { t: 'quote'; runs: LegalRun[] }
  | { t: 'rule' };

// A non-breaking space, built from its code so no invisible character sits in the source.
const NBSP = String.fromCharCode(0xa0);
const LEADING = new RegExp(`^[ ${NBSP}]+`);
const TRAILING = new RegExp(`[ ${NBSP}]+$`);

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: NBSP,
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  copy: '©',
};

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

const SAFE_HREF = /^(https:\/\/|mailto:)/i;

function hrefOf(attributes: string): string | undefined {
  const found = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attributes);
  const value = decode((found?.[1] ?? found?.[2] ?? '').trim());
  return SAFE_HREF.test(value) ? value : undefined;
}

type Kind =
  | { t: 'p' }
  | { t: 'h'; level: 1 | 2 | 3 }
  | { t: 'quote' }
  | { t: 'li'; marker: string; depth: number };

const BLOCKS = new Set([
  'p',
  'div',
  'pre',
  'figure',
  'figcaption',
  'address',
  'table',
  'tr',
  'caption',
]);
const SKIPPED = new Set(['script', 'style']);

/**
 * Turns the sanitised HTML of a legal document section (paragraphs, headings, lists, quotes, bold, italic, links, line breaks, simple
 * tables) into blocks the app draws as plain text. It is a small reader for the tags the web's sanitiser lets through, not a browser:
 * an unknown tag is dropped and its text kept, scripts and styles are dropped with their text, and only `https` and `mailto` links
 * survive. Nothing in the document is ever run.
 */
export function parseLegalHtml(html: string): LegalBlock[] {
  const out: LegalBlock[] = [];
  let runs: LegalRun[] = [];
  let kind: Kind = { t: 'p' };
  let item: Extract<Kind, { t: 'li' }> | null = null;
  const lists: { ordered: boolean; n: number }[] = [];
  const format = { bold: 0, italic: 0, underline: 0 };
  const links: (string | undefined)[] = [];
  let skip = 0;
  let cells = 0;

  const flush = () => {
    const merged: LegalRun[] = [];
    for (const run of runs) {
      const last = merged[merged.length - 1];
      if (
        last &&
        last.bold === run.bold &&
        last.italic === run.italic &&
        last.underline === run.underline &&
        last.href === run.href
      ) {
        last.text += run.text;
      } else {
        merged.push({ ...run });
      }
    }
    runs = [];
    if (merged.length === 0) return;
    merged[0]!.text = merged[0]!.text.replace(LEADING, '');
    const end = merged[merged.length - 1]!;
    end.text = end.text.replace(TRAILING, '');
    const kept = merged.filter((run) => run.text !== '');
    if (kept.length === 0) return;
    if (kind.t === 'h') out.push({ t: 'h', level: kind.level, runs: kept });
    else if (kind.t === 'quote') out.push({ t: 'quote', runs: kept });
    else if (kind.t === 'li') {
      out.push({ t: 'li', marker: kind.marker, depth: kind.depth, runs: kept });
      kind.marker = '';
    } else out.push({ t: 'p', runs: kept });
  };
  const open = (next: Kind) => {
    flush();
    kind = next;
  };
  const close = () => {
    flush();
    kind = item ?? { t: 'p' };
  };
  const addText = (raw: string) => {
    const text = decode(raw).replace(/[ \t\r\n]+/g, ' ');
    if (text === '' || (text === ' ' && runs.length === 0)) return;
    const run: LegalRun = { text };
    if (format.bold > 0) run.bold = true;
    if (format.italic > 0) run.italic = true;
    if (format.underline > 0) run.underline = true;
    const href = links[links.length - 1];
    if (href) run.href = href;
    runs.push(run);
  };

  const token = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|([^<]+)|</g;
  for (let match = token.exec(html); match; match = token.exec(html)) {
    const [whole, slash, rawName, attributes, text] = match;
    if (text !== undefined) {
      if (skip === 0) addText(text);
      continue;
    }
    if (!rawName) {
      if (skip === 0 && whole === '<') addText('<');
      continue;
    }
    const name = rawName.toLowerCase();
    const closing = slash === '/';
    if (SKIPPED.has(name)) {
      skip = closing ? Math.max(0, skip - 1) : skip + 1;
      continue;
    }
    if (skip > 0) continue;

    if (name === 'br') runs.push({ text: '\n' });
    else if (name === 'hr') {
      flush();
      if (!closing) out.push({ t: 'rule' });
    } else if (name === 'strong' || name === 'b')
      format.bold = Math.max(0, format.bold + (closing ? -1 : 1));
    else if (name === 'em' || name === 'i')
      format.italic = Math.max(0, format.italic + (closing ? -1 : 1));
    else if (name === 'u') format.underline = Math.max(0, format.underline + (closing ? -1 : 1));
    else if (name === 'a') {
      if (closing) links.pop();
      else links.push(hrefOf(attributes ?? ''));
    } else if (/^h[1-6]$/.test(name)) {
      if (closing) close();
      else open({ t: 'h', level: Math.min(3, Number(name[1])) as 1 | 2 | 3 });
    } else if (name === 'blockquote') {
      if (closing) close();
      else open({ t: 'quote' });
    } else if (name === 'ul' || name === 'ol') {
      flush();
      if (closing) {
        lists.pop();
        item = null;
        kind = { t: 'p' };
      } else lists.push({ ordered: name === 'ol', n: 0 });
    } else if (name === 'li') {
      if (closing) {
        flush();
        item = null;
        kind = { t: 'p' };
      } else {
        flush();
        const list = lists[lists.length - 1];
        if (list) list.n += 1;
        item = {
          t: 'li',
          marker: list?.ordered ? `${list.n}.` : '•',
          depth: Math.max(0, lists.length - 1),
        };
        kind = item;
      }
    } else if (BLOCKS.has(name)) {
      if (name === 'tr') cells = 0;
      if (closing) close();
      else open(item ?? { t: 'p' });
    } else if ((name === 'td' || name === 'th') && !closing) {
      if (cells > 0) runs.push({ text: ' | ' });
      cells += 1;
    }
  }
  flush();
  return out;
}
