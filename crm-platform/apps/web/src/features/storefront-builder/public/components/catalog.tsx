'use client';

import type { PublicHome } from '@crm/contracts';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { fetchMoreProducts } from '../api/client';
import {
  DEFAULT_FILTERS,
  applyFilters,
  categoriesOf,
  isSortMode,
  mergeProducts,
  priceRange,
  sortProducts,
  type FilterState,
  type SortMode,
} from '../lib/catalog';
import { formatIn } from '../lib/money';
import { ChevronDownIcon, GridIcon, ListIcon } from './icons';
import { ProductCard } from './product-card';
import { useStore } from './store-provider';

/**
 * The catalog of the home page (WD-STORE-009, WD-STORE-031): toolbar, filter sidebar, product grid and "Show more". Search, filter
 * and sort narrow the products loaded so far; "Show more" loads the next page through the shop's own route handler.
 */
export function Catalog({ home }: { home: PublicHome }) {
  const t = useTranslations('shopPublic');
  const { shop, search, setSearch, register } = useStore();
  const uid = useId();
  const [products, setProducts] = useState(home.products);
  const [loadedPage, setLoadedPage] = useState(home.page);
  const [hasMore, setHasMore] = useState(home.hasMore);
  const [total, setTotal] = useState(home.total);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  // QUIRK (WaDesk): "Featured" keeps the order of the last sort; this is that order.
  const [lastOrder, setLastOrder] = useState<string[] | null>(null);

  const state = useMemo<FilterState>(() => ({ ...filters, term: search }), [filters, search]);
  const shown = useMemo(
    () => applyFilters(products, state, lastOrder),
    [products, state, lastOrder],
  );
  const categories = useMemo(() => categoriesOf(products), [products]);
  const range = useMemo(() => priceRange(products), [products]);

  const patch = (p: Partial<FilterState>) => setFilters((f) => ({ ...f, ...p }));
  const pickSort = (mode: SortMode) => {
    patch({ sort: mode });
    if (mode !== 'featured') setLastOrder(sortProducts(products, mode).map((p) => p.id));
  };
  const toggleCategory = (c: string) =>
    patch({
      categories: filters.categories.includes(c)
        ? filters.categories.filter((x) => x !== c)
        : [...filters.categories, c],
    });
  // The header's search box lives in the store provider; "reset" clears it too.
  const reset = () => {
    setFilters(DEFAULT_FILTERS);
    setSearch('');
  };

  const showMore = async () => {
    setLoading(true);
    setFailed(false);
    const res = await fetchMoreProducts(shop.slug, loadedPage + 1);
    setLoading(false);
    if (!res.ok) {
      setFailed(true);
      return;
    }
    register(res.data.products);
    const merged = mergeProducts(products, res.data.products);
    setProducts(merged);
    if (filters.sort !== 'featured')
      setLastOrder(sortProducts(merged, filters.sort).map((p) => p.id));
    setLoadedPage(res.data.page);
    setHasMore(res.data.hasMore);
    setTotal(res.data.total);
  };

  if (products.length === 0) {
    return (
      <div className="sf-empty-page">
        <h2>{t('catalog.emptyTitle')}</h2>
        <p>{t('catalog.emptyBody')}</p>
      </div>
    );
  }

  return (
    <section className="sf-catalog" id="categories" aria-label={t('catalog.label')}>
      <div className="sf-toolbar">
        <div className="sf-count" role="status" aria-live="polite">
          {t('catalog.count', { count: shown.length })}
        </div>
        <div className="sf-toolbar-end">
          <label className="sf-sr" htmlFor={`${uid}-sort`}>
            {t('catalog.sort.label')}
          </label>
          <select
            id={`${uid}-sort`}
            value={filters.sort}
            onChange={(e) => isSortMode(e.target.value) && pickSort(e.target.value)}
          >
            <option value="featured">{t('catalog.sort.featured')}</option>
            <option value="price-asc">{t('catalog.sort.priceAsc')}</option>
            <option value="price-desc">{t('catalog.sort.priceDesc')}</option>
            <option value="name-asc">{t('catalog.sort.nameAsc')}</option>
            <option value="name-desc">{t('catalog.sort.nameDesc')}</option>
          </select>
          <div className="sf-view-toggle" role="group" aria-label={t('catalog.view.label')}>
            <button
              type="button"
              aria-pressed={view === 'grid'}
              className={view === 'grid' ? 'is-on' : ''}
              aria-label={t('catalog.view.grid')}
              onClick={() => setView('grid')}
            >
              <GridIcon size={13} />
            </button>{' '}
            <button
              type="button"
              aria-pressed={view === 'list'}
              className={view === 'list' ? 'is-on' : ''}
              aria-label={t('catalog.view.list')}
              onClick={() => setView('list')}
            >
              <ListIcon size={13} />
            </button>
          </div>
        </div>
      </div>

      <div className="sf-shop-layout">
        <aside className="sf-filters" aria-label={t('catalog.filters.title')}>
          <h3>{t('catalog.filters.title')}</h3>
          {categories.length > 0 ? (
            <div
              className="sf-filter-group"
              role="group"
              aria-label={t('catalog.filters.category')}
            >
              <h3>{t('catalog.filters.category')}</h3>
              {categories.map((c) => (
                <label key={c}>
                  <input
                    type="checkbox"
                    checked={filters.categories.includes(c)}
                    onChange={() => toggleCategory(c)}
                  />
                  {c}
                </label>
              ))}
            </div>
          ) : null}
          {range.max > 0 ? (
            <div className="sf-filter-group" role="group" aria-label={t('catalog.filters.price')}>
              <h3>{t('catalog.filters.price')}</h3>
              <div className="sf-price-range">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={filters.min}
                  onChange={(e) => patch({ min: e.target.value })}
                  placeholder={t('catalog.filters.min')}
                  aria-label={t('catalog.filters.min')}
                />
                <span aria-hidden="true">—</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={filters.max}
                  onChange={(e) => patch({ max: e.target.value })}
                  placeholder={t('catalog.filters.max')}
                  aria-label={t('catalog.filters.max')}
                />
              </div>
              <div className="sf-range-hint">
                {t('catalog.filters.range', {
                  min: formatIn(range.min * 100, shop.currencyCode),
                  max: formatIn(range.max * 100, shop.currencyCode),
                })}
              </div>
            </div>
          ) : null}
          <div
            className="sf-filter-group"
            role="group"
            aria-label={t('catalog.filters.availability')}
          >
            <h3>{t('catalog.filters.availability')}</h3>
            <label>
              <input
                type="checkbox"
                checked={filters.inStockOnly}
                onChange={(e) => patch({ inStockOnly: e.target.checked })}
              />
              {t('catalog.filters.inStock')}
            </label>
            <label>
              <input
                type="checkbox"
                checked={filters.saleOnly}
                onChange={(e) => patch({ saleOnly: e.target.checked })}
              />
              {t('catalog.filters.onSale')}
            </label>
          </div>
          <button type="button" className="sf-reset" onClick={reset}>
            {t('catalog.filters.reset')}
          </button>
        </aside>

        <div className="sf-grid-wrap">
          {shown.length > 0 ? (
            <div className={`sf-grid${view === 'list' ? ' is-list' : ''}`}>
              {shown.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          ) : (
            <div className="sf-no-results">
              <div className="sf-no-results-title">{t('catalog.noMatch')}</div>
              <button type="button" className="sf-reset" onClick={reset}>
                {t('catalog.filters.clear')}
              </button>
            </div>
          )}
        </div>
      </div>

      {hasMore ? (
        <div className="sf-more">
          <button
            type="button"
            className="sf-more-btn"
            onClick={() => void showMore()}
            disabled={loading}
            aria-busy={loading}
          >
            <span>
              {loading ? t('catalog.loading') : failed ? t('catalog.retry') : t('catalog.showMore')}
            </span>
            <ChevronDownIcon size={12} />
          </button>
          {total > 0 ? (
            <div className="sf-more-count">
              {t('catalog.showing', { shown: products.length, total })}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
