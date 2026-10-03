'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, EmptyState, Spinner, cn } from '@crm/ui';
import type { FlowErrorGroups } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useErrorGroups, useFailedRows } from '../api/flow-runtime';
import type { AnalyticsState } from '../lib/history-model';
import { contactLabel, shortId } from '../lib/model';
import { CARD, KICKER, TH, useDateTime, useErrorText } from './parts';
import type { GoFn } from './history-tab';
import { useRetryActions } from './use-retry';

const groupKey = (g: FlowErrorGroups['groups'][number]) => g.reason ?? '';

/**
 * The error logs tab (WD-FLR-055): five totals, the failed runs grouped by reason (expand one to see the flows it hit, retry its
 * contacts or open them in the execution history), and the raw failed runs underneath.
 */
export function ErrorsTab({ state, go }: { state: AnalyticsState; go: GoFn }) {
  const t = useTranslations('flr.errlog');
  const tc = useTranslations('flr.common');
  const ta = useTranslations('flr.analytics');
  const canManage = useCan('flr.runs.manage');
  const when = useDateTime();
  const errText = useErrorText();
  const groups = useErrorGroups(state);
  const rows = useFailedRows(state);
  const retry = useRetryActions();
  const base = useId();
  const [open, setOpen] = useState<string[]>([]);
  const toggle = (k: string) =>
    setOpen((o) => (o.includes(k) ? o.filter((x) => x !== k) : [...o, k]));

  const d = groups.data;
  const tiles: Array<[string, number | undefined]> = [
    [t('tileFailed'), d?.totals.failed],
    [t('tileReasons'), d?.totals.distinctReasons],
    [t('tileFlows'), d?.totals.affectedFlows],
    [t('tileContacts'), d?.totals.affectedContacts],
    [t('tileRetried'), d?.totals.retried],
  ];
  const failed = (
    <EmptyState
      title={t('loadError')}
      message={errText(groups.error, tc('loadError'))}
      actions={
        <Button variant="secondary" onClick={() => void groups.refetch()}>
          {tc('retry')}
        </Button>
      }
    />
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map(([label, value]) => (
          <div key={label} className={`${CARD} px-4 py-3`}>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 font-mono text-2xl tabular-nums">
              {value === undefined ? tc('noValue') : value.toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      <section className={CARD} aria-labelledby="flr-err-title">
        <div className="border-b border-border px-5 py-4">
          <div className={KICKER}>{t('kicker')}</div>
          <h2 id="flr-err-title" className="mt-1 text-xl leading-tight">
            {t('title')}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('hint')}</p>
        </div>
        {groups.isPending ? (
          <div className="flex justify-center p-10">
            <Spinner label={tc('loading')} />
          </div>
        ) : groups.isError || !d ? (
          <div className="p-4">{failed}</div>
        ) : d.groups.length === 0 ? (
          <div className="p-4">
            <EmptyState title={t('emptyTitle')} message={t('emptyBody')} />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {d.groups.map((g, i) => {
              const k = groupKey(g);
              const isOpen = open.includes(k);
              const panel = `${base}-${i}`;
              return (
                <li key={k} className="px-5 py-4">
                  <button
                    type="button"
                    className="flex w-full items-start gap-3 text-start"
                    aria-expanded={isOpen}
                    aria-controls={panel}
                    aria-label={`${g.reason ?? t('noReason')}: ${t('expand')}`}
                    onClick={() => toggle(k)}
                  >
                    <span className="shrink-0 rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[11px] text-danger">
                      {g.count.toLocaleString()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-[13px] font-semibold leading-snug">
                        {g.reason ?? t('noReason')}
                      </span>
                      {g.lastSeen && (
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          {g.firstSeen
                            ? ta('seenBoth', { first: when(g.firstSeen), last: when(g.lastSeen) })
                            : ta('seenLast', { last: when(g.lastSeen) })}
                        </span>
                      )}
                    </span>
                    <span
                      aria-hidden
                      className="shrink-0 font-mono text-[11px] text-muted-foreground"
                    >
                      {isOpen ? '−' : '+'}
                    </span>
                  </button>
                  <div id={panel} hidden={!isOpen} className="mt-3 space-y-3 ps-9">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {g.flows.map((f) => (
                        <Link
                          key={f.flowId}
                          href={`/flow-runtime/flows/${f.flowId}`}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11.5px] hover:bg-muted"
                        >
                          <span>{f.flowName || tc('unknownFlow', { id: shortId(f.flowId) })}</span>
                          <b className="font-mono">{f.count.toLocaleString()}</b>
                        </Link>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {canManage && g.subscriberIds.length > 0 && (
                        <Button
                          size="sm"
                          className="rounded-full"
                          disabled={retry.busy}
                          onClick={() => retry.ask(g.subscriberIds)}
                        >
                          {t('retryRuns', { n: g.subscriberIds.length })}
                        </Button>
                      )}
                      {g.reason && (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="rounded-full"
                          onClick={() =>
                            go({ tab: 'history', status: 'failed', q: g.reason ?? '' })
                          }
                        >
                          {t('showRuns')}
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={`${CARD} overflow-hidden`} aria-labelledby="flr-raw-title">
        <div className="border-b border-border px-5 py-4">
          <div className={KICKER}>{t('rawKicker')}</div>
          <h2 id="flr-raw-title" className="mt-1 text-xl leading-tight">
            {t('rawTitle')}
          </h2>
        </div>
        {rows.isPending ? (
          <div className="flex justify-center p-10">
            <Spinner label={tc('loading')} />
          </div>
        ) : rows.isError ? (
          <div className="p-4">
            <EmptyState
              title={t('loadError')}
              message={errText(rows.error, tc('loadError'))}
              actions={
                <Button variant="secondary" onClick={() => void rows.refetch()}>
                  {tc('retry')}
                </Button>
              }
            />
          </div>
        ) : rows.items.length === 0 ? (
          <div className="p-4">
            <EmptyState title={t('rawEmptyTitle')} message={t('rawEmptyBody')} />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-[12.5px]">
                <thead className="border-b border-border bg-muted text-muted-foreground">
                  <tr>
                    <th className={TH}>{t('colContact')}</th>
                    <th className={TH}>{t('colFlow')}</th>
                    <th className={TH}>{t('colFailedAt')}</th>
                    <th className={TH}>{t('colReason')}</th>
                    <th className={`${TH} text-end`}>{t('colRetries')}</th>
                    <th className={TH}>
                      <span className="sr-only">{t('colAction')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border align-top">
                  {rows.items.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/50">
                      <td className="max-w-[220px] px-3 py-2.5">
                        <div className="truncate font-semibold">
                          {contactLabel(r.contact, r.contact.phone ?? tc('unknownContact'))}
                        </div>
                        {r.contact.phone && (
                          <div className="font-mono text-[10.5px] text-muted-foreground">
                            {r.contact.phone}
                          </div>
                        )}
                      </td>
                      <td className="max-w-[220px] truncate px-3 py-2.5">{r.flowName}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11.5px]">
                        {when(r.failedAt)}
                      </td>
                      <td className={cn('break-words px-3 py-2.5 leading-snug text-danger')}>
                        {r.failureReason || t('noReason')}
                      </td>
                      <td className="px-3 py-2.5 text-end font-mono tabular-nums">
                        {r.retryCount}
                      </td>
                      <td className="px-3 py-2.5 text-end">
                        {canManage && r.canRetry && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={retry.busy}
                            onClick={() => retry.ask([r.id])}
                          >
                            {t('retryRow')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted-foreground">
              <span aria-live="polite">
                {t('showing', {
                  shown: rows.items.length,
                  total: d?.totals.failed ?? rows.items.length,
                })}
              </span>
              {rows.hasNextPage && (
                <Button
                  variant="secondary"
                  disabled={rows.isFetchingNextPage}
                  onClick={() => void rows.fetchNextPage()}
                >
                  {rows.isFetchingNextPage ? tc('loadingMore') : tc('loadMore')}
                </Button>
              )}
            </div>
          </>
        )}
      </section>
      {retry.dialog}
    </div>
  );
}
