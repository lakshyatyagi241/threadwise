'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useSyncExternalStore, useTransition } from 'react';
import { setLocale, setTheme } from '@/components/shell/actions';

/** Native language name for the picker ("العربية", "Deutsch"); falls back to the code. */
export function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    return name ? name.charAt(0).toLocaleUpperCase(code) + name.slice(1) : code;
  } catch {
    return code;
  }
}

/** The page's current theme lives on <html data-theme>; this follows it, including changes made elsewhere. */
function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}
const currentTheme = (): 'light' | 'dark' =>
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

/** Language and theme switches for pages that have no app shell (guest pages). `locales` are the complete ones. */
export function GuestToolbar({ locales }: { locales: readonly string[] }) {
  const t = useTranslations('auth-registration-security.guest.toolbar');
  const locale = useLocale();
  const router = useRouter();
  const [, start] = useTransition();
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => 'light' as const);
  const names = useMemo(
    () => locales.map((code) => [code, languageName(code)] as const),
    [locales],
  );

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    start(() => void setTheme(next));
  };

  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border bg-background/80 p-1 text-foreground backdrop-blur">
      <select
        aria-label={t('language')}
        value={locales.includes(locale) ? locale : 'en'}
        onChange={(e) =>
          start(async () => {
            await setLocale(e.target.value);
            router.refresh();
          })
        }
        className="h-7 max-w-32 rounded-full bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {names.map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={t('theme')}
        className="h-7 rounded-full px-3 text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
      >
        {theme === 'dark' ? t('themeToLight') : t('themeToDark')}
      </button>
    </div>
  );
}
