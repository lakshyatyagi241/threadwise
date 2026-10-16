/**
 * WhatsApp's text markup as a tree the UI renders without ever touching innerHTML.
 *
 * Inline: `*bold*`, `_italic_`, `~strike~`, ```` ```code``` ```` (monospace, may span lines, nothing inside it is formatted).
 * Blocks: `> quote`, `- item` or `* item` bullets, `1. item` numbers. Any other line is a plain line.
 * Like WhatsApp, a marker opens only where the text before it is not a letter, digit or `_`, and closes only where the text after
 * it is not one either, so `snake_case_name` and `2*3*4` stay as they are. A marker that never closes stays as plain text.
 * `{{name}}` is a template variable; only the template preview turns those on (`variables: true`).
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'var'; token: string }
  | { kind: 'code'; text: string }
  | { kind: 'bold' | 'italic' | 'strike'; children: Inline[] };

export type Block =
  { kind: 'line'; runs: Inline[] } | { kind: 'quote' | 'ul' | 'ol'; items: Inline[][] };

export interface ParseOptions {
  /** Turn `{{name}}` into a variable node (the template preview). Off for a message someone sent. */
  variables?: boolean;
}

type Mark = 'bold' | 'italic' | 'strike';

const MARK_RULES: ReadonlyArray<{ kind: Mark; re: RegExp }> = [
  { kind: 'bold', re: /(?<![\p{L}\p{N}_])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\p{L}\p{N}_])/gu },
  { kind: 'italic', re: /(?<![\p{L}\p{N}_])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\p{L}\p{N}_])/gu },
  { kind: 'strike', re: /(?<![\p{L}\p{N}_])~(?=[^\s~])([^~\n]*?[^\s~])~(?![\p{L}\p{N}_])/gu },
];
const VARIABLE = /\{\{\s*([^{}]+?)\s*\}\}/gu;
const CODE = /```([\s\S]+?)```/g;
const QUOTE_PREFIX = /^>[ \t]?/;
const BULLET_PREFIX = /^[-*][ \t]+/;
const NUMBER_PREFIX = /^\d+\.[ \t]+/;

/** Inline runs of one piece of text. `banned` keeps a marker from nesting in itself (`*a *b* c*` is bold then text). */
function inline(s: string, banned: ReadonlySet<Mark>, variables: boolean): Inline[] {
  const out: Inline[] = [];
  let pos = 0;
  while (pos < s.length) {
    // The earliest match of any rule wins; each rule is searched from `pos`, so lookbehinds see the text before it.
    let best: { kind: Mark | 'var'; m: RegExpExecArray } | null = null;
    const rules: Array<{ kind: Mark | 'var'; re: RegExp }> = [
      ...MARK_RULES.filter((r) => !banned.has(r.kind)),
    ];
    if (variables) rules.push({ kind: 'var', re: VARIABLE });
    for (const r of rules) {
      r.re.lastIndex = pos;
      const m = r.re.exec(s);
      if (m && (best === null || m.index < best.m.index)) best = { kind: r.kind, m };
    }
    if (best === null) {
      out.push({ kind: 'text', text: s.slice(pos) });
      break;
    }
    const { kind, m } = best;
    if (m.index > pos) out.push({ kind: 'text', text: s.slice(pos, m.index) });
    if (kind === 'var') {
      out.push({ kind: 'var', token: m[1] ?? '' });
    } else {
      out.push({
        kind,
        children: inline(m[1] ?? '', new Set([...banned, kind]), variables),
      });
    }
    pos = m.index + m[0].length;
  }
  return out;
}

interface Piece {
  code: boolean;
  text: string;
}

/** The text split into ```` ``` ```` code pieces and everything else. */
function splitCode(text: string): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  for (const m of text.matchAll(CODE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ code: false, text: text.slice(last, at) });
    out.push({ code: true, text: m[1] ?? '' });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ code: false, text: text.slice(last) });
  return out;
}

/** The runs of one line made of pieces. */
function runsOf(pieces: Piece[], variables: boolean): Inline[] {
  const runs: Inline[] = [];
  for (const p of pieces) {
    if (p.code) runs.push({ kind: 'code', text: p.text });
    else runs.push(...inline(p.text, new Set(), variables));
  }
  return runs;
}

type ListKind = 'quote' | 'ul' | 'ol';

/** Splits the message into lines, then groups quote lines, bullets and numbers into their own blocks. */
export function parseWhatsApp(text: string, opts: ParseOptions = {}): Block[] {
  const variables = opts.variables ?? false;
  const normal = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (normal === '') return [];

  // Each line is a list of pieces. A code piece sits inside its line, so a ```` ``` ```` block that spans lines stays one piece.
  const lines: Piece[][] = [[]];
  for (const piece of splitCode(normal)) {
    if (piece.code) {
      lines[lines.length - 1]?.push(piece);
      continue;
    }
    piece.text.split('\n').forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1]?.push({ code: false, text: part });
    });
  }

  const blocks: Block[] = [];
  for (const pieces of lines) {
    const head = pieces[0];
    let kind: ListKind | 'line' = 'line';
    let body = pieces;
    if (head && !head.code) {
      const prefixes: Array<[ListKind, RegExp]> = [
        ['quote', QUOTE_PREFIX],
        ['ul', BULLET_PREFIX],
        ['ol', NUMBER_PREFIX],
      ];
      for (const [k, re] of prefixes) {
        const m = re.exec(head.text);
        if (!m) continue;
        kind = k;
        const rest = head.text.slice(m[0].length);
        body = rest ? [{ code: false, text: rest }, ...pieces.slice(1)] : pieces.slice(1);
        break;
      }
    }

    const runs = runsOf(body, variables);
    if (kind === 'line') {
      blocks.push({ kind: 'line', runs });
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (last && last.kind !== 'line' && last.kind === kind) last.items.push(runs);
    else blocks.push({ kind, items: [runs] });
  }
  return blocks;
}
