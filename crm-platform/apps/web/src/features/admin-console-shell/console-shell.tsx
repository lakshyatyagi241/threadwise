'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import type { OperatorSessionResponse } from '@crm/contracts';
import { Alert, Badge, Spinner, cn } from '@crm/ui';
import { setLocale, setTheme } from '@/components/shell/actions';
import { LOCALES } from '@/i18n/locales';
import { useModuleNav } from '@/features/addons-extension-registry/use-module-nav';
import { withModuleLeaves } from '@/features/addons-extension-registry/module-nav';
import { OperatorProvider } from '@/features/auth-registration-security/platform/operator-context';
import { OPERATOR_ACCOUNT_PATH } from '@/features/auth-registration-security/platform/operator-nav';
import {
  CloseIcon,
  MenuIcon,
  MoonIcon,
  SunIcon,
} from '@/features/auth-registration-security/platform/ui/icons';
import {
  IpBlockedView,
  useIpBlock,
} from '@/features/auth-registration-security/platform/ui/ip-blocked-view';
import { languageName } from '@/features/auth-registration-security/platform/ui/language';
import { ToastProvider } from '@/features/auth-registration-security/platform/ui/toast';
import { useDocumentTheme } from '@/features/auth-registration-security/platform/ui/use-browser';
import {
  CONSOLE_HOME,
  activeLeafId,
  buildConsoleNav,
  CONSOLE_NAV_ITEMS,
  hubOf,
} from './console-nav';
import { CONSOLE_LAYOUT } from './console-layout';
import { pageVisibleTo } from './console-access';
import { AreaLinks, HubMenu } from './hub-menu';
import { HIDE_WHEN_COLLAPSED, RailLink } from './rail-link';
import type { ConsoleCounts } from './console-counts';
import { ConsoleIcon } from './console-icons';
import { ConsolePalette, useIsApple } from './console-palette';
import { CONSOLE_KEYWORDS } from './console-keywords';
import { buildSearchIndex, makeSearchEntry, type SearchEntry } from './console-search';
import { saveSidebarState, type SidebarState } from './sidebar-state';

const PLATFORM = 'auth-registration-security.platform';
/**
 * Page content. An `sr-only` label inside a table that scrolls sideways (a column header's "Actions") is absolutely
 * positioned at its in-flow spot, past the visible edge, and the scroller does not contain it, so the whole page grew a
 * horizontal scrollbar on phones and tablets. Pinning every `sr-only` node to the inline start keeps it inside the
 * viewport. Breadcrumb links get a 24px tap target.
 */
const MAIN_CLASS =
  'min-w-0 flex-1 p-4 outline-none md:p-6 [&_.sr-only]:start-0 [&_nav_a]:inline-flex [&_nav_a]:min-h-6 [&_nav_a]:items-center';
const ROLE_TONE = { super_admin: 'success', support: 'neutral', auditor: 'neutral' } as const;

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
 * The platform console shell (WD-ASHELL-003/004/005): a grouped rail with live count badges that
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
  const ts = useTranslations('admin-console-shell.search');
  const tAll = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const theme = useDocumentTheme();
  const [, start] = useTransition();
  const [signingOut, setSigningOut] = useState(false);
  const [collapsed, setCollapsed] = useState(initialSidebar === 'collapsed');
  // The drawer belongs to the page it was opened on, so navigating closes it without an effect.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  const open = openAt === pathname;
  const setOpen = (next: boolean) => setOpenAt(next ? pathname : null);

  const { operator } = session;
  const gated = session.mfaEnrolmentRequired;
  const onAccountPage = pathname === OPERATOR_ACCOUNT_PATH;
  const onHome = pathname === CONSOLE_HOME;
  const blocked = gated && !onAccountPage;
  // The API refused this address (operator IP allowlist, WD-AUTH-038): say so instead of showing empty screens.
  const ipBlock = useIpBlock();

  // Active modules append their own entries (add-ons domain, WD-ADD-012).
  const moduleNav = useModuleNav(!gated);
  const entries = useMemo(
    () =>
      withModuleLeaves(
        buildConsoleNav(CONSOLE_NAV_ITEMS, CONSOLE_LAYOUT, (id) =>
          pageVisibleTo(session.operator.role, id),
        ),
        moduleNav,
      ),
    [moduleNav, session.operator.role],
  );
  const activeId = activeLeafId(pathname, entries);
  const activeHub = hubOf(entries, activeId);

  // Console search (Ctrl+K): every page of the rail plus Your account. Off while the menu is disabled (two-factor enrolment pending).
  const apple = useIsApple();
  const searchIndex = useMemo(
    () => [
      ...buildSearchIndex(entries, tAll, (id) => CONSOLE_KEYWORDS[id] ?? ''),
      makeSearchEntry(
        'account',
        OPERATOR_ACCOUNT_PATH,
        tn('account'),
        '',
        '',
        CONSOLE_KEYWORDS.account,
      ),
    ],
    [entries, tAll, tn],
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const searchAvailable = !gated;
  const openPalette = () => {
    if (searchAvailable) setPaletteOpen(true);
  };
  const choosePage = (entry: SearchEntry) => {
    setPaletteOpen(false);
    if (entry.href !== pathname) router.push(entry.href);
  };

  // Ctrl+K or Command+K toggles the search. It matches the physical K key as well, so it works on non-Latin keyboard layouts.
  useEffect(() => {
    if (!searchAvailable) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== 'k' && e.code !== 'KeyK') return;
      e.preventDefault();
      if (paletteOpen) setPaletteOpen(false);
      else openPalette();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
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
    saveSidebarState(next);
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

  const hideWhenCollapsed = HIDE_WHEN_COLLAPSED;

  return (
    <OperatorProvider session={session}>
      <ToastProvider>
        <a
          href="#console-main"
          className="fixed start-3 top-3 z-50 -translate-y-[200%] rounded-md bg-background px-3 py-2 text-sm focus:translate-y-0 focus:shadow-lg"
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
              'w-64 md:sticky md:top-0 md:h-dvh md:overflow-hidden md:data-[collapsed=true]:w-16',
              // Home is a grid of area blocks, so the desktop page has no rail; the phone drawer still lists the areas.
              onHome && 'md:hidden',
              'max-md:fixed max-md:inset-y-0 max-md:start-0 max-md:overflow-hidden',
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

            {/* Only the list scrolls: the brand row above and the account row below stay in view. Padding keeps the focus ring from being clipped. */}
            <nav className="-mx-1 mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1 [scrollbar-color:rgb(255_255_255/0.25)_transparent] [scrollbar-width:thin]">
              {activeHub ? (
                <>
                  <div className={hideWhenCollapsed}>
                    <HubMenu
                      hub={activeHub}
                      entries={entries}
                      activeId={activeId}
                      counts={counts}
                      gated={gated}
                    />
                  </div>
                  {/* An icon-only rail has no room for page names: it shows one icon per area instead. */}
                  <div className="hidden space-y-0.5 md:group-data-[collapsed=true]/rail:block">
                    <AreaLinks
                      entries={entries}
                      activeHubId={activeHub.id}
                      homeActive={false}
                      gated={gated}
                    />
                  </div>
                </>
              ) : (
                <AreaLinks
                  entries={entries}
                  activeHubId={null}
                  homeActive={pathname === CONSOLE_HOME}
                  gated={gated}
                />
              )}
            </nav>

            <div className="mt-3 border-t border-white/10 pt-2">
              <RailLink
                href={OPERATOR_ACCOUNT_PATH}
                icon="user"
                label={tn('account')}
                active={onAccountPage}
                testId="rail-account"
              />
            </div>

            <div className="mt-2 border-t border-white/10 pt-3 sm:hidden">
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

              <div className="hidden min-w-0 flex-1 justify-center md:flex">
                <button
                  type="button"
                  data-testid="console-search-trigger"
                  onClick={openPalette}
                  disabled={!searchAvailable}
                  aria-haspopup="dialog"
                  aria-keyshortcuts="Control+K Meta+K"
                  aria-label={ts('label')}
                  className="flex h-9 w-full max-w-sm items-center gap-2 rounded-md border border-border bg-muted/40 px-3 text-sm text-muted-foreground transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ConsoleIcon name="search" className="size-4" />
                  <span className="min-w-0 flex-1 truncate text-start">{ts('trigger')}</span>
                  <kbd className="rounded border border-border px-1.5 text-xs">
                    {apple ? '⌘K' : 'Ctrl K'}
                  </kbd>
                </button>
              </div>

              <div className="ms-auto flex items-center gap-1.5 sm:gap-2 md:ms-0">
                <button
                  type="button"
                  data-testid="console-search-trigger-compact"
                  onClick={openPalette}
                  disabled={!searchAvailable}
                  aria-haspopup="dialog"
                  aria-label={ts('label')}
                  title={ts('label')}
                  className="inline-flex size-8 items-center justify-center rounded-md border border-border hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 md:hidden"
                >
                  <ConsoleIcon name="search" className="size-4" />
                </button>
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

            {paletteOpen && searchAvailable && (
              <ConsolePalette
                index={searchIndex}
                onSelect={choosePage}
                onClose={() => setPaletteOpen(false)}
              />
            )}

            {gated && (
              <Alert tone="warning" className="m-3 sm:mx-6 sm:mt-4">
                <p className="font-medium">{t('mfaRequired.title')}</p>
                <p>{t('mfaRequired.body')}</p>
              </Alert>
            )}

            <main id="console-main" tabIndex={-1} className={MAIN_CLASS}>
              {blocked ? (
                <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Spinner label={t('redirecting')} />
                  {t('redirecting')}
                </div>
              ) : ipBlock ? (
                <IpBlockedView ip={ipBlock.ip} />
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
