'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import {
  CALL_LOG_DIRECTIONS,
  CALL_LOG_RANGES,
  CALL_LOG_STATUSES,
  type CallLogRow,
  type CallLogSource,
} from '@crm/contracts';
import { Alert, Badge, Button, EmptyState, Input, Select, Spinner, StatTile, cn } from '@crm/ui';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { AGENT_IGNORE, AGENT_PII } from '@/lib/agent-marks';
import { usePlanFeature } from '@/lib/plan-features';
import { useCallLogFilters, useCallLogs, useCallLogsLive } from '../api/call-logs';
import {
  STATUS_TONE,
  durationText,
  forPlan,
  logSearch,
  pageCount,
  parseLogParams,
  phoneText,
  sourcesFor,
  toListQuery,
  WHATSAPP_CALLING,
  type LogParams,
} from '../lib/call-logs';
import { LogCallDialog } from './log-call-dialog';
import { useErrorText } from './use-error-text';

const RANGE_KEY = { '24h': 'last24h', '7d': 'last7d', '30d': 'last30d' } as const;

/** The tabs shared by the call log and the call analytics. */
export function CallLogsTabs({ active }: { active: 'log' | 'analytics' }) {
  const t = useTranslations('calling-voice.logs.tabs');
  const sp = useSearchParams();
  // The range, the custom days and the number carry across; the log's other filters do not mean anything to the analytics.
  const whatsapp = usePlanFeature(WHATSAPP_CALLING);
  const p = forPlan(parseLogParams(sp), whatsapp);
  const carry = logSearch({ range: p.range, from: p.from, to: p.to, numberId: p.numberId });
  const link = (on: boolean) =>
    cn(
      'rounded-full px-4 py-1.5 text-sm font-medium',
      on ? 'bg-primary text-primary-foreground' : 'text-foreground/80 hover:bg-muted',
    );
  return (
    <nav aria-label={t('label')} className="flex gap-1">
      <Link
        href={`/call-logs${carry}`}
        className={link(active === 'log')}
        aria-current={active === 'log' ? 'page' : undefined}
      >
        {t('log')}
      </Link>
      <Link
        href={`/call-logs/analytics${carry}`}
        className={link(active === 'analytics')}
        aria-current={active === 'analytics' ? 'page' : undefined}
      >
        {t('analytics')}
      </Link>
    </nav>
  );
}

/**
 * `/call-logs` (TW-CALL-022): the calls of the workspace, newest first. Reference's page, kept: the time range and status on the side,
 * four totals, a search and a table with a page of 25. Added to it: a custom range, direction, number and teammate filters, totals for
 * what the filters select, and a refresh when a call ends. The filters live in the address, so a view can be shared and survives a reload.
 *
 * Without the plan feature `waba_calling` (BL-257) it is the same screen for the calls a workspace writes down or has reported (Log a call,
 * the mobile app, a telephony provider, a click to call): the WhatsApp number filter and the WhatsApp source are left out, and the
 * words do not promise WhatsApp calls. With the feature nothing changes.
 */
export function CallLogsScreen() {
  const t = useTranslations('calling-voice.logs');
  const errorText = useErrorText();
  useCallLogsLive();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const whatsapp = usePlanFeature(WHATSAPP_CALLING);
  const params = useMemo(() => forPlan(parseLogParams(sp), whatsapp), [sp, whatsapp]);
  const tz = useSession().effectiveTimezone || 'UTC';
  const logs = useCallLogs(toListQuery(params, tz));
  const filters = useCallLogFilters();
  const canLog = useCan('call.logs.create');
  const [logging, setLogging] = useState(false);

  const go = (patch: Partial<LogParams>, keepPage = false) =>
    router.replace(
      `${pathname}${logSearch({ ...params, page: keepPage ? params.page : 1, ...patch })}`,
      {
        scroll: false,
      },
    );

  const data = logs.data;
  const pages = data ? pageCount(data.total, data.pageSize) : 1;
  const hasFilters = Boolean(
    params.status ||
    params.direction ||
    params.numberId ||
    params.agentId ||
    params.source ||
    params.q,
  );

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-7 sm:px-6 lg:px-7">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-3 self-start lg:sticky lg:top-6">
          <p className="rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            {whatsapp ? t('sideTip') : t('sideTipLogged')}
          </p>
          <RangeCard params={params} go={go} />
          <StatusCard params={params} go={go} />
        </aside>

        <section className="min-w-0 space-y-5" aria-busy={logs.isFetching}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {t('eyebrow')}
              </div>
              <h1 className="mt-1 text-3xl font-normal leading-none tracking-tight sm:text-4xl">
                {t('title')}
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                {whatsapp ? t('subtitle') : t('subtitleLogged')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {canLog && (
                <Button variant="brand" onClick={() => setLogging(true)}>
                  {t('logCall.button')}
                </Button>
              )}
              <CallLogsTabs active="log" />
            </div>
          </div>
          {canLog && <LogCallDialog open={logging} onClose={() => setLogging(false)} />}

          {logs.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Spinner label={t('loading')} /> {t('loading')}
            </div>
          )}
          {logs.isError && !data && (
            <Alert tone="danger" className="flex flex-wrap items-center justify-between gap-3">
              <span>
                {t('loadFailed')} {errorText(logs.error)}
              </span>
              <Button size="sm" variant="secondary" onClick={() => void logs.refetch()}>
                {t('retry')}
              </Button>
            </Alert>
          )}

          {data && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label={t('kpi.total')} value={data.kpis.workspace.total} />
                <StatTile
                  label={t('kpi.last24h')}
                  value={data.kpis.workspace.last24h}
                  hint={t('kpi.minutes', { count: data.kpis.workspace.minutes24h })}
                />
                <StatTile label={t('kpi.completed')} value={data.kpis.workspace.completed} />
                <StatTile
                  label={t('kpi.failed')}
                  value={data.kpis.workspace.failed}
                  tone={data.kpis.workspace.failed > 0 ? 'warning' : 'default'}
                />
              </div>

              <div>
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('kpi.selection')}
                </h2>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                  <StatTile label={t('kpi.calls')} value={data.kpis.selection.total} />
                  <StatTile label={t('kpi.answered')} value={data.kpis.selection.answered} />
                  <StatTile label={t('kpi.missed')} value={data.kpis.selection.missed} />
                  <StatTile
                    label={t('kpi.avgDuration')}
                    value={durationText(data.kpis.selection.avgDurationSec)}
                  />
                  <StatTile
                    label={t('kpi.totalMinutes')}
                    value={data.kpis.selection.totalMinutes}
                  />
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-border bg-background">
                <FilterBar
                  key={sp.toString()}
                  params={params}
                  numbers={whatsapp ? (filters.data?.numbers ?? []) : []}
                  sources={sourcesFor(whatsapp)}
                  agents={filters.data?.agents ?? []}
                  onApply={(patch) => go(patch)}
                  onClear={() =>
                    go({
                      status: undefined,
                      direction: undefined,
                      numberId: undefined,
                      agentId: undefined,
                      source: undefined,
                      q: undefined,
                    })
                  }
                  hasFilters={hasFilters}
                />
                {data.rows.length === 0 ? (
                  <div className="px-4 py-12">
                    {hasFilters ? (
                      <EmptyState
                        title={t('emptyFilteredTitle')}
                        message={t('emptyFilteredMessage')}
                        actions={
                          <Button
                            variant="secondary"
                            onClick={() =>
                              go({
                                status: undefined,
                                direction: undefined,
                                numberId: undefined,
                                agentId: undefined,
                                source: undefined,
                                q: undefined,
                              })
                            }
                          >
                            {t('clearFilters')}
                          </Button>
                        }
                      />
                    ) : (
                      <EmptyState
                        title={t('emptyTitle')}
                        message={whatsapp ? t('emptyMessage') : t('emptyMessageLogged')}
                      />
                    )}
                  </div>
                ) : (
                  <LogTable rows={data.rows} />
                )}
              </div>

              {data.total > 0 && (
                <Pager
                  page={data.page}
                  pages={pages}
                  pageSize={data.pageSize}
                  total={data.total}
                  onPage={(page) => go({ page }, true)}
                />
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function SideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-background p-2">
      <div className="px-3 pb-1.5 pt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

const sideItem = (active: boolean) =>
  cn(
    'flex w-full items-center justify-between rounded-lg px-3 py-2 text-start text-sm',
    active
      ? 'bg-primary font-semibold text-primary-foreground'
      : 'text-foreground/80 hover:bg-muted',
  );

/** The window of the log: Reference's three presets, plus two days of the person's own choosing. */
export function RangeCard({
  params,
  go,
}: {
  params: LogParams;
  go: (patch: Partial<LogParams>) => void;
}) {
  const t = useTranslations('calling-voice.logs.range');
  const custom = Boolean(params.from || params.to);
  const [from, setFrom] = useState(params.from ?? '');
  const [to, setTo] = useState(params.to ?? '');
  const apply = (e: FormEvent) => {
    e.preventDefault();
    if (!from && !to) return go({ from: undefined, to: undefined });
    go({ from: from || undefined, to: to || undefined });
  };
  return (
    <SideCard title={t('title')}>
      {CALL_LOG_RANGES.map((r) => {
        const on = !custom && params.range === r;
        return (
          <button
            key={r}
            type="button"
            aria-pressed={on}
            className={sideItem(on)}
            onClick={() => go({ range: r, from: undefined, to: undefined })}
          >
            {t(RANGE_KEY[r])}
          </button>
        );
      })}
      <form onSubmit={apply} className="mt-1 space-y-2 border-t border-border px-3 pb-2 pt-3">
        <div className="text-xs font-medium text-muted-foreground">{t('custom')}</div>
        <label className="block text-xs">
          <span className="text-muted-foreground">{t('from')}</span>
          <Input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="block text-xs">
          <span className="text-muted-foreground">{t('to')}</span>
          <Input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <Button type="submit" size="sm" variant={custom ? 'brand' : 'secondary'} className="w-full">
          {t('apply')}
        </Button>
      </form>
    </SideCard>
  );
}

const STATUS_DOT: Record<string, string> = {
  completed: 'bg-success',
  'in-progress': 'bg-primary',
  'no-answer': 'bg-warning',
  declined: 'bg-muted-foreground',
  failed: 'bg-danger',
};

function StatusCard({
  params,
  go,
}: {
  params: LogParams;
  go: (patch: Partial<LogParams>) => void;
}) {
  const t = useTranslations('calling-voice.logs.status');
  return (
    <SideCard title={t('title')}>
      <button
        type="button"
        aria-pressed={!params.status}
        className={sideItem(!params.status)}
        onClick={() => go({ status: undefined })}
      >
        {t('all')}
      </button>
      {CALL_LOG_STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={params.status === s}
          className={sideItem(params.status === s)}
          onClick={() => go({ status: s })}
        >
          <span className="flex items-center gap-2">
            <span aria-hidden className={cn('size-2 rounded-full', STATUS_DOT[s])} />
            {t(s)}
          </span>
        </button>
      ))}
    </SideCard>
  );
}

function FilterBar({
  params,
  numbers,
  sources,
  agents,
  onApply,
  onClear,
  hasFilters,
}: {
  params: LogParams;
  numbers: Array<{ id: string; label: string; phoneNumber: string | null }>;
  sources: readonly CallLogSource[];
  agents: Array<{ id: string; name: string }>;
  onApply: (patch: Partial<LogParams>) => void;
  onClear: () => void;
  hasFilters: boolean;
}) {
  const t = useTranslations('calling-voice.logs.filters');
  const [q, setQ] = useState(params.q ?? '');
  const [direction, setDirection] = useState(params.direction ?? '');
  const [numberId, setNumberId] = useState(params.numberId ?? '');
  const [agentId, setAgentId] = useState(params.agentId ?? '');
  const [source, setSource] = useState(params.source ?? '');
  const ts = useTranslations('calling-voice.logs.source');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onApply({
      q: q.trim() || undefined,
      source: (source || undefined) as LogParams['source'],
      direction: (direction || undefined) as LogParams['direction'],
      numberId: numberId || undefined,
      agentId: agentId || undefined,
    });
  };
  return (
    <form
      onSubmit={submit}
      role="search"
      aria-label={t('label')}
      className="flex flex-wrap items-end gap-2 border-b border-border px-4 py-3"
    >
      <label className="min-w-[12rem] flex-1 text-xs">
        <span className="sr-only">{t('searchLabel')}</span>
        <Input
          type="search"
          value={q}
          maxLength={80}
          placeholder={t('searchPlaceholder')}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      <label className="text-xs">
        <span className="sr-only">{t('direction')}</span>
        <Select value={direction} onChange={(e) => setDirection(e.target.value)} className="w-auto">
          <option value="">{t('allDirections')}</option>
          {CALL_LOG_DIRECTIONS.map((d) => (
            <option key={d} value={d}>
              {t(d)}
            </option>
          ))}
        </Select>
      </label>
      <label className="text-xs">
        <span className="sr-only">{t('source')}</span>
        <Select value={source} onChange={(e) => setSource(e.target.value)} className="w-auto">
          <option value="">{t('allSources')}</option>
          {sources.map((x) => (
            <option key={x} value={x}>
              {ts(x)}
            </option>
          ))}
        </Select>
      </label>
      {numbers.length > 1 && (
        <label className="text-xs">
          <span className="sr-only">{t('number')}</span>
          <Select value={numberId} onChange={(e) => setNumberId(e.target.value)} className="w-auto">
            <option value="">{t('allNumbers')}</option>
            {numbers.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </Select>
        </label>
      )}
      {agents.length > 0 && (
        <label className="text-xs">
          <span className="sr-only">{t('agent')}</span>
          <Select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="w-auto">
            <option value="">{t('allAgents')}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </label>
      )}
      <Button type="submit" variant="brand">
        {t('apply')}
      </Button>
      {hasFilters && (
        <Button type="button" variant="ghost" onClick={onClear}>
          {t('clear')}
        </Button>
      )}
    </form>
  );
}

export function StatusBadge({ status }: { status: CallLogRow['status'] }) {
  const t = useTranslations('calling-voice.logs.status');
  return <Badge tone={STATUS_TONE[status]}>{t(status)}</Badge>;
}

function LogTable({ rows }: { rows: CallLogRow[] }) {
  const t = useTranslations('calling-voice.logs.table');
  const ts = useTranslations('calling-voice.logs.source');
  const to = useTranslations('calling-voice.logs.logCall.outcomes');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <caption className="sr-only">{t('caption')}</caption>
        <thead>
          <tr className="border-b border-border bg-muted/40 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {(['customer', 'number', 'handledBy', 'started', 'duration', 'status'] as const).map(
              (c) => (
                <th key={c} scope="col" className="px-4 py-2.5 text-start font-medium">
                  {t(c)}
                </th>
              ),
            )}
            <th scope="col" className="px-4 py-2.5 text-end font-medium">
              {t('actions')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/40">
              <td className="max-w-[16rem] px-4 py-3">
                <Link
                  href={`/call-logs/${r.id}`}
                  className="block truncate font-semibold hover:text-primary"
                  {...AGENT_IGNORE}
                  {...AGENT_PII}
                >
                  {r.contactName || phoneText(r.customerPhone)}
                </Link>
                <div
                  className="truncate font-mono text-[11px] text-muted-foreground"
                  {...AGENT_PII}
                >
                  {t(r.direction)} · {phoneText(r.customerPhone)}
                </div>
                {r.source && r.source !== 'whatsapp' && (
                  <div className="mt-1">
                    <Badge tone="neutral">{ts(r.source)}</Badge>
                  </div>
                )}
              </td>
              <td className="max-w-[10rem] truncate px-4 py-3 text-xs">
                {r.numberLabel || t('none')}
              </td>
              <td className="max-w-[10rem] truncate px-4 py-3 text-xs" {...AGENT_PII}>
                {r.handlerName || t('none')}
              </td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                {r.startedAt ? (
                  <time
                    dateTime={r.startedAt}
                    title={format.dateTime(new Date(r.startedAt), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  >
                    {format.relativeTime(new Date(r.startedAt), now)}
                  </time>
                ) : (
                  t('none')
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                {durationText(r.durationSec)}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={r.status} />
                {r.outcome && (
                  <div className="mt-1 text-[11px] text-muted-foreground">{to(r.outcome)}</div>
                )}
              </td>
              <td className="px-4 py-3 text-end">
                <Link
                  href={`/call-logs/${r.id}`}
                  className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-muted"
                >
                  {t('open')}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pager({
  page,
  pages,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const t = useTranslations('calling-voice.logs.paging');
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav
      aria-label={t('label')}
      className="flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <span className="text-muted-foreground">
        {from > total ? t('beyond', { pages }) : t('showing', { from, to, total })}
      </span>
      <span className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t('previous')}
        </Button>
        <span aria-current="page" className="text-xs text-muted-foreground">
          {t('page', { page, pages })}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          {t('next')}
        </Button>
      </span>
    </nav>
  );
}
