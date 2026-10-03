import {
  CMS_KEYS,
  CMS_REGISTRY,
  isCmsPage,
  isHexColor,
  isSafeLink,
  isLayoutKey,
  removableSlugs,
  type CmsPage,
  type LegalSection,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';

/**
 * The pure rules of the marketing-site domain: no database, no clock of its own, no framework. Everything the
 * services decide (slugs, scheduling, reading time, what a content value must look like) is decided here so it is
 * unit-testable without a server.
 */

// --- text helpers ---------------------------------------------------------------------------------------------------

/** Tags removed, entities for the few common ones decoded, whitespace collapsed. For counting words and excerpts. */
export function stripTags(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** `ceil(words / 200)`, at least one minute (WD-CMS-011 rule 4). */
export function readMinutes(html: string | null | undefined): number {
  const text = stripTags(html ?? '');
  const words = text === '' ? 0 : text.split(' ').length;
  return Math.max(1, Math.ceil(words / 200));
}

/** A legal document's read time: `max(1, floor(sections * 1.5))` (WD-CMS-013). */
export const legalReadMinutes = (sections: number): number =>
  Math.max(1, Math.floor(sections * 1.5));

/** `%`, `_` and `\` escaped so a search term is matched literally by LIKE. */
export const escapeLike = (term: string): string => term.replace(/[\\%_]/g, (c) => `\\${c}`);

// --- slugs ----------------------------------------------------------------------------------------------------------

const SLUG_MAX = 120;

/** Lowercase ASCII words joined by hyphens; `fallback` when nothing is left (a title made only of symbols). */
export function slugify(input: string, fallback = 'post'): string {
  const base = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
  return base === '' ? fallback : base;
}

/** `base`, else `base-2`, `base-3`, ... (the suffix counts toward the length limit). */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/g, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// --- blog scheduling (WD-CMS-030 rule 3, WD-CMS-031) ------------------------------------------------------------------

/**
 * "Stamp the current time", resolved by the database, not by this process: a post is live when `published_at <= now()`
 * is evaluated by Postgres, so a date stamped from an application clock that runs a little ahead of the database would
 * keep a just-published post hidden. One clock decides both the stamp and the comparison.
 */
export const DB_NOW = 'now' as const;
export type PublishDate = Date | typeof DB_NOW | null;

/**
 * The publish date a save stores. An explicit date always wins; otherwise a published post keeps its existing date or
 * is stamped now, and a draft keeps whatever it had (null if never published).
 */
export function resolvePublishedAt(
  status: 'draft' | 'published',
  explicit: Date | null,
  existing: Date | null,
): PublishDate {
  if (explicit) return explicit;
  if (status === 'published') return existing ?? DB_NOW;
  return existing;
}

/** The publish/unpublish toggle: unpublishing keeps the date, publishing stamps it only when it was empty. */
export function toggledPost(
  status: 'draft' | 'published',
  publishedAt: Date | null,
): { status: 'draft' | 'published'; publishedAt: PublishDate } {
  if (status === 'published') return { status: 'draft', publishedAt };
  return { status: 'published', publishedAt: publishedAt ?? DB_NOW };
}

export function seoDescription(post: {
  metaDescription: string | null;
  excerpt: string | null;
  body: string | null;
}): string {
  if (post.metaDescription?.trim()) return post.metaDescription.trim();
  if (post.excerpt?.trim()) return post.excerpt.trim();
  return stripTags(post.body ?? '').slice(0, 155);
}

// --- legal sections (WD-CMS-034 rule 1) -------------------------------------------------------------------------------

/**
 * Sections as stored: trimmed number and title, body kept; a row with no title and no visible text is dropped; a blank
 * number becomes its final position as two digits ("01", "02", ...). `clean` sanitises each body.
 */
export function normaliseSections(
  sections: ReadonlyArray<LegalSection>,
  clean: (html: string) => string,
): LegalSection[] {
  const kept = sections
    .map((s) => ({ n: s.n.trim(), title: s.title.trim(), body: clean(s.body) }))
    .filter((s) => s.title !== '' || stripTags(s.body) !== '');
  return kept.map((s, i) => ({ ...s, n: s.n === '' ? String(i + 1).padStart(2, '0') : s.n }));
}

// --- pricing ---------------------------------------------------------------------------------------------------------

/**
 * Twelve months of the monthly price at the yearly discount, in integer cents so there is no float rounding.
 * `monthlyCents * 12 * (100 - pct) / 100`, rounded half up.
 */
export function yearlyCents(monthlyCents: number, discountPct: number): number {
  return Math.round((monthlyCents * 12 * (100 - discountPct)) / 100);
}

export const centsToMoney = (cents: number): string =>
  `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

// --- content values (WD-CMS-008, 019, 020) --------------------------------------------------------------------------

export type ContentCheck = { ok: true; value: string } | { ok: false; message: string };

/**
 * Validates one value for a known key. Empty is always allowed (it means "use the shipped default"). `cleanHtml`
 * sanitises rich text; plain text keeps its characters but loses control characters and is length-capped.
 */
export function checkContentValue(
  key: string,
  raw: string,
  cleanHtml: (html: string) => string,
): ContentCheck {
  if (isLayoutKey(key)) return { ok: false, message: 'Hide and reorder use the layout endpoint' };
  const info = CMS_KEYS.get(key);
  if (!info) return { ok: false, message: 'Unknown content key' };
  const value = raw.trim();
  if (value === '') return { ok: true, value: '' };
  switch (info.type) {
    case 'color':
      return isHexColor(value) ? { ok: true, value } : { ok: false, message: 'Invalid colour' };
    case 'link':
      return isSafeLink(value)
        ? { ok: true, value }
        : {
            ok: false,
            message: 'Use a path starting with /, an anchor, https://, mailto: or tel:',
          };
    case 'richtext':
      return { ok: true, value: cleanHtml(value) };
    case 'longtext':
      return value.length > 4000
        ? { ok: false, message: 'Too long' }
        : // eslint-disable-next-line no-control-regex
          { ok: true, value: value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '') };
    default:
      return value.length > 500
        ? { ok: false, message: 'Too long' }
        : // eslint-disable-next-line no-control-regex
          { ok: true, value: value.replace(/[\u0000-\u001f]/g, ' ') };
  }
}

/** Keys the editor may write, as a predicate for scope operations. */
export const isKnownContentKey = (key: string): boolean => CMS_KEYS.has(key);

export type LayoutCheck =
  { ok: true; hidden?: string[]; order?: string[] } | { ok: false; message: string };

/**
 * WD-CMS-022/023: hiding refuses unknown slugs and pinned sections (422); reordering silently keeps only removable
 * slugs of the page, once each, in the submitted order.
 */
export function checkLayout(
  page: string,
  hidden: readonly string[] | undefined,
  order: readonly string[] | undefined,
): LayoutCheck {
  if (!isCmsPage(page)) return { ok: false, message: 'Unknown page' };
  const all = CMS_REGISTRY[page as CmsPage].sections;
  const removable = removableSlugs(page as CmsPage);
  const out: { hidden?: string[]; order?: string[] } = {};
  if (hidden !== undefined) {
    for (const slug of hidden) {
      const section = all.find((s) => s.slug === slug);
      if (!section) return { ok: false, message: 'Unknown section' };
      if (!section.removable) return { ok: false, message: 'This section cannot be hidden' };
    }
    out.hidden = [...new Set(hidden)];
  }
  if (order !== undefined) {
    out.order = [...new Set(order.filter((s) => removable.includes(s)))];
  }
  return { ok: true, ...out };
}

// --- keyset cursor over a sort tuple ---------------------------------------------------------------------------------

/**
 * A cursor for lists that sort by something other than (created_at, id): the sort tuple as opaque base64url JSON. Like
 * the shared cursor it is only ever a WHERE bound, never an authorisation input.
 */
export const encodeTupleCursor = (parts: ReadonlyArray<string | number>): string =>
  Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');

export function decodeTupleCursor(raw: string, length: number): Array<string | number> {
  try {
    const parts: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      !Array.isArray(parts) ||
      parts.length !== length ||
      !parts.every((p) => typeof p === 'string' || (typeof p === 'number' && Number.isFinite(p)))
    ) {
      throw new Error('malformed');
    }
    return parts as Array<string | number>;
  } catch {
    throw AppError.validation('Invalid pagination cursor', [
      { path: 'cursor', message: 'Invalid pagination cursor' },
    ]);
  }
}
