import { STORE_SLUG_MAX } from '@crm/contracts';

const FOLD: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ł: 'l',
  ı: 'i',
};

/**
 * What Laravel's `Str::slug` produced for the names Reference shops have: accents folded to ASCII, `_` and spaces to a hyphen,
 * `@` to "at", anything else that is not a letter or digit dropped, hyphen runs collapsed, no hyphen at either end. Letters
 * with no ASCII form (a Chinese shop name) drop out and the caller falls back to "shop".
 */
export function slugify(text: string): string {
  const folded = text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[ßæœøđðþłı]/g, (c) => FOLD[c] ?? c)
    .replace(/_+/g, '-')
    .replace(/@/g, '-at-')
    .replace(/[^a-z0-9\s-]+/g, '')
    .replace(/[\s-]+/g, '-');
  return folded.replace(/^-+|-+$/g, '');
}

/** The slug a new shop is derived from: the slugified name, `shop` when nothing is left, cut to the column width. */
export function baseSlug(name: string, fallback = 'shop'): string {
  const slug = slugify(name).slice(0, STORE_SLUG_MAX).replace(/-+$/, '');
  return slug || fallback;
}

/**
 * `base`, then `base-2`, `base-3` ... A suffixed candidate is cut so that, suffix included, it still fits the column (Reference
 * appended the suffix to an uncut name and failed in the database for a long one).
 */
export function slugCandidate(base: string, attempt: number): string {
  if (attempt <= 1) return base;
  const suffix = `-${attempt}`;
  return `${base.slice(0, STORE_SLUG_MAX - suffix.length).replace(/-+$/, '')}${suffix}`;
}
