'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { BillingPlan } from '@crm/contracts';
import { cn } from '@crm/ui';
import { compareRows } from '../lib/format';

const NS = 'plans-subscriptions-trials';
const COLLAPSED_ROWS = 12;

/**
 * "Compare plans" (WD-PLAN-011): every cap at least one plan sets, then every capability at least one plan enables, one column per
 * plan, the highlighted plan tinted. Collapsed behind "Show all" past 12 rows. Hidden for fewer than two plans.
 */
export function CompareTable({ plans }: { plans: readonly BillingPlan[] }) {
  const t = useTranslations(`${NS}.plans.compare`);
  const tl = useTranslations(`${NS}.limits`);
  const tf = useTranslations(`${NS}.features`);
  const tc = useTranslations(`${NS}.common`);
  const locale = useLocale();
  const [all, setAll] = useState(false);
  if (plans.length < 2) return null;

  const { limits, flags } = compareRows(plans);
  const rows = [
    ...limits.map((key) => ({ kind: 'limit' as const, key })),
    ...flags.map((key) => ({ kind: 'flag' as const, key })),
  ];
  const shown = all ? rows : rows.slice(0, COLLAPSED_ROWS);

  return (
    <section aria-labelledby="compare-title" className="space-y-3">
      <h2 id="compare-title" className="text-lg font-semibold">
        {t('title')}
      </h2>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-start">
              <th scope="col" className="px-4 py-3 text-start font-medium">
                {t('feature')}
              </th>
              {plans.map((p) => (
                <th
                  key={p.slug}
                  scope="col"
                  className={cn(
                    'px-4 py-3 text-start font-semibold',
                    p.highlighted && 'bg-primary/10',
                  )}
                >
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={`${row.kind}-${row.key}`} className="border-b border-border last:border-0">
                <th scope="row" className="px-4 py-2.5 text-start font-normal">
                  {row.kind === 'limit' ? tl(row.key) : tf(row.key)}
                </th>
                {plans.map((p) => {
                  const value =
                    row.kind === 'limit'
                      ? ((p.limits as Record<string, number>)[row.key] ?? 0)
                      : (p.features as Record<string, boolean>)[row.key]
                        ? 1
                        : 0;
                  return (
                    <td key={p.slug} className={cn('px-4 py-2.5', p.highlighted && 'bg-primary/5')}>
                      {row.kind === 'limit' ? (
                        value > 0 ? (
                          new Intl.NumberFormat(locale).format(value)
                        ) : (
                          tc('unlimited')
                        )
                      ) : value ? (
                        <span className="text-success" aria-label={t('included')}>
                          ✓
                        </span>
                      ) : (
                        <span className="text-muted-foreground" aria-label={t('notIncluded')}>
                          —
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > COLLAPSED_ROWS && (
        <button
          type="button"
          className="text-sm font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
        >
          {all ? t('showLess') : t('showAll', { count: rows.length })}
        </button>
      )}
    </section>
  );
}
