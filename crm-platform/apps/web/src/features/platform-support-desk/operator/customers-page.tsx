'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customerDetailResponseSchema, customersResponseSchema } from '@crm/contracts';
import { Badge, Button, Card, Input, StatTile } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { ApiError } from '@/lib/api/errors';
import { PRIORITY_TONE, STATUS_TONE } from '../lib/display';
import { minutesLabel, relativeTime, shortDate } from '../lib/format';

const NS = 'platform-support-desk';

/** Workspaces ranked by support load (TW-SUPP-020). */
export function CustomersPage() {
  const t = useTranslations(`${NS}.customers`);
  const locale = useLocale();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setQ(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const list = useQuery({
    queryKey: ['support', 'operator', 'customers', q],
    queryFn: ({ signal }) =>
      operatorFetch('/support/customers', {
        query: { q },
        schema: customersResponseSchema,
        signal,
      }),
  });

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('subtitle')} />
      {list.isPending && <LoadingBlock />}
      {list.isError && <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label={t('kpi.customers')} value={list.data.kpis.customers} />
            <StatTile label={t('kpi.total')} value={list.data.kpis.total} />
            <StatTile label={t('kpi.open')} value={list.data.kpis.open} />
            <StatTile label={t('kpi.top')} value={list.data.kpis.top} />
          </div>
          <Card className="overflow-x-auto p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
              <h2 className="text-lg font-semibold">{t('list')}</h2>
              <Input
                type="search"
                aria-label={t('filter')}
                placeholder={t('filter')}
                className="w-full max-w-[17rem]"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <table className="w-full text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="p-3 text-start">{t('workspace')}</th>
                  <th className="p-3 text-end">{t('openCol')}</th>
                  <th className="p-3 text-end">{t('totalCol')}</th>
                  <th className="p-3 text-end">{t('avgRes')}</th>
                  <th className="p-3 text-start">{t('last')}</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {list.data.data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground">
                      {t('empty')}
                    </td>
                  </tr>
                )}
                {list.data.data.map((r) => (
                  <tr
                    key={r.workspaceId}
                    className="border-b last:border-0"
                    data-testid="customer-row"
                  >
                    <td className="p-3">
                      <p className="font-semibold">{r.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{r.slug}</p>
                    </td>
                    <td
                      className={`p-3 text-end font-mono ${r.openTickets > 0 ? 'text-danger' : 'text-muted-foreground'}`}
                    >
                      {r.openTickets}
                    </td>
                    <td className="p-3 text-end font-mono">{r.totalTickets}</td>
                    <td className="p-3 text-end font-mono">
                      {minutesLabel(r.avgResolutionMinutes)}
                    </td>
                    <td className="p-3 font-mono text-xs">
                      {r.lastTicketAt ? relativeTime(r.lastTicketAt, locale) : '—'}
                    </td>
                    <td className="p-3 text-end">
                      <Link
                        href={`/admin/support/customers/${r.workspaceId}`}
                        className="text-primary hover:underline"
                      >
                        {t('view')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

/** One workspace's ticket history (TW-SUPP-021). */
export function CustomerDetailPage({ id }: { id: string }) {
  const t = useTranslations(`${NS}.customers.detail`);
  const ts = useTranslations(`${NS}.status`);
  const tp = useTranslations(`${NS}.priority`);
  const locale = useLocale();
  const q = useQuery({
    queryKey: ['support', 'operator', 'customer', id],
    queryFn: ({ signal }) =>
      operatorFetch(`/support/customers/${id}`, { schema: customerDetailResponseSchema, signal }),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });

  if (q.isPending) return <LoadingBlock />;
  if (q.isError) {
    return q.error instanceof ApiError && q.error.status === 404 ? (
      <div className="space-y-4">
        <p>{t('notFound')}</p>
        <Link href="/admin/support/customers" className="text-primary hover:underline">
          {t('all')}
        </Link>
      </div>
    ) : (
      <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
    );
  }
  const d = q.data;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('eyebrow')}
        title={d.workspace.name}
        description={t('subtitle')}
        actions={
          <Link href="/admin/support/customers">
            <Button variant="secondary">{t('all')}</Button>
          </Link>
        }
      />
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label={t('total')} value={d.stats.total} />
        <StatTile
          label={t('open')}
          value={d.stats.open}
          tone={d.stats.open > 0 ? 'warning' : 'default'}
        />
        <StatTile label={t('resolved')} value={d.stats.resolved} tone="accent" />
        <StatTile label={t('avgFirst')} value={minutesLabel(d.stats.avgFirstResponseMinutes)} />
        <StatTile label={t('avgRes')} value={minutesLabel(d.stats.avgResolutionMinutes)} />
      </section>
      <Card className="overflow-x-auto p-0">
        <h2 className="border-b px-5 py-4 text-lg font-semibold">{t('history')}</h2>
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th className="p-3 text-start">{t('when')}</th>
              <th className="p-3 text-start">{t('subject')}</th>
              <th className="p-3 text-start">{t('status')}</th>
              <th className="p-3 text-center">{t('priority')}</th>
              <th className="p-3 text-start">{t('assigned')}</th>
              <th className="p-3 text-end">{t('resolvedIn')}</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {d.tickets.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                  {t('empty')}
                </td>
              </tr>
            )}
            {d.tickets.map((tk) => {
              const when = shortDate(tk.createdAt, locale);
              return (
                <tr key={tk.id} className="border-b last:border-0">
                  <td className="p-3 font-mono text-xs">
                    {when.day}
                    <br />
                    <span className="text-muted-foreground">{when.time}</span>
                  </td>
                  <td className="p-3">
                    <p className="truncate font-semibold">{tk.subject}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      #{tk.ticketNumber} · {tk.openedBy}
                    </p>
                  </td>
                  <td className="p-3">
                    <Badge tone={STATUS_TONE[tk.status]}>{ts(tk.status)}</Badge>
                  </td>
                  <td className="p-3 text-center">
                    <Badge tone={PRIORITY_TONE[tk.priority]}>{tp(tk.priority)}</Badge>
                  </td>
                  <td className="p-3">{tk.assignee ?? '—'}</td>
                  <td className="p-3 text-end font-mono text-xs">
                    {minutesLabel(tk.resolvedInMinutes)}
                  </td>
                  <td className="p-3 text-end">
                    <Link
                      href={`/admin/support?open=${tk.id}`}
                      className="text-primary hover:underline"
                    >
                      {t('open')}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
