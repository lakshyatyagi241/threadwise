'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import type { OperatorRole, OperatorSessionResponse } from '@crm/contracts';
import { Alert, Badge, Spinner, cn } from '@crm/ui';
import { setLocale, setTheme } from '@/components/shell/actions';
import { LOCALES } from '@/i18n/locales';
import { OperatorProvider } from './operator-context';
import {
  OPERATOR_ACCOUNT_PATH,
  OPERATOR_HOME,
  OPERATOR_NAV,
  activeNavId,
  groupNav,
} from './operator-nav';
import { CloseIcon, MenuIcon, MoonIcon, SunIcon } from './ui/icons';
import { languageName } from './ui/language';
import { ToastProvider } from './ui/toast';
import { useDocumentTheme } from './ui/use-browser';

const NS = 'auth-registration-security.platform';
const ROLE_TONE: Record<OperatorRole, 'success' | 'neutral'> = {
  super_admin: 'success',
  support: 'neutral',
  auditor: 'neutral',
};

/**
 * The platform console shell: sidebar, header, drawer on phones. A super
 * admin who has not enrolled two-factor authentication gets nothing but the enrolment
 * page: the API refuses everything else, so the shell sends every other path there.
 */
export function OperatorShell({
  operator: session,
  children,
}: {
  operator: OperatorSessionResponse;
  children: ReactNode;
}) {
  const t = useTranslations(`${NS}.shell`);
  const tn = useTranslations(`${NS}.nav`);
  const tAll = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  // The drawer is open for the page it was opened on, so navigating closes it without an effect.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const setOpen = (next: boolean | ((v: boolean) => boolean)) =>
    setOpenAt((typeof next === 'function' ? next(open) : next) ? pathname : null);
  const theme = useDocumentTheme();
  const [signingOut, setSigningOut] = useState(false);
  const [, start] = useTransition();
  const menuButton = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  const { operator } = session;
  const gated = session.mfaEnrolmentRequired;
  const onAccountPage = pathname === OPERATOR_ACCOUNT_PATH;
  const blocked = gated && !onAccountPage;
  const activeId = activeNavId(pathname, OPERATOR_NAV);
  const groups = useMemo(() => groupNav(OPERATOR_NAV), []);
  const languages = useMemo(() => LOCALES.map((code) => [code, languageName(code)] as const), []);

  useEffect(() => {
    if (blocked) router.replace(OPERATOR_ACCOUNT_PATH);
  }, [blocked, router]);

  // Escape closes the drawer and hands focus back to its button.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenAt(null);
        menuButton.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    drawerRef.current?.querySelector<HTMLElement>('a[href],button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    start(() => void setTheme(next));
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      await fetch('/api/platform-auth/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
      router.replace('/admin/login');
      router.refresh();
    }
  };

  const signOutButton = (className: string) => (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={signingOut}
      className={cn(
        'items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      {signingOut && <Spinner label={t('signingOut')} />}
      {t('signOut')}
    </button>
  );

  return (
    <OperatorProvider session={session}>
      <ToastProvider>
        <a
          href="#console-main"
          className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg"
        >
          {t('skipToContent')}
        </a>
        <div className="flex min-h-dvh">
          {open && (
            <button
              type="button"
              aria-label={t('closeMenu')}
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-30 bg-black/50 md:hidden"
            />
          )}
          <aside
            id="console-sidebar"
            ref={drawerRef}
            aria-label={t('navLabel')}
            className={cn(
              'z-40 flex w-64 shrink-0 flex-col bg-sidebar p-3 text-sidebar-foreground',
              'md:sticky md:top-0 md:h-dvh md:overflow-y-auto',
              'max-md:fixed max-md:inset-y-0 max-md:start-0 max-md:overflow-y-auto',
              open ? 'max-md:flex' : 'max-md:hidden',
            )}
          >
            <div className="flex items-center justify-between gap-2 px-2 py-3">
              <Link
                href={OPERATOR_HOME}
                className="min-w-0 rounded-md text-white focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="block truncate text-lg font-semibold leading-tight">
                  {t('brand')}
                </span>
                <span className="block truncate text-xs uppercase tracking-wide opacity-70">
                  {t('title')}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  menuButton.current?.focus();
                }}
                aria-label={t('closeMenu')}
                className="rounded-md p-1.5 text-sidebar-foreground hover:bg-sidebar-active md:hidden"
              >
                <CloseIcon />
              </button>
            </div>

            <nav className="mt-2 flex-1 space-y-4">
              {groups.map((group) => (
                <div key={group.groupKey}>
                  <div className="px-2 pb-1 text-xs uppercase tracking-wide opacity-60">
                    {tAll(group.groupKey)}
                  </div>
                  {group.items.map((item) => {
                    const label = tAll(item.labelKey);
                    return gated ? (
                      <span
                        key={item.id}
                        aria-disabled="true"
                        className="flex items-center rounded-md px-2 py-2 text-sm opacity-40"
                      >
                        {label}
                      </span>
                    ) : (
                      <Link
                        key={item.id}
                        href={item.href}
                        aria-current={item.id === activeId ? 'page' : undefined}
                        className={cn(
                          'flex items-center rounded-md px-2 py-2 text-sm hover:bg-sidebar-active',
                          'focus-visible:ring-2 focus-visible:ring-primary',
                          item.id === activeId && 'bg-sidebar-active text-white',
                        )}
                      >
                        {label}
                      </Link>
                    );
                  })}
                </div>
              ))}
              <div>
                <div className="px-2 pb-1 text-xs uppercase tracking-wide opacity-60">
                  {tn('groups.account')}
                </div>
                <Link
                  href={OPERATOR_ACCOUNT_PATH}
                  aria-current={onAccountPage ? 'page' : undefined}
                  className={cn(
                    'flex items-center rounded-md px-2 py-2 text-sm hover:bg-sidebar-active',
                    'focus-visible:ring-2 focus-visible:ring-primary',
                    onAccountPage && 'bg-sidebar-active text-white',
                  )}
                >
                  {tn('account')}
                </Link>
              </div>
            </nav>

            <div className="mt-4 border-t border-white/10 pt-3 sm:hidden">
              {signOutButton(
                'flex h-10 w-full text-sidebar-foreground hover:bg-sidebar-active hover:text-white',
              )}
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur sm:px-4">
              <button
                ref={menuButton}
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-label={t('openMenu')}
                aria-expanded={open}
                aria-controls="console-sidebar"
                className="inline-flex size-9 items-center justify-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary md:hidden"
              >
                <MenuIcon />
              </button>
              <span className="min-w-0 truncate text-sm font-medium">{t('title')}</span>

              <div className="ms-auto flex items-center gap-1.5 sm:gap-2">
                <select
                  aria-label={t('language')}
                  value={locale}
                  onChange={(e) =>
                    start(async () => {
                      await setLocale(e.target.value);
                      router.refresh();
                    })
                  }
                  className="h-8 w-20 rounded-md border border-border bg-background px-1.5 text-sm focus-visible:ring-2 focus-visible:ring-primary sm:w-auto sm:max-w-32 sm:px-2"
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
                  className="inline-flex size-8 items-center justify-center rounded-md border border-border hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
                </button>
                <Link
                  href={OPERATOR_ACCOUNT_PATH}
                  title={t('accountLink', { email: operator.email })}
                  className="flex items-center gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
                  >
                    {operator.fullName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="hidden max-w-36 truncate text-muted-foreground lg:inline">
                    {operator.fullName}
                  </span>
                  <span className="hidden sm:inline-flex">
                    <Badge tone={ROLE_TONE[operator.role]}>{t(`roles.${operator.role}`)}</Badge>
                  </span>
                  <span className="sr-only sm:hidden">
                    {operator.fullName}, {t(`roles.${operator.role}`)}
                  </span>
                </Link>
                {signOutButton('hidden h-8 sm:inline-flex')}
              </div>
            </header>

            {gated && (
              <Alert tone="warning" className="m-3 sm:mx-6 sm:mt-4">
                <p className="font-medium">{t('mfaRequired.title')}</p>
                <p>{t('mfaRequired.body')}</p>
              </Alert>
            )}

            <main
              id="console-main"
              tabIndex={-1}
              className="min-w-0 flex-1 p-4 outline-none md:p-6"
            >
              {blocked ? (
                <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Spinner label={t('redirecting')} />
                  {t('redirecting')}
                </div>
              ) : (
                children
              )}
            </main>
          </div>
        </div>
      </ToastProvider>
    </OperatorProvider>
  );
}
