'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import {
  RELEASE_STALL_MINUTES,
  type ReleaseChange,
  type ReleaseRow,
  type ReleaseState,
} from '@crm/contracts';
import { Alert, Badge, Card, EmptyState } from '@crm/ui';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { DEPLOYMENTS_POLL_MS, fetchReleases, releasesKeys } from '../api';
import { summarize } from './release-summary';

const NS = 'platform-deployments';

/** How many pull requests of one release are listed before the rest fold into "N more". */
const SHOWN_CHANGES = 5;

const TONE: Record<ReleaseState, 'neutral' | 'warning' | 'danger' | 'success'> = {
  building: 'warning',
  shipping: 'warning',
  releasing: 'warning',
  ok: 'success',
  failed: 'danger',
  rolled_back: 'danger',
};

/** Operators read the console in Indian time whatever their browser's zone is. */
const IST = 'Asia/Kolkata';

const COLUMNS = ['tag', 'changes', 'state', 'step', 'started', 'finished', 'error'] as const;

/** A time as Indian time, with the zone written out (the browser's own zone would read as a different hour to the person next to you). */
const istTime = (f: ReturnType<typeof useFormatter>, iso: string) =>
  f.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'medium', timeZone: IST });
const istStamp = (f: ReturnType<typeof useFormatter>, iso: string) => `${istTime(f, iso)} IST`;

/**
 * How many of the newest attempts must all lack their pull requests before the page says so. A release always carries at least its
 * commit, so several empty ones in a row mean the build server or the host script that records them is not doing it.
 */
const SILENT_RELEASES = 3;

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
  const stamp = (iso: string) => istStamp(f, iso);
  const stalled = data.rows.filter((r) => r.stalled).length;
  const newest = data.rows.slice(0, SILENT_RELEASES);
  const silent = newest.length === SILENT_RELEASES && newest.every((r) => r.changes.length === 0);

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        {q.isError ? t('stale') : t('updated', { time: stamp(data.generatedAt) })}
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

      {silent && <Alert tone="warning">{t('releases.noChangesAlert')}</Alert>}

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

/** One pull request of a release: its number and title, who raised it and when, and what it changes in two or three lines at most. */
function ChangeItem({ change: c }: { change: ReleaseChange }) {
  const t = useTranslations(NS);
  const f = useFormatter();
  const summary = c.body ? summarize(c.body) : '';
  return (
    <li className="break-words">
      <div className="text-sm font-medium leading-snug">
        {c.pr !== null && <span className="font-mono text-xs text-muted-foreground">#{c.pr} </span>}
        {c.title}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        {t('releases.by', { author: c.author })}
        {c.createdAt && (
          <span data-testid="release-raised">
            {' · '}
            {t('releases.raisedIst', { time: istTime(f, c.createdAt) })}
          </span>
        )}
      </div>
      {summary && (
        <p
          className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground"
          data-testid="release-description"
          title={c.body ?? undefined}
        >
          {summary}
        </p>
      )}
    </li>
  );
}

function ReleaseRowView({ row }: { row: ReleaseRow }) {
  const t = useTranslations(NS);
  const f = useFormatter();
  const stamp = (iso: string) => istStamp(f, iso);
  // A failed attempt always says why; one that stopped moving says so, so the cell is never an unexplained blank.
  const failed = row.state === 'failed' || row.state === 'rolled_back';
  const why =
    row.error ??
    (failed
      ? t('noDetail')
      : row.stalled
        ? t('releases.noProgress', { minutes: RELEASE_STALL_MINUTES })
        : null);
  return (
    <tr className="align-top">
      <td className="px-3 py-2 font-mono text-xs">{row.tag}</td>
      <td className="max-w-md px-3 py-2">
        <ul className="space-y-3">
          {row.changes.slice(0, SHOWN_CHANGES).map((c) => (
            <ChangeItem key={`${c.pr ?? 'commit'}-${c.title}`} change={c} />
          ))}
        </ul>
        {row.changes.length > SHOWN_CHANGES && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              {t('releases.moreChanges', { count: row.changes.length - SHOWN_CHANGES })}
            </summary>
            <ul className="mt-2 space-y-3">
              {row.changes.slice(SHOWN_CHANGES).map((c) => (
                <ChangeItem key={`${c.pr ?? 'commit'}-${c.title}`} change={c} />
              ))}
            </ul>
          </details>
        )}
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
        {why ? (
          <div
            className={row.error ? 'break-words text-danger' : 'break-words text-muted-foreground'}
          >
            {why}
          </div>
        ) : null}
      </td>
    </tr>
  );
}
