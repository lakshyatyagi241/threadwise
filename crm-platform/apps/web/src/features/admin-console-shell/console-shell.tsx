'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import type { OperatorSessionResponse } from '@crm/contracts';
import { Alert, Badge, Spinner, cn } from '@crm/ui';
import { setLocale, setTheme } from '@/components/shell/actions';
import { LOCALES } from '@/i18n/locales';
import { OperatorProvider } from '@/features/auth-registration-security/platform/operator-context';
import {
  OPERATOR_ACCOUNT_PATH,
  OPERATOR_NAV,
} from '@/features/auth-registration-security/platform/operator-nav';
import {
  CloseIcon,
  MenuIcon,
  MoonIcon,
  SunIcon,
} from '@/features/auth-registration-security/platform/ui/icons';
import { languageName } from '@/features/auth-registration-security/platform/ui/language';
import { ToastProvider } from '@/features/auth-registration-security/platform/ui/toast';
import { useDocumentTheme } from '@/features/auth-registration-security/platform/ui/use-browser';
import {
  CONSOLE_HOME,
  activeLeafId,
  buildConsoleNav,
  formatCount,
  initiallyOpenGroups,
  isGroup,
  type ConsoleLeaf,
} from './console-nav';
import type { ConsoleCounts } from './console-counts';
import { sidebarCookie, type SidebarState } from './sidebar-state';

const PLATFORM = 'auth-registration-security.platform';
const ROLE_TONE = { super_admin: 'success', support: 'neutral', auditor: 'neutral' } as const;

const Chevron = ({ open }: { open: boolean }) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 20 20"
    className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="m5 8 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PanelIcon = ({ collapsed }: { collapsed: boolean }) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 20 20"
    className={cn('size-5 rtl:-scale-x-100', collapsed && 'rotate-180')}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
  >
    <rect x="3" y="4" width="14" height="12" rx="2" />
    <path d="M8 4v12M13 8l-2 2 2 2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * The platform console shell (TW-ASHELL-003/004/005): a grouped rail with live count badges that
 * collapses to icons on desktop (remembered in a cookie the server reads, so there is no flash) and
 * is a drawer on phones. A super admin who has not enrolled two-factor authentication gets nothing
 * but the enrolment page: the API refuses everything else, so every other path is sent there.
 */
export function ConsoleShell({
  operator: session,
  counts,
  initialSidebar,
  children,
}: {
  operator: OperatorSessionResponse;
  counts: ConsoleCounts;
  initialSidebar: SidebarState;
  children: ReactNode;
}) {
  const t = useTranslations(`${PLATFORM}.shell`);
  const tn = useTranslations(`${PLATFORM}.nav`);
  const tc = useTranslations('admin-console-shell.shell');
  const tAll = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const theme = useDocumentTheme();
  const [, start] = useTransition();
  const [signingOut, setSigningOut] = useState(false);
  const [collapsed, setCollapsed] = useState(initialSidebar === 'collapsed');
  // Drawer and group toggles belong to the page they were made on, so navigating resets them without an effect.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const [flipped, setFlipped] = useState<{ path: string; ids: string[] }>({
    path: pathname,
    ids: [],
  });
  const menuButton = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  const open = openAt === pathname;
  const setOpen = (next: boolean) => setOpenAt(next ? pathname : null);

  const { operator } = session;
  const gated = session.mfaEnrolmentRequired;
  const onAccountPage = pathname === OPERATOR_ACCOUNT_PATH;
  const blocked = gated && !onAccountPage;

  const entries = useMemo(() => buildConsoleNav(OPERATOR_NAV), []);
  const activeId = activeLeafId(pathname, entries);
  const defaultOpen = useMemo(() => initiallyOpenGroups(entries, activeId), [entries, activeId]);
  const flippedIds = flipped.path === pathname ? flipped.ids : [];
  const isGroupOpen = (id: string) => defaultOpen.has(id) !== flippedIds.includes(id);
  const toggleGroup = (id: string) =>
    setFlipped({
      path: pathname,
      ids: flippedIds.includes(id) ? flippedIds.filter((x) => x !== id) : [...flippedIds, id],
    });

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

  // Body scroll stays locked while the drawer is open.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const toggleCollapsed = () => {
    const next: SidebarState = collapsed ? 'expanded' : 'collapsed';
    setCollapsed(next === 'collapsed');
    document.cookie = sidebarCookie(next);
  };

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

  // Labels and headings vanish only on desktop and only when collapsed; the phone drawer is always full.
  const hideWhenCollapsed = 'md:group-data-[collapsed=true]/rail:hidden';

  const leafLink = (leaf: ConsoleLeaf, nested: boolean) => {
    const label = tAll(leaf.labelKey);
    const badge = formatCount(leaf.badgeKey ? counts[leaf.badgeKey] : null);
    const active = leaf.id === activeId;
    const body = (
      <>
        <span
          aria-hidden="true"
          className="flex size-6 shrink-0 items-center justify-center rounded bg-white/10 text-xs font-semibold uppercase"
        >
          {label.slice(0, 1)}
        </span>
        <span className={cn('min-w-0 flex-1 truncate', hideWhenCollapsed)}>{label}</span>
        {badge && (
          <span
            data-testid={`count-${leaf.id}`}
            className={cn(
              'rounded-full bg-white/15 px-1.5 text-xs tabular-nums',
              hideWhenCollapsed,
            )}
          >
            {badge}
          </span>
        )}
      </>
    );
    const cls = cn(
      'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
      nested && 'ms-2 md:group-data-[collapsed=true]/rail:ms-0',
    );
    return gated ? (
      <span key={leaf.id} aria-disabled="true" className={cn(cls, 'opacity-40')}>
        {body}
      </span>
    ) : (
      <Link
        key={leaf.id}
        href={leaf.href}
        title={label}
        aria-current={active ? 'page' : undefined}
        className={cn(
          cls,
          'hover:bg-sidebar-active focus-visible:ring-2 focus-visible:ring-primary',
          active && 'bg-sidebar-active text-white',
        )}
      >
        {body}
      </Link>
    );
  };

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
            data-collapsed={collapsed}
            aria-label={t('navLabel')}
            className={cn(
              'group/rail z-40 flex shrink-0 flex-col bg-sidebar p-3 text-sidebar-foreground',
              'w-64 md:sticky md:top-0 md:h-dvh md:overflow-y-auto md:data-[collapsed=true]:w-16',
              'max-md:fixed max-md:inset-y-0 max-md:start-0 max-md:overflow-y-auto',
              open ? 'max-md:flex' : 'max-md:hidden',
            )}
          >
            <div className="flex items-center justify-between gap-2 px-2 py-3">
              <Link
                href={CONSOLE_HOME}
                className={cn(
                  'min-w-0 rounded-md text-white focus-visible:ring-2 focus-visible:ring-primary',
                  hideWhenCollapsed,
                )}
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
                data-testid="console-sidebar-toggle"
                onClick={toggleCollapsed}
                aria-label={collapsed ? tc('expand') : tc('collapse')}
                title={collapsed ? tc('expand') : tc('collapse')}
                aria-pressed={collapsed}
                className="hidden rounded-md p-1.5 text-sidebar-foreground hover:bg-sidebar-active focus-visible:ring-2 focus-visible:ring-primary md:inline-flex"
              >
                <PanelIcon collapsed={collapsed} />
              </button>
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

            <nav className="mt-2 flex-1 space-y-1">
              {entries.map((entry) => {
                if (!isGroup(entry)) return leafLink(entry, false);
                const label = tAll(entry.labelKey);
                const expanded = isGroupOpen(entry.id);
                return (
                  <div key={entry.id} className="pt-2">
                    <button
                      type="button"
                      data-testid={`group-${entry.id}`}
                      aria-expanded={expanded}
                      aria-label={tc('toggleGroup', { group: label })}
                      onClick={() => toggleGroup(entry.id)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-xs uppercase tracking-wide opacity-70 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-primary',
                        hideWhenCollapsed,
                      )}
                    >
                      <span className="truncate">{label}</span>
                      <Chevron open={expanded} />
                    </button>
                    {/* Collapsed rail shows every leaf as an icon, whatever the group state. */}
                    <div
                      className={cn(
                        'space-y-0.5',
                        !expanded && 'hidden md:group-data-[collapsed=true]/rail:block',
                      )}
                    >
                      {entry.children.map((leaf) => leafLink(leaf, true))}
                    </div>
                  </div>
                );
              })}
              <div className="pt-2">
                <div
                  className={cn(
                    'px-2 pb-1 text-xs uppercase tracking-wide opacity-60',
                    hideWhenCollapsed,
                  )}
                >
                  {tn('groups.account')}
                </div>
                <Link
                  href={OPERATOR_ACCOUNT_PATH}
                  title={tn('account')}
                  aria-current={onAccountPage ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-active',
                    'focus-visible:ring-2 focus-visible:ring-primary',
                    onAccountPage && 'bg-sidebar-active text-white',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="flex size-6 shrink-0 items-center justify-center rounded bg-white/10 text-xs font-semibold uppercase"
                  >
                    {tn('account').slice(0, 1)}
                  </span>
                  <span className={cn('truncate', hideWhenCollapsed)}>{tn('account')}</span>
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
                data-testid="console-menu-button"
                onClick={() => setOpen(!open)}
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
