'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Suspense,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { railTheme, type ShellConfigResponse } from '@crm/contracts';
import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import type { ResolvedNavItem } from '@/features/_registry/types';
import { ConnectDeviceSheet } from '@/features/admin-console-shell/connect-device/connect-device-sheet';
import { EmbedFlag } from '@/features/admin-console-shell/connect-device/embed-flag';
import { InboxBell } from '@/features/admin-console-shell/inbox-bell/inbox-bell';
import { QuickAccessDrawer } from '@/features/admin-console-shell/quick-access/quick-access-drawer';
import { GuidedTour } from '@/features/admin-console-shell/tour/guided-tour';
import { SettingsTilesProvider } from '@/features/settings-hub/settings-context';
import { SettingsBack } from '@/features/settings-hub/settings-back';
import { PageSettingsShortcut } from '@/features/settings-hub/page-settings-shortcut';
import { useStoredValue } from '@/lib/use-stored-value';
import { CommandPalette } from './command-palette';
import { NavDrawer, NavRail } from './nav-rail';
import {
  SETTINGS_NAV_ID,
  activeNavId,
  helpItems,
  isFullWidthScreen,
  menuItems,
  toSections,
} from './nav-model';
import { ShellDataProvider } from './shell-data';
import { useChromeHidden } from './shell-chrome';
import { TopBar, type WalletChipData } from './top-bar';
import { TopNav } from './top-nav';
import { TopStrip, type JumpEntry } from './top-strip';
import { activeBarKey, resolveTopBar } from './topbar-model';
import type { ShellUser } from './user-menu';

export const NAV_PINNED_KEY = 'shell:nav:pinned';

interface Props {
  user: ShellUser;
  nav: ResolvedNavItem[];
  /** The Settings area's tiles after the gates (see features/_registry/settings-resolve.ts). */
  settings: ResolvedSettingsTile[];
  theme: 'light' | 'dark';
  /**
   * What the platform admin chose for every customer: top bar or sidebar, the rail colours, the bar's entries and whether the
   * tour runs. Absent (a test, an isolated render) means the sidebar shell with no extras.
   */
  shell?: ShellConfigResponse;
  /** Plan and role for the account menu's chip. */
  profile?: { plan: string; role: string };
  /** Workspace switcher and similar header content owned by a domain. */
  headerStart?: ReactNode;
  /** Card pinned under the menu (the workspace switcher). It reads `useNavCollapsed()` to shrink with the rail. */
  navFooter?: ReactNode;
  /** Persistent notices above the page (email verification, trial). */
  banners?: ReactNode;
  /** Optional pill in the middle of the top bar (see `AnnouncementPill`). */
  announcement?: ReactNode;
  /** Optional balance chip; omitted until a billing domain provides one. */
  wallet?: WalletChipData;
  /** Unread notifications for the bell; 0 or absent shows no count. */
  notificationCount?: number;
  /** The live notification bell (see features/notifications-activity-audit); when given it replaces the static one. */
  bell?: ReactNode;
  children: ReactNode;
}

/** The screen the top bar's bell points at, found in the menu by id (it stays disabled until the screen exists). */
const BELL_ID = 'notifications';

const ACCOUNT_JUMPS = [
  { key: 'account', href: '/account' },
  { key: 'wallet', href: '/billing/wallet' },
  { key: 'notifications', href: '/notifications' },
] as const;

/**
 * The signed-in frame. Two modes, chosen platform-wide by an admin (WD-ASHELL-011): the classic top bar with a More page
 * (WaDesk's default), or a left rail with every page grouped (a slim icon rail, a labelled panel when pinned open, a drawer
 * on phones) under a slim strip. The menu comes entirely from the resolved registry; nothing here names a domain's screens.
 * A page can hide all chrome (`<HideShellChrome />`) for a full-screen canvas.
 */
export function AppShell({
  user,
  nav,
  settings,
  theme,
  shell,
  profile,
  headerStart,
  navFooter,
  banners,
  announcement,
  wallet,
  notificationCount,
  bell: liveBell,
  children,
}: Props) {
  const pathname = usePathname();
  const tNav = useTranslations();
  const tStrip = useTranslations('admin-console-shell.strip');
  const [drawer, setDrawer] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [pinnedRaw, setPinned] = useStoredValue(NAV_PINNED_KEY);
  const wide = isFullWidthScreen(nav, settings, pathname);
  // On a full-width screen the menu is the slim rail; the expand button opens it for that visit only (the saved choice stays).
  const [openHere, setOpenHere] = useState<string | null>(null);
  const pinned = wide ? openHere === pathname : pinnedRaw === '1';
  const togglePinned = () =>
    wide ? setOpenHere(pinned ? null : pathname) : setPinned(pinned ? '0' : '1');
  const chromeHidden = useChromeHidden();

  const mode = shell?.mode ?? 'sidebar';
  const sections = useMemo(() => toSections(menuItems(nav)), [nav]);
  const help = useMemo(() => helpItems(nav), [nav]);
  const activeId = activeNavId(nav, settings, pathname);
  const closeDrawer = useCallback(() => setDrawer(false), []);

  const bell = nav.find((i) => i.id === BELL_ID);
  const settingsLink = nav.find((i) => i.id === SETTINGS_NAV_ID);
  const barItems = useMemo(
    () => resolveTopBar(shell?.bar ?? [], nav, settings),
    [shell?.bar, nav, settings],
  );
  const rail = shell ? railTheme(shell.rail) : null;
  const railVars = rail ? (rail.vars as CSSProperties) : undefined;

  const jumpIndex = useMemo<JumpEntry[]>(() => {
    const groupLabel = (g: string) => tNav(`shell.groups.${g}`);
    const fromMenu = sections.flatMap((s) =>
      s.items
        .filter((i) => !i.comingSoon)
        .map((i) => ({ label: tNav(i.labelKey), group: groupLabel(s.group), href: i.href })),
    );
    const account = ACCOUNT_JUMPS.map((a) => ({
      label: tStrip(`account.${a.key}`),
      group: tStrip('account.group'),
      href: a.href,
    }));
    return [...fromMenu, ...account];
  }, [sections, tNav, tStrip]);
  const activeItem = nav.find((i) => i.id === activeId);

  const data = useMemo(
    () => ({
      nav,
      tiles: settings,
      mode,
      bar: shell?.bar ?? [],
      walletLabel: wallet?.label,
      profile: profile ? { ...profile, walletLabel: wallet?.label } : undefined,
    }),
    [nav, settings, mode, shell?.bar, wallet?.label, profile],
  );

  const page = (
    <main className="relative min-w-0 flex-1 overflow-x-clip p-4 md:p-6">
      <SettingsTilesProvider tiles={settings}>
        <Suspense fallback={null}>
          <EmbedFlag />
        </Suspense>
        <SettingsBack />
        {children}
      </SettingsTilesProvider>
    </main>
  );
  const extras = shell ? (
    <>
      <CommandPalette nav={nav} tiles={settings} />
      <QuickAccessDrawer />
      <ConnectDeviceSheet />
      <InboxBell />
      <Suspense fallback={null}>
        <GuidedTour run={shell.tour.run && mode === 'topbar'} />
      </Suspense>
    </>
  ) : null;

  // A full-screen page: no header, rail or bars (WD-ASHELL-012).
  if (chromeHidden) {
    return (
      <ShellDataProvider value={data}>
        <div className="flex min-h-dvh flex-col">{page}</div>
        {extras}
      </ShellDataProvider>
    );
  }

  if (mode === 'topbar') {
    return (
      <ShellDataProvider value={data}>
        <div className="flex min-h-dvh flex-col" data-user-shell="topbar">
          <NavDrawer
            open={drawer}
            onClose={closeDrawer}
            sections={sections}
            activeId={activeId}
            returnFocusTo={menuButton}
            footer={navFooter}
          />
          {banners}
          <TopNav
            user={user}
            theme={theme}
            items={barItems}
            activeKey={activeBarKey(barItems, pathname)}
            onOpenMenu={() => setDrawer(true)}
            menuButtonRef={menuButton}
            workspace={navFooter}
            wallet={wallet}
            bell={liveBell}
            settingsHref={settingsLink?.href}
            helpItems={help}
          />
          {page}
        </div>
        {extras}
      </ShellDataProvider>
    );
  }

  return (
    <ShellDataProvider value={data}>
      <div className="flex min-h-dvh" data-user-shell="sidebar" style={railVars}>
        <NavRail
          sections={sections}
          activeId={activeId}
          pinned={pinned}
          onTogglePinned={togglePinned}
          footer={navFooter}
        />
        <NavDrawer
          open={drawer}
          onClose={closeDrawer}
          sections={sections}
          activeId={activeId}
          returnFocusTo={menuButton}
          footer={navFooter}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          {banners}
          {shell ? (
            <TopStrip
              user={user}
              theme={theme}
              onOpenMenu={() => setDrawer(true)}
              menuButtonRef={menuButton}
              pageTitle={activeItem ? tNav(activeItem.labelKey) : ''}
              brand={tNav('common.appName')}
              jumpIndex={jumpIndex}
              wallet={wallet}
              bell={liveBell}
              settingsHref={settingsLink?.href}
              helpItems={help}
            />
          ) : (
            <TopBar
              user={user}
              theme={theme}
              onOpenMenu={() => setDrawer(true)}
              menuButtonRef={menuButton}
              headerStart={headerStart}
              announcement={announcement}
              wallet={wallet}
              notificationsHref={bell && !bell.comingSoon ? bell.href : undefined}
              notificationCount={notificationCount}
              bell={liveBell}
              pageSettings={<PageSettingsShortcut tiles={settings} />}
              settingsHref={settingsLink?.href}
              helpItems={help}
            />
          )}
          {/* `relative overflow-x-clip`: a visually hidden label that escaped a wide table must never widen the page. */}
          {page}
        </div>
      </div>
      {extras}
    </ShellDataProvider>
  );
}
