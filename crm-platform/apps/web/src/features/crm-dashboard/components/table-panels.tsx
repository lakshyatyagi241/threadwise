'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { CrmDashboardResponse } from '@crm/contracts';
import { cn } from '@crm/ui';
import { Panel } from '@/features/dashboards-analytics-charts/components/parts';
import { moneyText } from '../lib/format';
import { links } from '../lib/query';

const TH = 'px-3 py-2 text-start text-xs font-medium text-muted-foreground';
const TD = 'px-3 py-2 tabular-nums';

function Table({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[28rem] text-sm" aria-label={label}>
        {children}
      </table>
    </div>
  );
}

/** Owners ranked by won value in the period (the owner filter and the viewer's record scope already apply). A name opens that person's deals. */
export function LeaderboardPanel({
  rows,
  pipeline,
  currency,
}: {
  rows: NonNullable<CrmDashboardResponse['deals']>['leaderboard'];
  pipeline: string;
  currency: string;
}) {
  const t = useTranslations('crm-dashboard.leaderboard');
  const locale = useLocale();
  return (
    <Panel title={t('title')} subtitle={t('subtitle')}>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <Table label={t('title')}>
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>#</th>
              <th className={TH}>{t('owner')}</th>
              <th className={cn(TH, 'text-end')}>{t('won')}</th>
              <th className={cn(TH, 'text-end')}>{t('value')}</th>
              <th className={cn(TH, 'text-end')}>{t('lost')}</th>
              <th className={cn(TH, 'text-end')}>{t('open')}</th>
              <th className={cn(TH, 'text-end')}>{t('activities')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.owner?.id ?? 'none'} className="border-b border-border last:border-0">
                <td className={cn(TD, 'text-muted-foreground')}>{i + 1}</td>
                <td className="px-3 py-2">
                  {r.owner ? (
                    <Link
                      href={links.deals({ owner: r.owner.id, pipeline })}
                      className="font-medium hover:underline"
                    >
                      {r.owner.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{t('unowned')}</span>
                  )}
                </td>
                <td className={cn(TD, 'text-end')}>{r.wonCount}</td>
                <td className={cn(TD, 'text-end font-medium')}>
                  {moneyText(r.wonValue, locale, currency, { compact: true })}
                </td>
                <td className={cn(TD, 'text-end')}>{r.lostCount}</td>
                <td className={cn(TD, 'text-end')}>{r.openCount}</td>
                <td className={cn(TD, 'text-end')}>{r.activities}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}

/** Lead sources: how many leads each brought in the period and how far they got. */
export function SourcesPanel({
  rows,
  currency,
}: {
  rows: NonNullable<CrmDashboardResponse['contacts']>['sources'];
  currency: string;
}) {
  const t = useTranslations('crm-dashboard.sources');
  const locale = useLocale();
  return (
    <Panel title={t('title')} subtitle={t('subtitle')}>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <Table label={t('title')}>
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>{t('source')}</th>
              <th className={cn(TH, 'text-end')}>{t('leads')}</th>
              <th className={cn(TH, 'text-end')}>{t('toDeal')}</th>
              <th className={cn(TH, 'text-end')}>{t('toWon')}</th>
              <th className={cn(TH, 'text-end')}>{t('wonValue')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.source ?? 'none'} className="border-b border-border last:border-0">
                <td className="px-3 py-2 font-medium">{r.source ?? t('none')}</td>
                <td className={cn(TD, 'text-end')}>{r.leads}</td>
                <td className={cn(TD, 'text-end')}>
                  {r.dealRate}%<span className="ms-1 text-xs text-muted-foreground">({r.withDeal})</span>
                </td>
                <td className={cn(TD, 'text-end')}>
                  {r.wonRate}%<span className="ms-1 text-xs text-muted-foreground">({r.withWonDeal})</span>
                </td>
                <td className={cn(TD, 'text-end')}>
                  {moneyText(r.wonValue, locale, currency, { compact: true })}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}

/** Open tasks by assignee (overdue and due later today), and the next ones due (Reference's "Upcoming tasks"). */
export function TasksPanel({ tasks }: { tasks: NonNullable<CrmDashboardResponse['tasks']> }) {
  const t = useTranslations('crm-dashboard.tasks');
  const locale = useLocale();
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(iso));
  return (
    <Panel
      title={t('title')}
      subtitle={t('subtitle', { open: tasks.open, overdue: tasks.overdue, today: tasks.dueToday })}
      action={
        <Link href={links.tasks()} className="text-xs font-medium text-primary hover:underline">
          {t('all')}
        </Link>
      }
    >
      {tasks.byAssignee.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <Table label={t('byAssignee')}>
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>{t('assignee')}</th>
              <th className={cn(TH, 'text-end')}>{t('open')}</th>
              <th className={cn(TH, 'text-end')}>{t('overdue')}</th>
              <th className={cn(TH, 'text-end')}>{t('dueToday')}</th>
            </tr>
          </thead>
          <tbody>
            {tasks.byAssignee.map((r) => (
              <tr key={r.assignee?.id ?? 'none'} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  <Link
                    href={links.tasks({ tab: 'all', assignee: r.assignee?.id ?? 'none' })}
                    className="font-medium hover:underline"
                  >
                    {r.assignee?.name ?? t('unassigned')}
                  </Link>
                </td>
                <td className={cn(TD, 'text-end')}>{r.open}</td>
                <td className={cn(TD, 'text-end', r.overdue > 0 && 'font-medium text-danger')}>
                  {r.overdue}
                </td>
                <td className={cn(TD, 'text-end')}>{r.dueToday}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {tasks.upcoming.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">{t('upcoming')}</h3>
          <ul className="space-y-1.5">
            {tasks.upcoming.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{u.title}</span>
                <span
                  className={cn(
                    'shrink-0 text-xs tabular-nums',
                    u.overdue ? 'font-medium text-danger' : 'text-muted-foreground',
                  )}
                >
                  {u.overdue ? `${t('overdueTag')} · ` : ''}
                  {date(u.dueAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
