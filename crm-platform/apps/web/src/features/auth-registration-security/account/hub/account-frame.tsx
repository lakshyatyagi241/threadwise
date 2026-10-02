'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactNode } from 'react';
import { Card, cn } from '@crm/ui';
import { NAV } from '@/features/_registry/nav.generated';
import { CAPABILITIES_UNKNOWN, resolveNavAll } from '@/features/_registry/resolve';
import { useSession } from '../../shared/session-context';
import { PLANS_PATH } from '../plans/plan-format';
import { HUB_ICONS, LockIcon } from './hub-icons';
import { HUB_GROUPS, buildHubTabs, currentTab, tabsFromNav } from './hub-tabs';
import { RailProfile } from './rail-profile';

/**
 * The account hub frame (WD-AUTH-024): the rail (photo, name, plan, menu,
 * upgrade card) on the left, a scrolling strip on phones, and one pane on the
 * right under a breadcrumb. Each pane is its own route, so a link or a reload
 * lands on the same pane; `/account?tab=<name>` redirects to the right route.
 *
 * The menu comes from `hub-tabs.ts`: this domain's panes plus any pane another
 * domain declares in its own `nav.ts` as `/account/<name>`. A pane outside this
 * route group wraps itself in this frame (re-exported from `shared/account-hub`).
 */
export function AccountFrame({ children }: { children: ReactNode }) {
  const t = useTranslations('auth-registration-security.account.hub');
  const root = useTranslations();
  const pathname = usePathname();
  const { flags, permissions } = useSession();

  const tabs = useMemo(() => {
    const caps = { ...CAPABILITIES_UNKNOWN, permissions: new Set(Object.keys(permissions)) };
    return buildHubTabs(tabsFromNav(resolveNavAll(NAV, caps)));
  }, [permissions]);
  const current = currentTab(pathname, tabs);
  // While a forced password change or MFA enrolment is pending only the security pane works.
  const forced = flags.passwordChangeRequired || flags.mfaEnrolmentRequired;
  const ownsHeading = Boolean(current?.titleKey);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 lg:flex-row lg:items-start">
      <aside
        className="w-full shrink-0 space-y-3 lg:sticky lg:top-6 lg:w-64"
        aria-label={t('railLabel')}
      >
        <Card className="space-y-4 p-4">
          <RailProfile />
          <nav
            aria-label={t('menuLabel')}
            className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:block lg:space-y-4 lg:overflow-visible lg:px-0 lg:pb-0"
          >
            {HUB_GROUPS.map((group) => (
              <div key={group} className="flex gap-1 lg:block lg:space-y-1">
                <p className="hidden px-2 pb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground lg:block">
                  {t(`groups.${group}`)}
                </p>
                {tabs
                  .filter((tab) => tab.group === group)
                  .map((tab) => {
                    const active = current?.id === tab.id;
                    const locked = forced && tab.id !== 'security';
                    const Icon = HUB_ICONS[tab.icon];
                    const classes = cn(
                      'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-primary lg:w-full',
                      active
                        ? 'bg-primary/10 font-semibold text-primary'
                        : 'text-foreground hover:bg-muted',
                      tab.danger && 'text-danger',
                      tab.danger && active && 'bg-danger/10 text-danger',
                      locked && 'cursor-not-allowed opacity-50 hover:bg-transparent',
                    );
                    const label = root(tab.labelKey);
                    const content = (
                      <>
                        <Icon />
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                        {tab.locked && !locked && (
                          <LockIcon className="size-3.5 text-muted-foreground" />
                        )}
                      </>
                    );
                    return locked ? (
                      <span
                        key={tab.id}
                        aria-disabled="true"
                        title={t('lockedHint')}
                        className={classes}
                      >
                        {content}
                      </span>
                    ) : (
                      <Link
                        key={tab.id}
                        href={tab.href}
                        aria-current={active ? 'page' : undefined}
                        className={classes}
                      >
                        {content}
                      </Link>
                    );
                  })}
              </div>
            ))}
          </nav>
        </Card>

        <Link
          href={PLANS_PATH}
          className="group block rounded-md border border-success/30 bg-success/5 p-4 transition hover:border-success focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="block text-sm font-semibold leading-tight text-success">
            {t('upgrade.title')}
          </span>
          <span className="mt-1 hidden text-xs leading-snug text-muted-foreground lg:block">
            {t('upgrade.body')}
          </span>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-success">
            {t('upgrade.cta')}
            <span aria-hidden="true" className="rtl:-scale-x-100">
              →
            </span>
          </span>
        </Link>
      </aside>

      <section
        className="min-w-0 flex-1 space-y-5"
        aria-labelledby={ownsHeading ? 'account-pane-title' : undefined}
      >
        {current && (
          <header className="space-y-2">
            <nav aria-label={t('breadcrumbLabel')}>
              <ol className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                <li>
                  <Link
                    href="/account"
                    className="hover:text-primary focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {t('breadcrumbRoot')}
                  </Link>
                </li>
                <li aria-hidden="true">/</li>
                <li aria-current="page">{root(current.labelKey)}</li>
              </ol>
            </nav>
            {current.titleKey && (
              <>
                <h1 id="account-pane-title" className="text-2xl font-semibold tracking-tight">
                  {root(current.titleKey)}
                </h1>
                {current.descriptionKey && (
                  <p className="text-sm text-muted-foreground">{root(current.descriptionKey)}</p>
                )}
              </>
            )}
          </header>
        )}
        {children}
      </section>
    </div>
  );
}
