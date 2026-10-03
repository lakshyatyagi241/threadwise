'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button, ConfirmDialog, EmptyState, Spinner, cn, useToast } from '@crm/ui';
import { FLOW_SUBSCRIBER_STATUSES, type FlowSubscriber } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import {
  KEYS,
  pauseSubscriber,
  refreshAll,
  resumeSubscriber,
  retryFailed,
  useFlowOptions,
  useSubscribers,
} from '../api/flow-runtime';
import { parseSubscriberStatus, shortId } from '../lib/model';
import { EnrollPanel } from './enroll-panel';
import { useRetryActions } from './use-retry';
import {
  CARD,
  Denied,
  KICKER,
  SubscriberStatusChip,
  TH,
  useDateTime,
  useErrorText,
  useReasonText,
  useSourceLabel,
} from './parts';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

const COUNT_TONE = {
  active: 'border-success/40',
  paused: 'border-warning/40',
  completed: 'border-border',
  failed: 'border-danger/40',
} as const;

/**
 * `/flow-runtime/flows/[flowId]`: who is in one flow. Counts over every subscriber, status tabs, row actions (pause, resume,
 * retry a failed one), "Retry all failed" and the "Enroll contacts" panel.
 */
export function SubscribersScreen({ flowId }: { flowId: string }) {
  const t = useTranslations('flr');
  const canRead = useCan('flr.runs.read');
  const canManage = useCan('flr.runs.manage');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const when = useDateTime();
  const sourceLabel = useSourceLabel();
  const reasonText = useReasonText();
  const errText = useErrorText();

  const status = parseSubscriberStatus(search.get('status'));
  const setStatus = (s: string) =>
    router.replace(s === 'all' ? pathname : `${pathname}?status=${s}`, { scroll: false });

  const list = useSubscribers(flowId, status);
  const flows = useFlowOptions();
  const flowName =
    flows.data?.find((f) => f.id === flowId)?.name ??
    t('common.unknownFlow', { id: shortId(flowId) });

  const [enrolling, setEnrolling] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const retry = useRetryActions();

  const act = async (s: FlowSubscriber, fn: (id: string) => Promise<unknown>, done: string) => {
    setBusyId(s.id);
    try {
      await fn(s.id);
      toast(done, 'success');
    } catch (e) {
      toast(errText(e), 'danger');
    } finally {
      setBusyId(null);
      void qc.invalidateQueries({ queryKey: KEYS.subscribers });
    }
  };

  const doRetryAll = async () => {
    setBulkBusy(true);
    try {
      const r = await retryFailed(flowId);
      toast(t('subs.retryAllDone', { retried: r.retried, skipped: r.skipped }), 'success');
    } catch (e) {
      toast(errText(e), 'danger');
    } finally {
      setBulkBusy(false);
      setConfirmAll(false);
      void refreshAll(qc);
    }
  };

  if (!canRead) return <Denied />;

  const gone = list.error instanceof ApiError && list.error.status === 404;
  const counts = list.counts;
  const failedCount = counts?.failed ?? 0;

  return (
    <main className="mx-auto max-w-none px-4 py-7 sm:px-6 lg:px-7">
      <div className="mb-4">
        <Link href="/flow-runtime" className="text-xs font-semibold text-brand hover:underline">
          ← {t('subs.back')}
        </Link>
      </div>

      {gone ? (
        <EmptyState title={t('subs.notFoundTitle')} message={t('subs.notFoundBody')} />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className={`mb-2 ${KICKER}`}>{t('subs.kicker')}</div>
              <h1 className="break-words text-2xl leading-tight tracking-tight lg:text-4xl">
                {flowName}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">{t('subs.title')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/flow-runtime?flowId=${flowId}`}
                className="inline-flex h-10 items-center rounded-full border border-border px-4 text-xs font-semibold hover:bg-muted"
              >
                {t('subs.runsLink')}
              </Link>
              {canManage && (
                <>
                  <Button
                    variant="secondary"
                    className="rounded-full"
                    disabled={failedCount === 0}
                    onClick={() => setConfirmAll(true)}
                  >
                    {t('subs.retryAll')}
                  </Button>
                  <Button
                    variant="brand"
                    className="rounded-full"
                    onClick={() => setEnrolling((v) => !v)}
                  >
                    {t('subs.enrollOpen')}
                  </Button>
                </>
              )}
            </div>
          </div>

          {!canManage && (
            <p className="mb-4 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
              {t('common.viewOnly')}
            </p>
          )}

          {canManage && enrolling && (
            <EnrollPanel flowId={flowId} onClose={() => setEnrolling(false)} />
          )}

          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {FLOW_SUBSCRIBER_STATUSES.map((s) => (
              <div
                key={s}
                className={cn('rounded-2xl border bg-background p-4 shadow-sm', COUNT_TONE[s])}
              >
                <div className="text-xs text-muted-foreground">{t(`subs.count.${s}`)}</div>
                <div className="mt-1 text-3xl font-semibold leading-none tabular-nums">
                  {counts ? counts[s].toLocaleString() : t('common.noValue')}
                </div>
              </div>
            ))}
          </div>

          <section className={CARD}>
            <div
              className="flex flex-wrap gap-2 border-b border-border px-4 py-3 sm:px-5"
              role="tablist"
            >
              {(['all', ...FLOW_SUBSCRIBER_STATUSES] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={status === s}
                  onClick={() => setStatus(s)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs font-medium',
                    status === s
                      ? 'bg-brand text-brand-foreground'
                      : 'border border-border hover:bg-muted',
                  )}
                >
                  {s === 'all' ? t('subs.tabAll') : t(`subscriberStatus.${s}`)}
                </button>
              ))}
            </div>

            {list.isPending ? (
              <div className="flex justify-center p-10">
                <Spinner label={t('common.loading')} />
              </div>
            ) : list.isError ? (
              <div className="p-4">
                <EmptyState
                  title={t('subs.loadError')}
                  message={errText(list.error, t('common.loadError'))}
                  actions={
                    <Button variant="secondary" onClick={() => void list.refetch()}>
                      {t('common.retry')}
                    </Button>
                  }
                />
              </div>
            ) : list.items.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title={status === 'all' ? t('subs.emptyTitle') : t('subs.emptyFilteredTitle')}
                  message={status === 'all' ? t('subs.emptyBody') : t('subs.emptyFilteredBody')}
                />
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-[12.5px]">
                    <thead className="border-b border-border bg-muted text-muted-foreground">
                      <tr>
                        <th className={TH}>{t('subs.colContact')}</th>
                        <th className={TH}>{t('subs.colStatus')}</th>
                        <th className={TH}>{t('subs.colSource')}</th>
                        <th className={TH}>{t('subs.colEnrolled')}</th>
                        <th className={TH}>{t('subs.colFailure')}</th>
                        <th className={`${TH} text-end`}>{t('subs.colRetries')}</th>
                        <th className={TH}>
                          <span className="sr-only">{t('subs.colActions')}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border align-top">
                      {list.items.map((s) => (
                        <tr key={s.id} className="hover:bg-muted/50">
                          <td className="max-w-[240px] px-3 py-2.5">
                            <div className="truncate font-semibold">
                              {s.contact.name?.trim() || t('common.unknownContact')}
                            </div>
                            {s.contact.phone && (
                              <div className="font-mono text-[11px] text-muted-foreground">
                                {s.contact.phone}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <SubscriberStatusChip status={s.status} />
                          </td>
                          <td className="px-3 py-2.5">{sourceLabel(s.source)}</td>
                          <td className="whitespace-nowrap px-3 py-2.5">{when(s.enrolledAt)}</td>
                          <td className="max-w-[280px] break-words px-3 py-2.5 text-danger">
                            {s.failureReason ? reasonText(s.failureReason) : ''}
                          </td>
                          <td className="px-3 py-2.5 text-end font-mono tabular-nums">
                            {s.retryCount}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-end">
                            {s.lastRunId && (
                              <Link
                                href={`/flow-runtime/runs/${s.lastRunId}`}
                                className="me-3 text-xs font-semibold text-brand hover:underline"
                              >
                                {t('subs.lastRun')}
                              </Link>
                            )}
                            {canManage && s.status === 'active' && (
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={busyId === s.id}
                                onClick={() => void act(s, pauseSubscriber, t('subs.paused'))}
                              >
                                {t('subs.pause')}
                              </Button>
                            )}
                            {canManage && s.status === 'paused' && (
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={busyId === s.id}
                                onClick={() => void act(s, resumeSubscriber, t('subs.resumed'))}
                              >
                                {t('subs.resume')}
                              </Button>
                            )}
                            {canManage && s.status === 'failed' && (
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={retry.busy}
                                onClick={() => retry.ask([s.id])}
                              >
                                {t('subs.retry')}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted-foreground">
                  <span aria-live="polite">{t('subs.showing', { count: list.items.length })}</span>
                  {list.hasNextPage && (
                    <Button
                      variant="secondary"
                      disabled={list.isFetchingNextPage}
                      onClick={() => void list.fetchNextPage()}
                    >
                      {list.isFetchingNextPage ? t('common.loadingMore') : t('common.loadMore')}
                    </Button>
                  )}
                </div>
              </>
            )}
          </section>
        </>
      )}

      {retry.dialog}
      <ConfirmDialog
        open={confirmAll}
        title={t('subs.retryAllTitle')}
        message={t('subs.retryAllBody')}
        confirmLabel={t('subs.retryAllConfirm')}
        cancelLabel={t('subs.retryAllCancel')}
        busy={bulkBusy}
        onConfirm={() => void doRetryAll()}
        onClose={() => setConfirmAll(false)}
      />
    </main>
  );
}
