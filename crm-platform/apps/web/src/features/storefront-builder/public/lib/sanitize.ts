/**
 * Allow-list HTML sanitiser for the few places the shop renders markup: the hero heading (Meridian's `em`) and a product's
 * rich-text body. The API sanitises first (decision D-05); this is the second wall at the render sink, so it never trusts its
 * input: tags and attributes not listed are dropped, `script`-like elements lose their content, links keep only safe schemes,
 * and every tag it keeps is rebuilt from scratch (no attribute is copied through verbatim).
 */

export type Profile = 'inline' | 'rich';

const INLINE_TAGS = new Set([
  'em',
  'strong',
  'b',
  'i',
  'u',
  's',
  'br',
  'span',
  'small',
  'sup',
  'sub',
  'mark',
  'a',
]);
const RICH_TAGS = new Set([
  ...INLINE_TAGS,
  'p',
  'div',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'hr',
  'a',
  'img',
  'code',
  'pre',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'figure',
  'figcaption',
]);
const VOID = new Set(['br', 'hr', 'img']);
/** Elements whose content is code or hidden data, never text: dropped with everything inside. */
const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'noscript',
  'template',
  'svg',
  'math',
  'textarea',
  'select',
  'title',
  'head',
]);

const ENTITY = /^&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/i;

function escapeText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '<') out += '&lt;';
    else if (c === '>') out += '&gt;';
    else if (c === '"') out += '&quot;';
    else if (c === '&') out += ENTITY.test(text.slice(i)) ? '&' : '&amp;';
    else out += c;
  }
  return out;
}

const escapeAttr = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Resolves entities that could hide a scheme (`&#106;avascript:`) before the scheme is checked. */
function decodeForCheck(v: string): string {
  return v
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => safeFromCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d: string) => safeFromCode(parseInt(d, 10)))
    .replace(/&(colon|tab|newline);?/gi, (_, n: string) =>
      n.toLowerCase() === 'colon' ? ':' : ' ',
    );
}
const safeFromCode = (n: number): string => {
  try {
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
};

function safeUrl(raw: string, schemes: readonly string[]): string | null {
  // eslint-disable-next-line no-control-regex
  const cleaned = decodeForCheck(raw).replace(/[\u0000- \u007f-\u009f]+/g, '');
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned);
  if (m) return schemes.includes(m[1]!.toLowerCase()) ? raw.trim() : null;
  // relative or protocol-relative
  return cleaned.startsWith('//') ? null : raw.trim();
}

interface RawTag {
  name: string;
  closing: boolean;
  attrs: Map<string, string>;
  end: number;
}

/** Reads one tag starting at `<`. Returns null when it is not a tag (a stray `<`). */
function readTag(html: string, start: number): RawTag | null {
  let i = start + 1;
  const closing = html[i] === '/';
  if (closing) i++;
  const nameStart = i;
  while (i < html.length && /[a-z0-9]/i.test(html[i]!)) i++;
  if (i === nameStart || !/[a-z]/i.test(html[nameStart]!)) return null;
  const name = html.slice(nameStart, i).toLowerCase();
  const attrs = new Map<string, string>();
  while (i < html.length) {
    while (i < html.length && /[\s/]/.test(html[i]!)) i++;
    if (html[i] === '>') return { name, closing, attrs, end: i + 1 };
    const aStart = i;
    while (i < html.length && !/[\s=>/]/.test(html[i]!)) i++;
    const attr = html.slice(aStart, i).toLowerCase();
    if (i === aStart) {
      i++;
      continue;
    }
    while (i < html.length && /\s/.test(html[i]!)) i++;
    let value = '';
    if (html[i] === '=') {
      i++;
      while (i < html.length && /\s/.test(html[i]!)) i++;
      const q = html[i];
      if (q === '"' || q === "'") {
        const close = html.indexOf(q, i + 1);
        if (close === -1) return { name, closing, attrs, end: html.length };
        value = html.slice(i + 1, close);
        i = close + 1;
      } else {
        const vStart = i;
        while (i < html.length && !/[\s>]/.test(html[i]!)) i++;
        value = html.slice(vStart, i);
      }
    }
    if (!attrs.has(attr)) attrs.set(attr, value);
  }
  return { name, closing, attrs, end: html.length };
}

function openTag(name: string, attrs: Map<string, string>): string {
  if (name === 'a') {
    const href = attrs.get('href');
    const safe = href === undefined ? null : safeUrl(href, ['http', 'https', 'mailto', 'tel']);
    return safe
      ? `<a href="${escapeAttr(safe)}" target="_blank" rel="noopener noreferrer nofollow">`
      : '<a>';
  }
  if (name === 'img') {
    const src = attrs.get('src');
    const safe = src === undefined ? null : safeUrl(src, ['http', 'https']);
    if (!safe) return '';
    const alt = attrs.get('alt');
    return `<img src="${escapeAttr(safe)}" alt="${escapeAttr(alt ?? '')}" loading="lazy">`;
  }
  if (name === 'th' || name === 'td') {
    const span = (k: string) => {
      const n = Number.parseInt(attrs.get(k) ?? '', 10);
      return n >= 1 && n <= 50 ? ` ${k}="${n}"` : '';
    };
    return `<${name}${span('colspan')}${span('rowspan')}>`;
  }
  return `<${name}>`;
}

/** Sanitises `html` to the profile's allow-list. Always returns a string safe to set as inner HTML. */
export function sanitizeHtml(html: string | null | undefined, profile: Profile = 'rich'): string {
  if (!html) return '';
  const allowed = profile === 'inline' ? INLINE_TAGS : RICH_TAGS;
  const out: string[] = [];
  const stack: string[] = [];
  let i = 0;
  let text = '';
  const flush = () => {
    if (text) out.push(escapeText(text));
    text = '';
  };
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      text += html.slice(i);
      break;
    }
    text += html.slice(i, lt);
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      i = close === -1 ? html.length : close + 3;
      continue;
    }
    const tag = readTag(html, lt);
    if (!tag) {
      text += '<';
      i = lt + 1;
      continue;
    }
    i = tag.end;
    flush();
    if (DROP_WITH_CONTENT.has(tag.name)) {
      if (!tag.closing) {
        const re = new RegExp(`</${tag.name}\\s*>`, 'i');
        const m = re.exec(html.slice(i));
        i = m ? i + m.index + m[0].length : html.length;
      }
      continue;
    }
    if (!allowed.has(tag.name)) continue;
    if (tag.closing) {
      const at = stack.lastIndexOf(tag.name);
      if (at === -1) continue;
      while (stack.length > at) out.push(`</${stack.pop()}>`);
      continue;
    }
    const opened = openTag(tag.name, tag.attrs);
    if (!opened) continue;
    out.push(opened);
    if (!VOID.has(tag.name)) stack.push(tag.name);
  }
  flush();
  while (stack.length > 0) out.push(`</${stack.pop()}>`);
  return out.join('');
}

/** Tags and entities removed, for meta descriptions and JSON-LD. */
export function stripTags(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
