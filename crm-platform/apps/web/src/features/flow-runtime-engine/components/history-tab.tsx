'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, EmptyState, Input, Spinner, cn, useToast } from '@crm/ui';
import { FLOW_SUBSCRIBER_STATUSES, FLOW_RETRY_COOLDOWN_SECONDS } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useHistory } from '../api/flow-runtime';
import {
  DEFAULT_ANALYTICS_STATE,
  MAX_BATCH,
  fillBatch,
  historyFiltered,
  toggleBatch,
  type AnalyticsState,
} from '../lib/history-model';
import { contactLabel, shortId } from '../lib/model';
import {
  CARD,
  KICKER,
  SubscriberStatusChip,
  TH,
  useDateTime,
  useDuration,
  useErrorText,
  useReasonText,
} from './parts';
import { useRetryActions } from './use-retry';

export type GoFn = (patch: Partial<AnalyticsState>) => void;

const CHIP = 'rounded-full px-3 py-1.5 text-xs font-semibold';
const CHIP_ON = 'bg-brand text-brand-foreground';
const CHIP_OFF = 'border border-border hover:bg-muted';

/**
 * The execution history tab (TW-FLR-054): every contact's pass through a flow, with status tabs and counts, a search, custom dates
 * that override the period, a cursor "Load more", per-row retry and a capped bulk retry (TW-FLR-057, 058).
 */
export function HistoryTab({ state, go }: { state: AnalyticsState; go: GoFn }) {
  const t = useTranslations('flr.hist');
  const tc = useTranslations('flr.common');
  const tr = useTranslations('flr.retry');
  const ts = useTranslations('flr.subscriberStatus');
  const canManage = useCan('flr.runs.manage');
  const { toast } = useToast();
  const when = useDateTime();
  const dur = useDuration();
  const errText = useErrorText();
  const reasonText = useReasonText();
  const list = useHistory(state);
  const [selected, setSelected] = useState<string[]>([]);
  const retry = useRetryActions(() => setSelected([]));

  // The search box is typed into freely (`typed`) and written to the address once the typing pauses; null means "as in the address".
  const [typed, setTyped] = useState<string | null>(null);
  const q = typed ?? state.q;
  useEffect(() => {
    if (typed === null || typed === state.q) return;
    const id = setTimeout(() => go({ q: typed }), 300);
    return () => clearTimeout(id);
  }, [typed, state.q, go]);

  const counts = list.counts;
  const total = counts ? (state.status === 'all' ? counts.all : counts[state.status]) : 0;
  const retryable = list.items.filter((r) => r.canRetry).map((r) => r.id);
  const allPicked = retryable.length > 0 && retryable.every((id) => selected.includes(id));
  const filtered = historyFiltered(state);

  const pick = (id: string) => {
    const r = toggleBatch(selected, id);
    if (r.capped) toast(tr('capReached', { n: MAX_BATCH }), 'danger');
    setSelected(r.ids);
  };
  const pickAll = (on: boolean) => {
    if (!on) return setSelected((s) => s.filter((id) => !retryable.includes(id)));
    const r = fillBatch(selected, retryable);
    if (r.capped) toast(tr('capReached', { n: MAX_BATCH }), 'info');
    setSelected(r.ids);
  };

  return (
    <section className={CARD} aria-labelledby="flr-hist-title">
      <div className="border-b border-border px-5 py-4">
        <div className={KICKER}>{t('kicker')}</div>
        <h2 id="flr-hist-title" className="mt-1 text-xl leading-tight">
          {t('title')}
        </h2>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('colStatus')}>
          {(['all', ...FLOW_SUBSCRIBER_STATUSES] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={state.status === s}
              onClick={() => go({ status: s })}
              className={cn(CHIP, state.status === s ? CHIP_ON : CHIP_OFF)}
            >
              {s === 'all' ? t('all') : ts(s)}
              <span className="ms-1 font-mono text-[11px]">{counts ? counts[s] : '—'}</span>
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {t('from')}
            <Input
              type="date"
              className="h-8 w-auto rounded-full px-2.5 text-xs"
              value={state.from}
              max={state.to || undefined}
              onChange={(e) => go({ from: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {t('to')}
            <Input
              type="date"
              className="h-8 w-auto rounded-full px-2.5 text-xs"
              value={state.to}
              min={state.from || undefined}
              onChange={(e) => go({ to: e.target.value })}
            />
          </label>
          <Input
            type="search"
            aria-label={t('searchLabel')}
            placeholder={t('search')}
            maxLength={120}
            className="h-8 w-full rounded-full text-xs sm:w-64"
            value={q}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
      </div>
      <p className="px-5 pb-3 pt-2 text-[11px] text-muted-foreground">{t('customDates')}</p>

      {canManage && selected.length > 0 && (
        <div
          role="region"
          aria-live="polite"
          className="flex flex-wrap items-center gap-3 border-y border-border bg-muted/60 px-5 py-3"
        >
          <span className="text-[12.5px]">{t('bulkSelected', { count: selected.length })}</span>
          <span className="text-[11px] text-muted-foreground">
            {t('bulkLimits', { n: MAX_BATCH, s: FLOW_RETRY_COOLDOWN_SECONDS })}
          </span>
          <div className="flex-1" />
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full"
            onClick={() => setSelected([])}
          >
            {t('bulkClear')}
          </Button>
          <Button
            size="sm"
            className="rounded-full"
            disabled={retry.busy}
            onClick={() => retry.ask(selected)}
          >
            {t('bulkRetry')}
          </Button>
        </div>
      )}

      {list.isPending ? (
        <div className="flex justify-center p-10">
          <Spinner label={tc('loading')} />
        </div>
      ) : list.isError ? (
        <div className="p-4">
          <EmptyState
            title={t('loadError')}
            message={errText(list.error, tc('loadError'))}
            actions={
              <Button variant="secondary" onClick={() => void list.refetch()}>
                {tc('retry')}
              </Button>
            }
          />
        </div>
      ) : list.items.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title={filtered ? t('emptyTitle') : t('emptyNoneTitle')}
            message={filtered ? t('emptyBody') : t('emptyNoneBody')}
            actions={
              filtered && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setTyped(null);
                    go({
                      status: DEFAULT_ANALYTICS_STATE.status,
                      q: '',
                      from: '',
                      to: '',
                      flowId: '',
                    });
                  }}
                >
                  {t('reset')}
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
                  {canManage && (
                    <th className="w-10 px-3 py-2.5">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--primary)]"
                        aria-label={t('selectAll')}
                        title={t('selectAll')}
                        checked={allPicked}
                        disabled={retryable.length === 0}
                        onChange={(e) => pickAll(e.target.checked)}
                      />
                    </th>
                  )}
                  <th className={TH}>{t('colContact')}</th>
                  <th className={TH}>{t('colFlow')}</th>
                  <th className={TH}>{t('colStatus')}</th>
                  <th className={TH}>{t('colEnrolled')}</th>
                  <th className={TH}>{t('colFinished')}</th>
                  <th className={TH}>{t('colDuration')}</th>
                  <th className={`${TH} text-end`}>{t('colRetries')}</th>
                  <th className={TH}>
                    <span className="sr-only">{t('colAction')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border align-top">
                {list.items.map((r) => {
                  const name = contactLabel(r.contact, r.contact.phone ?? t('noContact'));
                  const finished = r.status === 'failed' ? r.failedAt : r.completedAt;
                  return (
                    <tr key={r.id} className="hover:bg-muted/50">
                      {canManage && (
                        <td className="px-3 py-2.5">
                          {r.canRetry && (
                            <input
                              type="checkbox"
                              className="size-4 accent-[var(--primary)]"
                              aria-label={t('selectRow', { contact: name })}
                              checked={selected.includes(r.id)}
                              onChange={() => pick(r.id)}
                            />
                          )}
                        </td>
                      )}
                      <td className="max-w-[220px] px-3 py-2.5">
                        <div className="truncate font-semibold">{name}</div>
                        {r.contact.phone && (
                          <div className="font-mono text-[10.5px] text-muted-foreground">
                            {r.contact.phone}
                          </div>
                        )}
                      </td>
                      <td className="max-w-[220px] px-3 py-2.5">
                        <Link
                          href={`/flow-runtime/flows/${r.flowId}`}
                          className="block truncate hover:underline"
                        >
                          {r.flowName || tc('unknownFlow', { id: shortId(r.flowId) })}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        <SubscriberStatusChip status={r.status} />
                        {r.status === 'failed' && (
                          <div className="mt-1 max-w-[260px] break-words text-[11px] leading-snug text-danger">
                            {reasonText(r.failureReason)}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">{when(r.enrolledAt)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">{when(finished)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">{dur(r.durationSeconds)}</td>
                      <td className="px-3 py-2.5 text-end font-mono tabular-nums">
                        {r.retryCount}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-end">
                        <div className="flex justify-end gap-2">
                          {r.lastRunId && (
                            <Link
                              href={`/flow-runtime/runs/${r.lastRunId}`}
                              className="inline-flex h-8 items-center text-xs font-semibold text-brand hover:underline"
                            >
                              {t('openRun')}
                            </Link>
                          )}
                          {canManage && r.canRetry && (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={retry.busy}
                              onClick={() => retry.ask([r.id])}
                            >
                              {t('retry')}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted-foreground">
            <span aria-live="polite">{t('showing', { shown: list.items.length, total })}</span>
            {list.hasNextPage && (
              <Button
                variant="secondary"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? tc('loadingMore') : tc('loadMore')}
              </Button>
            )}
          </div>
        </>
      )}
      {retry.dialog}
    </section>
  );
}
