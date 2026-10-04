'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@crm/ui';
import { ApiTab } from './api-tab';
import { AppearanceTab } from './appearance-tab';
import { BrandingTab } from './branding-tab';
import { DataTab } from './data-tab';
import { GeneralTab } from './general-tab';
import { TAB_GROUPS, TAB_LINKS, parseTab, type SettingsTab } from './logic';
import { NotificationsTab } from './notifications-tab';

const NS = 'admin-console-shell.workspaceSettings';

const PANES: Partial<Record<SettingsTab, () => React.JSX.Element>> = {
  general: GeneralTab,
  branding: BrandingTab,
  notifications: NotificationsTab,
  api: ApiTab,
  data: DataTab,
  appearance: AppearanceTab,
};

/**
 * TW-ASHELL-032: the workspace Settings page. A left rail in two groups (Workspace, System) and a card to the person's own
 * account; `?tab=` picks the pane and an unknown value reads as General. Tabs whose screen is another domain's page (Team and roles,
 * AI keys, Security) are links to it.
 */
export function WorkspaceSettingsPage() {
  const t = useTranslations(NS);
  const path = usePathname();
  const tab = parseTab(useSearchParams().get('tab'));
  const Pane = PANES[tab] ?? GeneralTab;
  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">
          {t('titleLead')} <span className="italic text-primary">{t('titleTail')}</span>
        </h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label={t('railLabel')} className="space-y-4">
          {TAB_GROUPS.map((g) => (
            <div key={g.id} className="space-y-1">
              <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t(`groups.${g.id}`)}
              </p>
              {g.tabs.map((id) => {
                const external = TAB_LINKS[id];
                return (
                  <Link
                    key={id}
                    href={external ?? `${path}?tab=${id}`}
                    aria-current={tab === id ? 'page' : undefined}
                    className={cn(
                      'flex items-center justify-between rounded-lg px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      tab === id
                        ? 'bg-primary/10 font-semibold text-primary'
                        : 'text-foreground hover:bg-muted',
                    )}
                  >
                    {t(`tabs.${id}`)}
                    {external && (
                      <span aria-hidden className="text-muted-foreground">
                        {'↗'}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
          <Link
            href="/account"
            className="block rounded-xl border border-border p-3 text-sm hover:bg-muted"
          >
            <span className="block font-semibold">{t('personal.title')}</span>
            <span className="block text-xs text-muted-foreground">{t('personal.body')}</span>
          </Link>
        </nav>
        <div className="min-w-0">
          <Pane />
        </div>
      </div>
    </section>
  );
}
