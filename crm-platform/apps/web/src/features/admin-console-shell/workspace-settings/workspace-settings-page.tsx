'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@crm/ui';
import { NavIcon } from '@/components/shell/nav-icons';
import { ApiTab } from './api-tab';
import { AppearanceTab } from './appearance-tab';
import { BrandingTab } from './branding-tab';
import { DataTab } from './data-tab';
import { GeneralTab } from './general-tab';
import { TAB_GROUPS, TAB_LINKS, parseTab, type SettingsTab } from './logic';
import { NotificationsTab } from './notifications-tab';

const NS = 'admin-console-shell.workspaceSettings';

const TAB_ICON: Record<SettingsTab, string> = {
  general: 'channels',
  branding: 'tag',
  team: 'team',
  notifications: 'bell',
  aikeys: 'bot',
  security: 'user',
  api: 'code',
  data: 'history',
  appearance: 'sun',
};

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
          {t('titleLead')} <span className="not-italic text-primary">{t('titleTail')}</span>
        </h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label={t('railLabel')} className="space-y-3">
          <div className="space-y-4 rounded-2xl border border-border bg-background p-3 shadow-sm">
            {TAB_GROUPS.map((g) => (
              <div key={g.id} className="space-y-1">
                <p className="px-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
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
                        'flex items-center justify-between rounded-full px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary',
                        tab === id
                          ? 'bg-primary font-semibold text-primary-foreground'
                          : 'text-foreground hover:bg-muted',
                      )}
                    >
                      <span className="flex items-center gap-2.5">
                        <NavIcon name={TAB_ICON[id]} className="size-3.5" />
                        {t(`tabs.${id}`)}
                      </span>
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
          </div>
          <Link
            href="/account"
            className="block rounded-2xl border border-border bg-background p-4 text-sm shadow-sm hover:bg-muted"
          >
            <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('personal.eyebrow')}
            </span>
            <span className="mt-1 block font-serif text-base">
              {t('personal.title')} {'→'}
            </span>
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
