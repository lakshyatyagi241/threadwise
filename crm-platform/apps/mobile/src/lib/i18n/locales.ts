/**
 * The languages the app is translated into: English, Hindi and Marathi. The check script (`pnpm i18n:check`) fails when one of
 * them is missing a key or still carries the English text, so this list and `src/messages/` must stay in step. (The web app has
 * more languages; the app's scope was set to these three by the product owner on 2026-10-10.)
 */
export const LOCALES = ['en', 'hi', 'mr'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export const isLocale = (value: string): value is Locale =>
  (LOCALES as readonly string[]).includes(value);

/** Maps a BCP-47 tag from the phone ("hi-IN", "mr_IN", "en-GB") to a supported locale, or null. */
export function matchLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  if (isLocale(tag)) return tag;
  const base = tag.toLowerCase().split(/[-_]/)[0] ?? '';
  return isLocale(base) ? base : null;
}
