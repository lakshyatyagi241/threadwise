/** The language codes Meta accepts for a template, written with an underscore as the API stores them. */
export const TEMPLATE_LANGUAGES: readonly string[] = [
  'af', 'sq', 'ar', 'az', 'bn', 'bg', 'ca', 'zh_CN', 'zh_HK', 'zh_TW', 'hr', 'cs', 'da', 'nl',
  'en', 'en_GB', 'en_US', 'et', 'fil', 'fi', 'fr', 'ka', 'de', 'el', 'gu', 'ha', 'he', 'hi', 'hu',
  'id', 'ga', 'it', 'ja', 'kn', 'kk', 'rw_RW', 'ko', 'ky_KG', 'lo', 'lv', 'lt', 'mk', 'ms', 'ml',
  'mr', 'nb', 'fa', 'pl', 'pt_BR', 'pt_PT', 'pa', 'ro', 'ru', 'sr', 'sk', 'sl', 'es', 'es_AR',
  'es_ES', 'es_MX', 'sw', 'sv', 'ta', 'te', 'th', 'tr', 'uk', 'ur', 'uz', 'vi', 'zu',
];

export const DEFAULT_LANGUAGE = 'en_US';

/** A readable name from the browser's own tables (no hand-written list), falling back to the code. */
export function languageName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code.replace('_', '-')) ?? code;
  } catch {
    return code;
  }
}

/** The codes sorted by their name in the reader's language; a code the template already has but we do not list is kept. */
export function languageOptions(
  locale: string,
  current?: string,
): Array<{ code: string; label: string }> {
  const codes = current && !TEMPLATE_LANGUAGES.includes(current) ? [...TEMPLATE_LANGUAGES, current] : TEMPLATE_LANGUAGES;
  return codes
    .map((code) => ({ code, label: `${languageName(code, locale)} (${code})` }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
}
