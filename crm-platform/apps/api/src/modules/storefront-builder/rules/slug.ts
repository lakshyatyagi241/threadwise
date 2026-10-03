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

/** The Arabic letters Laravel's ASCII folding turns into Latin ones (a shop called "مرحبا" gets the slug "mrhba"). */
const ARABIC: Record<string, string> = {
  ا: 'a',
  ب: 'b',
  ت: 't',
  ث: 'th',
  ج: 'g',
  ح: 'h',
  خ: 'kh',
  د: 'd',
  ذ: 'th',
  ر: 'r',
  ز: 'z',
  س: 's',
  ش: 'sh',
  ص: 's',
  ض: 'd',
  ط: 't',
  ظ: 'th',
  ع: 'aa',
  غ: 'gh',
  ف: 'f',
  ق: 'k',
  ك: 'k',
  ل: 'l',
  م: 'm',
  ن: 'n',
  ه: 'h',
  و: 'o',
  ي: 'y',
  ء: 'aa',
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
};

/** Zero-width characters count as a word break, as they did in Reference's slug. */
const INVISIBLE = /[\u200b-\u200d\u2060\ufeff]/g;

/**
 * What Laravel's `Str::slug` produced for the names Reference shops have: accents folded to ASCII, `_` and spaces to a hyphen,
 * `@` to "at", anything else that is not a letter or digit dropped, hyphen runs collapsed, no hyphen at either end. Letters
 * with no ASCII form (a Chinese shop name) drop out and the caller falls back to "shop".
 */
export function slugify(text: string): string {
  const folded = text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(INVISIBLE, ' ')
    .replace(/[\u0600-\u06ff]/g, (c) => ARABIC[c] ?? c)
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
