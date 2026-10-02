'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@crm/ui';
import { useOverview } from '../api/catalog';
import { isPlanLocked } from '../lib/errors';
import { providerLabel } from '../lib/format';
import { CATALOG_TABS, activeTab } from '../lib/tabs';
import { ChevronLeftIcon } from './icons';
import { DotPill, Paywall } from './parts';

/**
 * The frame of the four catalog tabs (WD-CAT-001): the "Integrations / WhatsApp Catalog" strip with the connection pill,
 * and the tab links. On a plan without the storefront flag the page shows the paywall instead of the tab.
 */
export function CatalogShell({ children }: { children: ReactNode }) {
  const t = useTranslations('catalogProducts.shell');
  const pathname = usePathname();
  const overview = useOverview();
  const tab = activeTab(pathname);
  const locked = overview.isError && isPlanLocked(overview.error);
  const catalog = overview.data?.catalog ?? null;

  return (
    <>
      <div className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-none flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/integrations"
              title={t('back')}
              aria-label={t('back')}
              className="grid size-8 shrink-0 place-items-center rounded-full border border-border bg-background outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ChevronLeftIcon className="size-3.5 rtl:rotate-180" />
            </Link>
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('breadcrumb')}
              </div>
              <h1 className="truncate font-serif text-[20px] font-normal leading-tight">
                {t('titleLead')}{' '}
                <span className="italic text-brand dark:text-primary">{t('titleAccent')}</span>
              </h1>
            </div>
          </div>
          {catalog ? (
            <DotPill on data-testid="catalog-pill">
              {t('connected', { provider: providerLabel(catalog.provider) })}
            </DotPill>
          ) : overview.isPending ? null : (
            <DotPill on={false} data-testid="catalog-pill">
              {t('notConnected')}
            </DotPill>
          )}
        </div>
      </div>

      <nav aria-label={t('tabs')} className="border-b border-border bg-background/60">
        <div className="mx-auto flex max-w-none items-center gap-1 overflow-x-auto px-4 sm:px-6 lg:px-7">
          {CATALOG_TABS.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              aria-current={tab === item.id ? 'page' : undefined}
              className={cn(
                'relative shrink-0 whitespace-nowrap px-4 py-3 text-[12.5px] font-medium outline-none focus-visible:underline',
                tab === item.id
                  ? 'text-brand dark:text-primary'
                  : 'text-foreground/80 hover:text-brand',
              )}
            >
              {t(`tab.${item.id}`)}
              {tab === item.id && (
                <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-brand dark:bg-primary" />
              )}
            </Link>
          ))}
        </div>
      </nav>

      <div className="mx-auto max-w-none space-y-5 px-4 py-7 sm:px-6 lg:px-7">
        {locked ? <Paywall /> : children}
      </div>
    </>
  );
}
