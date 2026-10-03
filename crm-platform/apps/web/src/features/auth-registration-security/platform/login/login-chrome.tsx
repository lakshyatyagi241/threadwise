'use client';

import { useTranslations } from 'next-intl';
import { useTransition, type ReactNode } from 'react';
import { LocaleSwitcher } from '@/features/localization-translation/locale-switcher';
import { setTheme } from '@/components/shell/actions';
import { MoonIcon, SunIcon } from '../ui/icons';
import { useDocumentTheme } from '../ui/use-browser';

/** The bare page around the operator sign-in card: brand, language and theme, nothing else. */
export function LoginChrome({ children }: { children: ReactNode }) {
  const t = useTranslations('auth-registration-security.platform.shell');
  const [, start] = useTransition();
  const theme = useDocumentTheme();

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
          <LocaleSwitcher />
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
