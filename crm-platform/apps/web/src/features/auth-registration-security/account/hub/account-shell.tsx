'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ComponentType, ReactNode, SVGProps } from 'react';
import { Card, cn } from '@crm/ui';
import { BrushIcon, KeyIcon, TrashIcon, UserIcon } from '../../shared/icons';
import { useSession } from '../../shared/session-context';
import { AvatarCard } from './avatar-card';

type TabId = 'profile' | 'branding' | 'security' | 'delete';

interface Tab {
  id: TabId;
  href: string;
  group: 'account' | 'security';
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  danger?: boolean;
}

/** The hub's panes (TW-AUTH-024). Plan, wallet, orders and the rest belong to other domains and add their own routes here. */
const TABS: Tab[] = [
  { id: 'profile', href: '/account/profile', group: 'account', icon: UserIcon },
  { id: 'branding', href: '/account/branding', group: 'account', icon: BrushIcon },
  { id: 'security', href: '/account/security', group: 'security', icon: KeyIcon },
  { id: 'delete', href: '/account/delete', group: 'security', icon: TrashIcon, danger: true },
];
const GROUPS = ['account', 'security'] as const;

/**
 * The account hub frame: avatar card and menu on the left (a scrolling strip on
 * phones), one pane on the right. Each pane is its own route, so a link or a
 * reload lands on the same pane.
 */
export function AccountShell({ children }: { children: ReactNode }) {
  const t = useTranslations('auth-registration-security.account.hub');
  const pathname = usePathname();
  const { user, flags } = useSession();
  const current = TABS.find((tab) => pathname === tab.href || pathname.startsWith(`${tab.href}/`));
  // While a forced password change or MFA enrolment is pending only the security pane works.
  const forced = flags.passwordChangeRequired || flags.mfaEnrolmentRequired;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 lg:flex-row lg:items-start">
      <aside className="w-full shrink-0 lg:w-64" aria-label={t('railLabel')}>
        <Card className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 lg:flex-col lg:gap-3">
            <AvatarCard />
            <div className="min-w-0 flex-1 lg:w-full lg:flex-none lg:text-center">
              <p className="truncate text-base font-semibold">
                {user.displayName ?? user.fullName}
              </p>
              <p className="truncate text-sm text-muted-foreground" dir="ltr">
                {user.email}
              </p>
            </div>
          </div>
          <nav
            aria-label={t('menuLabel')}
            className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:block lg:space-y-4 lg:overflow-visible lg:px-0 lg:pb-0"
          >
            {GROUPS.map((group) => (
              <div key={group} className="flex gap-1 lg:block lg:space-y-1">
                <p className="hidden px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:block">
                  {t(`groups.${group}`)}
                </p>
                {TABS.filter((tab) => tab.group === group).map((tab) => {
                  const active = current?.id === tab.id;
                  const locked = forced && tab.id !== 'security';
                  const Icon = tab.icon;
                  const classes = cn(
                    'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-primary lg:w-full',
                    active ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted',
                    tab.danger && !active && 'text-danger',
                    locked && 'cursor-not-allowed opacity-50 hover:bg-transparent',
                  );
                  return locked ? (
                    <span key={tab.id} aria-disabled="true" className={classes}>
                      <Icon />
                      {t(`tabs.${tab.id}`)}
                    </span>
                  ) : (
                    <Link
                      key={tab.id}
                      href={tab.href}
                      aria-current={active ? 'page' : undefined}
                      className={classes}
                    >
                      <Icon />
                      {t(`tabs.${tab.id}`)}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </Card>
      </aside>

      <section className="min-w-0 flex-1 space-y-5" aria-labelledby="account-pane-title">
        {current && (
          <header className="space-y-1">
            <h1 id="account-pane-title" className="text-2xl font-semibold">
              {t(`pages.${current.id}.title`)}
            </h1>
            <p className="text-sm text-muted-foreground">{t(`pages.${current.id}.description`)}</p>
          </header>
        )}
        {children}
      </section>
    </div>
  );
}
