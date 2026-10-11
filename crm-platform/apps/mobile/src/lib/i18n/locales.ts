/**
 * The same 21 locales as the web app (apps/web/messages). The check script (`pnpm i18n:check`) fails when a locale is missing a
 * key or still carries the English text, so this list and `src/messages/` must stay in step.
 */
export const LOCALES = [
  'en',
  'ar',
  'bn',
  'de',
  'es',
  'fr',
  'he',
  'hi',
  'id',
  'it',
  'ja',
  'ko',
  'nl',
  'pl',
  'pt',
  'ru',
  'th',
  'tr',
  'ur',
  'vi',
  'zh-CN',
] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export const isLocale = (value: string): value is Locale =>
  (LOCALES as readonly string[]).includes(value);

/** Maps a BCP-47 tag from the phone ("pt-BR", "zh-Hans-CN", "he-IL") to a supported locale, or null. */
export function matchLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  if (isLocale(tag)) return tag;
  const lower = tag.toLowerCase();
  if (lower.startsWith('zh')) return 'zh-CN';
  if (lower.startsWith('iw')) return 'he'; // the legacy Android code for Hebrew
  const base = lower.split(/[-_]/)[0] ?? '';
  return isLocale(base) ? base : null;
}
