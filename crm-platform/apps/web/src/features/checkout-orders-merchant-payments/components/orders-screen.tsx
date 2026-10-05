'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { StoreOrderListItem } from '@crm/contracts';
import { Button, ConfirmDialog, EmptyState, Input, Select, cn, useToast } from '@crm/ui';
import { StoreShell } from '@/features/storefront-builder';
import { chkApi } from '../api/service';
import { invalidateOrders, useDeleteOrder, useOrderCounts, useOrders } from '../api/hooks';
import { formatMoney, formatWhen, withShop, displayPhone } from '../lib/format';
import {
  hasActiveFilter,
  isInvertedRange,
  ordersQuery,
  ordersSearch,
  parseOrdersFilters,
  resetOrdersFilters,
  type OrdersFilters,
} from '../lib/orders-filters';
import { ORDER_SOURCES, ORDER_STATUSES, PAYMENT_STATUSES, isTerminalStatus } from '../lib/status';
import {
  ErrorPanel,
  Eyebrow,
  LinkButton,
  LoadMore,
  NoAccess,
  OrderStatusBadge,
  PaymentStatusBadge,
  SourceBadge,
  TableSkeleton,
  Th,
  useErrorLine,
  useShopParam,
  useStoreCan,
  useStoreShops,
} from './parts';

/** `/store/orders`: every order of the workspace with status tabs, filters kept in the address, and quick actions per row. */
export function OrdersScreen() {
  return (
    <StoreShell>
      <OrdersContent />
    </StoreShell>
  );
}

/** The page without the store frame (what the render tests exercise). */
export function OrdersContent() {
  const can = useStoreCan('orders');
  if (!can.read) return <NoAccess />;
  return <OrdersList canManage={can.manage} canDelete={can.delete} />;
}

const DEBOUNCE_MS = 350;

function OrdersList({ canManage, canDelete }: { canManage: boolean; canDelete: boolean }) {
  const t = useTranslations('checkout-orders-merchant-payments.orders');
  const tc = useTranslations('checkout-orders-merchant-payments.common');
  const ts = useTranslations('checkout-orders-merchant-payments.status');
  const tSource = useTranslations('checkout-orders-merchant-payments.source');
  const tPay = useTranslations('checkout-orders-merchant-payments.paymentStatus');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const shop = useShopParam();
  const { toast } = useToast();
  const errLine = useErrorLine();
  const qc = useQueryClient();

  const filters = useMemo(() => parseOrdersFilters(searchParams), [searchParams]);
  const filtersRef = useRef(filters);
  useEffect(() => {
    filtersRef.current = filters;
  });

  const go = (next: OrdersFilters) => {
    const s = ordersSearch(next, shop);
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };
  const patch = (p: Partial<OrdersFilters>) => go({ ...filters, ...p });

  // The search box types freely and writes the address 350 ms after the last key.
  const [qText, setQText] = useState(filters.q);
  const pushedQ = useRef(filters.q);
  useEffect(() => {
    if (filters.q !== pushedQ.current) {
      pushedQ.current = filters.q;
      setQText(filters.q);
    }
  }, [filters.q]);
  useEffect(() => {
    const next = qText.trim();
    if (next === pushedQ.current) return;
    const timer = setTimeout(() => {
      pushedQ.current = next;
      go({ ...filtersRef.current, q: next });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `go` only reads the address; the timer must restart on typing alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qText]);

  const list = useOrders(ordersQuery(filters));
  const counts = useOrderCounts();
  const shops = useStoreShops(shop);
  const shopList = shops.data?.shops ?? [];
  const showShopFilter = shopList.length >= 2;

  const statusM = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      chkApi.updateOrderStatus(id, { status: status as (typeof ORDER_STATUSES)[number] }),
    onSuccess: () => invalidateOrders(qc),
  });
  const deleteM = useDeleteOrder();
  const [confirmStatus, setConfirmStatus] = useState<{
    order: StoreOrderListItem;
    status: string;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<StoreOrderListItem | null>(null);

  const applyStatus = (order: StoreOrderListItem, status: string) => {
    statusM.mutate(
      { id: order.id, status },
      {
        onSuccess: (res) => {
          const label = ts.has(status) ? ts(status) : status;
          toast(
            `${t('statusChanged', { no: order.orderNo, status: label })}${res.notified ? ` ${t('buyerNotified')}` : ''}`,
          );
        },
        onError: (e) => toast(errLine(e), 'danger'),
        onSettled: () => setConfirmStatus(null),
      },
    );
  };
  const onPickStatus = (order: StoreOrderListItem, status: string) => {
    if (status === order.status) return;
    if (isTerminalStatus(status)) setConfirmStatus({ order, status });
    else applyStatus(order, status);
  };
  const doDelete = () => {
    const order = confirmDelete;
    if (!order) return;
    deleteM.mutate(order.id, {
      onSuccess: () => toast(t('deleted', { no: order.orderNo })),
      onError: (e) => toast(errLine(e), 'danger'),
      onSettled: () => setConfirmDelete(null),
    });
  };

  const active = hasActiveFilter(filters);
  const inverted = isInvertedRange(filters);
  const tabs = ['all', ...ORDER_STATUSES] as const;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Eyebrow>{t('eyebrow')}</Eyebrow>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background">
        <div className="space-y-3 border-b border-border p-3 sm:p-4">
          <div
            role="group"
            aria-label={t('statusTabs')}
            className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
          >
            {tabs.map((k) => {
              const selected = filters.status === k;
              const n = counts.data?.[k];
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => patch({ status: k })}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold transition',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    selected
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground',
                  )}
                >
                  {k === 'all' ? tc('all') : ts(k)}
                  <span className="font-mono text-[10px] opacity-80">
                    {n === undefined ? '-' : n.toLocaleString(locale)}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <Input
                type="search"
                value={qText}
                onChange={(e) => setQText(e.target.value)}
                maxLength={120}
                placeholder={t('searchPlaceholder')}
                aria-label={t('searchLabel')}
              />
            </div>
            <Select
              value={filters.source}
              onChange={(e) => patch({ source: e.target.value })}
              aria-label={t('sourceLabel')}
            >
              <option value="all">{t('allSources')}</option>
              {ORDER_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {tSource(s)}
                </option>
              ))}
            </Select>
            <Select
              value={filters.paymentStatus}
              onChange={(e) => patch({ paymentStatus: e.target.value })}
              aria-label={t('paymentLabel')}
            >
              <option value="all">{t('allPayments')}</option>
              {PAYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {tPay(s)}
                </option>
              ))}
            </Select>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-10 shrink-0">{t('fromLabel')}</span>
              <Input
                type="date"
                value={filters.from}
                max={filters.to || undefined}
                onChange={(e) => patch({ from: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-10 shrink-0">{t('toLabel')}</span>
              <Input
                type="date"
                value={filters.to}
                min={filters.from || undefined}
                onChange={(e) => patch({ to: e.target.value })}
              />
            </label>
            {showShopFilter && (
              <Select
                value={filters.storefrontId}
                onChange={(e) => patch({ storefrontId: e.target.value })}
                aria-label={t('shopLabel')}
              >
                <option value="">{tc('allShops')}</option>
                {shopList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.shopName || s.slug}
                  </option>
                ))}
              </Select>
            )}
            {active && (
              <Button variant="ghost" onClick={() => go(resetOrdersFilters())}>
                {t('clearFilters')}
              </Button>
            )}
          </div>
          {inverted && (
            <p role="alert" className="text-xs text-danger">
              {t('invertedRange')}
            </p>
          )}
        </div>

        <div className="p-3 sm:p-4">
          {list.isPending ? (
            <TableSkeleton label={t('loading')} />
          ) : list.isError ? (
            <ErrorPanel error={list.error} onRetry={() => void list.refetch()} />
          ) : list.items.length === 0 ? (
            active ? (
              <EmptyState
                title={t('noMatchTitle')}
                message={t('noMatchMessage')}
                actions={
                  <Button onClick={() => go(resetOrdersFilters())}>{t('clearFilters')}</Button>
                }
              />
            ) : (
              <EmptyState
                title={t('emptyTitle')}
                message={t('emptyMessage')}
                actions={
                  <LinkButton href={withShop('/store', shop)}>{t('emptyAction')}</LinkButton>
                }
              />
            )
          ) : (
            <div className={cn(list.isPlaceholderData && 'opacity-60 transition-opacity')}>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[980px] text-sm">
                  <thead className="border-b border-border bg-muted text-muted-foreground">
                    <tr>
                      <Th>{t('cols.order')}</Th>
                      <Th>{t('cols.customer')}</Th>
                      <Th>{t('cols.items')}</Th>
                      <Th end>{t('cols.total')}</Th>
                      <Th>{t('cols.payment')}</Th>
                      <Th>{t('cols.status')}</Th>
                      <Th>{t('cols.source')}</Th>
                      <Th>{t('cols.created')}</Th>
                      <Th end>{t('cols.actions')}</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {list.items.map((o) => (
                      <OrderRow
                        key={o.id}
                        order={o}
                        shop={shop}
                        locale={locale}
                        showShopName={showShopFilter}
                        canManage={canManage}
                        canDelete={canDelete}
                        busy={statusM.isPending && statusM.variables?.id === o.id}
                        onStatus={onPickStatus}
                        onDelete={setConfirmDelete}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <LoadMore
                hasMore={list.hasNextPage}
                loading={list.isFetchingNextPage}
                onMore={() => void list.fetchNextPage()}
              />
            </div>
          )}
        </div>
      </div>

      {canManage && (
        <ConfirmDialog
          open={confirmStatus !== null}
          title={
            confirmStatus
              ? t('confirmStatusTitle', {
                  no: confirmStatus.order.orderNo,
                  status: ts.has(confirmStatus.status)
                    ? ts(confirmStatus.status)
                    : confirmStatus.status,
                })
              : ''
          }
          message={t('confirmStatusMessage')}
          confirmLabel={t('confirmStatusConfirm')}
          cancelLabel={tc('cancel')}
          busy={statusM.isPending}
          onConfirm={() => confirmStatus && applyStatus(confirmStatus.order, confirmStatus.status)}
          onClose={() => setConfirmStatus(null)}
        />
      )}
      {canDelete && (
        <ConfirmDialog
          open={confirmDelete !== null}
          title={confirmDelete ? t('deleteTitle', { no: confirmDelete.orderNo }) : ''}
          message={t('deleteMessage')}
          confirmLabel={t('deleteConfirm')}
          cancelLabel={tc('cancel')}
          tone="danger"
          busy={deleteM.isPending}
          onConfirm={doDelete}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </>
  );
}

function OrderRow({
  order: o,
  shop,
  locale,
  showShopName,
  canManage,
  canDelete,
  busy,
  onStatus,
  onDelete,
}: {
  order: StoreOrderListItem;
  shop: string | undefined;
  locale: string;
  showShopName: boolean;
  canManage: boolean;
  canDelete: boolean;
  busy: boolean;
  onStatus: (order: StoreOrderListItem, status: string) => void;
  onDelete: (order: StoreOrderListItem) => void;
}) {
  const t = useTranslations('checkout-orders-merchant-payments.orders');
  const tc = useTranslations('checkout-orders-merchant-payments.common');
  const ts = useTranslations('checkout-orders-merchant-payments.status');
  const href = withShop(`/store/orders/${o.id}`, shop);
  // A status this build does not know (an older or newer server) stays selectable as what it is.
  const known = (ORDER_STATUSES as readonly string[]).includes(o.status);
  return (
    <tr className="align-top hover:bg-muted/40">
      <td className="px-4 py-3">
        <Link
          href={href}
          className="font-mono text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={t('openOrder', { no: o.orderNo })}
        >
          #{o.orderNo}
        </Link>
        {showShopName && o.storefrontName && (
          <div className="mt-0.5 text-xs text-muted-foreground">{o.storefrontName}</div>
        )}
      </td>
      <td className="px-4 py-3">
        <Link href={href} className="font-medium hover:underline">
          {o.customerName || t('anonymous')}
        </Link>
        {o.customerPhone && (
          <div dir="ltr" className="text-start font-mono text-xs text-muted-foreground">
            {displayPhone(o.customerPhone)}
          </div>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
        {t('itemsCount', { count: o.itemsCount })}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-end font-semibold">
        {formatMoney(o.totalMinor, o.currencyCode, locale)}
      </td>
      <td className="px-4 py-3">
        <PaymentStatusBadge status={o.paymentStatus} />
      </td>
      <td className="px-4 py-3">
        <OrderStatusBadge status={o.status} />
      </td>
      <td className="px-4 py-3">
        <SourceBadge source={o.source} />
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
        {formatWhen(o.createdAt, locale)}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-2">
          {canManage && (
            <Select
              value={o.status}
              disabled={busy}
              onChange={(e) => onStatus(o, e.target.value)}
              aria-label={t('changeStatus', { no: o.orderNo })}
              className="h-8 w-auto min-w-32 text-xs"
            >
              {!known && <option value={o.status}>{o.status}</option>}
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ts(s)}
                </option>
              ))}
            </Select>
          )}
          <Link
            href={href}
            className="rounded-md px-2 py-1 text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {tc('open')}
          </Link>
          {canDelete && (
            <button
              type="button"
              onClick={() => onDelete(o)}
              title={t('deleteOrder', { no: o.orderNo })}
              aria-label={t('deleteOrder', { no: o.orderNo })}
              className="grid size-8 place-items-center rounded-md border border-border text-muted-foreground transition hover:border-danger/40 hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <svg
                viewBox="0 0 16 16"
                className="size-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <path d="M3 4h10M6 4V2h4v2M5 6v7h6V6" />
              </svg>
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
