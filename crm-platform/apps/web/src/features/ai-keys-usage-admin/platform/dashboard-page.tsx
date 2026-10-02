'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { aiDashboardResponseSchema, type AiUsageWindow } from '@crm/contracts';
import { Badge, Card, StatTile } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { compactNumber, dollars } from '../lib/format';
import { ErrorBlock, LoadingBlock } from '../shared/state';
import { DailyBars, ShareBars, SourceSplit, WindowSwitch } from '../shared/usage-view';
import { DASHBOARD_QUERY_KEY } from './queries';

const NS = 'ai-keys-usage-admin.dashboard';

/** Platform-wide AI usage: who spent tokens, on which vendor and model, who paid, and whether each key is live. */
export function DashboardPage() {
  const t = useTranslations(NS);
  const tc = useTranslations('ai-keys-usage-admin.common');
  const locale = useLocale();
  const [window, setWindow] = useState<AiUsageWindow>('30d');
  const q = useQuery({
    queryKey: [...DASHBOARD_QUERY_KEY, window],
    queryFn: ({ signal }) =>
      operatorFetch('/ai-dashboard', {
        query: { window },
        schema: aiDashboardResponseSchema,
        signal,
      }),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
  const num = (n: number) => new Intl.NumberFormat(locale).format(n);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={<WindowSwitch value={window} onChange={setWindow} />}
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
              hint={t('kpis.calls', { count: q.data.kpis.calls })}
            />
            <StatTile
              label={t('kpis.platform')}
              value={compactNumber(q.data.kpis.platformTokens, locale)}
              hint={`${t('kpis.ownKeys')}: ${compactNumber(q.data.kpis.ownKeyTokens, locale)}`}
            />
            <StatTile
              label={t('kpis.cost')}
              value={dollars(q.data.kpis.estimatedCostUsd, locale)}
              hint={t('kpis.costHint')}
              tone="accent"
            />
            <StatTile
              label={t('kpis.workspaces')}
              value={num(q.data.kpis.workspaces)}
              hint={`${t('kpis.providers')}: ${num(q.data.kpis.providers)}`}
            />
          </div>

          <Card>
            <DailyBars data={q.data.daily} caption={t('daily')} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <ShareBars
                caption={t('byProvider')}
                empty={t('empty')}
                rows={q.data.byProvider.map((p) => ({
                  key: p.provider,
                  label: p.provider,
                  value: p.tokens,
                  note: t('kpis.calls', { count: p.calls }),
                }))}
              />
            </Card>
            <Card>
              <SourceSplit
                caption={t('split')}
                platformLabel={t('splitPlatform')}
                ownLabel={t('splitOwn')}
                platform={q.data.sourceSplit.admin}
                own={q.data.sourceSplit.workspace}
              />
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="space-y-2 overflow-x-auto">
              <h3 className="text-sm font-medium">{t('topWorkspaces')}</h3>
              {q.data.topWorkspaces.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('empty')}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-start text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 text-start font-medium">{t('columns.workspace')}</th>
                      <th className="py-1 text-end font-medium">{t('columns.tokens')}</th>
                      <th className="py-1 text-end font-medium">{t('columns.calls')}</th>
                      <th className="py-1 text-end font-medium">{t('columns.ownKey')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.topWorkspaces.map((w) => (
                      <tr key={w.id} className="border-t border-border">
                        <td className="max-w-48 truncate py-1.5">{w.name}</td>
                        <td className="py-1.5 text-end font-mono">{num(w.tokens)}</td>
                        <td className="py-1.5 text-end font-mono">{num(w.calls)}</td>
                        <td className="py-1.5 text-end font-mono">{num(w.ownKeyTokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card className="space-y-2 overflow-x-auto">
              <h3 className="text-sm font-medium">{t('topModels')}</h3>
              {q.data.byModel.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('empty')}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 text-start font-medium">{t('columns.model')}</th>
                      <th className="py-1 text-start font-medium">{t('columns.provider')}</th>
                      <th className="py-1 text-end font-medium">{t('columns.tokens')}</th>
                      <th className="py-1 text-end font-medium">{t('columns.calls')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.byModel.map((m) => (
                      <tr key={`${m.provider}:${m.model ?? ''}`} className="border-t border-border">
                        <td className="max-w-40 truncate py-1.5 font-mono text-xs" dir="ltr">
                          {m.model ?? tc('dash')}
                        </td>
                        <td className="py-1.5">{m.provider}</td>
                        <td className="py-1.5 text-end font-mono">{num(m.tokens)}</td>
                        <td className="py-1.5 text-end font-mono">{num(m.calls)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          <Card className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">{t('keyHealth')}</h3>
              <p className="text-xs text-muted-foreground">
                {t('byok')}:{' '}
                {t('byokSummary', {
                  count: q.data.keys.byok.count,
                  workspaces: q.data.keys.byok.workspaces,
                })}
              </p>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {q.data.keys.platform.map((k) => (
                <li
                  key={k.provider}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{k.provider}</span>
                    <span
                      className="block truncate font-mono text-xs text-muted-foreground"
                      dir="ltr"
                    >
                      {k.defaultModel ?? tc('dash')}
                    </span>
                  </span>
                  <Badge tone={k.live ? 'success' : 'neutral'}>
                    {k.live ? t('live') : t('notLive')}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
