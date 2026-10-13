'use client';

import { useId, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, Field, Select } from '@crm/ui';
import type { LscPlatformRun, LscRunStatus } from '@crm/contracts';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { durationText, knownReason, STATUS_FILTERS, totalTokens } from './logic';
import {
  RUNS_KEY,
  RUNS_PAGE_SIZE,
  WORKSPACE_OPTIONS_KEY,
  runsSchema,
  workspacesSchema,
} from './queries';
import { ErrorBlock, LoadingBlock } from './state';
import { useUsd } from './use-usd';

const NS = 'lead-scoring-admin.runs';
const STATUS_TONE: Record<LscRunStatus, 'success' | 'neutral' | 'danger' | 'warning'> = {
  ok: 'success',
  kept: 'neutral',
  failed: 'danger',
  skipped: 'warning',
};

function RunRow({ run }: { run: LscPlatformRun }) {
  const t = useTranslations(NS);
  const tc = useTranslations('lead-scoring-admin.common');
  const format = useFormatter();
  const usd = useUsd();
  const n = (v: number) => format.number(v);
  const duration = durationText(run.durationMs);
  const reason = knownReason(run.error);
  const tokens = totalTokens(run);

  return (
    <tr className="border-b align-top last:border-0">
      <td className="whitespace-nowrap py-2 pe-3">
        <time dateTime={run.createdAt}>
          {format.dateTime(new Date(run.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
        </time>
      </td>
      <th scope="row" className="px-3 py-2 text-start font-medium">
        {run.workspaceName}
      </th>
      <td className="px-3 py-2">
        {run.contactName ?? <span className="text-muted-foreground">{tc('dash')}</span>}
      </td>
      <td className="px-3 py-2">{t(`trigger.${run.trigger}`)}</td>
      <td className="px-3 py-2">
        <Badge
          tone={STATUS_TONE[run.status]}
          className={run.status === 'kept' ? 'text-foreground' : ''}
        >
          {t(`status.${run.status}`)}
        </Badge>
      </td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
        {run.score === null ? (
          <span className="text-muted-foreground">{tc('dash')}</span>
        ) : run.previousScore === null ? (
          n(run.score)
        ) : (
          t('scoreWas', { score: run.score, previous: run.previousScore })
        )}
      </td>
      <td className="px-3 py-2">
        {run.model ? (
          <span className="break-all font-mono text-xs" dir="ltr">
            {run.model}
          </span>
        ) : (
          <span className="text-muted-foreground">{tc('dash')}</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-end tabular-nums">
        <span
          title={t('tokensTitle', { input: n(run.promptTokens), output: n(run.completionTokens) })}
        >
          {n(tokens)}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-end tabular-nums">
        <span dir="ltr" title={t(`costSourceHelp.${run.costSource}`)}>
          {run.costSource === 'estimate' && <span aria-hidden="true">~</span>}
          {usd(run.costUsd)}
        </span>
        <span className="block text-xs text-muted-foreground">
          {t(`costSource.${run.costSource}`)}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2">{t(`paidBy.${run.billedAgainst}`)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-end tabular-nums">
        {duration === null ? (
          <span className="text-muted-foreground">{tc('dash')}</span>
        ) : (
          t(`duration.${duration.unit}`, { value: format.number(duration.value) })
        )}
      </td>
      <td className="max-w-56 ps-3 py-2">
        {run.error ? (
          <span title={run.error}>{reason ? t(`reason.${reason}`) : run.error}</span>
        ) : (
          <span className="text-muted-foreground">{tc('dash')}</span>
        )}
      </td>
    </tr>
  );
}

/** The scoring log across workspaces, newest first: cost per run, who paid, why a run failed. Filter and "load more" by cursor. */
export function RunsCard() {
  const t = useTranslations(NS);
  const id = useId();
  const [status, setStatus] = useState<LscRunStatus | ''>('');
  const [workspaceId, setWorkspaceId] = useState('');

  // The workspace filter lists the workspaces that cost the most (the API caps a page at 100).
  const options = useQuery({
    queryKey: WORKSPACE_OPTIONS_KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/lead-scoring/workspaces', {
        query: { limit: 100 },
        schema: workspacesSchema,
        signal,
      }),
    refetchOnWindowFocus: false,
  });

  const q = useInfiniteQuery({
    queryKey: [...RUNS_KEY, status, workspaceId],
    queryFn: ({ pageParam, signal }) =>
      operatorFetch('/lead-scoring/runs', {
        query: {
          status: status || undefined,
          workspaceId: workspaceId || undefined,
          cursor: pageParam,
          limit: RUNS_PAGE_SIZE,
        },
        schema: runsSchema,
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  const filtered = status !== '' || workspaceId !== '';
  const columns = [
    'time',
    'workspace',
    'contact',
    'trigger',
    'status',
    'score',
    'model',
    'tokens',
    'cost',
    'paidBy',
    'duration',
    'error',
  ] as const;
  const endAligned = new Set<string>(['tokens', 'cost', 'duration']);

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void q.refetch()}
          disabled={q.isFetching}
        >
          {t('refresh')}
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('filters.status')} htmlFor={`${id}-status`} className="w-44">
          <Select
            id={`${id}-status`}
            value={status}
            onChange={(e) => setStatus(e.target.value as LscRunStatus | '')}
          >
            <option value="">{t('filters.anyStatus')}</option>
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('filters.workspace')} htmlFor={`${id}-workspace`} className="w-56">
          <Select
            id={`${id}-workspace`}
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
          >
            <option value="">{t('filters.anyWorkspace')}</option>
            {(options.data?.data ?? []).map((w) => (
              <option key={w.workspaceId} value={w.workspaceId}>
                {w.name}
              </option>
            ))}
          </Select>
        </Field>
        {filtered && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setStatus('');
              setWorkspaceId('');
            }}
          >
            {t('filters.clear')}
          </Button>
        )}
      </div>

      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError && !q.data ? (
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        filtered ? (
          <EmptyState title={t('noMatchTitle')} message={t('noMatchMessage')} />
        ) : (
          <EmptyState title={t('emptyTitle')} message={t('emptyMessage')} />
        )
      ) : (
        <>
          {q.isError && <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem] text-sm" aria-label={t('tableLabel')}>
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  {columns.map((c) => (
                    <th
                      key={c}
                      scope="col"
                      className={`px-3 py-2 font-medium first:ps-0 last:pe-0 ${endAligned.has(c) ? 'text-end' : 'text-start'}`}
                    >
                      {t(`columns.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <RunRow key={r.id} run={r} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">{t('costLegend')}</p>
          {q.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                onClick={() => void q.fetchNextPage()}
                disabled={q.isFetchingNextPage}
              >
                {q.isFetchingNextPage ? t('loadingMore') : t('loadMore')}
              </Button>
            </div>
          )}
          {q.isFetchNextPageError && (
            <ErrorBlock error={q.error} onRetry={() => void q.fetchNextPage()} />
          )}
        </>
      )}
    </Card>
  );
}
