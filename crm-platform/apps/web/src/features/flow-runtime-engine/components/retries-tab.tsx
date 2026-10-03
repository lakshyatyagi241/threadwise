'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge, Button, EmptyState, Spinner, cn } from '@crm/ui';
import { FLOW_RETRY_OUTCOMES, type FlowRetryOutcome } from '@crm/contracts';
import { useRetryRecords } from '../api/flow-runtime';
import { outcomeTone, type AnalyticsState } from '../lib/history-model';
import { contactLabel, shortId } from '../lib/model';
import { CARD, KICKER, TH, useDateTime, useErrorText, useReasonText } from './parts';
import type { GoFn } from './history-tab';

const CHIP = 'rounded-full px-3 py-1.5 text-xs font-semibold';

/**
 * The retry records tab (WD-FLR-056): every attempt to run a failed run again, newest first, with an outcome chip row whose
 * counts ignore the chosen outcome (so picking one never zeroes the others).
 */
export function RetriesTab({ state, go }: { state: AnalyticsState; go: GoFn }) {
  const t = useTranslations('flr.retries');
  const tc = useTranslations('flr.common');
  const when = useDateTime();
  const errText = useErrorText();
  const reasonText = useReasonText();
  const list = useRetryRecords(state);
  const totals = list.totals;
  // "Skipped" is ours (a launch that neither started nor failed); the chip appears only once one exists.
  const outcomes = FLOW_RETRY_OUTCOMES.filter((o) => o !== 'skipped' || (totals?.skipped ?? 0) > 0);

  return (
    <section className={`${CARD} overflow-hidden`} aria-labelledby="flr-retries-title">
      <div className="border-b border-border px-5 py-4">
        <div className={KICKER}>{t('kicker')}</div>
        <h2 id="flr-retries-title" className="mt-1 text-xl leading-tight">
          {t('title')}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t('hint')}</p>
      </div>
      <div
        className="flex flex-wrap gap-1.5 border-b border-border px-5 py-3"
        role="group"
        aria-label={t('chipsLabel')}
      >
        {(['all', ...outcomes] as const).map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={state.outcome === o}
            onClick={() => go({ outcome: o })}
            className={cn(
              CHIP,
              state.outcome === o
                ? 'bg-brand text-brand-foreground'
                : 'border border-border hover:bg-muted',
            )}
          >
            {o === 'all' ? t('all') : t(`outcome.${o}`)}
            <span className="ms-1 font-mono text-[11px]">{totals ? totals[o] : '—'}</span>
          </button>
        ))}
      </div>

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
          <EmptyState title={t('emptyTitle')} message={t('emptyBody')} />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[12.5px]">
              <thead className="border-b border-border bg-muted text-muted-foreground">
                <tr>
                  <th className={TH}>{t('colWhen')}</th>
                  <th className={TH}>{t('colRun')}</th>
                  <th className={TH}>{t('colFlow')}</th>
                  <th className={TH}>{t('colContact')}</th>
                  <th className={TH}>{t('colBy')}</th>
                  <th className={TH}>{t('colPrevious')}</th>
                  <th className={TH}>{t('colOutcome')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border align-top">
                {list.items.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/50">
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11.5px]">
                      {when(r.createdAt)}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11.5px]">
                      #{shortId(r.subscriberId)}
                    </td>
                    <td className="max-w-[200px] px-3 py-2.5">
                      <Link
                        href={`/flow-runtime/flows/${r.flowId}`}
                        className="block truncate hover:underline"
                      >
                        {r.flowName || tc('unknownFlow', { id: shortId(r.flowId) })}
                      </Link>
                    </td>
                    <td className="max-w-[200px] px-3 py-2.5">
                      <div className="truncate">
                        {r.contact
                          ? contactLabel(r.contact, r.contact.phone ?? t('noContact'))
                          : t('noContact')}
                      </div>
                      {r.contact?.phone && (
                        <div className="font-mono text-[10.5px] text-muted-foreground">
                          {r.contact.phone}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.retriedBy ?? (r.source === 'system' ? t('system') : t('unknown'))}
                    </td>
                    <td className="max-w-[260px] break-words px-3 py-2.5 leading-snug text-muted-foreground">
                      {r.previousFailureReason
                        ? reasonText(r.previousFailureReason)
                        : tc('noValue')}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={outcomeTone(r.outcome as FlowRetryOutcome)}>
                        {t(`outcome.${r.outcome}`)}
                      </Badge>
                      {r.outcomeReason && (
                        <div className="mt-1 max-w-[260px] break-words text-[11px] leading-snug text-muted-foreground">
                          {r.outcomeReason}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted-foreground">
            <span aria-live="polite">{t('showing', { count: list.items.length })}</span>
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
    </section>
  );
}
