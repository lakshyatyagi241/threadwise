'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import {
  DEPLOYMENT_STALL_MINUTES,
  PUBLISH_STATUSES,
  type PublishRow,
  type PublishStatus,
} from '@crm/contracts';
import { Alert, Badge, Button, EmptyState, StatTile } from '@crm/ui';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { DEPLOYMENTS_LIMIT, DEPLOYMENTS_POLL_MS, fetchPublishes, publishesKeys } from '../api';

const NS = 'platform-deployments';

type Filter = PublishStatus | 'all';
const FILTERS: readonly Filter[] = ['all', ...PUBLISH_STATUSES];

const TONE: Record<PublishStatus, 'neutral' | 'warning' | 'danger' | 'success'> = {
  queued: 'neutral',
  running: 'warning',
  failed: 'danger',
  done: 'success',
};

/** The Flow publishes tab: every flow.published event the worker handles, with its state, attempts and last error. Polls. */
export function PublishesView() {
  const t = useTranslations(NS);
  const f = useFormatter();
  const [filter, setFilter] = useState<Filter>('all');
  const status = filter === 'all' ? null : filter;
  const q = useQuery({
    queryKey: publishesKeys.list(status),
    queryFn: ({ signal }) => fetchPublishes(status, signal),
    refetchInterval: DEPLOYMENTS_POLL_MS,
  });

  // Done has its own word under publishes.status; the other states reuse the Geta tab's words.
  const label = (s: PublishStatus) =>
    s === 'done' ? t('publishes.status.done') : t(`status.${s}`);

  if (q.isPending) return <LoadingBlock />;
  if (q.isError && !q.data) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;

  const data = q.data;
  const { counts } = data;

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        {q.isError
          ? t('stale')
          : t('updated', { time: f.dateTime(new Date(data.generatedAt), { timeStyle: 'medium' }) })}
      </p>

      {counts.stalled > 0 && (
        <Alert tone="warning">
          {t('publishes.stalledAlert', {
            count: counts.stalled,
            minutes: DEPLOYMENT_STALL_MINUTES,
          })}
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label={t('kpi.running')}
          value={counts.running}
          tone={counts.running > 0 ? 'accent' : 'default'}
        />
        <StatTile label={t('kpi.queued')} value={counts.queued} />
        <StatTile
          label={t('kpi.failed')}
          value={counts.failed}
          tone={counts.failed > 0 ? 'warning' : 'default'}
        />
        <StatTile label={label('done')} value={counts.done} />
        <StatTile
          label={t('kpi.stalled')}
          value={counts.stalled}
          tone={counts.stalled > 0 ? 'warning' : 'default'}
        />
      </div>

      <div role="group" aria-label={t('filter.label')} className="flex flex-wrap gap-2">
        {FILTERS.map((id) => (
          <Button
            key={id}
            size="sm"
            variant={filter === id ? 'primary' : 'secondary'}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {id === 'all' ? t('filter.all') : label(id)}
          </Button>
        ))}
      </div>

      {data.truncated && (
        <Alert tone="info">{t('publishes.truncated', { limit: DEPLOYMENTS_LIMIT })}</Alert>
      )}

      {data.rows.length === 0 ? (
        <EmptyState
          title={t('empty.title')}
          message={
            filter === 'all'
              ? t('publishes.empty.all')
              : filter === 'done'
                ? t('publishes.empty.done')
                : t(`empty.${filter}`)
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-muted/50 text-start text-xs text-muted-foreground">
              <tr>
                {(
                  [
                    ['cols.workspace', 'workspace'],
                    ['cols.flow', 'flow'],
                    ['cols.status', 'status'],
                    ['publishes.cols.attempts', 'attempts'],
                    ['publishes.cols.queued', 'queued'],
                    ['publishes.cols.finished', 'finished'],
                    ['cols.error', 'error'],
                  ] as const
                ).map(([key, id]) => (
                  <th key={id} scope="col" className="px-3 py-2 text-start font-medium">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.rows.map((row) => (
                <PublishRowView key={`${row.flowId}-${row.queuedAt}`} row={row} label={label} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PublishRowView({ row, label }: { row: PublishRow; label: (s: PublishStatus) => string }) {
  const t = useTranslations(NS);
  const f = useFormatter();
  const stamp = (iso: string) =>
    f.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'medium' });

  return (
    <tr className="align-top">
      <td className="px-3 py-2 font-medium">{row.workspaceName}</td>
      <td className="px-3 py-2">{row.flowName}</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          <Badge tone={TONE[row.status]}>{label(row.status)}</Badge>
          {row.stalled && <Badge tone="warning">{t('stalledBadge')}</Badge>}
        </div>
      </td>
      <td className="px-3 py-2 tabular-nums">{row.attempts}</td>
      <td className="whitespace-nowrap px-3 py-2">{stamp(row.queuedAt)}</td>
      <td className="whitespace-nowrap px-3 py-2">
        {row.processedAt ? stamp(row.processedAt) : t('publishes.notProcessed')}
      </td>
      <td className="max-w-xs px-3 py-2">
        {row.lastError ? <div className="break-words text-danger">{row.lastError}</div> : null}
      </td>
    </tr>
  );
}
