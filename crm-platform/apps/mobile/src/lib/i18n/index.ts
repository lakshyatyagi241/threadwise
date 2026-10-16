import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@/messages/en.json';
import hi from '@/messages/hi.json';
import mr from '@/messages/mr.json';
import es from '@/messages/es.json';
import ar from '@/messages/ar.json';
import pt from '@/messages/pt.json';
import ru from '@/messages/ru.json';
import ja from '@/messages/ja.json';
import de from '@/messages/de.json';
import fr from '@/messages/fr.json';
import it from '@/messages/it.json';
import ko from '@/messages/ko.json';
import zhCN from '@/messages/zh-CN.json';
import tr from '@/messages/tr.json';
import id from '@/messages/id.json';
import vi from '@/messages/vi.json';
import th from '@/messages/th.json';
import pl from '@/messages/pl.json';
import nl from '@/messages/nl.json';
import ur from '@/messages/ur.json';
import he from '@/messages/he.json';
import bn from '@/messages/bn.json';
import { DEFAULT_LOCALE, matchLocale, type Locale } from './locales';

// Counts need other plural forms in some languages (Arabic has six, Russian four, Japanese one), so a file is checked by
// `i18n:check` against its language's forms rather than by type against English.
const resources: Record<Locale, object> = {
  en,
  hi,
  mr,
  es,
  ar,
  pt,
  ru,
  ja,
  de,
  fr,
  it,
  ko,
  'zh-CN': zhCN,
  tr,
  id,
  vi,
  th,
  pl,
  nl,
  ur,
  he,
  bn,
};

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
