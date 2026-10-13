'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { LscRun, LscRunStatus } from '@crm/contracts';
import { Badge, cn } from '@crm/ui';
import { formatCostUsd, formatCount } from '../lib/cost';
import { hasSpend, isProblem, reasonOf, scoreChange } from '../lib/runs-model';
import { useFormatDate } from './parts';

const STATUS_TONE: Record<LscRunStatus, 'success' | 'neutral' | 'danger' | 'warning'> = {
  ok: 'success',
  kept: 'neutral',
  failed: 'danger',
  skipped: 'warning',
};

/**
 * The scoring log: one row per attempt with what it did and what it cost. `compact` is the history on one contact's page (no
 * contact or key columns).
 */
export function RunsTable({
  runs,
  compact = false,
  caption,
}: {
  runs: readonly LscRun[];
  compact?: boolean;
  caption: string;
}) {
  const t = useTranslations('lead-scoring.runs');
  const locale = useLocale();
  const fmt = useFormatDate();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-start text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('col.when')}
            </th>
            {!compact && (
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t('col.contact')}
              </th>
            )}
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('col.result')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('col.score')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('col.trigger')}
            </th>
            <th scope="col" className="px-3 py-2 text-end font-medium">
              {t('col.tokens')}
            </th>
            <th scope="col" className="px-3 py-2 text-end font-medium">
              {t('col.cost')}
            </th>
            {!compact && (
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t('col.key')}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const change = scoreChange(r);
            const reason = reasonOf(r.error);
            const tokens = r.promptTokens + r.completionTokens;
            return (
              <tr key={r.id} className="border-b border-border last:border-0 align-top">
                <td className="whitespace-nowrap px-3 py-2">
                  <time dateTime={r.createdAt}>{fmt(r.createdAt)}</time>
                </td>
                {!compact && (
                  <td className="max-w-56 px-3 py-2">
                    {r.contactId ? (
                      <Link
                        href={`/contacts/${r.contactId}`}
                        className="block truncate font-medium outline-none hover:text-primary hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {r.contactName || t('unnamed')}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{t('deletedContact')}</span>
                    )}
                  </td>
                )}
                <td className="px-3 py-2">
                  <Badge tone={STATUS_TONE[r.status]}>{t(`status.${r.status}`)}</Badge>
                  {isProblem(r.status) && reason && (
                    <p className="mt-1 max-w-64 text-xs text-muted-foreground">
                      {t(`reason.${reason}`)}
                    </p>
                  )}
                  {r.status === 'kept' && (
                    <p className="mt-1 max-w-64 text-xs text-muted-foreground">{t('keptNote')}</p>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  {change ?? <span className="text-muted-foreground">—</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2">{t(`trigger.${r.trigger}`)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-end tabular-nums">
                  {hasSpend(r) ? (
                    <span
                      title={t('tokensDetail', {
                        prompt: r.promptTokens,
                        completion: r.completionTokens,
                      })}
                    >
                      {formatCount(tokens, locale)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-end tabular-nums">
                  {hasSpend(r) ? (
                    <span
                      title={t(`costSource.${r.costSource === 'vendor' ? 'vendor' : 'estimate'}`)}
                      className={cn(r.costSource === 'estimate' && 'italic')}
                    >
                      {formatCostUsd(r.costUsd, locale)}
                      {r.costSource === 'estimate' && <span aria-hidden="true"> ~</span>}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                {!compact && (
                  <td className="whitespace-nowrap px-3 py-2">
                    {r.billedAgainst === 'none' ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      t(`billed.${r.billedAgainst}`)
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
