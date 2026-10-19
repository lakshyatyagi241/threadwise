'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Card, cn } from '@crm/ui';
import { DPDP_PENALTY_TIERS, type DpdpItemStatus, type DpdpRegisterResponse } from '@crm/contracts';
import { barShares, statusCounts } from './logic';

const NS = 'dpdp-register-admin';

/** The colour of a status in the bar and beside its count. The text label always sits next to it: colour is never the only signal. */
const SWATCH: Record<DpdpItemStatus, string> = {
  not_following: 'bg-danger',
  partial: 'bg-warning',
  unverified: 'bg-muted-foreground/50',
  following: 'bg-success',
  not_applicable: 'border border-border bg-background',
};

/** The columns of the penalty-tier table. */
const TIER_COLUMNS = ['notFollowing', 'partial', 'unverified'] as const;
const COLUMN_STATUS = {
  notFollowing: 'not_following',
  partial: 'partial',
  unverified: 'unverified',
} as const satisfies Record<(typeof TIER_COLUMNS)[number], DpdpItemStatus>;

/**
 * The top of the register: the five status counts with a stacked bar, the days left to each commencement date, and how many
 * obligations are not followed, partial or unverified under each penalty tier. Everything comes from the payload.
 */
export function SummaryStrip({ register }: { register: DpdpRegisterResponse }) {
  const t = useTranslations(NS);
  const format = useFormatter();
  const { summary, milestones } = register;

  return (
    <section aria-label={t('summary.label')} className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-sm font-semibold">{t('summary.counts.title')}</h2>
          <p className="text-xs text-muted-foreground">
            {t('summary.counts.counted', { total: summary.total })}
          </p>
        </div>
        <div aria-hidden="true" className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
          {barShares(summary).map(({ status, percent }) => (
            <div
              key={status}
              data-bar-status={status}
              className={SWATCH[status]}
              style={{ width: `${percent}%` }}
            />
          ))}
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {statusCounts(register).map(({ status, count }) => (
            <div key={status} className="flex flex-col-reverse">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  aria-hidden="true"
                  className={cn('size-2.5 shrink-0 rounded-sm', SWATCH[status])}
                />
                {t(`status.${status}`)}
              </dt>
              <dd className="text-2xl font-semibold tabular-nums">{format.number(count)}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">{t('summary.counts.notCounted')}</p>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">{t('summary.milestones.title')}</h2>
          <ul className="space-y-3">
            {milestones.map((m) => {
              const nameKey = `summary.milestones.names.${m.id}`;
              return (
                <li key={m.id} className="space-y-0.5">
                  <p className="text-sm font-medium">{t.has(nameKey) ? t(nameKey) : m.id}</p>
                  <p className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                    <time dateTime={m.date}>
                      {format.dateTime(new Date(`${m.date}T00:00:00Z`), {
                        dateStyle: 'medium',
                        timeZone: 'UTC',
                      })}
                    </time>
                    <span>
                      {m.passed
                        ? t('summary.milestones.passed')
                        : t('summary.milestones.left', { days: m.daysLeft })}
                    </span>
                  </p>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">{t('summary.tiers.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('summary.tiers.hint')}</p>
          </div>
          <div className="overflow-x-auto">
            <table aria-label={t('summary.tiers.title')} className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th scope="col" className="py-1.5 pe-3 text-start font-medium">
                    {t('summary.tiers.tier')}
                  </th>
                  {TIER_COLUMNS.map((column) => (
                    <th key={column} scope="col" className="px-2 py-1.5 text-end font-medium">
                      {t(`status.${COLUMN_STATUS[column]}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DPDP_PENALTY_TIERS.map((tier) => (
                  <tr key={tier} className="border-b border-border last:border-0">
                    <th
                      scope="row"
                      className="whitespace-nowrap py-1.5 pe-3 text-start font-normal"
                    >
                      {t(`tiers.${tier}`)}
                    </th>
                    {TIER_COLUMNS.map((column) => (
                      <td key={column} className="px-2 py-1.5 text-end tabular-nums">
                        {format.number(summary.byTier[tier][column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </section>
  );
}
