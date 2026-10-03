'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Input, cn } from '@crm/ui';
import { CATALOG_SEND_MAX_PRODUCTS, type CatalogShop } from '@crm/contracts';
import { useProductPicker } from '../api/catalog';
import { groupByCategory, type SendForm } from '../lib/send-model';
import { SearchIcon } from './icons';
import { CARD, LoadError, ProductThumb, StepBadge, TEXT_LINK } from './parts';

/** The search box applies after the typing pauses, so each keystroke is not a request. */
function useDebounced(value: string, ms: number): string {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setOut(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return out;
}

/**
 * Step 03: the products of the chosen shop under their category (TW-CAT-014). Single product takes one card, the list up to
 * 30. The search runs on the server so a catalog larger than one picker page can still be searched.
 */
export function ProductsStep({
  form,
  shop,
  shops,
  onToggle,
}: {
  form: SendForm;
  /** The shop the picker is filtered by; empty when the workspace has no shop. */
  shop: string;
  shops: CatalogShop[];
  onToggle: (id: string) => void;
}) {
  const t = useTranslations('catalogProducts.send.products');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 250);
  const picker = useProductPicker({ shopId: shop, q, enabled: true });
  const groups = useMemo(
    () => groupByCategory(picker.data?.products ?? [], t('other')),
    [picker.data, t],
  );
  const shopName = shops.find((s) => s.id === shop)?.shopName ?? null;
  const selected = form.productIds.length;

  return (
    <section className={cn(CARD, 'p-5')} aria-labelledby="cat-send-products">
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <StepBadge n="03" />
        <h3
          id="cat-send-products"
          className="flex-1 font-serif text-[18px] font-normal leading-none"
        >
          {t('title')}{' '}
          <span
            className="font-mono text-[10px] font-normal text-muted-foreground"
            aria-live="polite"
          >
            {form.mode === 'mpm'
              ? t('selectedOf', { count: selected, max: CATALOG_SEND_MAX_PRODUCTS })
              : t('selected', { count: selected })}
          </span>
        </h3>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            className="h-9 w-52 rounded-full bg-muted ps-9 text-[12px]"
          />
        </div>
      </div>

      {shops.length > 0 && (
        <p className="mb-3 text-[11.5px] text-muted-foreground">
          {t.rich('showingFrom', {
            shop: shopName ?? '—',
            b: (chunks) => <b className="text-foreground">{chunks}</b>,
          })}
        </p>
      )}

      {picker.isPending ? (
        <p className="py-6 text-center text-[12px] text-muted-foreground">{t('loading')}</p>
      ) : picker.isError ? (
        <LoadError
          error={picker.error}
          title={t('loadError')}
          onRetry={() => void picker.refetch()}
        />
      ) : groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-[12px] text-muted-foreground">
          {q ? (
            t('noMatch')
          ) : (
            <>
              {shops.length > 0 ? t('emptyShop') : t('empty')}{' '}
              <Link href="/store/products/create" className={TEXT_LINK}>
                {t('addOne')}
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <details key={g.name} open className="rounded-xl border border-border bg-muted/30">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  {g.name} <span className="text-foreground">· {g.items.length}</span>
                </span>
                <span aria-hidden="true" className="font-mono text-[10.5px] text-muted-foreground">
                  ▾
                </span>
              </summary>
              <ul className="grid grid-cols-2 gap-1.5 border-t border-border p-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {g.items.map((p) => (
                  <li key={p.id}>
                    <label className="relative block cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.productIds.includes(p.id)}
                        onChange={() => onToggle(p.id)}
                        className="peer sr-only"
                      />
                      <span className="block overflow-hidden rounded-lg border border-border bg-background transition peer-checked:border-brand peer-checked:ring-2 peer-checked:ring-brand/25 peer-focus-visible:ring-2 peer-focus-visible:ring-primary">
                        <span className="grid h-20 place-items-center overflow-hidden bg-muted">
                          <ProductThumb
                            url={p.imageUrl}
                            size="h-20 w-full"
                            className="rounded-none"
                          />
                        </span>
                        <span className="block px-1.5 py-1">
                          <span className="block truncate text-[10.5px] font-semibold leading-tight">
                            {p.name}
                          </span>
                          <span className="block font-mono text-[9.5px] text-brand dark:text-primary">
                            {p.priceDisplay}
                          </span>
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
