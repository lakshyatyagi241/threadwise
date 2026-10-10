import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@/messages/en.json';
import hi from '@/messages/hi.json';
import mr from '@/messages/mr.json';
import { DEFAULT_LOCALE, matchLocale, type Locale } from './locales';

const resources = { en, hi, mr } satisfies Record<Locale, typeof en>;

/** The first of the phone's preferred languages that the app is translated into, else English. */
export function detectLocale(): Locale {
  for (const l of getLocales()) {
    const match = matchLocale(l.languageTag);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

export async function initI18n(locale: Locale = detectLocale()): Promise<void> {
  if (i18n.isInitialized) {
    await i18n.changeLanguage(locale);
    return;
  }
  await i18n.use(initReactI18next).init({
    resources: Object.fromEntries(
      Object.entries(resources).map(([k, v]) => [k, { translation: v }]),
    ),
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    // React escapes already; i18next escaping would double-encode "&" in a name.
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export { i18n };
export type { Locale };
