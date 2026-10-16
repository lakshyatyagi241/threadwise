/**
 * The languages the app is translated into: the web app's 21 (the Reference languages) plus Marathi, which the app has had since
 * the start. The check script (`pnpm i18n:check`) fails when one of them is missing a key or still carries the English text, so
 * this list, `src/messages/` and the imports in `index.ts` must stay in step. Arabic, Hebrew and Urdu are written right to left.
 */
export const LOCALES = [
  'en',
  'hi',
  'mr',
  'es',
  'ar',
  'pt',
  'ru',
  'ja',
  'de',
  'fr',
  'it',
  'ko',
  'zh-CN',
  'tr',
  'id',
  'vi',
  'th',
  'pl',
  'nl',
  'ur',
  'he',
  'bn',
] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export const isLocale = (value: string): value is Locale =>
  (LOCALES as readonly string[]).includes(value);

/** Language codes a phone may still report in their older form, and the app's file that serves each. */
const ALIASES: Record<string, Locale> = { iw: 'he', in: 'id', zh: 'zh-CN' };

/**
 * Maps a BCP-47 tag from the phone ("hi-IN", "mr_IN", "en-GB", "zh-Hans-CN") to a supported locale, or null. Chinese in any script or
 * region ("zh-TW" too) gets the one Chinese file the app has, which is better than English.
 */
export function matchLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  if (isLocale(tag)) return tag;
  const base = tag.toLowerCase().split(/[-_]/)[0] ?? '';
  if (isLocale(base)) return base;
  return ALIASES[base] ?? null;
}

/** Languages written in a script Inter (Latin, Cyrillic, Greek, Vietnamese) has no letters for: the phone's own font draws them. */
const OTHER_SCRIPTS = new Set(['hi', 'mr', 'bn', 'ar', 'ur', 'he', 'th', 'ja', 'ko', 'zh']);

/**
 * Whether the language is written in a script that is shaped rather than set letter by letter and is not in Inter (Devanagari: Hindi,
 * Marathi; Bengali, Arabic, Urdu, Hebrew, Thai and the Chinese, Japanese and Korean scripts). Such text is drawn in the phone's own
 * font, needs a little room at the end of a shrink-wrapped line (see `Text`) and must not be letter-spaced, which pulls its marks
 * apart. English and the other Latin and Cyrillic languages (Spanish, German, Russian, ...) keep Inter and are set as English is.
 */
export const usesShapedScript = (language: string | null | undefined): boolean =>
  OTHER_SCRIPTS.has((language ?? DEFAULT_LOCALE).toLowerCase().split(/[-_]/)[0] ?? '');
