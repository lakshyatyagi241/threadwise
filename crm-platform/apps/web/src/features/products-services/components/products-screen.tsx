'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ListSalesItemsQuery, SalesItem, SalesItemKind } from '@crm/contracts';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Input,
  Select,
  Spinner,
  useToast,
} from '@crm/ui';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { useSalesItemMutations, useSalesItems } from '../api/hooks';
import { formatPrice } from '../lib/money';
import { ItemFormModal } from './item-form-modal';

const PAGE = 25;
type Tab = 'all' | 'active' | 'inactive';

/** `/products-services`: the price list of the Products and services add-on. */
export function ProductsScreen() {
  const t = useTranslations('products-services');
  const locale = useLocale();
  const { toast } = useToast();
  const session = useSession();
  const canCreate = useCan('record.sales-items.create');
  const canUpdate = useCan('record.sales-items.update');
  const canDelete = useCan('record.sales-items.delete');
  const [tab, setTab] = useState<Tab>('all');
  const [kind, setKind] = useState<'' | SalesItemKind>('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<SalesItem | 'new' | null>(null);
  const [deleting, setDeleting] = useState<SalesItem | null>(null);
  const { update, remove } = useSalesItemMutations();

  const query: Partial<ListSalesItemsQuery> = {
    page,
    limit: PAGE,
    status: tab,
    ...(kind ? { kind } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
  };
  const list = useSalesItems(query);
  const counts = list.data?.counts;
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const defaultCurrency =
    (session as { org?: { currency?: string | null } }).org?.currency ?? 'INR';

  async function toggle(item: SalesItem) {
    try {
      await update.mutateAsync({
        id: item.id,
        input: { isActive: !item.isActive, rowVersion: item.rowVersion },
      });
      toast(
        t(item.isActive ? 'toast.deactivated' : 'toast.activated', { name: item.name }),
        'success',
      );
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('toast.failed'), 'danger');
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      toast(t('toast.deleted', { name: deleting.name }), 'success');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('toast.failed'), 'danger');
    } finally {
      setDeleting(null);
    }
  }

  const tabs: Array<[Tab, number | undefined]> = [
    ['all', counts?.all],
    ['active', counts?.active],
    ['inactive', counts?.inactive],
  ];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canCreate && (
          <Button variant="brand" onClick={() => setEditing('new')}>
            {t('add')}
          </Button>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label={t('tabsLabel')} className="flex gap-1">
          {tabs.map(([id, n]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => {
                setTab(id);
                setPage(1);
              }}
              className={
                tab === id
                  ? 'rounded-full bg-brand px-3 py-1 text-xs font-semibold text-brand-foreground'
                  : 'rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted'
              }
            >
              {t(`tabs.${id}`)}
              {n !== undefined && <span className="ms-1 tabular-nums">{n}</span>}
            </button>
          ))}
        </div>
        <Select
          aria-label={t('kindFilter')}
          value={kind}
          className="w-40"
          onChange={(e) => {
            setKind(e.target.value as '' | SalesItemKind);
            setPage(1);
          }}
        >
          <option value="">{t('allKinds')}</option>
          <option value="product">{t('form.kinds.product')}</option>
          <option value="service">{t('form.kinds.service')}</option>
        </Select>
        <Input
          type="search"
          aria-label={t('search')}
          placeholder={t('search')}
          className="max-w-xs"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {list.isPending ? (
        <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : list.isError ? (
        <p role="alert" className="py-8 text-sm text-danger">
          {t('loadFailed')}{' '}
          <button type="button" className="underline" onClick={() => void list.refetch()}>
            {t('retry')}
          </button>
        </p>
      ) : (list.data?.data ?? []).length === 0 ? (
        <EmptyState
          title={counts?.all === 0 ? t('emptyTitle') : t('noMatchTitle')}
          message={counts?.all === 0 ? t('empty') : t('noMatch')}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-background">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('caption')}</caption>
            <thead className="bg-muted/40 text-start text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {['name', 'kind', 'price', 'tax', 'status'].map((c) => (
                  <th key={c} scope="col" className="px-4 py-2 text-start font-medium">
                    {t(`col.${c}`)}
                  </th>
                ))}
                <th scope="col" className="px-4 py-2">
                  <span className="sr-only">{t('col.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(list.data?.data ?? []).map((item) => (
                <tr key={item.id} className={item.isActive ? '' : 'text-muted-foreground'}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium" dir="auto">
                      {item.name}
                    </div>
                    {item.sku && (
                      <div className="font-mono text-xs text-muted-foreground" dir="ltr">
                        {item.sku}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge>{t(`form.kinds.${item.kind}`)}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums" dir="ltr">
                    {formatPrice(item.unitPriceMinor, item.currency, locale)}
                    {item.unit && (
                      <span className="text-xs text-muted-foreground"> / {item.unit}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {item.taxRatePercent === null ? '—' : `${item.taxRatePercent}%`}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge>{t(item.isActive ? 'statusActive' : 'statusInactive')}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-end">
                    <div className="flex justify-end gap-2">
                      {canUpdate && (
                        <>
                          <Button size="sm" variant="secondary" onClick={() => setEditing(item)}>
                            {t('edit')}
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => void toggle(item)}>
                            {item.isActive ? t('deactivate') : t('activate')}
                          </Button>
                        </>
                      )}
                      {canDelete && (
                        <Button size="sm" variant="secondary" onClick={() => setDeleting(item)}>
                          {t('delete')}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-end gap-3 text-sm" aria-label={t('paging')}>
          <Button
            size="sm"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {t('previous')}
          </Button>
          <span className="tabular-nums text-muted-foreground">{t('pageOf', { page, pages })}</span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            {t('next')}
          </Button>
        </nav>
      )}

      {editing !== null && (
        <ItemFormModal
          item={editing === 'new' ? undefined : editing}
          defaultCurrency={defaultCurrency}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            toast(t('toast.saved', { name: saved.name }), 'success');
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        busy={remove.isPending}
        title={t('deleteTitle', { name: deleting?.name ?? '' })}
        message={t('deleteMessage')}
        confirmLabel={t('delete')}
        cancelLabel={t('form.cancel')}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
