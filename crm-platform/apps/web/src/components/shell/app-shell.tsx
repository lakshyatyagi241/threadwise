'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import type { ResolvedNavItem } from '@/features/_registry/types';
import { PageHelpTip } from '@/features/help-center';
import { SettingsTilesProvider } from '@/features/settings-hub/settings-context';
import { SettingsBack } from '@/features/settings-hub/settings-back';
import { PageSettingsShortcut } from '@/features/settings-hub/page-settings-shortcut';
import { CommandPalette } from './command-palette';
import { NavDrawer, NavRail } from './nav-rail';
import { PageTitle } from './page-title';
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

  return (
    <div className="app-shell flex min-h-dvh">
      <PageTitle nav={nav} tiles={settings} />
      {/* Ctrl/Cmd+K on every page: jump to any menu entry or Settings tile this person may open (nav and tiles are already gated). */}
      <CommandPalette nav={nav} tiles={settings} />
      <NavRail sections={sections} activeId={activeId} footer={navFooter} />
      <NavDrawer
        open={drawer}
        onClose={closeDrawer}
        sections={sections}
        activeId={activeId}
        returnFocusTo={menuButton}
        footer={navFooter}
      />
      <div className="app-shell-col flex min-w-0 flex-1 flex-col">
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
        {banners}
        {/* `relative overflow-x-clip`: a visually hidden label that escaped a wide table must never widen the page.
            A screen wrapped in <PageFill> turns the shell into a one-window-tall column (rules in globals.css). */}
        <main className="app-shell-main relative min-w-0 flex-1 overflow-x-clip p-4 md:p-6">
          <SettingsTilesProvider tiles={settings}>
            <SettingsBack />
            {children}
          </SettingsTilesProvider>
        </main>
      </div>
    </div>
  );
}
