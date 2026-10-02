/** WhatsApp's text markup as a tree the preview renders without ever touching innerHTML. */
export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'var'; token: string }
  | { kind: 'code'; text: string }
  | { kind: 'bold' | 'italic' | 'strike'; children: Segment[] };

const MARKUP = /\{\{\s*([^{}]+?)\s*\}\}|```([\s\S]+?)```|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g;

export function parseMarkup(text: string, depth = 0): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(MARKUP)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) });
    if (m[1] !== undefined) out.push({ kind: 'var', token: m[1] });
    else if (m[2] !== undefined) out.push({ kind: 'code', text: m[2] });
    else {
      const kind = m[3] !== undefined ? 'bold' : m[4] !== undefined ? 'italic' : 'strike';
      const inner = m[3] ?? m[4] ?? m[5] ?? '';
      out.push({
        kind,
        children: depth < 2 ? parseMarkup(inner, depth + 1) : [{ kind: 'text', text: inner }],
      });
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/** The `n/max` counter and whether it is over. */
export const counter = (text: string, max: number) => ({
  used: text.length,
  max,
  over: text.length > max,
});

/** Wraps the selection in a marker (`*`, `_`, `~`, three backticks); an empty selection inserts the word "text". */
export function wrapSelection(
  value: string,
  start: number,
  end: number,
  marker: string,
  fallback = 'text',
): { value: string; start: number; end: number } {
  const picked = value.slice(start, end) || fallback;
  const next = value.slice(0, start) + marker + picked + marker + value.slice(end);
  return { value: next, start: start + marker.length, end: start + marker.length + picked.length };
}
