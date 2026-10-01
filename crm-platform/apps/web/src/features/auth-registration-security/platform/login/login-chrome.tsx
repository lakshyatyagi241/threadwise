'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useTransition, type ReactNode } from 'react';
import { setLocale, setTheme } from '@/components/shell/actions';
import { LOCALES } from '@/i18n/locales';
import { MoonIcon, SunIcon } from '../ui/icons';
import { languageName } from '../ui/language';
import { useDocumentTheme } from '../ui/use-browser';

/** The bare page around the operator sign-in card: brand, language and theme, nothing else. */
export function LoginChrome({ children }: { children: ReactNode }) {
  const t = useTranslations('auth-registration-security.platform.shell');
  const locale = useLocale();
  const router = useRouter();
  const [, start] = useTransition();
  const theme = useDocumentTheme();
  const languages = useMemo(() => LOCALES.map((code) => [code, languageName(code)] as const), []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    start(() => void setTheme(next));
  };

  return (
    <div className="flex min-h-dvh flex-col bg-muted">
      <header className="flex items-center justify-between gap-3 px-4 py-3 sm:px-8">
        <div className="min-w-0">
          <span className="block truncate text-base font-semibold leading-tight">{t('brand')}</span>
          <span className="block truncate text-xs uppercase tracking-wide text-muted-foreground">
            {t('title')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label={t('language')}
            value={locale}
            onChange={(e) =>
              start(async () => {
                await setLocale(e.target.value);
                router.refresh();
              })
            }
            className="h-8 max-w-32 rounded-md border border-border bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-primary"
          >
            {languages.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? t('themeToLight') : t('themeToDark')}
            title={theme === 'dark' ? t('themeToLight') : t('themeToDark')}
            className="inline-flex size-8 items-center justify-center rounded-md border border-border bg-background hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>
      <main className="m-auto w-full max-w-md px-4 pb-12">{children}</main>
    </div>
  );
}
