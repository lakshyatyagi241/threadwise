/**
 * A form's intro, thank-you and paragraph text arrive from the API already sanitised (spec section 14), and the page sanitises
 * AGAIN before it sets any HTML: a second, independent line so a gap on one side is not a stored XSS on the other. It does not
 * clean markup; it REBUILDS it: the text is tokenised into tags and text, every text run is escaped, and only a short list of tags
 * (with no attributes except an `https:` or `mailto:` link) is written back. Anything else, a script, a style, an event handler, an
 * image, is dropped as text.
 */

const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'p', 'ul', 'ol', 'li', 'a']);
const VOID = new Set(['br']);

const escapeText = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** An entity the author may have typed (`&amp;`) is kept as typed; a bare `&` is escaped by `escapeText`. */
const unescapeBasic = (s: string): string =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

function safeHref(raw: string): string | null {
  const v = unescapeBasic(raw).trim();
  if (/^https:\/\//i.test(v) || /^mailto:[^\s@]+@[^\s@]+$/i.test(v)) {
    return /[\s"'<>`]/.test(v) ? null : v;
  }
  return null;
}

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)\s*(\/?)>/g;

export function safeHtml(input: string): string {
  const source = input.length > 20_000 ? input.slice(0, 20_000) : input;
  const hasMarkup = /<[a-zA-Z/]/.test(source);
  const out: string[] = [];
  const open: string[] = [];
  let last = 0;
  const text = (chunk: string) => {
    // A plain-text paragraph keeps its line breaks.
    const escaped = escapeText(unescapeBasic(chunk));
    out.push(hasMarkup ? escaped : escaped.replace(/\r?\n/g, '<br>'));
  };
  for (const m of source.matchAll(TAG)) {
    const index = m.index ?? 0;
    text(source.slice(last, index));
    last = index + m[0].length;
    const closing = m[1] === '/';
    const name = m[2]!.toLowerCase();
    if (!ALLOWED.has(name)) continue;
    if (closing) {
      const at = open.lastIndexOf(name);
      if (at < 0) continue;
      while (open.length > at) out.push(`</${open.pop()}>`);
      continue;
    }
    if (name === 'a') {
      const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[3] ?? '');
      const safe = href ? safeHref(href[1] ?? href[2] ?? '') : null;
      if (!safe) continue;
      out.push(`<a href="${escapeText(safe)}" target="_blank" rel="noopener noreferrer nofollow">`);
      open.push('a');
      continue;
    }
    if (VOID.has(name)) {
      out.push(`<${name}>`);
      continue;
    }
    out.push(`<${name}>`);
    open.push(name);
  }
  text(source.slice(last));
  while (open.length > 0) out.push(`</${open.pop()}>`);
  return out.join('');
}

/** The text of a rich string without any markup: the preview of a block in a list, a title tooltip. */
export function plainText(input: string): string {
  return unescapeBasic(input.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}
