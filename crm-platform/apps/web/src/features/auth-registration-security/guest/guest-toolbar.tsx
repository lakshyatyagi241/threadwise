'use client';

import { useTranslations } from 'next-intl';
import { useSyncExternalStore, useTransition } from 'react';
import { setTheme } from '@/components/shell/actions';
import { LocaleSwitcher } from '@/features/localization-translation/locale-switcher';

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
  const [, start] = useTransition();
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => 'light' as const);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    start(() => void setTheme(next));
  };

  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border bg-background/80 p-1 text-foreground backdrop-blur">
      <LocaleSwitcher only={locales} />
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
