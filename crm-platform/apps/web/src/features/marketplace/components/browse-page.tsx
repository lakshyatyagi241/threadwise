'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { marketAppCardSchema, type MarketAppKind } from '@crm/contracts';
import { Alert, Button, EmptyState, Input, Select, Spinner, cn } from '@crm/ui';
import { useCursorList } from '@/lib/api/use-cursor-list';
import { fetchCategories, mktKeys } from '../api';
import {
  AVAILABILITY_VIEWS,
  BROWSE_RETRY,
  SEARCH_MAX,
  SORT_OPTIONS,
  availabilityPatch,
  availabilityView,
  browseHref,
  emptyReason,
  hasActiveFilter,
  isAddonCard,
  knownCategory,
  listQuery,
  parseBrowseParams,
  showShelves,
  type BrowseFilters,
} from '../lib/browse';
import { isPlanGate, mktError } from '../lib/errors';
import { AppCard } from './app-card';
import { CategoryList, RequestBox, Shelves } from './browse-parts';
import { SearchIcon } from './icons';
import { MarketplaceHeader } from './marketplace-header';
import { ToolCards } from './tool-cards';
import { ErrorPanel, LoadingBlock, PAGE, TEXT_LINK } from './ui';

const DEBOUNCE_MS = 300;

/**
 * One tab of the Marketplace (`/marketplace/apps` or `/marketplace/integrations`): category list, search, the availability chips (All, Available add-ons, Installed), the
 * sort, the Popular / New / Featured shelves while nothing narrows the list, the results grid with "Load more" (the API has no
 * total), and the request box. Every filter lives in the address, so a view can be shared and the back button works.
 */
export function BrowsePage({ kind }: { kind: MarketAppKind }) {
  const t = useTranslations('marketplace.browse');
  const router = useRouter();
  const params = useSearchParams();
  const filters = parseBrowseParams(params);

  const go = (next: Partial<BrowseFilters>) =>
    router.replace(browseHref(kind, { ...filters, ...next }), { scroll: false });

  // The search box is local so typing is instant; the address follows after a pause.
  const [draft, setDraft] = useState(filters.q);
  const lastUrlQ = useRef(filters.q);
  useEffect(() => {
    if (filters.q !== lastUrlQ.current) {
      // The address changed from outside the box (a link, back, "clear filters"): the box follows it.
      lastUrlQ.current = filters.q;
      setDraft(filters.q);
    }
  }, [filters.q]);
  useEffect(() => {
    const next = draft.trim().slice(0, SEARCH_MAX);
    if (next === filters.q) return;
    const id = setTimeout(() => {
      lastUrlQ.current = next;
      router.replace(browseHref(kind, { ...filters, q: next }), { scroll: false });
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `filters` is rebuilt from the address on every render; its fields are the dependencies below
  }, [draft, filters.q, filters.category, filters.installed, filters.addons, filters.sort, kind]);

  const categories = useQuery({
    queryKey: mktKeys.categories(kind),
    queryFn: ({ signal }) => fetchCategories(kind, signal),
    staleTime: 60_000,
    ...BROWSE_RETRY,
  });
  const list = useCursorList(
    mktKeys.apps(kind),
    '/marketplace/apps',
    marketAppCardSchema,
    listQuery(kind, filters),
    BROWSE_RETRY,
  );

  // The whole Marketplace is behind a plan feature: one clear panel instead of two failed regions.
  const gate = [categories.error, list.error].find((e) => e && isPlanGate(mktError(e)));
  if (gate) {
    return (
      <div className={PAGE}>
        <MarketplaceHeader section={kind === 'mini_app' ? 'apps' : 'integrations'} />
        <ErrorPanel error={gate} />
      </div>
    );
  }

  const cats = categories.data?.data ?? [];
  const unknownCategory = categories.isSuccess && !knownCategory(cats, filters.category);
  const filtered = hasActiveFilter(filters);
  const moreError = list.isFetchNextPageError ? list.error : null;
  // Add-ons are picked from the loaded cards (the list API has no availability filter), so a page with none may still have more.
  const items = filters.addons ? list.items.filter(isAddonCard) : list.items;

  return (
    <div className={PAGE}>
      <MarketplaceHeader section={kind === 'mini_app' ? 'apps' : 'integrations'} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-0 flex-1 basis-60">
          <label htmlFor="mkt-search" className="sr-only">
            {t('searchLabel')}
          </label>
          <SearchIcon className="pointer-events-none absolute inset-y-0 start-3 my-auto text-muted-foreground" />
          <Input
            id="mkt-search"
            type="search"
            value={draft}
            maxLength={SEARCH_MAX}
            placeholder={t(`searchPlaceholder.${kind}`)}
            onChange={(e) => setDraft(e.target.value)}
            className="ps-9"
          />
        </div>
        <div role="group" aria-label={t('availability.label')} className="flex flex-wrap gap-1.5">
          {AVAILABILITY_VIEWS.map((v) => {
            const on = availabilityView(filters) === v;
            return (
              <button
                key={v}
                type="button"
                aria-pressed={on}
                data-testid={`mkt-availability-${v}`}
                onClick={() => go(availabilityPatch(v))}
                className={cn(
                  'h-9 rounded-full border px-3 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  on
                    ? 'border-primary bg-primary/10 font-medium text-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {t(`availability.${v}`)}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="mkt-sort" className="text-sm text-muted-foreground">
            {t('sortLabel')}
          </label>
          <Select
            id="mkt-sort"
            value={filters.sort}
            onChange={(e) => go({ sort: e.target.value as BrowseFilters['sort'] })}
            className="w-auto"
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(`sort.${s}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <div>
          {categories.isPending ? (
            <LoadingBlock />
          ) : categories.isError ? (
            <ErrorPanel error={categories.error} onRetry={() => void categories.refetch()} />
          ) : (
            <CategoryList kind={kind} categories={cats} filters={filters} />
          )}
        </div>

        <div className="min-w-0 space-y-6">
          {unknownCategory && (
            <Alert tone="warning">
              {t('unknownCategory')}{' '}
              <Link href={browseHref(kind, { ...filters, category: null })} className={TEXT_LINK}>
                {t('showAll')}
              </Link>
            </Alert>
          )}

          {kind === 'integration' && showShelves(filters) && <ToolCards tab="integrations" />}

          {showShelves(filters) && <Shelves kind={kind} />}

          <section aria-labelledby="mkt-results" className="space-y-3">
            <h2 id="mkt-results" className="text-base font-semibold">
              {filtered ? t('resultsFiltered') : t('resultsAll')}
            </h2>
            <p aria-live="polite" className="sr-only">
              {list.isSuccess ? t('loadedCount', { count: items.length }) : ''}
            </p>

            {list.isPending ? (
              <LoadingBlock />
            ) : list.isError ? (
              <ErrorPanel error={list.error} onRetry={() => void list.refetch()} />
            ) : items.length === 0 && !list.hasNextPage ? (
              <EmptyState
                title={t(`empty.${emptyReason(filters)}.title`)}
                message={t(`empty.${emptyReason(filters)}.message`)}
                actions={
                  filtered ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setDraft('');
                        lastUrlQ.current = '';
                        router.replace(browseHref(kind), { scroll: false });
                      }}
                    >
                      {t('clearFilters')}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <div className="grid auto-rows-fr gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {items.map((card) => (
                    <AppCard key={card.id} card={card} />
                  ))}
                </div>
                {list.hasNextPage && (
                  <div className="flex justify-center">
                    <Button
                      variant="secondary"
                      onClick={() => void list.fetchNextPage()}
                      disabled={list.isFetchingNextPage}
                    >
                      {list.isFetchingNextPage && <Spinner />}
                      {t('loadMore')}
                    </Button>
                  </div>
                )}
                {moreError ? (
                  <ErrorPanel error={moreError} onRetry={() => void list.fetchNextPage()} />
                ) : null}
              </>
            )}
          </section>

          {list.isSuccess && <RequestBox kind={kind} name={filters.q} />}
        </div>
      </div>
    </div>
  );
}
