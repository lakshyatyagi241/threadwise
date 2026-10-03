'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Popover, cn } from '@crm/ui';
import type { ResolvedNavItem } from '@/features/_registry/types';
import { LOCALES } from '@/i18n/locales';
import { useOptionalShellData } from './shell-data';
import { TOUR_START_EVENT } from '@/features/admin-console-shell/tour/tour-model';
import { setLocale, setTheme } from './actions';

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

export function Avatar({ user, className }: { user: ShellUser; className?: string }) {
  return user.avatarUrl ? (
    <img src={user.avatarUrl} alt="" className={cn('rounded-full object-cover', className)} />
  ) : (
    <span
      aria-hidden="true"
      className={cn(
        'flex items-center justify-center rounded-full bg-brand font-semibold text-brand-foreground',
        className,
      )}
    >
      {(user.fullName || user.email).slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Round avatar that opens the account panel: profile link, language, theme and sign-out. */
export function UserMenu({
  user,
  theme,
  settingsHref,
  helpItems = [],
  profile: profileProp,
}: {
  user: ShellUser;
  theme: 'light' | 'dark';
  /** Opens the Settings area. */
  settingsHref?: string;
  /** Support and Guidebook: a screen that is not built yet shows disabled with a "Soon" mark. */
  helpItems?: readonly ResolvedNavItem[];
  /** The rich profile block (WD-ASHELL-019): plan and role chip, wallet, orders, plans and the tour replay. */
  profile?: ProfileMenuData;
}) {
  const t = useTranslations('shell');
  const tm = useTranslations('admin-console-shell.profileMenu');
  const shellData = useOptionalShellData();
  const profile = profileProp ?? shellData?.profile;
  const tAll = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(theme);
  const [, start] = useTransition();

  const toggleTheme = () => {
    const next = current === 'dark' ? 'light' : 'dark';
    setCurrent(next);
    document.documentElement.dataset.theme = next;
    start(() => void setTheme(next));
  };
  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  };
  const row =
    'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-start text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('userMenu')}
        title={user.email}
        className="flex rounded-full outline-none ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Avatar user={user} className="size-9 text-sm" />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label={t('userMenu')}
        className="w-72 space-y-1 p-2"
      >
        <div className="flex items-center gap-3 px-3 py-2">
          <Avatar user={user} className="size-10 text-base" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{user.fullName}</div>
            <div className="truncate text-xs text-muted-foreground" dir="ltr">
              {user.email}
            </div>
          </div>
        </div>
        {profile && (
          <p
            className="mx-3 mb-1 inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
            data-testid="profile-chip"
          >
            {tm('chip', { plan: profile.plan, role: profile.role })}
          </p>
        )}
        <div className="my-1 h-px bg-border" />
        {settingsHref && (
          <Link href={settingsHref} onClick={() => setOpen(false)} className={row}>
            {t('settings')}
          </Link>
        )}
        <Link href="/account" onClick={() => setOpen(false)} className={row}>
          {t('account')}
        </Link>
        {profile && (
          <>
            <Link href="/billing/wallet" onClick={() => setOpen(false)} className={row}>
              <span>{tm('wallet')}</span>
              {profile.walletLabel && (
                <span className="tabular-nums text-muted-foreground">{profile.walletLabel}</span>
              )}
            </Link>
            <Link href="/billing/orders" onClick={() => setOpen(false)} className={row}>
              {tm('orders')}
            </Link>
            <Link href="/account/plans" onClick={() => setOpen(false)} className={row}>
              {tm('plans')}
            </Link>
            <button
              type="button"
              className={row}
              onClick={() => {
                setOpen(false);
                window.dispatchEvent(new CustomEvent(TOUR_START_EVENT));
              }}
            >
              {tm('tour')}
            </button>
          </>
        )}
        <label className={cn(row, 'cursor-pointer')}>
          <span>{t('language')}</span>
          <select
            aria-label={t('language')}
            value={locale}
            onChange={(e) =>
              start(async () => {
                await setLocale(e.target.value);
                router.refresh();
              })
            }
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={toggleTheme} className={row}>
          <span>{t('theme')}</span>
          <span className="text-muted-foreground">
            {current === 'dark' ? t('themeLight') : t('themeDark')}
          </span>
        </button>
        {helpItems.length > 0 && (
          <>
            <div className="my-1 h-px bg-border" />
            <div role="group" aria-label={t('help')}>
              {helpItems.map((item) =>
                item.comingSoon ? (
                  <span
                    key={item.id}
                    aria-disabled="true"
                    title={t('comingSoon')}
                    className={cn(row, 'cursor-not-allowed text-muted-foreground')}
                  >
                    <span>{tAll(item.labelKey)}</span>
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wide">
                      {t('soon')}
                    </span>
                  </span>
                ) : (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={row}
                  >
                    {tAll(item.labelKey)}
                  </Link>
                ),
              )}
            </div>
          </>
        )}
        <div className="my-1 h-px bg-border" />
        <button type="button" onClick={() => void logout()} className={cn(row, 'text-danger')}>
          {t('logout')}
        </button>
      </Popover>
    </div>
  );
}
