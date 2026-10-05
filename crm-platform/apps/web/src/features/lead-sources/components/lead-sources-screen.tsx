'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Button, Card, EmptyState, Tabs } from '@crm/ui';
import { fetchSources, leadKeys } from '../api';
import { LEADS_READ, useLeadsCan, type LeadsCan } from '../lib/permissions';
import {
  COMING_SOON_PROVIDERS,
  ROUTES,
  attentionTotal,
  parseTab,
  sourceRows,
  type LeadTab,
  type SourceRow,
} from '../lib/source-view';
import { KindBadge, Loading, NoAccess, RegionError, SourceStatusChip, When } from './ui';

const LINK_BUTTON =
  'inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background';
const PRIMARY = `${LINK_BUTTON} bg-primary text-primary-foreground hover:opacity-90`;
const SECONDARY = `${LINK_BUTTON} border border-border bg-background text-foreground hover:bg-muted`;

/**
 * `/lead-sources`: Social leads (spec 5.6). Two tabs are built: Ads (where leads can come from) and Webhook (the sources that exist
 * and what they received). The whole screen answers a plan without the feature with the upgrade prompt and a role without the
 * read key with the key it lacks; the plan check is the API's (422), the screen only explains it.
 */
export function LeadSourcesScreen({ tab: initialTab = 'ads' }: { tab?: LeadTab }) {
  const t = useTranslations('lead-sources.page');
  const router = useRouter();
  const can = useLeadsCan();
  const [tab, setTab] = useState<LeadTab>(initialTab);
  const list = useQuery({
    queryKey: leadKeys.list,
    queryFn: ({ signal }) => fetchSources(signal),
    enabled: can.read,
    retry: false,
  });

  if (!can.read) return <NoAccess permission={LEADS_READ} />;
  if (list.isError && !list.data) {
    return <RegionError error={list.error} onRetry={() => void list.refetch()} />;
  }

  const rows = sourceRows(list.data ?? []);
  const waiting = attentionTotal(list.data ?? []);
  const change = (id: string) => {
    const next = parseTab(id);
    setTab(next);
    router.replace(next === 'ads' ? ROUTES.list : ROUTES.webhooks, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{t('description')}</p>
        </div>
        {can.manage && (
          <Link href={ROUTES.create} className={PRIMARY}>
            {t('newSource')}
          </Link>
        )}
      </header>

      <Tabs
        value={tab}
        onValueChange={change}
        items={[
          {
            id: 'ads',
            label: t('tabs.ads'),
            content: (
              <AdsTab can={can} count={rows.length} onOpenSources={() => change('webhook')} />
            ),
          },
          {
            id: 'webhook',
            label: (
              <span className="inline-flex items-center gap-2">
                {t('tabs.webhook')}
                {waiting > 0 && (
                  <Badge tone="warning" aria-label={t('tabs.attention', { count: waiting })}>
                    {waiting}
                  </Badge>
                )}
              </span>
            ),
            content: list.isPending ? (
              <Loading label={t('loading')} />
            ) : (
              <WebhookTab can={can} rows={rows} />
            ),
          },
        ]}
      />
    </div>
  );
}

// --- Ads tab --------------------------------------------------------------------------------------------------------------------

/**
 * Where leads can come from. Only the generic webhook has a door today (it carries LinkedIn, TikTok, Google Ads and any form tool
 * through Zapier or Make); the other providers are shown as coming soon because the backend has no door for them yet. A coming-soon
 * card is not a link and not a button.
 */
export function AdsTab({
  can,
  count,
  onOpenSources,
}: {
  can: LeadsCan;
  count: number;
  onOpenSources: () => void;
}) {
  const t = useTranslations('lead-sources.ads');
  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <li>
          <Card className="flex h-full flex-col gap-3 p-5" data-testid="provider-webhook">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-base font-semibold">{t('providers.webhook.name')}</h2>
              <Badge tone="success">{t('available')}</Badge>
            </div>
            <p className="flex-1 text-sm text-muted-foreground">{t('providers.webhook.body')}</p>
            <p className="text-xs text-muted-foreground">{t('sourceCount', { count })}</p>
            <div className="flex flex-wrap gap-2">
              {can.manage && (
                <Link href={ROUTES.create} className={PRIMARY}>
                  {t('setUpWebhook')}
                </Link>
              )}
              <Button type="button" variant="secondary" onClick={onOpenSources}>
                {t('openSources')}
              </Button>
            </div>
          </Card>
        </li>
        {COMING_SOON_PROVIDERS.map((p) => (
          <li key={p}>
            {/* Not a link and not a button on purpose: the API has no door for this provider yet. */}
            <Card
              className="flex h-full flex-col gap-3 p-5 opacity-90"
              data-testid={`provider-${p}`}
              data-coming-soon="true"
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-base font-semibold">{t(`providers.${p}.name`)}</h2>
                <Badge>{t('comingSoon')}</Badge>
              </div>
              <p className="flex-1 text-sm text-muted-foreground">{t(`providers.${p}.body`)}</p>
              <p className="text-xs text-muted-foreground">{t('untilThen')}</p>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Webhook tab ----------------------------------------------------------------------------------------------------------------

export function WebhookTab({ can, rows }: { can: LeadsCan; rows: SourceRow[] }) {
  const t = useTranslations('lead-sources.sources');

  if (rows.length === 0) {
    return (
      <EmptyState
        title={t('emptyTitle')}
        message={can.manage ? t('empty') : t('emptyNoManage')}
        actions={
          can.manage ? (
            <Link href={ROUTES.create} className={PRIMARY}>
              {t('create')}
            </Link>
          ) : undefined
        }
      />
    );
  }
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[44rem] border-collapse text-sm">
          <caption className="sr-only">{t('caption')}</caption>
          <thead>
            <tr className="border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="px-3 py-2 text-start font-semibold">
                {t('col.name')}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">
                {t('col.kind')}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">
                {t('col.status')}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">
                {t('col.token')}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">
                {t('col.lastEvent')}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">
                {t('col.attention')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id} data-testid="source-row" className="align-middle">
                <td className="px-3 py-3">
                  <Link
                    href={r.href}
                    className="font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
                    dir="auto"
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="px-3 py-3">
                  <KindBadge kind={r.kind} />
                </td>
                <td className="px-3 py-3">
                  <SourceStatusChip status={r.status} />
                </td>
                <td className="px-3 py-3 text-xs text-muted-foreground">
                  {r.connector ? (
                    t('connector')
                  ) : r.tokenHint ? (
                    <span dir="ltr">{t('endsIn', { hint: r.tokenHint })}</span>
                  ) : (
                    '-'
                  )}
                </td>
                <td className="px-3 py-3 text-xs">
                  <When value={r.lastEventAt} empty={t('noEvents')} />
                </td>
                <td className="px-3 py-3">
                  {r.attentionHref ? (
                    <Link
                      href={r.attentionHref}
                      data-testid="needs-attention-badge"
                      className="focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <Badge tone="warning">
                        {t('needsAttention', { count: r.needsAttention })}
                      </Badge>
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {can.manage && (
        <Link href={ROUTES.create} className={SECONDARY}>
          {t('create')}
        </Link>
      )}
    </div>
  );
}
