'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { RELEASE_STALL_MINUTES, type ReleaseRow, type ReleaseState } from '@crm/contracts';
import { Alert, Badge, Card, EmptyState } from '@crm/ui';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { DEPLOYMENTS_POLL_MS, fetchReleases, releasesKeys } from '../api';

const NS = 'platform-deployments';

const TONE: Record<ReleaseState, 'neutral' | 'warning' | 'danger' | 'success'> = {
  building: 'warning',
  shipping: 'warning',
  releasing: 'warning',
  ok: 'success',
  failed: 'danger',
  rolled_back: 'danger',
};

const COLUMNS = ['tag', 'changes', 'state', 'step', 'started', 'finished', 'error'] as const;

/**
 * The Product releases tab: what is live on desk.wabo.ai, whether a release is running, and every attempt with its steps and error.
 * Read-only; polls, so a release that moves shows up without a reload.
 */
export function ReleasesView() {
  const t = useTranslations(NS);
  const f = useFormatter();
  const q = useQuery({
    queryKey: releasesKeys.all,
    queryFn: ({ signal }) => fetchReleases(signal),
    refetchInterval: DEPLOYMENTS_POLL_MS,
  });

  if (q.isPending) return <LoadingBlock />;
  if (q.isError && !q.data) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;

  const data = q.data;
  const stamp = (iso: string) =>
    f.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'medium' });
  const stalled = data.rows.filter((r) => r.stalled).length;

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        {q.isError
          ? t('stale')
          : t('updated', { time: f.dateTime(new Date(data.generatedAt), { timeStyle: 'medium' }) })}
      </p>

      <Card className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">{t('releases.liveLabel')}</div>
        {data.live ? (
          <div className="text-lg font-semibold">
            {t('releases.live', { tag: data.live.tag, time: stamp(data.live.finishedAt) })}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">{t('releases.noneLive')}</div>
        )}
        {data.inProgress && <Badge tone="warning">{t('releases.inProgress')}</Badge>}
      </Card>

      {stalled > 0 && (
        <Alert tone="warning">
          {t('releases.stalledAlert', { count: stalled, minutes: RELEASE_STALL_MINUTES })}
        </Alert>
      )}

      {data.rows.length === 0 ? (
        <EmptyState title={t('empty.title')} message={t('releases.empty')} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[1200px] text-sm">
            <thead className="bg-muted/50 text-start text-xs text-muted-foreground">
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c} scope="col" className="px-3 py-2 text-start font-medium">
                    {t(`releases.cols.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.rows.map((row) => (
                <ReleaseRowView key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReleaseRowView({ row }: { row: ReleaseRow }) {
  const t = useTranslations(NS);
  const f = useFormatter();
  const stamp = (iso: string) =>
    f.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'medium' });
  return (
    <tr className="align-top">
      <td className="px-3 py-2 font-mono text-xs">{row.tag}</td>
      <td className="max-w-md px-3 py-2">
        <ul className="space-y-1">
          {row.changes.map((c) => (
            <li key={`${c.pr ?? 'commit'}-${c.title}`} className="break-words">
              {c.pr !== null && (
                <span className="font-mono text-xs text-muted-foreground">#{c.pr} </span>
              )}
              {c.title}
              <span className="text-xs text-muted-foreground">
                {' '}
                {t('releases.by', { author: c.author })}
              </span>
            </li>
          ))}
        </ul>
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          <Badge tone={TONE[row.state]}>{t(`releases.state.${row.state}`)}</Badge>
          {row.stalled && <Badge tone="warning">{t('stalledBadge')}</Badge>}
        </div>
      </td>
      <td className="px-3 py-2 font-mono text-xs">{row.step ?? ''}</td>
      <td className="whitespace-nowrap px-3 py-2">{stamp(row.startedAt)}</td>
      <td className="whitespace-nowrap px-3 py-2">
        {row.finishedAt ? stamp(row.finishedAt) : t('notStarted')}
      </td>
      <td className="max-w-xs px-3 py-2">
        {row.error ? <div className="break-words text-danger">{row.error}</div> : null}
      </td>
    </tr>
  );
}
