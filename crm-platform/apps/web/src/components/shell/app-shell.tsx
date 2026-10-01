'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition, type ReactNode } from 'react';
import { Badge, Button, cn } from '@crm/ui';
import { LOCALES } from '@/i18n/locales';
import { NAV_GROUPS, type ResolvedNavItem } from '@/features/_registry/types';
import { setLocale, setTheme } from './actions';

interface Props {
  user: { fullName: string; email: string; avatarUrl?: string | null };
  nav: ResolvedNavItem[];
  theme: 'light' | 'dark';
  /** Workspace switcher and similar header content owned by a domain. */
  headerStart?: ReactNode;
  /** Persistent notices above the page (email verification, trial). */
  banners?: ReactNode;
  children: ReactNode;
}

export function AppShell({ user, nav, theme, headerStart, banners, children }: Props) {
  const t = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const [current, setCurrent] = useState(theme);

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

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          'w-64 shrink-0 bg-sidebar p-3 text-sidebar-foreground max-md:fixed max-md:inset-y-0 max-md:z-20',
          open ? 'max-md:block' : 'max-md:hidden',
        )}
      >
        <div className="px-2 py-3 text-lg font-semibold text-white">{t('common.appName')}</div>
        <nav className="mt-2 space-y-4">
          {NAV_GROUPS.map((group) => {
            const items = nav.filter((n) => n.group === group);
            if (!items.length) return null;
            return (
              <div key={group}>
                <div className="px-2 pb-1 text-xs uppercase tracking-wide opacity-60">
                  {t(`shell.groups.${group}`)}
                </div>
                {items.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-disabled={item.locked || undefined}
                    className={cn(
                      'flex items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-sidebar-active',
                      pathname.startsWith(item.href) && 'bg-sidebar-active text-white',
                      item.locked && 'opacity-60',
                    )}
                  >
                    <span>{t(item.labelKey)}</span>
                    {item.locked && <Badge tone="warning">{t('shell.locked')}</Badge>}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label={t('shell.openMenu')}
          >
            ☰
          </Button>
          <div className="min-w-0">{headerStart}</div>
          <div className="ms-auto flex items-center gap-2">
            <select
              aria-label={t('shell.language')}
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
            <Button
              variant="secondary"
              size="sm"
              onClick={toggleTheme}
              aria-label={t('shell.theme')}
            >
              {current === 'dark' ? t('shell.themeLight') : t('shell.themeDark')}
            </Button>
            <Link
              href="/account"
              className="flex items-center gap-2 rounded-md px-1 text-sm hover:bg-muted"
              title={user.email}
            >
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="size-7 rounded-full object-cover" />
              ) : (
                <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {user.fullName.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="hidden text-muted-foreground sm:inline">{user.fullName}</span>
            </Link>
            <Button variant="ghost" size="sm" onClick={() => void logout()}>
              {t('shell.logout')}
            </Button>
          </div>
        </header>
        {banners}
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
