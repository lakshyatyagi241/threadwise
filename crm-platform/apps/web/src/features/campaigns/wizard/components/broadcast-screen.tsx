'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import type {
  WizardBroadcastDetail,
  WizardFollowUpStepSummary,
  WizardRetrySummary,
} from '@crm/contracts';
import { Alert, Button, ConfirmDialog, EmptyState, Spinner, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import {
  KEYS,
  controlBroadcast,
  deleteBroadcast,
  exportBroadcastPath,
  retryFailedBroadcast,
  useBroadcast,
  type BroadcastAction,
} from '../api/wizard';
import { download } from '../../api/campaigns';
import { controlsFor, deletable, retryableFailed, runPath, statusTone } from '../lib/broadcast';
import { scheduleZone } from '../lib/schedule';
import { DirectorSummary } from '../../components/director-summary';
import { Chip, ErrorBlock, Skeleton, WizardCard } from './parts';
import { useScheduleWords } from './use-words';

function RetryBlock({ retries, zone }: { retries: WizardRetrySummary; zone: string }) {
  const t = useTranslations('campaigns.wizard.status');
  const words = useScheduleWords();
  if (!retries.enabled) return <p className="text-sm text-muted-foreground">{t('retriesOff')}</p>;
  return (
    <dl className="grid gap-3 sm:grid-cols-4">
      {(
        [
          ['pending', retries.pending],
          ['recovered', retries.recovered],
          ['exhausted', retries.exhausted],
        ] as const
      ).map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-muted-foreground">{t(`retry.${k}`)}</dt>
          <dd className="text-lg font-semibold tabular-nums">{v.toLocaleString()}</dd>
        </div>
      ))}
      <div>
        <dt className="text-xs text-muted-foreground">{t('retry.next')}</dt>
        <dd className="text-sm">
          {retries.nextRetryAt ? words.instant(new Date(retries.nextRetryAt), zone) : t('none')}
        </dd>
      </div>
      {retries.endDate && (
        <div className="sm:col-span-4 text-xs text-muted-foreground">
          {t('retry.until', { date: words.date(retries.endDate) })}
        </div>
      )}
    </dl>
  );
}

const FOLLOW_UP_COUNTS = [
  'waiting',
  'sent',
  'delivered',
  'read',
  'flowsStarted',
  'skipped',
  'lapsed',
  'failed',
] as const;

/** What each follow-up step of a run did, one compact line per step. */
function FollowUpOutcome({ steps }: { steps: readonly WizardFollowUpStepSummary[] }) {
  const t = useTranslations('campaigns.wizard.status.followUps');
  return (
    <div data-testid="run-follow-ups">
      <p className="text-xs font-medium text-muted-foreground">{t('title')}</p>
      <ul className="mt-1 space-y-1">
        {steps.map((s) => (
          <li key={s.step} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
            <span className="font-medium">{t('step', { step: s.step })}</span>
            {FOLLOW_UP_COUNTS.map((k) => (
              <span
                key={k}
                title={k === 'skipped' || k === 'lapsed' ? t(`hint.${k}`) : undefined}
                className={s[k] === 0 ? 'text-muted-foreground' : undefined}
              >
                {t(`count.${k}`, { count: s[k] })}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Runs({ b }: { b: WizardBroadcastDetail }) {
  const words = useScheduleWords();
  const t = useTranslations('campaigns.wizard.status');
  if (b.runList.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('noRuns')}</p>;
  }
  const zone = scheduleZone(b.schedule);
  const when = (iso: string | null) => (iso ? words.instant(new Date(iso), zone) : '-');
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{t('runsTitle')}</caption>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            {(
              [
                'occurrence',
                'runAt',
                'status',
                'sent',
                'delivered',
                'failed',
                'retries',
                '',
              ] as const
            ).map((h) => (
              <th key={h || 'open'} scope="col" className="px-2 py-1.5 text-start font-medium">
                {h && t(`col.${h}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {b.runList.map((r) => (
            <Fragment key={r.id}>
              <tr className="border-b border-border/60">
                <td className="px-2 py-1.5 tabular-nums">#{r.occurrence}</td>
                <td className="px-2 py-1.5">{when(r.runAt)}</td>
                <td className="px-2 py-1.5">
                  <Chip tone={statusTone(r.status)}>{stateLabel(t, r.status)}</Chip>
                </td>
                <td className="px-2 py-1.5 tabular-nums">{r.counts.sent.toLocaleString()}</td>
                <td className="px-2 py-1.5 tabular-nums">{r.counts.delivered.toLocaleString()}</td>
                <td className="px-2 py-1.5 tabular-nums">{r.counts.failed.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-xs text-muted-foreground">
                  {r.retries.enabled
                    ? t('retrySummary', {
                        pending: r.retries.pending,
                        recovered: r.retries.recovered,
                        exhausted: r.retries.exhausted,
                      })
                    : '-'}
                </td>
                <td className="px-2 py-1.5 text-end">
                  <Link
                    href={runPath(r.id)}
                    className="font-medium text-brand underline underline-offset-2"
                  >
                    {t('openRun')}
                  </Link>
                </td>
              </tr>
              {r.followUps.length > 0 && (
                <tr className="border-b border-border/60">
                  <td colSpan={8} className="px-2 pb-2.5 pt-0">
                    <FollowUpOutcome steps={r.followUps} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The director summary of what this broadcast sent. A one-off campaign is its own campaign; a series shows its newest run (the list
 * is newest first), and a series that has not run yet has nothing to summarise.
 */
function SummaryCard({ b }: { b: WizardBroadcastDetail }) {
  const t = useTranslations('campaigns.detail.summary');
  const latest = b.kind === 'campaign' ? null : (b.runList[0] ?? null);
  const id = b.kind === 'campaign' ? b.id : (latest?.id ?? null);
  if (!id) return null;
  return (
    <DirectorSummary
      kind="campaign"
      id={id}
      note={latest ? t('latestRun', { occurrence: latest.occurrence }) : undefined}
    />
  );
}

/** `/campaigns/wizard/broadcasts/[id]`: what a launched broadcast (one-off or recurring) is doing, with Pause, Resume and Cancel. */
export function BroadcastScreen({ id }: { id: string }) {
  const t = useTranslations('campaigns.wizard.status');
  const tm = useTranslations('campaigns.wizard.send.mode');
  const words = useScheduleWords();
  const q = useBroadcast(id);
  const qc = useQueryClient();
  const { toast } = useToast();
  const router = useRouter();
  const canControl = useCan('camp.campaigns.control');
  const canExport = useCan('camp.campaigns.export');
  const canDelete = useCan('camp.campaigns.delete');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmRetry, setConfirmRetry] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState<BroadcastAction | null>(null);
  const b = q.data;

  const run = async (action: BroadcastAction) => {
    setBusy(action);
    try {
      await controlBroadcast(id, action);
      toast(t(`done.${action}`), 'success');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('failed'), 'danger');
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: KEYS.broadcast(id) });
    }
  };

  const failedCount = b ? retryableFailed(b) : 0;
  const retryFailed = async () => {
    setRetrying(true);
    try {
      const out = await retryFailedBroadcast(id);
      toast(t('done.retryFailed', { count: out.recipients }), 'success');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('failed'), 'danger');
    } finally {
      setRetrying(false);
      void qc.invalidateQueries({ queryKey: KEYS.broadcast(id) });
    }
  };

  const exportRows = async () => {
    try {
      const { blob, filename } = await download(exportBroadcastPath(id));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('exportFailed'), 'danger');
    }
  };
  const remove = async () => {
    setDeleting(true);
    try {
      await deleteBroadcast(id);
      toast(t('done.delete'), 'success');
      void qc.invalidateQueries({ queryKey: ['camp'] });
      router.push('/campaigns');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('failed'), 'danger');
      setDeleting(false);
    }
  };

  const isNotFound = q.error instanceof ApiError && q.error.status === 404;
  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
      <Link href="/campaigns" className="text-sm text-muted-foreground hover:underline">
        {t('back')}
      </Link>
      {q.isPending ? (
        <Skeleton label={t('loading')} lines={6} />
      ) : isNotFound ? (
        <EmptyState
          title={t('notFoundTitle')}
          message={t('notFound')}
          actions={
            <Link href="/campaigns" className="text-sm font-medium text-brand underline">
              {t('back')}
            </Link>
          }
        />
      ) : q.isError || !b ? (
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{b.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Chip tone={statusTone(b.status)}>{stateLabel(t, b.status)}</Chip>
                <Chip>{tm(b.mode)}</Chip>
                {b.templateName && <Chip tone="brand">{b.templateName}</Chip>}
              </div>
            </div>
            {(canControl || canExport || canDelete) && (
              <div className="flex flex-wrap gap-2">
                {canControl && failedCount > 0 && (
                  <Button
                    variant="secondary"
                    disabled={busy !== null || retrying}
                    onClick={() => setConfirmRetry(true)}
                  >
                    {retrying && <Spinner />}
                    {t('action.retryFailed', { count: failedCount })}
                  </Button>
                )}
                {canControl &&
                  controlsFor(b).map((a) => (
                    <Button
                      key={a}
                      variant={a === 'cancel' ? 'danger' : a === 'resume' ? 'brand' : 'secondary'}
                      disabled={busy !== null}
                      onClick={() => (a === 'cancel' ? setConfirmCancel(true) : void run(a))}
                    >
                      {busy === a && <Spinner />}
                      {t(`action.${a}`)}
                    </Button>
                  ))}
                {canExport && (
                  <Button variant="secondary" onClick={() => void exportRows()}>
                    {t('action.export')}
                  </Button>
                )}
                {canDelete && deletable(b) && (
                  <Button
                    variant="danger"
                    disabled={busy !== null || deleting}
                    onClick={() => setConfirmDelete(true)}
                  >
                    {deleting && <Spinner />}
                    {t('action.delete')}
                  </Button>
                )}
              </div>
            )}
          </header>

          <SummaryCard b={b} />

          <WizardCard title={t('scheduleTitle')} id="status-schedule">
            <dl className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-3">
                <dt className="text-xs text-muted-foreground">{t('schedule')}</dt>
                <dd className="text-sm">{words.schedule(b.schedule)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('nextRun')}</dt>
                <dd className="text-sm">
                  {b.nextRunAt
                    ? words.instant(new Date(b.nextRunAt), scheduleZone(b.schedule))
                    : t('none')}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('lastRun')}</dt>
                <dd className="text-sm">
                  {b.lastRunAt
                    ? words.instant(new Date(b.lastRunAt), scheduleZone(b.schedule))
                    : t('none')}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('runsCount')}</dt>
                <dd className="text-sm tabular-nums">{b.runs.toLocaleString()}</dd>
              </div>
            </dl>
          </WizardCard>

          <WizardCard title={t('retriesTitle')} id="status-retries">
            <RetryBlock retries={b.retries} zone={scheduleZone(b.schedule)} />
          </WizardCard>

          <WizardCard title={t('runsTitle')} id="status-runs">
            <Runs b={b} />
          </WizardCard>

          {!canControl && controlsFor(b).length > 0 && <Alert tone="info">{t('noControl')}</Alert>}
        </>
      )}
      {canControl && failedCount > 0 && (
        <ConfirmDialog
          open={confirmRetry}
          busy={retrying}
          title={t('retryTitle')}
          message={t('retryMessage', { count: failedCount })}
          confirmLabel={t('action.retryFailed', { count: failedCount })}
          cancelLabel={t('keep')}
          onClose={() => setConfirmRetry(false)}
          onConfirm={() => {
            setConfirmRetry(false);
            void retryFailed();
          }}
        />
      )}
      {canDelete && b && deletable(b) && (
        <ConfirmDialog
          open={confirmDelete}
          tone="danger"
          busy={deleting}
          title={t('deleteTitle')}
          message={b.kind === 'series' ? t('deleteSeries') : t('deleteOne')}
          confirmLabel={t('action.delete')}
          cancelLabel={t('keep')}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            void remove();
          }}
        />
      )}
      <ConfirmDialog
        open={confirmCancel}
        tone="danger"
        busy={busy === 'cancel'}
        title={t('cancelTitle')}
        message={b?.mode === 'recurring' ? t('cancelSeries') : t('cancelOne')}
        confirmLabel={t('action.cancel')}
        cancelLabel={t('keep')}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => {
          setConfirmCancel(false);
          void run('cancel');
        }}
      />
    </main>
  );
}

/** Statuses the page has words for (a campaign's and a series'); anything newer is shown as the API names it. */
export const KNOWN_STATES = [
  'draft',
  'queued',
  'scheduled',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
  'active',
  'ended',
] as const;
function stateLabel(t: (key: string) => string, status: string): string {
  return (KNOWN_STATES as readonly string[]).includes(status) ? t(`state.${status}`) : status;
}
