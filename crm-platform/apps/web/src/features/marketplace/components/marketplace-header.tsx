'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { fetchInstallations, mktKeys } from '../api';
import { BROWSE_TABS } from '../lib/browse';
import { mktRoutes } from '../lib/routes';
import { usageView } from '../lib/manage';
import { ChevronLeftIcon, flip } from './icons';
import { TEXT_LINK } from './ui';

export type HeaderSection = 'apps' | 'integrations' | 'addons' | 'installed' | 'requests';

/** "Installed (3 of 10)": the usage of the plan's installed-apps cap, as the installed list reports it. Says nothing until it is known. */
export function InstalledLinkLabel() {
  const t = useTranslations('marketplace.header');
  const q = useQuery({
    queryKey: mktKeys.installations('all', 'all'),
    queryFn: ({ signal }) => fetchInstallations({}, signal),
    staleTime: 30_000,
  });
  if (!q.data) return <>{t('installed')}</>;
  const u = usageView(q.data.usage);
  return (
    <>
      {u.unlimited
        ? t('installedUnlimited', { installed: u.installed })
        : t('installedLimit', { installed: u.installed, limit: u.limit })}
    </>
  );
}

/**
 * The top of the browse, installed and requests screens: the title, the two tabs (links, the current one marked), and the secondary
 * links. The app page and the flows under it use `BackLink` instead.
 */
export function MarketplaceHeader({ section }: { section: HeaderSection }) {
  const t = useTranslations('marketplace.header');
  const tabClass = (active: boolean) =>
    cn(
      'shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition',
      active
        ? 'border-primary text-foreground'
        : 'border-transparent text-muted-foreground hover:text-foreground',
    );
  // Sticky under the 56px top bar; the bleed (-mx / px) lets its background cover the page padding while the cards scroll beneath it.
  return (
    <header className="sticky top-14 z-[35] -mx-4 -mt-4 space-y-3 bg-background px-4 pt-4 md:-mx-6 md:-mt-6 md:px-6 md:pt-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-border">
        <nav aria-label={t('tabsLabel')} className="-mb-px flex gap-1 overflow-x-auto">
          {BROWSE_TABS.map((tab) => {
            const active = section === tab.segment;
            return (
              <Link
                key={tab.kind}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={tabClass(active)}
              >
                {t(`tabs.${tab.kind}`)}
              </Link>
            );
          })}
          <Link
            href={mktRoutes.addons}
            aria-current={section === 'addons' ? 'page' : undefined}
            className={tabClass(section === 'addons')}
          >
            {t('tabs.addon')}
          </Link>
        </nav>
        <nav
          aria-label={t('moreLabel')}
          className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-2 text-sm"
        >
          <Link
            href={mktRoutes.installed}
            aria-current={section === 'installed' ? 'page' : undefined}
            className={cn(
              TEXT_LINK,
              'inline-flex min-h-7 items-center',
              section === 'installed' && 'underline',
            )}
          >
            <InstalledLinkLabel />
          </Link>
          <Link
            href={mktRoutes.requests}
            aria-current={section === 'requests' ? 'page' : undefined}
            className={cn(
              TEXT_LINK,
              'inline-flex min-h-7 items-center',
              section === 'requests' && 'underline',
            )}
          >
            {t('request')}
          </Link>
        </nav>
      </div>
    </header>
  );
}

/** A way back from an app page, the install flow or a manage page. */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className={cn(TEXT_LINK, 'inline-flex items-center gap-1 text-sm')}>
      <ChevronLeftIcon className={flip} />
      {label}
    </Link>
  );
}
