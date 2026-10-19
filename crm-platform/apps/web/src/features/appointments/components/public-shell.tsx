'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, type ReactNode } from 'react';
import { DEFAULT_BOOKING_THEME, type PublicBookingTheme } from '@crm/contracts';
import { LOCALES, LOCALE_COOKIE } from '@/i18n/locales';
import { safeImageSrc, toView, type ThemeView } from '../lib/booking-theme';
import { ThemeScope } from './public-theme';

const LANGUAGES: Array<{ id: string; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'ar', label: 'العربية' },
];

/**
 * The frame of every visitor page (service chooser, booking, manage, reschedule): the business name (and logo) and a language switch
 * above, an optional cover banner, one centred column, "Powered by" below. It sits outside the app shell, so there is no menu and no
 * session; light and dark follow the workspace's theme (BL-355) and right-to-left follows the language.
 *
 * `theme` is what the API resolved for this page (the workspace's look, or a service's own over it); without one the product's own look
 * is drawn. `org` is the workspace address the pictures are served under. In the editor's preview (`preview`) nothing leaves the page:
 * the language switch is inert, the tab title is left alone and a picture the person just chose (`local`) is shown straight away.
 */
export function PublicShell({
  orgName,
  org,
  theme,
  view,
  preview = false,
  children,
}: {
  orgName?: string | null;
  org?: string | null;
  theme?: PublicBookingTheme;
  /** The editor already has a view (with pictures it has not saved yet); it wins over `theme`. */
  view?: ThemeView;
  preview?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('appointments.public');
  const locale = useLocale();
  const router = useRouter();
  const id = useId();
  const resolved = useMemo(
    () => view ?? toView(theme ?? DEFAULT_BOOKING_THEME, org ?? ''),
    [view, theme, org],
  );
  const name = resolved.pageTitle?.trim() || orgName?.trim() || t('brandFallback');
  const logo = safeImageSrc(resolved.logoUrl, preview);
  const cover =
    resolved.backgroundStyle === 'image' ? safeImageSrc(resolved.coverUrl, preview) : null;

  // The tab says what the business named its page; the app's own title stays when it named none.
  useEffect(() => {
    if (preview || !resolved.pageTitle?.trim()) return;
    const before = document.title;
    document.title = resolved.pageTitle.trim();
    return () => {
      document.title = before;
    };
  }, [preview, resolved.pageTitle]);

  function setLocale(next: string) {
    if (preview) return;
    try {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      /* the language is not remembered */
    }
    router.refresh();
  }

  return (
    <ThemeScope view={resolved}>
      <div className="flex min-h-dvh flex-col bg-[color:var(--bk-backdrop)]">
        <header className="border-b border-border bg-background">
          <div className="mx-auto flex w-full max-w-[880px] items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              {logo ? (
                // The business name is read next to it, so the picture itself carries no text alternative.
                <img
                  src={logo}
                  alt=""
                  className="h-9 max-w-[9rem] shrink-0 object-contain"
                  data-testid="booking-logo"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand text-sm font-bold text-brand-foreground"
                >
                  {[...name][0]?.toUpperCase() ?? '?'}
                </span>
              )}
              <span className="truncate text-sm font-semibold" dir="auto">
                {name}
              </span>
            </div>
            {resolved.showLanguageSwitch && (
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
                  {LANGUAGES.filter((l) => (LOCALES as readonly string[]).includes(l.id)).map(
                    (l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ),
                  )}
                </select>
              </div>
            )}
          </div>
        </header>
        {cover && (
          <div className="mx-auto w-full max-w-[880px] px-4 pt-4 sm:pt-6">
            <img
              src={cover}
              alt=""
              className="h-32 w-full rounded-xl object-cover sm:h-44"
              data-testid="booking-cover"
            />
          </div>
        )}
        <main className="mx-auto w-full max-w-[880px] flex-1 px-4 pb-10 pt-5 sm:pt-8">
          {children}
        </main>
        {resolved.showPoweredBy && (
          <footer className="pb-6 text-center text-xs text-[color:var(--bk-backdrop-muted)]">
            {t('poweredBy', { brand: t('brandName') })}
          </footer>
        )}
      </div>
    </ThemeScope>
  );
}
