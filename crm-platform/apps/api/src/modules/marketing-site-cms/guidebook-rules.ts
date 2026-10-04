/**
 * Pure rules of the guidebook (WD-CMS-045, 047, 048): slugs, reading time and the Markdown renderer. No database, no
 * framework, unit-tested on their own.
 */

/** `ceil(words / 200)`, at least one minute, counted on the Markdown source (WD-CMS-047 rule 2). */
export function guidebookReadMinutes(body: string | null | undefined): number {
  const words = (body ?? '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

/** `article-` plus six random lowercase letters or digits: WaDesk's fallback when nothing slug-worthy is left. */
export function fallbackArticleSlug(random: () => number = Math.random): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = 'article-';
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(random() * alphabet.length)];
  return out;
}

/**
 * What the Markdown renderer makes of a link target: site-relative, an anchor, http(s) or mailto. Anything else
 * (`javascript:`, `data:`, protocol-relative) is dropped and only the link text is kept.
 */
export function safeMarkdownHref(href: string): string | null {
  const v = href.trim();
  if (v === '' || v.startsWith('//') || /\s/.test(v)) return null;
  return /^(\/|#|https?:\/\/|mailto:)/i.test(v) ? v : null;
}

const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Inline Markdown on text whose raw HTML has already been removed: code, bold, italic, links. */
function inline(text: string): string {
  const parts: string[] = [];
  // Code spans are lifted out first so their content is never read as Markdown.
  const withoutCode = text.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    parts.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${parts.length - 1}\u0000`;
  });
  let out = escapeHtml(withoutCode);
  out = out.replace(/!?\[([^\]\n]*)\]\(([^)\s]*)\)/g, (_m, label: string, href: string) => {
    const url = safeMarkdownHref(href.replace(/&amp;/g, '&'));
    return url ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${label}</a>` : label;
  });
  out = out
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
  // eslint-disable-next-line no-control-regex
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => parts[Number(i)] ?? '');
}

/**
 * Markdown to HTML for an article body: headings, paragraphs, bullet and numbered lists, block quotes, fenced and
 * inline code, rules, bold, italic and links. Raw HTML in the source is removed (WaDesk: `html_input: strip`) and
 * everything left is escaped, so the output carries only tags this function wrote. The service sanitises it again.
 */
export function renderMarkdown(source: string): string {
  // Raw HTML (and comments) out of the source, outside fenced code.
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];
  let i = 0;
  const stripRaw = (s: string) =>
    s.replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?[a-zA-Z][^>]*>/g, '');

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i++;
      continue;
    }
    const fence = /^\s*```/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) code.push(lines[i++]!);
      i++;
      html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      html.push(`<h${level}>${inline(stripRaw(heading[2]!))}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      html.push('<hr>');
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!))
        quote.push(lines[i++]!.replace(/^\s*>\s?/, ''));
      html.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`);
      continue;
    }
    const bullet = /^\s*[-*+]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const marker = ordered ? numbered : bullet;
      const items: string[] = [];
      while (i < lines.length && marker.test(lines[i]!)) {
        items.push(`<li>${inline(stripRaw(lines[i]!.replace(marker, '')))}</li>`);
        i++;
      }
      html.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !/^\s*(```|#{1,6}\s|>|[-*+]\s|\d+[.)]\s)/.test(lines[i]!)
    ) {
      para.push(lines[i++]!);
    }
    html.push(`<p>${inline(stripRaw(para.join('\n'))).replace(/\n/g, '<br>')}</p>`);
  }
  return html.join('\n');
}
