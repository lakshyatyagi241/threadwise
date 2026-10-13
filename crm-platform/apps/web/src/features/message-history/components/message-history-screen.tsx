'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, EmptyState, Field, Input, Select, Spinner, useToast } from '@crm/ui';
import {
  MESSAGE_HISTORY_RANGES,
  MESSAGE_LOG_HOT_DAYS,
  MESSAGE_LOG_RETENTION_DAYS,
} from '@crm/contracts';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import {
  useChannelOptions,
  useHistoryFeed,
  useHistoryInsights,
  useHistorySummary,
  useRequestHistoryExport,
} from '../api/history';
import {
  EMPTY_STATE,
  isNarrowed,
  parseState,
  rangeDays,
  stateToSearch,
  type Bucket,
  type HistoryState,
} from '../lib/filters';
import { DetailDrawer } from './detail-drawer';
import { DirectionDonut, TopConversations, TypeMixChart, VolumeChart } from './charts';
import { ExportPanel } from './export-panel';
import { FilterBar } from './filter-bar';
import { HistoryTable } from './history-table';
import { KpiStrip } from './kpi-strip';
import { DownloadIcon, useErrorText } from './parts';

/** The zone the times are shown in: the workspace's, else the browser's, else UTC (Reference's chain, minus the admin default). */
function useDisplayZone(): string {
  const { org } = useSession();
  return useMemo(() => {
    for (const z of [org.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone]) {
      if (!z) continue;
      try {
        new Intl.DateTimeFormat('en', { timeZone: z });
        return z;
      } catch {
        // not a zone this browser knows: the next
      }
    }
    return 'UTC';
  }, [org.timezone]);
}

/**
 * `/message-history` (TW-CHAT-039 to -042): the KPI cards, the volume chart and the direction ring, the filter bar, the message table
 * with its drawer, the type mix and the most active threads. Every filter lives in the address. The numbers are counts of the whole
 * window; the table loads its pages by cursor. Rows the person may not see are not sent at all (the API decides, see its docs).
 */
export function MessageHistoryScreen() {
  const t = useTranslations('message-history');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { toast } = useToast();
  const errorText = useErrorText();
  const tz = useDisplayZone();
  const canExport = useCan('inbox.logs.export');

  const state = useMemo(() => parseState(new URLSearchParams(search.toString())), [search]);
  const fromEmail = search.get('export') ?? '';
  const go = useCallback(
    (patch: Partial<HistoryState>) => {
      // A change of filter starts the list again; opening a row or switching the chart bucket keeps the rest.
      const keeps = Object.keys(patch).every((k) => k === 'open' || k === 'bucket');
      const next = { ...state, ...patch, ...(keeps ? {} : { open: '' }) };
      router.replace(`${pathname}${stateToSearch(next)}`, { scroll: false });
    },
    [state, pathname, router],
  );

  const feed = useHistoryFeed(state);
  const summary = useHistorySummary(state);
  const insights = useHistoryInsights(state, tz);
  const channels = useChannelOptions();
  const exporter = useRequestHistoryExport();

  const rows = useMemo(() => feed.data?.pages.flatMap((p) => p.data) ?? [], [feed.data]);
  const days = rangeDays(state);
  const windowLabel = days === null ? t('range.custom') : t(`range.short.${state.range}`);
  const narrowed = isNarrowed(state);

  const [from, setFrom] = useState(state.from);
  const [to, setTo] = useState(state.to);
  const custom = state.from !== '' && state.to !== '';
  const today = new Date().toISOString().slice(0, 10);

  const requestExport = async () => {
    try {
      const created = await exporter.mutateAsync(state);
      toast(
        created.emailedTo
          ? t('exports.requestedTo', { email: created.emailedTo })
          : t('exports.requested'),
        'success',
      );
    } catch (err) {
      toast(errorText(err), 'danger');
    }
  };

  const shown = rows.length;
  const total = summary.data
    ? {
        all: summary.data.dirCounts.all,
        out: summary.data.dirCounts.out,
        in: summary.data.dirCounts.in,
        fail: summary.data.dirCounts.fail,
      }[state.dir]
    : null;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('crumb')}
          </div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label={t('range.label')}
            value={custom ? 'custom' : state.range}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'custom') {
                const end = new Date();
                const start = new Date(end.getTime() - 6 * 86_400_000);
                const f = start.toISOString().slice(0, 10);
                const tt = end.toISOString().slice(0, 10);
                setFrom(f);
                setTo(tt);
                go({ from: f, to: tt });
              } else {
                go({ range: v as HistoryState['range'], from: '', to: '' });
              }
            }}
            className="h-9 w-auto min-w-[160px] rounded-full"
          >
            {MESSAGE_HISTORY_RANGES.map((r) => (
              <option key={r} value={r}>
                {t(`range.${r}`)}
              </option>
            ))}
            <option value="custom">{t('range.custom')}</option>
          </Select>
          {canExport && (
            <Button
              variant="secondary"
              size="sm"
              disabled={exporter.isPending}
              onClick={() => void requestExport()}
            >
              {exporter.isPending ? <Spinner /> : <DownloadIcon />} {t('exports.request')}
            </Button>
          )}
        </div>
      </header>

      {custom && (
        <form
          className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-background p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (from && to && from <= to) go({ from, to });
          }}
        >
          <Field label={t('range.from')} htmlFor="mh-from">
            <Input
              id="mh-from"
              type="date"
              value={from}
              max={today}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label={t('range.to')} htmlFor="mh-to">
            <Input
              id="mh-to"
              type="date"
              value={to}
              max={today}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <Button type="submit" size="sm" disabled={!from || !to || from > to}>
            {t('range.apply')}
          </Button>
          {from > to && from !== '' && to !== '' && (
            <p className="text-xs text-danger">{t('range.problem.order')}</p>
          )}
        </form>
      )}

      <p className="text-xs text-muted-foreground" data-testid="retention-note">
        {t('retention', { hot: MESSAGE_LOG_HOT_DAYS, days: MESSAGE_LOG_RETENTION_DAYS })}
      </p>

      {canExport && <ExportPanel highlight={fromEmail} tz={tz} />}

      {(summary.isError || insights.isError) && (
        <Alert tone="danger">
          {errorText(summary.error ?? insights.error)}{' '}
          <button
            type="button"
            className="underline"
            onClick={() => {
              void summary.refetch();
              void insights.refetch();
            }}
          >
            {t('tryAgain')}
          </button>
        </Alert>
      )}

      <KpiStrip summary={summary.data} windowLabel={windowLabel} />

      <section className="grid gap-4 lg:grid-cols-3">
        <VolumeChart
          insights={insights.data}
          bucket={state.bucket}
          days={days ?? 30}
          tz={tz}
          onBucket={(b: Bucket) => go({ bucket: b })}
        />
        <DirectionDonut insights={insights.data} />
      </section>

      <section className="rounded-md border border-border bg-background">
        <FilterBar
          state={state}
          summary={summary.data}
          channels={(channels.data?.data ?? []).map((c) => ({ id: c.id, name: c.name }))}
          onChange={go}
          onClear={() =>
            go({
              dir: EMPTY_STATE.dir,
              type: '',
              source: [],
              status: '',
              q: '',
              channelId: '',
              templateId: '',
              campaignId: '',
              broadcastId: '',
              scheduledId: '',
            })
          }
        />

        {feed.isError && (
          <div className="space-y-2 p-4">
            <Alert tone="danger">{errorText(feed.error)}</Alert>
            <Button variant="secondary" size="sm" onClick={() => void feed.refetch()}>
              {t('tryAgain')}
            </Button>
          </div>
        )}

        {feed.isPending && (
          <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground" role="status">
            <Spinner /> {t('loading')}
          </p>
        )}

        {!feed.isPending && !feed.isError && rows.length === 0 && (
          <div className="p-4">
            {narrowed ? (
              <EmptyState
                title={t('empty.noMatch')}
                message={t('empty.noMatchHint')}
                actions={
                  <Link
                    href={pathname}
                    className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-muted"
                  >
                    {t('filters.clear')}
                  </Link>
                }
              />
            ) : (
              <EmptyState
                title={days === null ? t('empty.periodCustom') : t('empty.period', { days })}
                message={t('empty.periodHint')}
              />
            )}
          </div>
        )}

        {rows.length > 0 && (
          <>
            <HistoryTable
              rows={rows}
              tz={tz}
              selected={state.open}
              onOpen={(id) => go({ open: id })}
            />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
              <div>
                {total === null
                  ? t('table.showing', { n: shown })
                  : t('table.showingOf', {
                      n: shown,
                      total: new Intl.NumberFormat(locale).format(total),
                    })}
              </div>
              {feed.hasNextPage && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={feed.isFetchingNextPage}
                  onClick={() => void feed.fetchNextPage()}
                >
                  {feed.isFetchingNextPage ? <Spinner /> : null} {t('table.loadMore')}
                </Button>
              )}
            </div>
          </>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <TopConversations insights={insights.data} windowLabel={windowLabel} tz={tz} />
        <TypeMixChart insights={insights.data} />
      </section>

      <DetailDrawer id={state.open} tz={tz} onClose={() => go({ open: '' })} />
    </div>
  );
}
