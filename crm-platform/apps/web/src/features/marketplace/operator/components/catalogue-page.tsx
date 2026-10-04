'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { MARKET_APP_KINDS, MARKET_APP_STATUSES, type MarketOperatorApp } from '@crm/contracts';
import { Badge, Button, EmptyState, Field, Input, Select, Spinner, StatTile } from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { fetchApps, fetchCategories, marketKeys } from '../api';
import {
  ALL_CATEGORIES,
  NO_FILTERS,
  categoryOptions,
  filterByCategory,
  listQuery,
  statusCounts,
  type CatalogueFilters,
  type KindFilter,
  type PricingFilter,
  type StatusFilter,
} from '../lib/catalogue';
import { listingHref, SUBSCRIPTIONS_PATH, subscriptionsHref } from '../lib/paths';
import type { MarketAccess } from '../lib/permissions';
import { PriceCell } from './price-cell';
import { useDebounced } from './use-docs-check';
import {
  AppStatusBadge,
  ConnectorLabel,
  Failure,
  KindLabel,
  LoadingBlock,
  MarketGate,
  primaryLink,
  textLink,
} from './ui';

const NS = 'marketplace.operator.list';
const NEW_PATH = '/admin/marketplace/new';

/** Operator console: the catalogue of every listing in any status. Needs `platform.market.manage` or `platform.market.review`. */
export function CataloguePage() {
  return <MarketGate>{(access) => <Catalogue access={access} />}</MarketGate>;
}

function Catalogue({ access }: { access: MarketAccess }) {
  const t = useTranslations(NS);
  const te = useTranslations('marketplace.operator.enums');
  const [filters, setFilters] = useState<CatalogueFilters>(NO_FILTERS);
  const search = useDebounced(filters.search, 300);
  const wire = listQuery({ ...filters, search });

  const q = useInfiniteQuery({
    queryKey: marketKeys.apps(wire),
    queryFn: ({ pageParam, signal }) => fetchApps({ ...wire, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    // Changing a filter keeps the list on screen (and the filter box focused) while the new one loads.
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
  const categories = useQuery({
    queryKey: marketKeys.categories,
    queryFn: ({ signal }) => fetchCategories(signal),
    refetchOnWindowFocus: false,
  });

  const loaded = useMemo(() => q.data?.pages.flatMap((p) => p.data) ?? [], [q.data]);
  const shown = useMemo(
    () => filterByCategory(loaded, filters.category),
    [loaded, filters.category],
  );
  const counts = useMemo(() => statusCounts(loaded), [loaded]);
  const options = useMemo(() => categoryOptions(categories.data?.data ?? []), [categories.data]);
  const filtered =
    filters.status !== 'all' ||
    filters.kind !== 'all' ||
    filters.pricing !== 'all' ||
    filters.category !== ALL_CATEGORIES ||
    filters.search.trim() !== '';

  const set = (patch: Partial<CatalogueFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const header = (
    <PageHeader
      title={t('title')}
      description={t('description')}
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <Link href={SUBSCRIPTIONS_PATH} className={textLink}>
            {t('subscriptionsLink')}
          </Link>
          {access.manage ? (
            <Link href={NEW_PATH} className={primaryLink}>
              {t('new')}
            </Link>
          ) : null}
        </div>
      }
    />
  );

  if (q.isPending) {
    return (
      <div className="space-y-6">
        {header}
        <LoadingBlock />
      </div>
    );
  }
  if (q.isError && !q.data) {
    return (
      <div className="space-y-6">
        {header}
        <Failure error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <section aria-label={t('kpi.label')} className="space-y-2">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatTile label={t('kpi.loaded')} value={counts.all} />
          <StatTile label={t('kpi.published')} value={counts.published} tone="accent" />
          <StatTile
            label={t('kpi.inReview')}
            value={counts.in_review}
            tone={counts.in_review > 0 ? 'warning' : 'default'}
          />
          <StatTile label={t('kpi.hidden')} value={counts.hidden} />
          <StatTile label={t('kpi.killed')} value={counts.killed} />
        </div>
        <p className="text-xs text-muted-foreground">
          {t('kpi.note', { count: counts.all })}
          {q.hasNextPage ? ` ${t('kpi.noteMore')}` : ''}
        </p>
      </section>

      <div
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
        role="search"
        aria-label={t('filters.label')}
      >
        <Field label={t('filters.search')} htmlFor="catalogue-search">
          <Input
            id="catalogue-search"
            type="search"
            placeholder={t('filters.searchPlaceholder')}
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
          />
        </Field>
        <Field label={t('filters.kind')} htmlFor="catalogue-kind">
          <Select
            id="catalogue-kind"
            value={filters.kind}
            onChange={(e) => set({ kind: e.target.value as KindFilter, category: ALL_CATEGORIES })}
          >
            <option value="all">{t('filters.allKinds')}</option>
            {MARKET_APP_KINDS.map((k) => (
              <option key={k} value={k}>
                {te(`kind.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('filters.status')} htmlFor="catalogue-status">
          <Select
            id="catalogue-status"
            value={filters.status}
            onChange={(e) => set({ status: e.target.value as StatusFilter })}
          >
            <option value="all">{t('filters.allStatuses')}</option>
            {MARKET_APP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {te(`appStatus.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('filters.pricing')} htmlFor="catalogue-pricing">
          <Select
            id="catalogue-pricing"
            value={filters.pricing}
            onChange={(e) => set({ pricing: e.target.value as PricingFilter })}
          >
            <option value="all">{t('filters.allPricing')}</option>
            <option value="free">{t('filters.free')}</option>
            <option value="paid">{t('filters.paid')}</option>
          </Select>
        </Field>
        <Field
          label={t('filters.category')}
          htmlFor="catalogue-category"
          hint={t('filters.categoryNote')}
        >
          <Select
            id="catalogue-category"
            value={filters.category}
            disabled={options.length === 0}
            onChange={(e) => set({ category: e.target.value })}
          >
            <option value={ALL_CATEGORIES}>{t('filters.allCategories')}</option>
            {options
              .filter((o) => filters.kind === 'all' || o.kind === filters.kind)
              .map((o) => (
                <option key={o.value} value={o.value}>
                  {filters.kind === 'all' ? `${te(`kind.${o.kind}`)}: ${o.name}` : o.name}
                </option>
              ))}
          </Select>
        </Field>
      </div>

      {q.isError && <Failure error={q.error} onRetry={() => void q.refetch()} />}

      {shown.length === 0 ? (
        <EmptyState
          title={filtered ? t('noMatchTitle') : t('emptyTitle')}
          message={
            filtered
              ? q.hasNextPage
                ? t('noMatchMoreMessage')
                : t('noMatchMessage')
              : t('emptyMessage')
          }
          actions={
            <>
              {filtered && (
                <Button variant="secondary" onClick={() => setFilters(NO_FILTERS)}>
                  {t('clearFilters')}
                </Button>
              )}
              {!filtered && access.manage && (
                <Link href={NEW_PATH} className={primaryLink}>
                  {t('new')}
                </Link>
              )}
              {filtered && q.hasNextPage && (
                <Button
                  variant="secondary"
                  disabled={q.isFetchingNextPage}
                  onClick={() => void q.fetchNextPage()}
                >
                  {t('loadMore')}
                </Button>
              )}
            </>
          }
        />
      ) : (
        <CatalogueTable apps={shown} />
      )}

      {q.hasNextPage && shown.length > 0 && (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            disabled={q.isFetchingNextPage}
            onClick={() => void q.fetchNextPage()}
          >
            {q.isFetchingNextPage && <Spinner />}
            {t('loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}

export function CatalogueTable({ apps }: { apps: readonly MarketOperatorApp[] }) {
  const t = useTranslations(NS);
  const format = useFormatter();
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[76rem] text-sm">
        <caption className="sr-only">{t('tableCaption')}</caption>
        <thead className="bg-muted text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.app')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.kind')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.category')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.status')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.versions')}
            </th>
            <th scope="col" className="px-3 py-2 text-end font-medium">
              {t('cols.installs')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.pricing')}
            </th>
            <th scope="col" className="px-3 py-2 text-end font-medium">
              {t('cols.subscriptions')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.planFeature')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {apps.map((a) => (
            <tr key={a.id} data-testid={`app-${a.slug}`}>
              <th scope="row" className="px-3 py-3 text-start align-top font-normal">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={listingHref(a)} className={textLink}>
                    {a.name}
                  </Link>
                  {a.firstParty && <Badge tone="success">{t('badges.firstParty')}</Badge>}
                  {a.featured && <Badge tone="warning">{t('badges.featured')}</Badge>}
                </div>
                <div className="mt-0.5 font-mono text-xs text-muted-foreground" dir="ltr">
                  {a.slug}
                </div>
              </th>
              <td className="px-3 py-3 align-top">
                <KindLabel kind={a.kind} />
                {a.connectorType && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    <ConnectorLabel type={a.connectorType} />
                  </div>
                )}
              </td>
              <td className="px-3 py-3 align-top">{a.category.name}</td>
              <td className="px-3 py-3 align-top">
                <AppStatusBadge status={a.status} />
                {a.status === 'killed' && a.killReason && (
                  <div className="mt-1 max-w-xs text-xs text-danger" dir="auto">
                    {t('killedReason', { reason: a.killReason })}
                  </div>
                )}
                {a.publishedAt && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    <time dateTime={a.publishedAt}>
                      {format.dateTime(new Date(a.publishedAt), { dateStyle: 'medium' })}
                    </time>
                  </div>
                )}
              </td>
              <td className="px-3 py-3 align-top text-xs">
                <div>
                  {t('versionPublished')}:{' '}
                  <span className="font-mono" dir="ltr">
                    {a.publishedVersion ?? t('dash')}
                  </span>
                </div>
                <div className="text-muted-foreground">
                  {t('versionLatest')}:{' '}
                  <span className="font-mono" dir="ltr">
                    {a.latestVersion ?? t('dash')}
                  </span>
                </div>
              </td>
              <td className="px-3 py-3 text-end align-top tabular-nums">{a.installCount}</td>
              <td className="px-3 py-3 align-top">
                <PriceCell pricing={a.pricing} />
              </td>
              <td className="px-3 py-3 text-end align-top tabular-nums">
                {a.pricing.model === 'free' && a.activeSubscriptions === 0 ? (
                  <span className="text-muted-foreground">{t('dash')}</span>
                ) : (
                  <Link href={subscriptionsHref(a.slug)} className={textLink}>
                    {a.activeSubscriptions}
                    <span className="sr-only"> {t('viewSubscriptions', { name: a.name })}</span>
                  </Link>
                )}
              </td>
              <td className="px-3 py-3 align-top">
                {a.planFeature ? (
                  <code className="font-mono text-xs" dir="ltr">
                    {a.planFeature}
                  </code>
                ) : (
                  <span className="text-xs text-muted-foreground">{t('everyPlan')}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
