'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useId, type ReactNode } from 'react';
import { LOCALES, LOCALE_COOKIE } from '@/i18n/locales';

const LANGUAGES: Array<{ id: string; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'ar', label: 'العربية' },
];

/**
 * The frame of every visitor page (service chooser, booking, manage, reschedule): the business name and a language switch
 * above, one centred column, "Powered by" below. It sits outside the app shell, so there is no menu and no session; light and
 * dark follow the theme tokens and right-to-left follows the language.
 */
export function PublicShell({
  orgName,
  children,
}: {
  orgName?: string | null;
  children: ReactNode;
}) {
  const t = useTranslations('appointments.public');
  const locale = useLocale();
  const router = useRouter();
  const id = useId();
  const name = orgName?.trim() || t('brandFallback');

  function setLocale(next: string) {
    try {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      /* the language is not remembered */
    }
    router.refresh();
  }

  return (
    <div className="flex min-h-dvh flex-col bg-muted/60">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-[880px] items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand text-sm font-bold text-brand-foreground"
            >
              {[...name][0]?.toUpperCase() ?? '?'}
            </span>
            <span className="truncate text-sm font-semibold" dir="auto">
              {name}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor={id} className="sr-only">
              {t('language')}
            </label>
            <select
              id={id}
              value={LANGUAGES.some((l) => l.id === locale) ? locale : 'en'}
              onChange={(e) => setLocale(e.target.value)}
              className="h-10 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {LANGUAGES.filter((l) => (LOCALES as readonly string[]).includes(l.id)).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[880px] flex-1 px-4 pb-10 pt-5 sm:pt-8">
        {children}
      </main>
      <footer className="pb-6 text-center text-xs text-muted-foreground">
        {t('poweredBy', { brand: t('brandName') })}
      </footer>
    </div>
  );
}
