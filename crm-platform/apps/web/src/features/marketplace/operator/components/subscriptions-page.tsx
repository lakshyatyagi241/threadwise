'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  MARKET_SUBSCRIPTION_SOURCES,
  MARKET_SUBSCRIPTION_STATUSES,
  type MarketOperatorSubscription,
  type MarketSubscriptionSummary,
} from '@crm/contracts';
import { Alert, Badge, Button, EmptyState, Field, Input, Select, Spinner, StatTile } from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { fetchSubscriptionSummary, fetchSubscriptions, marketKeys } from '../api';
import { formatMoney, formatMrr } from '../lib/pricing';
import { listingHref } from '../lib/paths';
import { MARKET_PERMISSIONS, type MarketAccess } from '../lib/permissions';
import {
  ALL_APPS,
  NO_SUBSCRIPTION_FILTERS,
  canCancel,
  isFiltered,
  canUnlockPrice,
  periodInfo,
  subscriptionQuery,
  subscriptionStatusTone,
  sumCounts,
  type SubscriptionFilters,
  type SubscriptionSourceFilter,
  type SubscriptionStatusFilter,
} from '../lib/subscriptions';
import { PerMonth, PerYear } from './price-cell';
import { CancelSubscriptionDialog, CompDialog, UnlockPriceDialog } from './subscription-dialogs';
import { ProrateDialog } from './refund-dialogs';
import { canRefundUnused } from '../lib/refunds';
import { Failure, LoadingBlock, MarketGate, textLink } from './ui';
import { useDebounced } from './use-docs-check';

const NS = 'marketplace.operator.subscriptions';

/**
 * Operator console: who subscribes to which paid app, per-app counts and monthly revenue, and the two money actions (comp a workspace,
 * cancel a subscription). Reading needs any Marketplace key; the actions need `platform.market.pricing`. `initialApp` opens the list on
 * one app (the pricing panel links here with it).
 */
export function SubscriptionsPage({ initialApp }: { initialApp?: string }) {
  return (
    <MarketGate>{(access) => <Subscriptions access={access} initialApp={initialApp} />}</MarketGate>
  );
}

function Subscriptions({ access, initialApp }: { access: MarketAccess; initialApp?: string }) {
  const t = useTranslations(NS);
  const te = useTranslations('marketplace.operator.enums');
  const [filters, setFilters] = useState<SubscriptionFilters>({
    ...NO_SUBSCRIPTION_FILTERS,
    app: initialApp ?? ALL_APPS,
  });
  const search = useDebounced(filters.search, 300);
  const wire = subscriptionQuery({ ...filters, search });
  const [cancelling, setCancelling] = useState<MarketOperatorSubscription | null>(null);
  const [unlocking, setUnlocking] = useState<MarketOperatorSubscription | null>(null);
  const [refunding, setRefunding] = useState<MarketOperatorSubscription | null>(null);
  const [comping, setComping] = useState(false);

  const summary = useQuery({
    queryKey: marketKeys.subscriptionSummary,
    queryFn: ({ signal }) => fetchSubscriptionSummary(signal),
    refetchOnWindowFocus: false,
  });
  const list = useInfiniteQuery({
    queryKey: marketKeys.subscriptions(wire),
    queryFn: ({ pageParam, signal }) => fetchSubscriptions({ ...wire, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    // Changing a filter keeps the list on screen (and the filter box focused) while the new one loads.
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);
  const set = (patch: Partial<SubscriptionFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const filtered = isFiltered(filters);
  const appRows = summary.data?.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          access.pricing ? <Button onClick={() => setComping(true)}>{t('comp')}</Button> : undefined
        }
      />
      {!access.pricing && (
        <Alert>{t('readOnly', { permission: MARKET_PERMISSIONS.pricing })}</Alert>
      )}

      <SummarySection summary={summary} />

      <div
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        role="search"
        aria-label={t('filters.label')}
      >
        <Field label={t('filters.app')} htmlFor="subs-app">
          <Select id="subs-app" value={filters.app} onChange={(e) => set({ app: e.target.value })}>
            <option value={ALL_APPS}>{t('filters.allApps')}</option>
            {filters.app !== ALL_APPS && !appRows.some((a) => a.slug === filters.app) && (
              <option value={filters.app}>{filters.app}</option>
            )}
            {appRows.map((a) => (
              <option key={a.appId} value={a.slug}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('filters.status')} htmlFor="subs-status">
          <Select
            id="subs-status"
            value={filters.status}
            onChange={(e) => set({ status: e.target.value as SubscriptionStatusFilter })}
          >
            <option value="all">{t('filters.allStatuses')}</option>
            {MARKET_SUBSCRIPTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {te(`subscriptionStatus.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('filters.source')} htmlFor="subs-source">
          <Select
            id="subs-source"
            value={filters.source}
            onChange={(e) => set({ source: e.target.value as SubscriptionSourceFilter })}
          >
            <option value="all">{t('filters.allSources')}</option>
            {MARKET_SUBSCRIPTION_SOURCES.map((s) => (
              <option key={s} value={s}>
                {te(`subscriptionSource.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('filters.search')} htmlFor="subs-search">
          <Input
            id="subs-search"
            type="search"
            placeholder={t('filters.searchPlaceholder')}
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
          />
        </Field>
      </div>

      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError && !list.data ? (
        <Failure error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <>
          {list.isError && <Failure error={list.error} onRetry={() => void list.refetch()} />}
          {rows.length === 0 ? (
            <EmptyState
              title={filtered ? t('noMatchTitle') : t('emptyTitle')}
              message={filtered ? t('noMatchMessage') : t('emptyMessage')}
              actions={
                filtered ? (
                  <Button variant="secondary" onClick={() => setFilters(NO_SUBSCRIPTION_FILTERS)}>
                    {t('clearFilters')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <SubscriptionsTable
              rows={rows}
              canAct={access.pricing}
              onCancel={(s) => setCancelling(s)}
              onUnlock={(s) => setUnlocking(s)}
              onRefund={(s) => setRefunding(s)}
            />
          )}
          {list.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage && <Spinner />}
                {t('loadMore')}
              </Button>
            </div>
          )}
        </>
      )}

      {cancelling && (
        <CancelSubscriptionDialog subscription={cancelling} onClose={() => setCancelling(null)} />
      )}
      {refunding && <ProrateDialog subscription={refunding} onClose={() => setRefunding(null)} />}
      {unlocking && (
        <UnlockPriceDialog subscription={unlocking} onClose={() => setUnlocking(null)} />
      )}
      {comping && (
        <CompDialog
          initialApp={filters.app === ALL_APPS ? undefined : filters.app}
          onClose={() => setComping(false)}
        />
      )}
    </div>
  );
}

// --- the per-app summary -------------------------------------------------------------------------------------------------------------

function SummarySection({
  summary,
}: {
  summary: {
    data?: MarketSubscriptionSummary;
    isPending: boolean;
    isError: boolean;
    error: unknown;
    refetch: () => unknown;
  };
}) {
  const t = useTranslations(`${NS}.summary`);
  const tk = useTranslations(`${NS}.kpi`);
  const locale = useLocale();
  if (summary.isPending) return <LoadingBlock />;
  if (summary.isError && !summary.data) {
    return <Failure error={summary.error} onRetry={() => void summary.refetch()} />;
  }
  const data = summary.data!;
  const totals = sumCounts(data.data);
  const mrr = data.totals;

  return (
    <section aria-label={tk('label')} className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <StatTile label={tk('active')} value={totals.active} tone="accent" />
        <StatTile label={tk('trialing')} value={totals.trialing} />
        <StatTile label={tk('comped')} value={totals.comped} />
        <StatTile
          label={tk('canceling')}
          value={totals.canceling}
          tone={totals.canceling > 0 ? 'warning' : 'default'}
        />
        <StatTile
          label={tk('pastDue')}
          value={totals.pastDue}
          tone={totals.pastDue > 0 ? 'warning' : 'default'}
        />
        <StatTile label={tk('ended')} value={totals.ended} />
        {mrr.length === 0 ? (
          <StatTile label={tk('mrr')} value="-" hint={tk('mrrNone')} />
        ) : (
          mrr.map((m) => (
            <StatTile
              key={m.currency}
              label={tk('mrrCurrency', { currency: m.currency })}
              value={<bdi dir="ltr">{formatMrr([m], locale)[0]}</bdi>}
              tone="accent"
            />
          ))
        )}
      </div>

      {data.data.length === 0 ? (
        <EmptyState title={t('emptyTitle')} message={t('emptyMessage')} />
      ) : (
        <div className="space-y-2">
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[56rem] text-sm">
              <caption className="sr-only">{t('caption')}</caption>
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {t('cols.app')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {t('cols.price')}
                  </th>
                  {(
                    [
                      'active',
                      'trialing',
                      'comped',
                      'canceling',
                      'pastDue',
                      'ended',
                      'total',
                    ] as const
                  ).map((c) => (
                    <th key={c} scope="col" className="px-3 py-2 text-end font-medium">
                      {t(`cols.${c}`)}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 text-end font-medium">
                    {t('cols.mrr')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.data.map((r) => (
                  <tr key={r.appId} data-testid={`summary-${r.slug}`}>
                    <th scope="row" className="px-3 py-2 text-start font-normal">
                      <Link href={listingHref({ slug: r.slug, id: r.appId })} className={textLink}>
                        {r.name}
                      </Link>
                    </th>
                    <td className="px-3 py-2">
                      {r.pricing.model === 'free' ? (
                        <span className="text-muted-foreground">{t('free')}</span>
                      ) : (
                        <PerMonth
                          price={formatMoney(r.pricing.amount, r.pricing.currency, locale)}
                        />
                      )}
                    </td>
                    {(
                      [
                        'active',
                        'trialing',
                        'comped',
                        'canceling',
                        'pastDue',
                        'ended',
                        'total',
                      ] as const
                    ).map((c) => (
                      <td key={c} className="px-3 py-2 text-end tabular-nums">
                        {r.counts[c]}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-end tabular-nums">
                      <MrrLines entries={r.mrr} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border bg-muted/50 font-medium">
                <tr data-testid="summary-totals">
                  <th scope="row" className="px-3 py-2 text-start" colSpan={2}>
                    {t('totals')}
                  </th>
                  {(
                    [
                      'active',
                      'trialing',
                      'comped',
                      'canceling',
                      'pastDue',
                      'ended',
                      'total',
                    ] as const
                  ).map((c) => (
                    <td key={c} className="px-3 py-2 text-end tabular-nums">
                      {totals[c]}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-end tabular-nums">
                    <MrrLines entries={mrr} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">{t('note')}</p>
        </div>
      )}
    </section>
  );
}

/** One line per currency: monthly revenue is never added across currencies. */
function MrrLines({ entries }: { entries: ReadonlyArray<{ currency: string; amount: string }> }) {
  const locale = useLocale();
  if (entries.length === 0) return <span className="text-muted-foreground">-</span>;
  const lines = formatMrr(entries, locale);
  return (
    <>
      {lines.map((line, i) => (
        <div key={entries[i]!.currency}>
          <bdi dir="ltr">{line}</bdi>
        </div>
      ))}
    </>
  );
}

// --- the subscriptions --------------------------------------------------------------------------------------------------------------

export function SubscriptionsTable({
  rows,
  canAct,
  onCancel,
  onUnlock,
  onRefund,
}: {
  rows: readonly MarketOperatorSubscription[];
  canAct: boolean;
  onCancel: (s: MarketOperatorSubscription) => void;
  onUnlock: (s: MarketOperatorSubscription) => void;
  onRefund: (s: MarketOperatorSubscription) => void;
}) {
  const t = useTranslations(NS);
  const te = useTranslations('marketplace.operator.enums');
  const format = useFormatter();
  const locale = useLocale();
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[64rem] text-sm">
        <caption className="sr-only">{t('tableCaption')}</caption>
        <thead className="bg-muted text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.workspace')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.app')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.status')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.source')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.started')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.period')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.amount')}
            </th>
            {canAct && (
              <th scope="col" className="px-3 py-2 text-end font-medium">
                <span className="sr-only">{t('cols.actions')}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((s) => {
            const period = periodInfo(s);
            return (
              <tr key={s.id} data-testid={`subscription-${s.id}`}>
                <th scope="row" className="px-3 py-3 text-start align-top font-normal">
                  <div className="font-medium" dir="auto">
                    {s.workspace.name}
                  </div>
                  {s.source === 'comp' && s.compNote && (
                    <div className="mt-0.5 max-w-xs text-xs text-muted-foreground" dir="auto">
                      {s.compBy
                        ? t('compBy', { operator: s.compBy, note: s.compNote })
                        : s.compNote}
                    </div>
                  )}
                </th>
                <td className="px-3 py-3 align-top">
                  <Link href={listingHref(s.app)} className={textLink}>
                    {s.app.name}
                  </Link>
                </td>
                <td className="px-3 py-3 align-top">
                  <Badge tone={subscriptionStatusTone(s.status)}>
                    {te(`subscriptionStatus.${s.status}`)}
                  </Badge>
                </td>
                <td className="px-3 py-3 align-top">{te(`subscriptionSource.${s.source}`)}</td>
                <td className="px-3 py-3 align-top">
                  <time dateTime={s.startedAt}>{date(s.startedAt)}</time>
                </td>
                <td className="px-3 py-3 align-top">
                  {period.date ? (
                    <time dateTime={period.date}>
                      {t(`period.${period.kind}`, { date: date(period.date) })}
                    </time>
                  ) : period.kind === 'compOpen' ? (
                    t('period.compOpen')
                  ) : (
                    <span className="text-muted-foreground">{t('period.none')}</span>
                  )}
                </td>
                <td className="px-3 py-3 align-top">
                  {s.amount && s.currency ? (
                    s.period === 'yearly' ? (
                      <PerYear price={formatMoney(s.amount, s.currency, locale)} />
                    ) : (
                      <PerMonth price={formatMoney(s.amount, s.currency, locale)} />
                    )
                  ) : (
                    <span className="text-muted-foreground">{t('noCharge')}</span>
                  )}
                </td>
                {canAct && (
                  <td className="px-3 py-3 text-end align-top">
                    {canRefundUnused(s) && (
                      <Button variant="secondary" size="sm" onClick={() => onRefund(s)}>
                        {t('refundUnused')}
                        <span className="sr-only">
                          {' '}
                          {s.workspace.name}, {s.app.name}
                        </span>
                      </Button>
                    )}
                    {canUnlockPrice(s) && (
                      <Button variant="secondary" size="sm" onClick={() => onUnlock(s)}>
                        {t('unlockPrice')}
                        <span className="sr-only">
                          {' '}
                          {s.workspace.name}, {s.app.name}
                        </span>
                      </Button>
                    )}
                    {canCancel(s) && (
                      <Button variant="secondary" size="sm" onClick={() => onCancel(s)}>
                        {t('cancel')}
                        <span className="sr-only">
                          {' '}
                          {s.workspace.name}, {s.app.name}
                        </span>
                      </Button>
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
