/** UI languages Reference ships (21). Arabic, Hebrew and Urdu are right-to-left. */
export const LOCALES = [
  'en',
  'es',
  'hi',
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
export const LOCALE_COOKIE = 'NEXT_LOCALE';
const RTL = new Set<string>(['ar', 'he', 'ur']);

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function dirOf(locale: string): 'rtl' | 'ltr' {
  return RTL.has(locale) ? 'rtl' : 'ltr';
}
