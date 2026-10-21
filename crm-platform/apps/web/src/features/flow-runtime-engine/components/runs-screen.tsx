'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button, ConfirmDialog, EmptyState, Select, Spinner, useToast } from '@crm/ui';
import { FLOW_RUN_SOURCES, FLOW_RUN_STATUSES, type FlowRunSummary } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { cancelRun, refreshAll, useFlowOptions, useRuns } from '../api/flow-runtime';
import {
  contactLabel,
  isLive,
  parseRunsState,
  runsStateToSearch,
  shortId,
  type RunsState,
} from '../lib/model';
import {
  CARD,
  Denied,
  KICKER,
  RunStatusChip,
  TH,
  useDateTime,
  useErrorText,
  useSourceLabel,
} from './parts';

/**
 * `/flow-runtime`: every run of every flow, newest first, with status, source and flow filters in the address and a cursor
 * "Load more". Live runs can be cancelled (needs `flr.runs.manage`).
 */
export function RunsScreen() {
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
  const errText = useErrorText();

  const state = useMemo(() => parseRunsState(new URLSearchParams(search.toString())), [search]);
  const go = (patch: Partial<RunsState>) =>
    router.replace(`${pathname}${runsStateToSearch({ ...state, ...patch })}`, { scroll: false });

  const list = useRuns(state);
  const flows = useFlowOptions();
  const flowName = (r: { flowId: string; flowName: string }) =>
    r.flowName || t('common.unknownFlow', { id: shortId(r.flowId) });

  const [pending, setPending] = useState<FlowRunSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const confirmCancel = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await cancelRun(pending.id);
      toast(t('runs.cancelled'), 'success');
    } catch (e) {
      toast(errText(e), 'danger');
    } finally {
      setBusy(false);
      setPending(null);
      void refreshAll(qc);
    }
  };

  if (!canRead) return <Denied />;

  const filtered = state.status !== 'all' || state.source !== 'all' || state.flowId !== '';
  const empty = !list.isPending && !list.isError && list.items.length === 0;

  return (
    <main className="mx-auto max-w-none px-4 py-7 sm:px-6 lg:px-7">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className={`mb-2 ${KICKER}`}>{t('common.workspace')}</div>
          <h1 className="text-3xl font-normal leading-none tracking-tight lg:text-[44px]">
            {t('runs.title')} <span className="not-italic text-brand">{t('runs.titleAccent')}</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('runs.intro')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" className="rounded-full" onClick={() => void refreshAll(qc)}>
            {t('common.refresh')}
          </Button>
          <Link
            href="/flow-runtime/analytics"
            className="inline-flex h-10 items-center rounded-full bg-brand px-4 text-xs font-semibold text-brand-foreground hover:opacity-90"
          >
            {t('runs.analytics')}
          </Link>
        </div>
      </div>

      {!canManage && (
        <p className="mb-4 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          {t('common.viewOnly')}
        </p>
      )}

      <section className={CARD}>
        <div className="grid grid-cols-1 gap-3 border-b border-border px-4 py-4 sm:grid-cols-3 sm:px-5">
          <label className="block">
            <span className={KICKER}>{t('runs.filterStatus')}</span>
            <Select
              className="mt-1"
              value={state.status}
              onChange={(e) => go({ status: e.target.value as RunsState['status'] })}
            >
              <option value="all">{t('runs.all')}</option>
              {FLOW_RUN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className={KICKER}>{t('runs.filterSource')}</span>
            <Select
              className="mt-1"
              value={state.source}
              onChange={(e) => go({ source: e.target.value })}
            >
              <option value="all">{t('runs.all')}</option>
              {FLOW_RUN_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {sourceLabel(s)}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className={KICKER}>{t('runs.filterFlow')}</span>
            <Select
              className="mt-1"
              value={state.flowId}
              onChange={(e) => go({ flowId: e.target.value })}
            >
              <option value="">{t('runs.allFlows')}</option>
              {/* A flow chosen from a shared link that has no runs in the options still shows as selected. */}
              {state.flowId && !flows.data?.some((f) => f.id === state.flowId) && (
                <option value={state.flowId}>
                  {t('common.unknownFlow', { id: shortId(state.flowId) })}
                </option>
              )}
              {flows.data?.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </label>
        </div>

        {list.isPending ? (
          <div className="flex justify-center p-10">
            <Spinner label={t('common.loading')} />
          </div>
        ) : list.isError ? (
          <div className="p-4">
            <EmptyState
              title={t('runs.loadError')}
              message={errText(list.error, t('common.loadError'))}
              actions={
                <Button variant="secondary" onClick={() => void list.refetch()}>
                  {t('common.retry')}
                </Button>
              }
            />
          </div>
        ) : empty ? (
          <div className="p-4">
            <EmptyState
              title={filtered ? t('runs.emptyFilteredTitle') : t('runs.emptyTitle')}
              message={filtered ? t('runs.emptyFilteredBody') : t('runs.emptyBody')}
              actions={
                filtered && (
                  <Button variant="secondary" onClick={() => router.replace(pathname)}>
                    {t('runs.resetFilters')}
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-[12.5px]">
                <thead className="border-b border-border bg-muted text-muted-foreground">
                  <tr>
                    <th className={TH}>{t('runs.colFlow')}</th>
                    <th className={TH}>{t('runs.colContact')}</th>
                    <th className={TH}>{t('runs.colChannel')}</th>
                    <th className={TH}>{t('runs.colSource')}</th>
                    <th className={TH}>{t('runs.colStatus')}</th>
                    <th className={TH}>{t('runs.colStarted')}</th>
                    <th className={TH}>{t('runs.colActivity')}</th>
                    <th className={`${TH} text-end`}>{t('runs.colReplies')}</th>
                    <th className={`${TH} text-end`}>{t('runs.colSteps')}</th>
                    <th className={TH}>
                      <span className="sr-only">{t('runs.colActions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {list.items.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/50">
                      <td className="max-w-[220px] px-3 py-2.5">
                        <Link
                          href={`/flow-runtime/runs/${r.id}`}
                          className="block truncate font-semibold text-brand hover:underline"
                          aria-label={`${t('runs.open')}: ${flowName(r)}`}
                        >
                          {flowName(r)}
                        </Link>
                      </td>
                      <td className="max-w-[200px] truncate px-3 py-2.5">
                        {contactLabel(r.contact, r.peerKey || t('common.unknownContact'))}
                      </td>
                      <td className="max-w-[160px] truncate px-3 py-2.5">
                        {r.channel?.name ?? t('common.noValue')}
                      </td>
                      <td className="px-3 py-2.5">{sourceLabel(r.source)}</td>
                      <td className="px-3 py-2.5">
                        <RunStatusChip status={r.status} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">{when(r.startedAt)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">{when(r.lastActivityAt)}</td>
                      <td
                        className="px-3 py-2.5 text-end font-mono tabular-nums"
                        title={t('runs.repliesHint')}
                      >
                        {r.replies}
                      </td>
                      <td className="px-3 py-2.5 text-end font-mono tabular-nums">{r.steps}</td>
                      <td className="px-3 py-2.5 text-end">
                        {canManage && isLive(r.status) && (
                          <Button variant="secondary" size="sm" onClick={() => setPending(r)}>
                            {t('runs.cancel')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted-foreground">
              <span aria-live="polite">{t('runs.showing', { count: list.items.length })}</span>
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

      <ConfirmDialog
        open={pending !== null}
        title={t('runs.cancelTitle')}
        message={
          pending
            ? t('runs.cancelBody', {
                contact: contactLabel(
                  pending.contact,
                  pending.peerKey || t('common.unknownContact'),
                ),
                flow: flowName(pending),
              })
            : ''
        }
        confirmLabel={t('runs.cancelConfirm')}
        cancelLabel={t('runs.cancelKeep')}
        tone="danger"
        busy={busy}
        onConfirm={() => void confirmCancel()}
        onClose={() => setPending(null)}
      />
    </main>
  );
}
