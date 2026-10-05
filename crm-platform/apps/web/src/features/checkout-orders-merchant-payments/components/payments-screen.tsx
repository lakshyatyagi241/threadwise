'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { Button, EmptyState } from '@crm/ui';
import { StoreShell } from '@/features/storefront-builder';
import { usePayments } from '../api/hooks';
import {
  EMPTY_FILTERS,
  filtersToQuery,
  filtersToSearch,
  hasActiveFilters,
  parseFilters,
  type PaymentFilters,
} from '../lib/payments-filters';
import { PaymentsFiltersBar } from './payments-filters-bar';
import { PaymentsSummary } from './payments-summary';
import { PaymentsTable } from './payments-table';
import { PaymentsWhatsappPay } from './payments-whatsapp-pay';
import {
  ErrorPanel,
  LinkButton,
  LoadMore,
  NoAccess,
  PageHeader,
  TableSkeleton,
  useShopParam,
  useStoreCan,
} from './parts';
import { withShop } from '../lib/format';

/** `/store/payments`: the money side of store orders, plus the WhatsApp Pay configurations (Reference's page of that address). */
export function PaymentsScreen() {
  const can = useStoreCan('payments');
  return (
    <StoreShell>{can.read ? <PaymentsBody canManage={can.manage} /> : <NoAccess />}</StoreShell>
  );
}

function PaymentsBody({ canManage }: { canManage: boolean }) {
  const t = useTranslations('checkout-orders-merchant-payments.payments');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const shopId = useShopParam();

  const search = params.toString();
  const filters = useMemo(() => parseFilters(new URLSearchParams(search)), [search]);
  const list = usePayments(useMemo(() => filtersToQuery(filters), [filters]));

  const setFilters = useCallback(
    (next: PaymentFilters) => {
      const qs = filtersToSearch(next, search);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, search],
  );
  const reset = useCallback(() => setFilters(EMPTY_FILTERS), [setFilters]);

  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')} />

      <PaymentsSummary />

      <section aria-labelledby="payments-list-title" className="space-y-3">
        <h2 id="payments-list-title" className="text-lg font-semibold">
          {t('listTitle')}
        </h2>
        <PaymentsFiltersBar filters={filters} onChange={setFilters} onReset={reset} />

        {list.isPending ? (
          <TableSkeleton label={t('loading')} />
        ) : list.isError ? (
          <ErrorPanel error={list.error} onRetry={() => void list.refetch()} />
        ) : list.items.length === 0 ? (
          hasActiveFilters(filters) ? (
            <EmptyState
              title={t('emptyFilteredTitle')}
              message={t('emptyFilteredMessage')}
              actions={
                <Button variant="secondary" onClick={reset}>
                  {t('resetFilters')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              title={t('emptyTitle')}
              message={t('emptyMessage')}
              actions={
                <LinkButton href={withShop('/store/orders', shopId)}>{t('goToOrders')}</LinkButton>
              }
            />
          )
        ) : (
          <>
            <PaymentsTable items={list.items} shopId={shopId} />
            <LoadMore
              hasMore={list.hasNextPage}
              loading={list.isFetchingNextPage}
              onMore={() => void list.fetchNextPage()}
            />
          </>
        )}
      </section>

      <PaymentsWhatsappPay canManage={canManage} />
    </>
  );
}
