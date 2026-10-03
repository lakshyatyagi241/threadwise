'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  SUPP_TICKET_PRIORITIES,
  SUPP_TICKET_STATUSES,
  operatorTicketListResponseSchema,
  type OperatorTicketListResponse,
} from '@crm/contracts';
import { Button, Card, Input, Select, StatTile } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { INBOX_KEY, PRIORITY_PILL, STATUS_PILL } from '../lib/display';
import { shortDate } from '../lib/format';
import { TicketPanel } from './ticket-panel';

const NS = 'platform-support-desk';

interface Filters {
  status: string;
  priority: string;
  agent: string;
  q: string;
}
const EMPTY: Filters = { status: '', priority: '', agent: '', q: '' };

/** Operator Inbox: KPI tiles, filters, a cursor-paged table and the slide-in ticket panel (`?open=<ticket id>`). */
export function InboxPage() {
  const t = useTranslations(`${NS}.operator`);
  const ts = useTranslations(`${NS}.status`);
  const tp = useTranslations(`${NS}.priority`);
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get('open');
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [search, setSearch] = useState('');

  // The search box waits for a pause in typing before it asks the server.
  useEffect(() => {
    const id = setTimeout(() => setFilters((f) => (f.q === search ? f : { ...f, q: search })), 300);
    return () => clearTimeout(id);
  }, [search]);

  const q = useInfiniteQuery({
    queryKey: [...INBOX_KEY, filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      operatorFetch('/support/tickets', {
        query: { ...filters, limit: 12, cursor: pageParam },
        schema: operatorTicketListResponseSchema,
        signal,
      }),
    getNextPageParam: (last: OperatorTicketListResponse) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
  });

  const setOpen = (id: string | null) =>
    router.replace(id ? `/admin/support?open=${id}` : '/admin/support', { scroll: false });
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  const kpis = q.data?.pages[0]?.kpis;
  const active = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Link href="/admin/support/team-inbox">
            <Button variant="secondary">{t('kanbanView')}</Button>
          </Link>
        }
      />

      {kpis && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label={t('kpi.open')} value={kpis.open} />
          <StatTile label={t('kpi.unassigned')} value={kpis.unassigned} tone="warning" />
          <StatTile label={t('kpi.resolved24h')} value={kpis.resolved24h} />
          <StatTile label={t('kpi.total')} value={kpis.total} />
        </div>
      )}

      <Card className="flex flex-wrap items-end gap-3">
        <Select
          aria-label={t('filters.status')}
          className="w-40"
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
        >
          <option value="">{t('filters.allStatus')}</option>
          {SUPP_TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ts(s)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('filters.priority')}
          className="w-40"
          value={filters.priority}
          onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
        >
          <option value="">{t('filters.allPriority')}</option>
          {SUPP_TICKET_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {tp(p)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('filters.agent')}
          className="w-48"
          value={filters.agent}
          onChange={(e) => setFilters({ ...filters, agent: e.target.value })}
        >
          <option value="">{t('filters.allAgents')}</option>
          <option value="me">{t('filters.me')}</option>
          <option value="unassigned">{t('filters.unassigned')}</option>
        </Select>
        <Input
          aria-label={t('filters.search')}
          placeholder={t('filters.search')}
          className="w-64"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {active && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilters(EMPTY);
              setSearch('');
            }}
          >
            {t('filters.clear')}
          </Button>
        )}
      </Card>

      {q.isPending && <LoadingBlock />}
      {q.isError && <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-start text-xs text-muted-foreground">
              <tr>
                <th className="p-3 text-start">{t('table.when')}</th>
                <th className="p-3 text-start">{t('table.ticket')}</th>
                <th className="p-3 text-start">{t('table.priority')}</th>
                <th className="p-3 text-start">{t('table.status')}</th>
                <th className="p-3 text-start">{t('table.assignee')}</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    {t('table.empty')}
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr
                  key={r.id}
                  tabIndex={0}
                  onClick={() => setOpen(r.id)}
                  onKeyDown={(e) => e.key === 'Enter' && setOpen(r.id)}
                  className="cursor-pointer border-b last:border-0 hover:bg-muted focus-visible:bg-muted"
                  data-testid="ticket-row"
                >
                  <td className="whitespace-nowrap p-3 text-muted-foreground">
                    {shortDate(r.createdAt, locale).day}
                    <br />
                    <span className="text-xs">{shortDate(r.createdAt, locale).time}</span>
                  </td>
                  <td className="p-3">
                    <p className="font-medium">{r.subject || t('table.noSubject')}</p>
                    <p className="font-mono text-[10.5px] text-muted-foreground">
                      #{r.ticketNumber} · {r.customerName || r.customerEmail}
                    </p>
                  </td>
                  <td className="p-3">
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase ${PRIORITY_PILL[r.priority]}`}
                    >
                      {tp(r.priority)}
                    </span>
                  </td>
                  <td className="p-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] lowercase ${STATUS_PILL[r.status]}`}
                    >
                      {ts(r.status)}
                    </span>
                  </td>
                  <td className="p-3">
                    {r.assignee?.name ?? (
                      <em className="text-muted-foreground">{t('table.unassigned')}</em>
                    )}
                  </td>
                  <td className="p-3 text-xs text-primary">{t('table.open')} &rarr;</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {q.hasNextPage && (
        <Button
          variant="secondary"
          onClick={() => void q.fetchNextPage()}
          disabled={q.isFetchingNextPage}
        >
          {t('table.loadMore')}
        </Button>
      )}

      {openId && <TicketPanel id={openId} onClose={() => setOpen(null)} />}
    </div>
  );
}
