'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import {
  DEPLOYMENT_STATUSES,
  DEPLOYMENT_STALL_MINUTES,
  type DeploymentRow,
  type DeploymentStatus,
} from '@crm/contracts';
import { Alert, Badge, Button, EmptyState, StatTile } from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { DEPLOYMENTS_LIMIT, DEPLOYMENTS_POLL_MS, deploymentsKeys, fetchDeployments } from '../api';

const NS = 'platform-deployments';

type Filter = DeploymentStatus | 'all';
const FILTERS: readonly Filter[] = ['all', ...DEPLOYMENT_STATUSES];
const COLUMNS = ['workspace', 'flow', 'status', 'step', 'attempted', 'updated', 'error'] as const;

const TONE: Record<DeploymentStatus, 'neutral' | 'warning' | 'danger' | 'success'> = {
  queued: 'neutral',
  running: 'warning',
  failed: 'danger',
  live: 'success',
};

/**
 * Operator console: every flow publish to the Geta console, with the exact state of each one. Read-only; a failed publish is retried
 * from the flow editor. Polls, so a publish that moves shows up without a reload.
 */
export function DeploymentsPage() {
  const t = useTranslations(NS);
  const f = useFormatter();
  const [filter, setFilter] = useState<Filter>('all');
  const status = filter === 'all' ? null : filter;
  const q = useQuery({
    queryKey: deploymentsKeys.list(status),
    queryFn: ({ signal }) => fetchDeployments(status, signal),
    refetchInterval: DEPLOYMENTS_POLL_MS,
  });

  const header = (
    <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
  );
  if (q.isPending) {
    return (
      <div className="space-y-6">
        {header}
        <LoadingBlock />
      </div>
    );
  }
  if (q.isError && !q.data) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }

  const data = q.data;
  const { counts } = data;

  return (
    <div className="space-y-6">
      {header}

      <p className="text-xs text-muted-foreground">
        {q.isError
          ? t('stale')
          : t('updated', { time: f.dateTime(new Date(data.generatedAt), { timeStyle: 'medium' }) })}
      </p>

      {counts.stalled > 0 && (
        <Alert tone="warning">
          {t('stalledAlert', { count: counts.stalled, minutes: DEPLOYMENT_STALL_MINUTES })}
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
        <StatTile label={t('kpi.live')} value={counts.live} />
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
            {t(`filter.${id}`)}
          </Button>
        ))}
      </div>

      {data.truncated && <Alert tone="info">{t('truncated', { limit: DEPLOYMENTS_LIMIT })}</Alert>}

      {data.rows.length === 0 ? (
        <EmptyState title={t('empty.title')} message={t(`empty.${filter}`)} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-muted/50 text-start text-xs text-muted-foreground">
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c} scope="col" className="px-3 py-2 text-start font-medium">
                    {t(`cols.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.rows.map((row) => (
                <DeploymentRowView key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DeploymentRowView({ row }: { row: DeploymentRow }) {
  const t = useTranslations(NS);
  const f = useFormatter();
  const stamp = (iso: string) =>
    f.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'medium' });

  return (
    <tr className="align-top">
      <td className="px-3 py-2 font-medium">{row.workspaceName}</td>
      <td className="px-3 py-2">
        <div>{row.flowName}</div>
        <div className="text-xs text-muted-foreground">
          {t('version', { version: row.publishVersion })}
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          <Badge tone={TONE[row.status]}>{t(`status.${row.status}`)}</Badge>
          {row.stalled && <Badge tone="warning">{t('stalledBadge')}</Badge>}
        </div>
      </td>
      <td className="px-3 py-2">{row.step ? t(`steps.${row.step}`) : null}</td>
      <td className="whitespace-nowrap px-3 py-2">
        {row.attemptedAt ? stamp(row.attemptedAt) : t('notStarted')}
      </td>
      <td className="whitespace-nowrap px-3 py-2">{stamp(row.updatedAt)}</td>
      <td className="max-w-xs px-3 py-2">
        {row.failedStep && (
          <div className="text-xs font-medium text-danger">
            {t('failedAt', { step: t(`steps.${row.failedStep}`) })}
          </div>
        )}
        {row.lastError ? (
          <div className="break-words text-danger">{row.lastError}</div>
        ) : row.failedStep ? (
          <div className="text-muted-foreground">{t('noDetail')}</div>
        ) : null}
      </td>
    </tr>
  );
}
