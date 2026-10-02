'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Badge, Button, ConfirmDialog, EmptyState, Input, cn, useToast } from '@crm/ui';
import { PRODUCTS_PAGE_SIZE, type ProductResponse } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS } from '../api/catalog';
import { deleteProduct, useProductsPage } from '../api/products';
import { parseProductsState, productsStateToSearch } from '../lib/pages';
import { truncate } from '../lib/format';
import { PlusIcon, SearchIcon } from './icons';
import { CARD, LoadError, LoadingBlock, Pager, PILL_LINK, ProductThumb, TH } from './parts';
import { ProductShareModal } from './product-share-modal';
import { useErrorText } from './use-error-text';

const ROW_BTN =
  'text-[11px] outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-primary rounded-sm';

/**
 * `/store/products` (TW-CAT-019, 021, 022): the workspace's product table with name and SKU search, numbered pages of 25 and the
 * row actions Share, Edit and Delete. The search and the page live in the address.
 */
export function ProductsScreen() {
  const t = useTranslations('catalogProducts.products');
  const errorText = useErrorText();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canCreate = useCan('cat.products.create');
  const canUpdate = useCan('cat.products.update');
  const canDelete = useCan('cat.products.delete');

  const state = useMemo(() => parseProductsState(new URLSearchParams(search.toString())), [search]);
  const go = (patch: Partial<typeof state>) =>
    router.replace(`${pathname}${productsStateToSearch({ ...state, ...patch })}`, {
      scroll: false,
    });

  const [q, setQ] = useState(state.q);
  const [seenQ, setSeenQ] = useState(state.q);
  if (state.q !== seenQ) {
    // The address changed under us (back button): follow it.
    setSeenQ(state.q);
    setQ(state.q);
  }

  const list = useProductsPage(state);
  const [sharing, setSharing] = useState<ProductResponse | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProductResponse | null>(null);
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteProduct(pendingDelete.id);
      toast(t('deleted'), 'success');
      setPendingDelete(null);
      await qc.invalidateQueries({ queryKey: KEYS.products });
    } catch (e) {
      toast(errorText(e), 'danger');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main className="mx-auto max-w-none px-4 py-7 sm:px-6 lg:px-7">
      <section className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {t('kicker')}
            </div>
            <h1 className="font-serif text-[26px] font-normal leading-tight tracking-tight sm:text-[34px]">
              {t('title')}
            </h1>
          </div>
          {canCreate && (
            <Link href="/store/products/create" className={PILL_LINK}>
              <PlusIcon className="size-3.5" />
              {t('add')}
            </Link>
          )}
        </div>

        <div className={CARD}>
          <div className="border-b border-border px-4 py-3">
            <form
              role="search"
              className="relative max-w-[480px]"
              onSubmit={(e) => {
                e.preventDefault();
                go({ q: q.trim(), page: 1 });
              }}
            >
              <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('search')}
                aria-label={t('search')}
                maxLength={100}
                className="h-9 ps-9 text-[12.5px]"
              />
            </form>
          </div>

          <div
            className={cn('transition-opacity', list.isFetching && !list.isPending && 'opacity-60')}
          >
            {list.isPending ? (
              <LoadingBlock label={t('loading')} />
            ) : list.isError ? (
              <div className="p-4">
                <LoadError
                  error={list.error}
                  title={t('loadError')}
                  onRetry={() => void list.refetch()}
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-[12.5px]">
                  <thead className="border-b border-border bg-muted text-muted-foreground">
                    <tr>
                      <th className={cn(TH, 'px-4')}>{t('col.image')}</th>
                      <th className={TH}>{t('col.name')}</th>
                      <th className={TH}>{t('col.sku')}</th>
                      <th className={cn(TH, 'text-end')}>{t('col.price')}</th>
                      <th className={TH}>{t('col.stock')}</th>
                      <th className={cn(TH, 'w-[280px] px-4 text-end')}>{t('col.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {list.items.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                          {state.q ? (
                            <EmptyState
                              title={t('noMatchTitle')}
                              message={t('noMatchBody', { q: state.q })}
                              className="border-0"
                              actions={
                                <Button variant="secondary" onClick={() => go({ q: '', page: 1 })}>
                                  {t('clearSearch')}
                                </Button>
                              }
                            />
                          ) : (
                            <>
                              <div className="font-serif text-[20px] text-foreground/80">
                                {t('emptyTitle')}
                              </div>
                              <p className="mt-1 text-[12.5px]">{t('emptyBody')}</p>
                            </>
                          )}
                        </td>
                      </tr>
                    ) : (
                      list.items.map((p) => (
                        <tr key={p.id} className="hover:bg-muted/50">
                          <td className="px-4 py-2.5">
                            <ProductThumb url={p.imageUrl} size="size-12" glyph="image" />
                          </td>
                          <td className="px-2 py-2.5">
                            <div className="font-medium">{p.name}</div>
                            {p.description ? (
                              <div className="max-w-md truncate text-[10.5px] text-muted-foreground">
                                {truncate(p.description, 80)}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-2 py-2.5 font-mono text-[11px]">{p.sku || '—'}</td>
                          <td className="px-2 py-2.5 text-end font-semibold tabular-nums">
                            {p.priceDisplay}
                          </td>
                          <td className="px-2 py-2.5">
                            <Badge
                              tone={p.inStock ? 'success' : 'neutral'}
                              className="gap-1 font-mono text-[10.5px]"
                            >
                              <span
                                className={cn(
                                  'size-1.5 rounded-full',
                                  p.inStock ? 'bg-success' : 'bg-border',
                                )}
                              />
                              {p.inStock ? t('inStock') : t('out')}
                            </Badge>
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-end">
                            <button
                              type="button"
                              onClick={() => setSharing(p)}
                              className={cn(
                                ROW_BTN,
                                'me-2 font-semibold text-brand dark:text-primary',
                              )}
                            >
                              {t('share')}
                            </button>
                            {canUpdate && (
                              <Link
                                href={`/store/products/${p.id}/edit`}
                                className={cn(ROW_BTN, 'me-2')}
                              >
                                {t('edit')}
                              </Link>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() => setPendingDelete(p)}
                                className={cn(ROW_BTN, 'text-danger')}
                              >
                                {t('delete')}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {list.total !== undefined && list.total > 0 && (
            <div
              className="border-t border-border px-4 py-3 text-center font-mono text-[11px] text-muted-foreground"
              aria-live="polite"
            >
              {t('showing', { shown: list.items.length, total: list.total })}
            </div>
          )}
        </div>
        <Pager
          page={list.page}
          total={list.total}
          size={PRODUCTS_PAGE_SIZE}
          onPage={(page) => go({ page })}
        />
      </section>

      <ProductShareModal product={sharing} onClose={() => setSharing(null)} />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('deleteTitle')}
        message={t('deleteBody', { name: pendingDelete?.name ?? '' })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onClose={() => setPendingDelete(null)}
      />
    </main>
  );
}
