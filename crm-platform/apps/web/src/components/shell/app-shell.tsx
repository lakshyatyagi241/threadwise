'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import type { ResolvedNavItem } from '@/features/_registry/types';
import { ConnectDeviceSheet } from '@/features/admin-console-shell/connect-device/connect-device-sheet';
import { EmbedFlag } from '@/features/admin-console-shell/connect-device/embed-flag';
import { InboxBell } from '@/features/admin-console-shell/inbox-bell/inbox-bell';
import { QuickAccessDrawer } from '@/features/admin-console-shell/quick-access/quick-access-drawer';
import { FlashHost } from '@/features/admin-console-shell/flash/flash-host';
import { GuidedTour } from '@/features/admin-console-shell/tour/guided-tour';
import { PageHelpTip } from '@/features/help-center';
import { SettingsTilesProvider } from '@/features/settings-hub/settings-context';
import { SettingsBack } from '@/features/settings-hub/settings-back';
import { PageSettingsShortcut } from '@/features/settings-hub/page-settings-shortcut';
import { NavDrawer, NavRail } from './nav-rail';
import { SETTINGS_NAV_ID, activeNavId, helpItems, menuItems, toSections } from './nav-model';
import { TopBar, type WalletChipData } from './top-bar';
import type { ShellUser } from './user-menu';

interface Props {
  user: ShellUser;
  nav: ResolvedNavItem[];
  /** The Settings area's tiles after the gates (see features/_registry/settings-resolve.ts). */
  settings: ResolvedSettingsTile[];
  theme: 'light' | 'dark';
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

/**
 * The signed-in frame: a dark navigation column (a slim icon rail with a panel per group, a drawer on
 * phones) beside a top bar and the page. The menu comes entirely from the resolved registry; nothing here names a domain's screens.
 */
export function AppShell({
  user,
  nav,
  settings,
  theme,
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
  const [drawer, setDrawer] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  const drawn = useMemo(() => menuItems(nav, settings), [nav, settings]);
  const sections = useMemo(() => toSections(drawn), [drawn]);
  const help = useMemo(() => helpItems(nav), [nav]);
  // Over what is drawn: a screen the sidebar does not list lights up the entry that covers it (/store/orders lights Store).
  const activeId = activeNavId(drawn, settings, pathname);
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
        <FlashHost />
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
            pageSettings={<PageSettingsShortcut tiles={settings} />}
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
        <NavRail sections={sections} activeId={activeId} footer={navFooter} />
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
              pageSettings={<PageSettingsShortcut tiles={settings} />}
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
              pageHelp={<PageHelpTip />}
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
