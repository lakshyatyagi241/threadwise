'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode, RefObject } from 'react';
import { cn } from '@crm/ui';
import type { ResolvedNavItem } from '@/features/_registry/types';
import { BrandMark, MenuIcon, NavIcon } from './nav-icons';
import { NavCollapsedContext } from './nav-context';
import { SEARCH_EVENT } from './command-palette-model';
import type { WalletChipData } from './top-bar';
import { UserMenu, type ShellUser } from './user-menu';
import type { BarItem } from './topbar-model';

/** A small gold crown: the plan lacks this feature, the link still works (TW-ASHELL-027). */
export function Crown({ className }: { className?: string }) {
  const t = useTranslations('admin-console-shell.topNav');
  return (
    <svg
      viewBox="0 0 16 16"
      role="img"
      aria-label={t('premium')}
      className={cn('size-3 text-amber-500', className)}
      fill="currentColor"
    >
      <title>{t('premium')}</title>
      <path d="M2 5l3 3 3-5 3 5 3-3-1.2 7H3.2L2 5z" />
    </svg>
  );
}

export interface TopNavProps {
  user: ShellUser;
  theme: 'light' | 'dark';
  items: readonly BarItem[];
  activeKey: string | undefined;
  onOpenMenu: () => void;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  /** The workspace switcher; drawn as a pill beside the logo from `lg` up. */
  workspace?: ReactNode;
  wallet?: WalletChipData;
  bell?: ReactNode;
  settingsHref?: string;
  helpItems?: readonly ResolvedNavItem[];
}

/**
 * The classic header (TW-ASHELL-013): logo, workspace switcher, the horizontal menu in the saved order, and on the right
 * search, balance, the bell and the account menu. Below `lg` the menu folds into the drawer opened by the hamburger.
 */
export function TopNav({
  user,
  theme,
  items,
  activeKey,
  onOpenMenu,
  menuButtonRef,
  workspace,
  wallet,
  bell,
  settingsHref,
  helpItems,
}: TopNavProps) {
  const tAll = useTranslations();
  const tn = useTranslations('admin-console-shell.topNav');
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background" data-shell="topbar">
      <div className="flex h-16 items-center gap-3 px-3 sm:px-4">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={onOpenMenu}
          aria-label={tAll('shell.openMenu')}
          className="flex size-9 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
        >
          <MenuIcon />
        </button>
        <Link
          href="/dashboard"
          className="flex shrink-0 items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <BrandMark className="size-8" />
          <span className="hidden text-base font-semibold tracking-tight sm:inline">
            {tAll('common.appName')}
          </span>
        </Link>
        {workspace && (
          <NavCollapsedContext.Provider value={false}>
            <div className="hidden w-56 shrink-0 lg:block [&_[role=menu]]:bottom-auto [&_[role=menu]]:top-full [&_[role=menu]]:mb-0 [&_[role=menu]]:mt-2">
              {workspace}
            </div>
          </NavCollapsedContext.Provider>
        )}

        <nav
          aria-label={tAll('shell.mainMenu')}
          data-tour="navbar"
          className="hidden min-w-0 flex-1 items-center justify-center gap-1 lg:flex"
        >
          {items.map((item) => {
            const active = item.key === activeKey;
            return (
              <Link
                key={item.key}
                href={item.href}
                data-tour={`nav-${item.key}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-primary',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {item.icon && <NavIcon name={item.icon} className="size-4" />}
                {item.labelKey ? tAll(item.labelKey) : tn('more')}
                {item.locked && <Crown className="absolute -end-0.5 -top-0.5" />}
              </Link>
            );
          })}
        </nav>

        <div className="ms-auto flex shrink-0 items-center gap-1 sm:gap-2 lg:ms-0">
          <button
            type="button"
            aria-label={tn('search')}
            title={tn('search')}
            onClick={() => window.dispatchEvent(new CustomEvent(SEARCH_EVENT))}
            className="hidden size-9 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary md:flex"
          >
            <NavIcon name="search" className="size-5" />
          </button>
          {wallet && (
            <Link
              href={wallet.href ?? '/billing/wallet'}
              className="hidden items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary xl:inline-flex"
            >
              <span className="text-muted-foreground">{tAll('shell.balance')}</span>
              <span className="tabular-nums">{wallet.label}</span>
            </Link>
          )}
          {bell}
          <UserMenu user={user} theme={theme} settingsHref={settingsHref} helpItems={helpItems} />
        </div>
      </div>
    </header>
  );
}
