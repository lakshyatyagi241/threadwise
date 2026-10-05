'use client';

import { useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { BillingPlan } from '@crm/contracts';
import { cn } from '@crm/ui';
import { cellValue, compareSections, type CompareRowDef } from '../lib/limits';

const NS = 'plans-subscriptions-trials';

/**
 * "Compare plans" (WD-PLAN-011): one column per plan, one row per limit, capability and visible Marketplace add-on, grouped under header
 * rows. The first column stays put while the plans scroll sideways, the header stays while the rows scroll, and the workspace's
 * current plan is tinted. "Only show differences" drops the rows every plan shares. Hidden for fewer than two plans.
 */
export function CompareTable({ plans }: { plans: readonly BillingPlan[] }) {
  const t = useTranslations(`${NS}.plans.compare`);
  const tl = useTranslations(`${NS}.limits`);
  const tf = useTranslations(`${NS}.features`);
  const tg = useTranslations(`${NS}.limitGroups`);
  const tfg = useTranslations(`${NS}.featureGroups`);
  const tc = useTranslations(`${NS}.common`);
  const locale = useLocale();
  const diffId = useId();
  const [onlyDiff, setOnlyDiff] = useState(false);
  if (plans.length < 2) return null;

  const sections = compareSections(plans, { onlyDiffering: onlyDiff });
  const label = (row: CompareRowDef) =>
    row.kind === 'limit' ? tl(row.key) : row.kind === 'flag' ? tf(row.key) : row.name;
  const sectionTitle = (s: (typeof sections)[number]) =>
    s.title.type === 'limitGroup'
      ? tg(s.title.group)
      : s.title.type === 'featureGroup'
        ? tfg(s.title.group)
        : t('addonsGroup');
  const tint = (p: BillingPlan) =>
    p.current ? 'bg-success/10' : p.highlighted ? 'bg-primary/5' : '';

  return (
    <section aria-labelledby="compare-title" className="space-y-3" data-testid="compare-table">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="compare-title" className="text-lg font-semibold">
          {t('title')}
        </h2>
        <label htmlFor={diffId} className="flex items-center gap-2 text-sm">
          <input
            id={diffId}
            type="checkbox"
            checked={onlyDiff}
            onChange={(e) => setOnlyDiff(e.target.checked)}
            className="size-4 accent-primary"
          />
          {t('onlyDifferences')}
        </label>
      </div>
      <div className="max-h-[75vh] overflow-auto rounded-xl border border-border">
        <table className="w-full min-w-[40rem] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky start-0 top-0 z-30 min-w-40 border-b border-e border-border bg-muted px-4 py-3 text-start font-medium"
              >
                {t('feature')}
              </th>
              {plans.map((p) => (
                <th
                  key={p.slug}
                  scope="col"
                  data-current={p.current}
                  className={cn(
                    'sticky top-0 z-20 min-w-32 border-b border-border bg-muted px-4 py-3 text-start font-semibold',
                    p.current && 'bg-success/20',
                  )}
                >
                  {p.name}
                  {p.current && (
                    <span className="block text-xs font-normal text-muted-foreground">
                      {t('currentPlan')}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.length === 0 && (
              <tr>
                <td
                  colSpan={plans.length + 1}
                  className="px-4 py-6 text-center text-muted-foreground"
                >
                  {t('noDifferences')}
                </td>
              </tr>
            )}
            {sections.map((s) => (
              <SectionRows key={s.id} id={s.id} title={sectionTitle(s)} cols={plans.length}>
                {s.rows.map((row) => (
                  <tr
                    key={`${row.kind}-${row.key}`}
                    data-testid={`compare-row-${row.kind}-${row.key}`}
                  >
                    <th
                      scope="row"
                      className="sticky start-0 z-10 min-w-40 border-b border-e border-border bg-background px-4 py-2.5 text-start font-normal"
                    >
                      {label(row)}
                    </th>
                    {plans.map((p) => {
                      const v = cellValue(p, row);
                      return (
                        <td
                          key={p.slug}
                          className={cn('border-b border-border px-4 py-2.5', tint(p))}
                        >
                          {row.kind === 'limit' ? (
                            v === 'default' ? (
                              tc('platformDefault')
                            ) : v === 'unlimited' ? (
                              tc('unlimited')
                            ) : (
                              new Intl.NumberFormat(locale).format(Number(v))
                            )
                          ) : v === '1' ? (
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
              </SectionRows>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SectionRows({
  id,
  title,
  cols,
  children,
}: {
  id: string;
  title: string;
  cols: number;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr data-testid={`compare-group-${id}`}>
        <th
          scope="colgroup"
          className="sticky start-0 z-10 min-w-40 border-b border-e border-border bg-muted px-4 py-2 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {title}
        </th>
        <td colSpan={cols} className="border-b border-border bg-muted/60" />
      </tr>
      {children}
    </>
  );
}
