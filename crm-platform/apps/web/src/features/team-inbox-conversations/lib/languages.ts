/** The languages the composer's AI can translate to: ISO 639 codes; the names come from the browser (`Intl.DisplayNames`). */
export const TRANSLATE_LANGUAGES = [
  'af',
  'sq',
  'ar',
  'hy',
  'az',
  'bn',
  'bg',
  'ca',
  'zh',
  'hr',
  'cs',
  'da',
  'nl',
  'en',
  'et',
  'fil',
  'fi',
  'fr',
  'de',
  'el',
  'gu',
  'he',
  'hi',
  'hu',
  'id',
  'it',
  'ja',
  'kn',
  'kk',
  'ko',
  'lv',
  'lt',
  'ms',
  'ml',
  'mr',
  'ne',
  'nb',
  'fa',
  'pl',
  'pt',
  'pa',
  'ro',
  'ru',
  'sr',
  'sk',
  'sl',
  'es',
  'sw',
  'sv',
  'ta',
  'te',
  'th',
  'tr',
  'uk',
  'ur',
  'uz',
  'vi',
  'cy',
  'zu',
] as const;

export interface LanguageChoice {
  code: string;
  /** In the language of the page, for the list. */
  label: string;
  /** In English, what the AI is told. */
  english: string;
}

/** The list for a page language, in that language's alphabetical order, filtered by what the agent typed (either name matches). */
export function languageChoices(locale: string, query: string): LanguageChoice[] {
  let local: Intl.DisplayNames | null = null;
  let en: Intl.DisplayNames | null = null;
  try {
    local = new Intl.DisplayNames([locale], { type: 'language' });
    en = new Intl.DisplayNames(['en'], { type: 'language' });
  } catch {
    // An old browser: the codes themselves stand in for the names.
  }
  const needle = query.trim().toLowerCase();
  return TRANSLATE_LANGUAGES.map((code) => ({
    code,
    label: local?.of(code) ?? code,
    english: en?.of(code) ?? code,
  }))
    .filter(
      (l) =>
        needle === '' ||
        l.label.toLowerCase().includes(needle) ||
        l.english.toLowerCase().includes(needle),
    )
    .sort((a, b) => a.label.localeCompare(b.label, locale));
}
