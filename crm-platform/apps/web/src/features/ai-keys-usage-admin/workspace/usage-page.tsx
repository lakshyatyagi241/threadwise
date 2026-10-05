'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { aiUsageResponseSchema, type AiUsageWindow } from '@crm/contracts';
import { Alert, Card, StatTile } from '@crm/ui';
import { apiFetch } from '@/lib/api/client';
import { compactNumber, dollars } from '../lib/format';
import { ErrorBlock, LoadingBlock } from '../shared/state';
import { DailyBars, ShareBars, SourceSplit, WindowSwitch } from '../shared/usage-view';
import { AI_KEYS } from './api';

const NS = 'ai-keys-usage-admin.usage';

/** The workspace's own AI usage for a window, and how much of the plan's monthly allowance is spent. */
export function UsagePage() {
  const t = useTranslations(NS);
  const tc = useTranslations('ai-keys-usage-admin.common');
  const locale = useLocale();
  const [window, setWindow] = useState<AiUsageWindow>('30d');
  const q = useQuery({
    queryKey: [...AI_KEYS.usage, window],
    queryFn: ({ signal }) =>
      apiFetch('/ai/usage', { query: { window }, schema: aiUsageResponseSchema, signal }),
    placeholderData: keepPreviousData,
  });
  const num = (n: number) => new Intl.NumberFormat(locale).format(n);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-3xl space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <WindowSwitch value={window} onChange={setWindow} />
      </header>

      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="space-y-6" aria-busy={q.isPlaceholderData}>
          <Card className="space-y-2">
            <h2 className="text-sm font-medium">{t('cap.title')}</h2>
            {q.data.cap.limit === null ? (
              <p className="text-sm text-muted-foreground">
                {t('cap.unlimited', { used: q.data.cap.used })}
              </p>
            ) : (
              <>
                <p className="text-sm">
                  {t('cap.used', { used: q.data.cap.used, limit: q.data.cap.limit })}
                </p>
                <div
                  role="progressbar"
                  aria-label={t('cap.title')}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={q.data.cap.percent}
                  className="h-2.5 rounded-full bg-muted"
                >
                  <div
                    className={`h-2.5 rounded-full ${q.data.cap.reached ? 'bg-danger' : 'bg-primary'}`}
                    style={{ width: `${q.data.cap.percent}%` }}
                  />
                </div>
                {q.data.cap.reached && <Alert tone="warning">{t('cap.reached')}</Alert>}
              </>
            )}
            <p className="text-xs text-muted-foreground">{t('cap.note')}</p>
          </Card>

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
              label={t('kpis.providers')}
              value={num(q.data.kpis.providers)}
              hint={`${t('kpis.models')}: ${num(q.data.kpis.models)}`}
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

          <Card className="space-y-2 overflow-x-auto">
            <h3 className="text-sm font-medium">{t('models')}</h3>
            {q.data.byModel.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('empty')}</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 text-start font-medium">{t('columns.model')}</th>
                    <th className="py-1 text-start font-medium">{t('columns.provider')}</th>
                    <th className="py-1 text-end font-medium">{t('columns.tokens')}</th>
                    <th className="py-1 text-end font-medium">{t('columns.prompt')}</th>
                    <th className="py-1 text-end font-medium">{t('columns.completion')}</th>
                    <th className="py-1 text-end font-medium">{t('columns.calls')}</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.byModel.map((m) => (
                    <tr key={`${m.provider}:${m.model ?? ''}`} className="border-t border-border">
                      <td className="max-w-48 truncate py-1.5 font-mono text-xs" dir="ltr">
                        {m.model ?? tc('dash')}
                      </td>
                      <td className="py-1.5">{m.provider}</td>
                      <td className="py-1.5 text-end font-mono">{num(m.tokens)}</td>
                      <td className="py-1.5 text-end font-mono">{num(m.promptTokens)}</td>
                      <td className="py-1.5 text-end font-mono">{num(m.completionTokens)}</td>
                      <td className="py-1.5 text-end font-mono">{num(m.calls)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <p className="text-xs text-muted-foreground">{t('costNote')}</p>
        </div>
      )}
    </div>
  );
}
