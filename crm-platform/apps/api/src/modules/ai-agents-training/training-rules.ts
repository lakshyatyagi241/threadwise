import { randomBytes } from 'node:crypto';
import { AIAG_SOURCE_LIMITS } from '@crm/contracts';

/** About one token per four characters of text, rounded up (Reference's estimate, shown on every entry). */
export const tokensEstimate = (chars: number): number => Math.ceil(chars / 4);

/** The slug an assistant name starts from: lower-case words joined by `-`; a name with no letters or digits gets a random one. */
export function slugBase(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || `assistant-${randomBytes(3).toString('hex')}`;
}

/** `base`, else `base-2`, `base-3`, ... the first one not taken (Reference's numbering). */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** A duplicate's slug: the original's plus a short random suffix, as Reference does. */
export const copySlug = (slug: string): string => `${slug}-copy-${randomBytes(2).toString('hex')}`;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  copy: '©',
};

/** Decodes the entities a page is likely to hold (named ones above, and numeric); anything else is left as written. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1]!.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Script and style blocks first (so JavaScript and CSS are not learned as knowledge), then every tag. Comments go too. */
export function stripHtml(html: string): string {
  const noBlocks = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  return decodeEntities(noBlocks.replace(/<[^>]*>/g, ' '));
}

/** A fetched page as the text the assistant reads: tags stripped, whitespace collapsed, cut at the cap. */
export function pageText(html: string): string {
  const text = stripHtml(html).replace(/\s+/gu, ' ').trim();
  return text.length > AIAG_SOURCE_LIMITS.urlText
    ? text.slice(0, AIAG_SOURCE_LIMITS.urlText)
    : text;
}

/** A file's text is trimmed and cut at the content cap. */
export function clampContent(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > AIAG_SOURCE_LIMITS.content
    ? trimmed.slice(0, AIAG_SOURCE_LIMITS.content)
    : trimmed;
}

/** The file name's extension, lower-case, without the dot ("" when it has none). */
export function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Copies a name for a duplicate: "<name> (copy)". */
export const copyName = (name: string): string => `${name} (copy)`;

export const isBinaryText = (s: string): boolean => s.includes('\u0000');
