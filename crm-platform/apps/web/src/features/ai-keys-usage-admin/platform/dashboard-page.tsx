'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { aiDashboardResponseSchema } from '@crm/contracts';
import { Badge, Card, StatTile } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { compactNumber, dollars } from '../lib/format';
import { ErrorBlock, LoadingBlock } from '../shared/state';
import {
  DEFAULT_USAGE_RANGE,
  DailyBars,
  ShareBars,
  SourceSplit,
  WindowSwitch,
  usageRangeQuery,
  usageRangeReady,
  type UsageRangeValue,
} from '../shared/usage-view';
import { DASHBOARD_QUERY_KEY } from './queries';

const NS = 'ai-keys-usage-admin.dashboard';

/** Platform-wide AI usage: who spent tokens, on which vendor and model, who paid, and whether each key is live. */
export function DashboardPage() {
  const t = useTranslations(NS);
  const tc = useTranslations('ai-keys-usage-admin.common');
  const locale = useLocale();
  const [range, setRange] = useState<UsageRangeValue>(DEFAULT_USAGE_RANGE);
  const q = useQuery({
    queryKey: [...DASHBOARD_QUERY_KEY, range],
    queryFn: ({ signal }) =>
      operatorFetch('/ai-dashboard', {
        query: usageRangeQuery(range),
        schema: aiDashboardResponseSchema,
        signal,
      }),
    placeholderData: keepPreviousData,
    enabled: usageRangeReady(range),
    refetchOnWindowFocus: false,
  });
  const num = (n: number) => new Intl.NumberFormat(locale).format(n);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={<WindowSwitch value={range} onChange={setRange} />}
      />
      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="space-y-6" aria-busy={q.isPlaceholderData}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label={t('kpis.tokens')}
              value={compactNumber(q.data.kpis.tokens, locale)}
              hint={t('kpis.tokensHint')}
            />
            <StatTile
              label={t('kpis.cost')}
              value={dollars(q.data.kpis.estimatedCostUsd, locale)}
              hint={t('kpis.costHint')}
              tone="accent"
            />
            <StatTile
              label={t('kpis.calls')}
              value={compactNumber(q.data.kpis.calls, locale)}
              hint={t('kpis.callsHint')}
            />
            <StatTile
              label={t('kpis.workspaces')}
              value={compactNumber(q.data.kpis.workspaces, locale)}
              hint={t('kpis.workspacesHint')}
            />
          </div>

          <Card className="space-y-2">
            <DailyBars data={q.data.daily} caption={t('daily')} />
            {q.data.daily.some((d) => d.tokens > 0) ? (
              <p className="text-xs text-muted-foreground">
                {t('peak', {
                  value: compactNumber(Math.max(...q.data.daily.map((d) => d.tokens)), locale),
                })}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{t('dailyEmpty')}</p>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <ShareBars
                caption={t('byProvider')}
                empty={t('providerEmpty')}
                rows={q.data.byProvider.map((p) => ({
                  key: p.provider,
                  label: p.provider,
                  value: p.tokens,
                  note: t('providerCalls', { count: p.calls }),
                }))}
              />
            </Card>
            <Card className="space-y-3">
              <SourceSplit
                caption={t('split')}
                platformLabel={t('splitPlatform')}
                ownLabel={t('splitOwn')}
                platform={q.data.sourceSplit.admin}
                own={q.data.sourceSplit.workspace}
              />
              <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                {t('splitNote')}
              </p>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="space-y-2">
              <h3 className="text-sm font-medium">{t('topWorkspaces')}</h3>
              {q.data.topWorkspaces.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {t('workspaceEmpty')}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {q.data.topWorkspaces.map((w) => (
                    <li key={w.id} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{w.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {t('workspaceMeta', { count: w.calls })}
                          {w.ownKeyTokens > 0
                            ? ` · ${t('workspaceByok', { tokens: compactNumber(w.ownKeyTokens, locale) })}`
                            : ''}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-sm">
                        {compactNumber(w.tokens, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card className="space-y-2">
              <h3 className="text-sm font-medium">{t('topModels')}</h3>
              {q.data.byModel.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">{t('modelEmpty')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {q.data.byModel.map((m) => (
                    <li
                      key={`${m.provider}:${m.model ?? ''}`}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium" dir="ltr">
                          {m.model ?? tc('dash')}
                        </span>
                        <span className="block text-xs capitalize text-muted-foreground">
                          {t('modelMeta', { provider: m.provider, count: m.calls })}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-sm">
                        {compactNumber(m.tokens, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">{t('keyHealth')}</h3>
              <Link
                href="/admin/ai-keys"
                className="text-xs font-semibold text-primary hover:underline"
              >
                {t('manageKeys')}
              </Link>
            </div>
            {q.data.keys.platform.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noPlatformKeys')}</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {q.data.keys.platform.map((k) => (
                  <li
                    key={k.provider}
                    className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium capitalize">{k.provider}</span>
                      <span className="block truncate text-xs text-muted-foreground" dir="ltr">
                        {k.defaultModel ?? t('noDefaultModel')}
                      </span>
                    </span>
                    <Badge tone={k.live ? 'success' : 'neutral'}>
                      {k.live ? t('live') : t('notLive')}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-x-8 gap-y-1 border-t border-border pt-3 text-sm">
              <p>
                <span className="text-muted-foreground">{t('byokKeys')}:</span>{' '}
                <span className="font-semibold">{num(q.data.keys.byok.count)}</span>
              </p>
              <p>
                <span className="text-muted-foreground">{t('byokWorkspaces')}:</span>{' '}
                <span className="font-semibold">{num(q.data.keys.byok.workspaces)}</span>
              </p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
