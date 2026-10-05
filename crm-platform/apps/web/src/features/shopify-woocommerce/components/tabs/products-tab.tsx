'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import type { DashboardProduct, StoreDashboard } from '@crm/contracts';
import { money, type Kind } from '../../lib/model';
import { SearchIcon, SendIcon } from '../ecom-icons';

/** One product card. Shopify cards also carry the Send (catalog composer) and Offer (offer tab) actions. */
function Card({ p, currency, kind }: { p: DashboardProduct; currency: string; kind: Kind }) {
  const t = useTranslations('ecom.products');
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
      <div className="relative aspect-square bg-muted">
        {p.imageUrl ? (
          <img src={p.imageUrl} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-xs text-muted-foreground">
            {t('noImage')}
          </div>
        )}
        {p.discountPct > 0 && (
          <span className="absolute left-2 top-2 rounded-full bg-danger px-2 py-0.5 text-[10px] font-semibold text-white">
            {t('save', { pct: p.discountPct })}
          </span>
        )}
      </div>
      <div className="space-y-1 p-3">
        <div className="truncate text-[13px] font-medium" title={p.title}>
          {p.title}
        </div>
        {kind === 'shopify' && p.vendor && (
          <div className="truncate text-[11px] text-muted-foreground">{p.vendor}</div>
        )}
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold tabular-nums">{money(p.price, currency)}</span>
          {p.comparePrice !== null && p.comparePrice > p.price && (
            <span className="text-[11px] text-muted-foreground line-through">
              {money(p.comparePrice, currency)}
            </span>
          )}
        </div>
        {kind === 'woocommerce' && (
          <div className={cn('text-[11px]', p.inStock ? 'text-success' : 'text-danger')}>
            {p.inStock ? t('inStock') : t('outOfStock')}
          </div>
        )}
        {kind === 'shopify' && (
          <div className="flex gap-2 pt-1">
            <Link
              href={`/catalog/send?product=${encodeURIComponent(p.id)}`}
              className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-full bg-brand text-[11px] font-semibold text-white hover:opacity-90"
            >
              <SendIcon className="size-3" />
              {t('send')}
            </Link>
            <Link
              href={`/shopify?tab=offers&product=${encodeURIComponent(p.id)}`}
              className="inline-flex h-8 flex-1 items-center justify-center rounded-full border border-border text-[11px] font-medium hover:bg-muted"
            >
              {t('offer')}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

const Grid = ({ children }: { children: React.ReactNode }) => (
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{children}</div>
);

/**
 * The products tab (TW-ECOM-023). Shopify: search, brand chips, special offers, new arrivals and every product of the mirror.
 * WooCommerce: the newest products live from the store.
 */
export function ProductsTab({ kind, data }: { kind: Kind; data: StoreDashboard }) {
  const t = useTranslations('ecom.products');
  const [query, setQuery] = useState('');
  const [brand, setBrand] = useState('');
  const brands = useMemo(
    () =>
      [...new Set(data.products.map((p) => p.vendor).filter((v): v is string => !!v))].slice(0, 8),
    [data.products],
  );

  if (kind === 'woocommerce') {
    return data.products.length === 0 ? (
      <p className="rounded-2xl border border-border bg-background p-10 text-center text-sm text-muted-foreground">
        {t('wooNone')}
      </p>
    ) : (
      <Grid>
        {data.products.map((p) => (
          <Card key={p.id} p={p} currency={data.currency} kind={kind} />
        ))}
      </Grid>
    );
  }

  const q = query.trim().toLowerCase();
  const match = (p: DashboardProduct) =>
    (q === '' || p.title.toLowerCase().includes(q)) &&
    (brand === '' || (p.vendor ?? '').toLowerCase() === brand.toLowerCase());
  const section = (title: string, list: DashboardProduct[], extra?: React.ReactNode) => {
    const shown = list.filter(match);
    if (list.length === 0) return null;
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[19px] font-normal">{title}</h3>
          {extra}
        </div>
        {shown.length === 0 ? null : (
          <Grid>
            {shown.map((p) => (
              <Card key={p.id} p={p} currency={data.currency} kind={kind} />
            ))}
          </Grid>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 shadow-sm">
        <SearchIcon className="size-4 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          className="flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      {brands.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {brands.map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={brand === b}
              onClick={() => setBrand(brand === b ? '' : b)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs',
                brand === b
                  ? 'border-brand bg-brand/10 font-medium text-brand'
                  : 'border-border hover:bg-muted',
              )}
            >
              {b}
            </button>
          ))}
        </div>
      )}
      {section(
        t('offers'),
        data.offers,
        <Link href="/catalog" className="text-xs font-medium text-brand hover:underline">
          {t('catalog')}
        </Link>,
      )}
      {section(t('newArrivals'), data.newArrivals)}
      {data.products.length === 0 ? (
        <p className="rounded-2xl border border-border bg-background p-10 text-center text-sm text-muted-foreground">
          {t('none')}
        </p>
      ) : (
        <>
          {section(t('all'), data.products)}
          {data.products.filter(match).length === 0 && (
            <p className="text-center text-sm text-muted-foreground">{t('noMatch')}</p>
          )}
        </>
      )}
    </div>
  );
}
