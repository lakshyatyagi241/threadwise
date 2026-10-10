import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from '@/messages/ar.json';
import bn from '@/messages/bn.json';
import de from '@/messages/de.json';
import en from '@/messages/en.json';
import es from '@/messages/es.json';
import fr from '@/messages/fr.json';
import he from '@/messages/he.json';
import hi from '@/messages/hi.json';
import id from '@/messages/id.json';
import it from '@/messages/it.json';
import ja from '@/messages/ja.json';
import ko from '@/messages/ko.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';
import pt from '@/messages/pt.json';
import ru from '@/messages/ru.json';
import th from '@/messages/th.json';
import tr from '@/messages/tr.json';
import ur from '@/messages/ur.json';
import vi from '@/messages/vi.json';
import zhCN from '@/messages/zh-CN.json';
import { DEFAULT_LOCALE, matchLocale, type Locale } from './locales';

const resources = {
  en,
  ar,
  bn,
  de,
  es,
  fr,
  he,
  hi,
  id,
  it,
  ja,
  ko,
  nl,
  pl,
  pt,
  ru,
  th,
  tr,
  ur,
  vi,
  'zh-CN': zhCN,
} satisfies Record<Locale, typeof en>;

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
