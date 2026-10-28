/** Lines of a PR description that are not about what changed: tool footers and trailers. */
const FOOTER = /generated with|co-authored-by|^🤖/i;

/**
 * A PR description as the few plain sentences a reader of the release list needs. The build server sends the description as its author wrote
 * it (markdown, up to 800 characters); here headings, tables, quotes, code blocks and tool footers are dropped, list marks, bold, code marks
 * and link targets are removed, and the rest is joined into one paragraph that the page clamps to three lines.
 */
export function summarize(body: string, max = 260): string {
  const parts: string[] = [];
  let inFence = false;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !line || /^(#|\||>|-{3,}$)/.test(line) || FOOTER.test(line)) continue;
    const text = line
      .replace(/^([-*+]|\d+\.)\s+/, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_`]+/g, '')
      .trim();
    if (text) parts.push(/[.!?:;]$/.test(text) ? text : `${text}.`);
  }
  const out = parts.join(' ');
  return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out;
}
