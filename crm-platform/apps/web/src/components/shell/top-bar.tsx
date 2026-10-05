'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode, RefObject } from 'react';
import { cn } from '@crm/ui';
import type { ResolvedNavItem } from '@/features/_registry/types';
import { BrandMark, MenuIcon, NavIcon } from './nav-icons';
import { UserMenu, type ShellUser } from './user-menu';

export interface WalletChipData {
  /** Already formatted, e.g. "$ 24.50". */
  label: string;
  href?: string;
}

/** The pill in the middle of the top bar: a promo or notice with an optional link. Pass it as the shell's `announcement`. */
export function AnnouncementPill({ children, href }: { children: ReactNode; href?: string }) {
  const cls =
    'inline-flex max-w-full items-center gap-2 truncate rounded-full border border-brand/25 bg-brand/10 px-4 py-1.5 text-sm font-medium text-brand';
  return href ? (
    <Link
      href={href}
      className={cn(
        cls,
        'outline-none hover:bg-brand/15 focus-visible:ring-2 focus-visible:ring-primary',
      )}
    >
      {children}
    </Link>
  ) : (
    <span className={cls}>{children}</span>
  );
}

function IconLink({
  href,
  label,
  icon,
  badge,
}: {
  /** Absent = the screen is not built yet: a disabled button with a tooltip. */
  href?: string;
  label: string;
  icon: string;
  badge?: number;
}) {
  const t = useTranslations('shell');
  const cls =
    'relative flex size-9 items-center justify-center rounded-full text-muted-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-primary';
  const glyph = <NavIcon name={icon} className="size-5" />;
  if (!href) {
    return (
      <button
        type="button"
        disabled
        aria-label={`${label} (${t('soon')})`}
        title={`${label} (${t('soon')})`}
        className={cn(cls, 'cursor-not-allowed opacity-60')}
      >
        {glyph}
      </button>
    );
  }
  return (
    <Link
      href={href}
      aria-label={badge ? `${label} (${badge})` : label}
      title={label}
      className={cn(cls, 'hover:bg-muted hover:text-foreground')}
    >
      {glyph}
      {badge ? (
        <span
          aria-hidden="true"
          className="absolute -end-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-danger-foreground ring-2 ring-background"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </Link>
  );
}

export interface TopBarProps {
  user: ShellUser;
  theme: 'light' | 'dark';
  onOpenMenu: () => void;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  /** Workspace switcher and similar content owned by a domain, next to the brand. */
  headerStart?: ReactNode;
  /** Optional centre pill (see `AnnouncementPill`). */
  announcement?: ReactNode;
  wallet?: WalletChipData;
  notificationsHref?: string;
  notificationCount?: number;
  /** A live bell (badge and panel) owned by the notifications domain; replaces the link or the disabled placeholder. */
  bell?: ReactNode;
  /** The "?" that opens the guide of the current screen (see `PageHelpTip`); renders nothing on a screen with no guide. */
  pageHelp?: ReactNode;
  /** The gear that offers the settings behind the current screen (see `PageSettingsShortcut`); absent or empty on other screens. */
  pageSettings?: ReactNode;
  /** The Settings area; the user menu links to it (the gear that used to sit here is the menu's Settings entry now). */
  settingsHref?: string;
  /** Support and Guidebook, shown in the user menu's Help block. */
  helpItems?: readonly ResolvedNavItem[];
}

/** Brand on the start side, an optional announcement in the middle, balance, bell and the user menu at the end. */
export function TopBar({
  user,
  theme,
  onOpenMenu,
  menuButtonRef,
  headerStart,
  announcement,
  wallet,
  notificationsHref,
  notificationCount,
  bell,
  pageHelp,
  pageSettings,
  settingsHref,
  helpItems,
}: TopBarProps) {
  const t = useTranslations();
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-background px-3 sm:gap-3 sm:px-4">
      <button
        ref={menuButtonRef}
        type="button"
        onClick={onOpenMenu}
        aria-label={t('shell.openMenu')}
        className="flex size-9 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary md:hidden"
      >
        <MenuIcon />
      </button>
      <Link
        href="/"
        className="flex shrink-0 items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary md:hidden"
      >
        <BrandMark className="size-8" />
        <span className="hidden text-base font-semibold tracking-tight sm:inline">
          {t('common.appName')}
        </span>
      </Link>
      {headerStart && <div className="min-w-0 max-w-[40vw] sm:max-w-none">{headerStart}</div>}

      <div className="hidden min-w-0 flex-1 justify-center px-2 lg:flex">{announcement}</div>

      <div className="ms-auto flex shrink-0 items-center gap-1 sm:gap-2 lg:ms-0">
        {wallet &&
          (wallet.href ? (
            <Link
              href={wallet.href}
              className="hidden items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary sm:inline-flex"
            >
              <span className="text-muted-foreground">{t('shell.balance')}</span>
              <span className="tabular-nums">{wallet.label}</span>
            </Link>
          ) : (
            <span className="hidden items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium sm:inline-flex">
              <span className="text-muted-foreground">{t('shell.balance')}</span>
              <span className="tabular-nums">{wallet.label}</span>
            </span>
          ))}
        {pageHelp}
        {pageSettings}
        {bell ?? (
          <IconLink
            href={notificationsHref}
            label={t('shell.notifications')}
            icon="bell"
            badge={notificationCount}
          />
        )}
        <UserMenu user={user} theme={theme} settingsHref={settingsHref} helpItems={helpItems} />
      </div>
    </header>
  );
}
