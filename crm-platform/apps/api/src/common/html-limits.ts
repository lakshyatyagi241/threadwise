/**
 * The HTML sanitiser (sanitize-html) takes time that grows faster than the input when the input is mostly `<`: 1 MB of unclosed `<div>` took
 * 20 s of synchronous CPU, 200 KB of `<` about 2 s. A document with more than this many `<` is cut just before the one past the limit; 20 000
 * tags (a long newsletter has a few thousand) take well under a second.
 */
export const MAX_HTML_TAGS = 20_000;

export function cutAtTag(html: string, max: number = MAX_HTML_TAGS): string {
  let n = 0;
  for (let i = html.indexOf('<'); i !== -1; i = html.indexOf('<', i + 1))
    if (++n > max) return html.slice(0, i);
  return html;
}
