'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { Popover, cn } from '@crm/ui';
import type { ResolvedNavItem } from '@/features/_registry/types';
import { useBrandName } from './brand';
import { useOptionalShellData } from './shell-data';
import { NavIcon } from './nav-icons';
import { setTheme } from './actions';
import { AvailabilityRow } from '@/features/workspaces-teams-tenancy/components/availability-row';
import {
  MyLeaveDialog,
  MyLeaveRow,
} from '@/features/workspaces-teams-tenancy/components/my-leave-row';
import { TOUR_START_EVENT } from '@/features/admin-console-shell/tour/tour-model';
import { signOut } from '@/features/auth-registration-security/shared/sign-out';

export interface ShellUser {
  fullName: string;
  email: string;
  avatarUrl?: string | null;
}

export interface ProfileMenuData {
  plan: string;
  role: string;
  /** Formatted balance next to the Wallet row; the row shows without it when the wallet domain is absent. */
  walletLabel?: string;
}

/** Up to two capitals, first letters of the first two words of the name (Reference: `AS` for "Ashell Agent"). */
export function initialsOf(user: Pick<ShellUser, 'fullName' | 'email'>): string {
  const base = (user.fullName || user.email).trim();
  const parts = base.split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'WA';
}

export function Avatar({ user, className }: { user: ShellUser; className?: string }) {
  return user.avatarUrl ? (
    <img src={user.avatarUrl} alt="" className={cn('rounded-full object-cover', className)} />
  ) : (
    <span
      aria-hidden="true"
      className={cn(
        'flex items-center justify-center rounded-full bg-gradient-to-br from-brand/80 to-brand font-semibold text-brand-foreground',
        className,
      )}
    >
      {initialsOf(user)}
    </span>
  );
}

const ROW =
  'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary';

type RowProps = {
  icon: string;
  children: ReactNode;
  end?: ReactNode;
  className?: string;
  onClick?: () => void;
  href?: string;
};

function Row({ icon, children, end, className, onClick, href }: RowProps) {
  const body = (
    <>
      <NavIcon name={icon} className="size-4 text-muted-foreground" />
      <span className="flex-1">{children}</span>
      {end}
    </>
  );
  if (href) {
    return (
      <Link href={href} onClick={onClick} className={cn(ROW, className)}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cn(ROW, className)}>
      {body}
    </button>
  );
}

/**
 * The light/dark row (below Wallet, per the product owner): same sun/moon icon and immediate-apply behavior as the header's
 * `ThemeMenu`, reusing its `setTheme` action so the two controls share one cookie. Unlike every other row here, toggling the
 * theme is not a navigation, so it does not close the popover — the person may want to see both states before dismissing it.
 */
function ThemeRow({ theme }: { theme: 'light' | 'dark' }) {
  const t = useTranslations('shell');
  const [current, setCurrent] = useState(theme);
  const [, start] = useTransition();
  useEffect(() => {
    document.documentElement.dataset.theme = current;
  }, [current]);

  const toggle = () => {
    const next = current === 'dark' ? 'light' : 'dark';
    setCurrent(next);
    start(() => void setTheme(next));
  };

  const label = current === 'dark' ? t('themeDark') : t('themeLight');
  return (
    <button
      type="button"
      onClick={toggle}
      role="switch"
      aria-checked={current === 'dark'}
      aria-label={`${t('theme')}: ${label}`}
      data-testid="user-menu-theme"
      className={ROW}
    >
      <NavIcon
        name={current === 'dark' ? 'moon' : 'sun'}
        className="size-4 text-muted-foreground"
      />
      <span className="flex-1">{t('theme')}</span>
      <span className="font-mono text-[11px] text-muted-foreground">{label}</span>
    </button>
  );
}

/**
 * The account menu behind the round avatar (TW-ASHELL-019). Reference replaces its server menu with this one once the bundle
 * loads: avatar, name and email, a "plan - role" chip, then Profile, Wallet with the balance, a light/dark toggle, Order
 * history, Settings, Pricing and plans, Help and support and Log out, with the app name in the footer. The header's theme
 * menu still exists beside it, as in Reference; this menu adds the same choice inline, below Wallet, per the product owner.
 * Language stays in the header. `strip` shows the name and role next to the avatar, as the sidebar mode's top strip does.
 * "Take the tour" is the replay entry Reference never wired (its own port notes ask for one).
 */
export function UserMenu({
  user,
  theme = 'light',
  settingsHref,
  helpItems = [],
  profile: profileProp,
  variant = 'bar',
}: {
  user: ShellUser;
  /** The current theme, shown and toggled by the row below Wallet (the header's theme menu also reads and sets it). */
  theme?: 'light' | 'dark';
  /** Opens the Settings area. */
  settingsHref?: string;
  /** Support: a screen that is not built yet shows disabled with a "Soon" mark. */
  helpItems?: readonly ResolvedNavItem[];
  /** The rich profile block (TW-ASHELL-019): plan and role chip, wallet, orders, plans and the tour replay. */
  profile?: ProfileMenuData;
  variant?: 'bar' | 'strip';
}) {
  const t = useTranslations('shell');
  const tm = useTranslations('admin-console-shell.profileMenu');
  const brand = useBrandName();
  const shellData = useOptionalShellData();
  const profile = profileProp ?? shellData?.profile;
  const [open, setOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const close = () => setOpen(false);

  // A full page navigation, so the browser's query cache of this account does not outlive the sign-out.
  const logout = () => signOut('/login');
  const support = helpItems.find((i) => i.id === 'support' && !i.comingSoon);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('userMenu')}
        title={user.email}
        data-testid="user-menu"
        className="flex items-center gap-1 rounded-full py-1 ps-1 pe-1 outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary md:gap-2 md:pe-2.5"
      >
        <Avatar user={user} className="size-9 text-xs ring-1 ring-border" />
        {variant === 'strip' && (
          <span className="hidden text-start leading-tight sm:block">
            <span className="block max-w-[9rem] truncate text-[12.5px] font-semibold">
              {user.fullName}
            </span>
            {profile && (
              <span className="block text-[10.5px] text-muted-foreground">{profile.role}</span>
            )}
          </span>
        )}
        <NavIcon name="chevron-down" className="hidden size-3 text-muted-foreground md:block" />
      </button>
      <Popover
        open={open}
        onClose={close}
        label={t('userMenu')}
        className="w-[260px] space-y-0 overflow-hidden rounded-2xl p-0"
      >
        <div className="flex items-center gap-3 px-4 pb-2 pt-4">
          <Avatar user={user} className="size-10 text-sm" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{user.fullName}</div>
            <div className="truncate font-mono text-[11px] text-muted-foreground" dir="ltr">
              {user.email}
            </div>
          </div>
        </div>
        {profile && (
          <p
            className="mx-4 mb-3 inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2.5 py-0.5 font-mono text-[10.5px] text-success"
            data-testid="profile-chip"
          >
            <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
            {tm('chip', { plan: profile.plan, role: profile.role })}
          </p>
        )}
        <div className="border-t border-border p-1.5">
          <Row icon="user" href="/account" onClick={close}>
            {tm('profile')}
          </Row>
          <Row
            icon="wallet"
            href="/billing/wallet"
            onClick={close}
            end={
              profile?.walletLabel ? (
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {profile.walletLabel}
                </span>
              ) : null
            }
          >
            {tm('wallet')}
          </Row>
          {/* Only inside the real shell: it needs the app's query client and a workspace session. */}
          {shellData && <AvailabilityRow className={ROW} />}
          {shellData && (
            <MyLeaveRow
              className={ROW}
              onOpen={() => {
                close();
                setLeaveOpen(true);
              }}
            />
          )}
          <ThemeRow theme={theme} />
          <Row icon="cart" href="/billing/orders" onClick={close}>
            {tm('orders')}
          </Row>
          {settingsHref && (
            <Row icon="gear" href={settingsHref} onClick={close}>
              {t('settings')}
            </Row>
          )}
          <Row icon="tag" href="/account/plans" onClick={close}>
            {tm('plans')}
          </Row>
          {support && (
            <Row icon="help" href={support.href} onClick={close}>
              {tm('help')}
            </Row>
          )}
          <Row
            icon="play"
            onClick={() => {
              close();
              window.dispatchEvent(new CustomEvent(TOUR_START_EVENT));
            }}
          >
            {tm('tour')}
          </Row>
        </div>
        <div className="border-t border-border p-1.5">
          <Row
            icon="logout"
            onClick={() => void logout()}
            className="text-danger hover:bg-danger/10"
          >
            {t('logout')}
          </Row>
        </div>
        <div className="border-t border-border bg-muted/50 px-4 py-2 font-mono text-[10.5px] text-muted-foreground">
          {brand}
          {process.env.NEXT_PUBLIC_APP_VERSION ? ` · v${process.env.NEXT_PUBLIC_APP_VERSION}` : ''}
        </div>
      </Popover>
      {/* Outside the popover: closing the menu must not close the dialog it opened. */}
      {shellData && leaveOpen && <MyLeaveDialog open onClose={() => setLeaveOpen(false)} />}
    </div>
  );
}
