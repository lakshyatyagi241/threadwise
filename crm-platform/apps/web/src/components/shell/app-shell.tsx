'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ResolvedNavItem } from '@/features/_registry/types';
import { useStoredValue } from '@/lib/use-stored-value';
import { NavDrawer, NavRail } from './nav-rail';
import { activeItemId, toSections } from './nav-model';
import { TopBar, type WalletChipData } from './top-bar';
import type { ShellUser } from './user-menu';

export const NAV_PINNED_KEY = 'shell:nav:pinned';

interface Props {
  user: ShellUser;
  nav: ResolvedNavItem[];
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
  children: ReactNode;
}

/** Screens the top bar's bell and gear point at, found in the menu by id (they stay disabled until the screen exists). */
const BELL_ID = 'notifications';
const GEAR_ID = 'account';

/**
 * The signed-in frame: a dark navigation column (a slim icon rail, a labelled panel when pinned open, a drawer on
 * phones) beside a top bar and the page. The menu comes entirely from the resolved registry; nothing here names a domain's screens.
 */
export function AppShell({
  user,
  nav,
  theme,
  headerStart,
  navFooter,
  banners,
  announcement,
  wallet,
  notificationCount,
  children,
}: Props) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [pinnedRaw, setPinned] = useStoredValue(NAV_PINNED_KEY);
  const pinned = pinnedRaw === '1';

  const sections = useMemo(() => toSections(nav), [nav]);
  const activeId = activeItemId(nav, pathname);
  const closeDrawer = useCallback(() => setDrawer(false), []);

  const bell = nav.find((i) => i.id === BELL_ID);
  const gear = nav.find((i) => i.id === GEAR_ID);

  return (
    <div className="flex min-h-dvh">
      <NavRail
        sections={sections}
        activeId={activeId}
        pinned={pinned}
        onTogglePinned={() => setPinned(pinned ? '0' : '1')}
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
          settingsHref={gear && !gear.comingSoon ? gear.href : undefined}
        />
        {banners}
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
