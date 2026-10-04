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
import { HeaderTools, RoundFrame, SearchButton } from './header-controls';
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

/** Restyles the rail-shaped workspace switcher as Reference's header pill (static block and button forms). */
const WS_PILL = [
  '[&>div.flex]:gap-2',
  '[&>div.flex]:rounded-full',
  '[&>div.flex]:border',
  '[&>div.flex]:border-border',
  '[&>div.flex]:bg-muted/50',
  '[&>div.flex]:p-1',
  '[&>div.flex]:pe-2.5',
  '[&>div.flex>span:first-child]:size-7',
  '[&>div.flex>span:first-child]:rounded-full',
  '[&>div.flex>span:first-child]:text-[11px]',
  '[&>div.flex>span>span.text-xs]:hidden',
  '[&>div.flex>span>span.font-bold]:text-[13px]',
  '[&>div.flex>span>span.font-bold]:font-semibold',
  '[&>div>button]:gap-2',
  '[&>div>button]:rounded-full',
  '[&>div>button]:border',
  '[&>div>button]:border-border',
  '[&>div>button]:bg-muted/50',
  '[&>div>button]:p-1',
  '[&>div>button]:pe-2.5',
  '[&>div>button>span:first-child]:size-7',
  '[&>div>button>span:first-child]:rounded-full',
  '[&>div>button>span:first-child]:text-[11px]',
  '[&>div>button>span>span.text-xs]:hidden',
  '[&>div>button>span>span.font-bold]:text-[13px]',
  '[&>div>button>span>span.font-bold]:font-semibold',
].join(' ');

export interface TopNavProps {
  user: ShellUser;
  theme: 'light' | 'dark';
  items: readonly BarItem[];
  activeKey: string | undefined;
  onOpenMenu: () => void;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  /** The workspace switcher; drawn as a pill beside the logo from `lg` up. */
  workspace?: ReactNode;
  /** Kept for callers; Reference's top bar shows no balance (it sits in the account menu and the rail's wallet card). */
  wallet?: WalletChipData;
  bell?: ReactNode;
  /** The gear for the settings behind the current screen (`PageSettingsShortcut`). */
  pageSettings?: ReactNode;
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
  bell,
  pageSettings,
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
          <span className="hidden font-serif text-2xl font-normal tracking-tight sm:inline">
            {tAll('common.appName')}
          </span>
        </Link>
        {workspace && (
          <NavCollapsedContext.Provider value={false}>
            <div
              data-testid="workspace-pill"
              className={cn(
                'hidden max-w-[210px] shrink-0 lg:block [&_[role=menu]]:bottom-auto [&_[role=menu]]:top-full [&_[role=menu]]:mb-0 [&_[role=menu]]:mt-2',
                // Reference's pill: round avatar, workspace name, chevron; no plan line. A single workspace draws a static
                // block (div.flex), several draw a button, so both are styled.
                WS_PILL,
              )}
            >
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
                  'relative inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[7px] text-[12.5px] font-medium 2xl:gap-2 2xl:px-3.5 2xl:text-[13px] outline-none transition focus-visible:ring-2 focus-visible:ring-primary',
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

        <div className="ms-auto flex shrink-0 items-center gap-1.5 sm:gap-2 lg:ms-0">
          <SearchButton
            label={tn('search')}
            onClick={() => window.dispatchEvent(new CustomEvent(SEARCH_EVENT))}
          />
          <HeaderTools theme={theme} />
          <RoundFrame>{pageSettings}</RoundFrame>
          <RoundFrame>{bell}</RoundFrame>
          <UserMenu
            user={user}
            theme={theme}
            settingsHref={settingsHref}
            helpItems={helpItems}
            variant="bar"
          />
        </div>
      </div>
    </header>
  );
}
