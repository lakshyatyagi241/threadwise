import { Fragment, type ReactNode } from 'react';

/**
 * A chat message as WhatsApp shows it: `*bold*`, `_italic_`, `~strike~` and `` `code` `` drawn as such, and lines that start with
 * `- ` as bullets (`1. ` lines stay numbered). The marks are read the way people type them: a pair of the same mark on one line
 * with text inside that does not start or end with a space, and (for the closing mark) not followed by a letter or digit, so
 * `snake_case_word` and a link with underscores stay as written. Nothing is read as HTML: every piece is a text node.
 */
const MARK: Record<string, 'strong' | 'em' | 's'> = { '*': 'strong', _: 'em', '~': 's' };
// An opening mark, text that neither starts nor ends in a space, the same mark, and not a letter or digit after it.
const PAIR = /([*_~])(?=\S)(.+?)(?<=\S)\1(?![\p{L}\p{N}])/u;
const CODE = /`([^`\n]+)`/;
const URL = /https?:\/\/\S+/;
const DIM = 'opacity-40';
// Inside the box the letters keep their width (a bolder face would drift from the real text under it), so bold is drawn with a
// thin outline instead of a heavier weight; italic is the slant, strike a line through.
const KEEP = {
  strong: '[-webkit-text-stroke:0.55px_currentColor]',
  em: 'italic',
  s: 'line-through',
} as const;

/** Whether a message has anything to draw: a mark pair, code, or a bullet line. */
export function hasFormatting(text: string): boolean {
  return PAIR.test(text) || CODE.test(text) || /^- /m.test(text);
}

function inline(text: string, key: string, keep = false): ReactNode[] {
  if (text === '') return [];
  // A link is left alone whole: its underscores and asterisks are part of the address.
  const link = URL.exec(text);
  const code = CODE.exec(text);
  const pair = PAIR.exec(text);
  const hits = [
    link && { at: link.index, len: link[0].length, kind: 'link' as const, m: link },
    code && { at: code.index, len: code[0].length, kind: 'code' as const, m: code },
    pair && { at: pair.index, len: pair[0].length, kind: 'pair' as const, m: pair },
  ].filter((h): h is NonNullable<typeof h> => Boolean(h));
  if (hits.length === 0) return [text];
  const first = hits.reduce((a, b) => (b.at < a.at ? b : a));
  const out: ReactNode[] = [];
  if (first.at > 0) out.push(text.slice(0, first.at));
  const k = `${key}.${first.at}`;
  if (first.kind === 'link') out.push(first.m[0]);
  else if (first.kind === 'code' && keep)
    out.push(
      <span key={k}>
        <span className={DIM}>`</span>
        {first.m[1]}
        <span className={DIM}>`</span>
      </span>,
    );
  else if (first.kind === 'code')
    out.push(
      <code key={k} className="rounded bg-black/5 px-1 font-mono text-[0.92em]">
        {first.m[1]}
      </code>,
    );
  else if (keep) {
    // In the box the marks stay (faint) so the letters sit exactly under the real text and the caret lines up.
    const mark = first.m[1]!;
    out.push(
      <span key={k} className={KEEP[MARK[mark]!]}>
        <span className={DIM}>{mark}</span>
        {inline(first.m[2]!, k, true)}
        <span className={DIM}>{mark}</span>
      </span>,
    );
  } else {
    const Tag = MARK[first.m[1]!]!;
    out.push(
      <Tag key={k} className={Tag === 'strong' ? 'font-semibold' : undefined}>
        {inline(first.m[2]!, k)}
      </Tag>,
    );
  }
  out.push(...inline(text.slice(first.at + first.len), `${key}+${first.at + first.len}`, keep));
  return out;
}

export function FormattedText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && '\n'}
          {/^- /.test(line) ? (
            <>
              <span aria-hidden="true">• </span>
              {inline(line.slice(2), `l${i}`)}
            </>
          ) : (
            inline(line, `l${i}`)
          )}
        </Fragment>
      ))}
    </>
  );
}

/** The message as typed, marks kept but faint, with the marked words drawn bold, italic or struck: the layer under the box's caret. */
export function HighlightedText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => (
        <Fragment key={i}>
          {i > 0 && '\n'}
          {/^- /.test(line) ? (
            <>
              <span className={DIM}>- </span>
              {inline(line.slice(2), `h${i}`, true)}
            </>
          ) : (
            inline(line, `h${i}`, true)
          )}
        </Fragment>
      ))}
    </>
  );
}
