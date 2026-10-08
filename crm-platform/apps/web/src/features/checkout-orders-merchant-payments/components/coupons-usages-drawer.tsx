'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { StoreCoupon } from '@crm/contracts';
import { EmptyState } from '@crm/ui';
import { useCouponUsages } from '../api/hooks';
import { displayPhone, formatMoney, formatWhen, withShop } from '../lib/format';
import { ErrorPanel, LoadMore, OrderStatusBadge, TableSkeleton, Drawer } from './parts';

/** The orders that redeemed one coupon (newest first), each linking to the order. Mount it with the coupon, unmount it to close. */
export function CouponUsagesDrawer({
  coupon,
  shopId,
  onClose,
}: {
  coupon: StoreCoupon | null;
  shopId: string | undefined;
  onClose: () => void;
}) {
  const t = useTranslations('checkout-orders-merchant-payments.coupons');
  const tc = useTranslations('checkout-orders-merchant-payments.common');
  const locale = useLocale();
  const usages = useCouponUsages(coupon?.id ?? null);

  return (
    <Drawer
      open={coupon !== null}
      onClose={onClose}
      eyebrow={t('usagesEyebrow')}
      title={coupon ? t('usagesTitle', { code: coupon.code }) : ''}
      closeLabel={tc('close')}
    >
      {usages.isPending ? (
        <TableSkeleton rows={4} label={tc('loading')} />
      ) : usages.isError ? (
        <ErrorPanel error={usages.error} onRetry={() => void usages.refetch()} />
      ) : usages.items.length === 0 ? (
        <EmptyState title={t('usagesEmptyTitle')} message={t('usagesEmptyMessage')} />
      ) : (
        <>
          <ul className="divide-y divide-border rounded-md border border-border">
            {usages.items.map((u) => (
              <li key={u.orderId} className="space-y-1 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    href={withShop(`/store/orders/${u.orderId}`, shopId)}
                    className="font-mono font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    #{u.orderNo}
                  </Link>
                  <OrderStatusBadge status={u.status} />
                </div>
                <div className="text-muted-foreground">
                  {u.customerName || t('guest')}
                  {u.customerPhone && (
                    <span dir="ltr" className="ms-2">
                      {displayPhone(u.customerPhone)}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {t('usageDiscount')}{' '}
                    <span className="font-medium text-foreground">
                      {formatMoney(u.discountMinor, u.currencyCode, locale)}
                    </span>
                    {' · '}
                    {t('usageTotal')}{' '}
                    <span className="font-medium text-foreground">
                      {formatMoney(u.totalMinor, u.currencyCode, locale)}
                    </span>
                  </span>
                  <span>{formatWhen(u.createdAt, locale)}</span>
                </div>
              </li>
            ))}
          </ul>
          <LoadMore
            hasMore={Boolean(usages.hasNextPage)}
            loading={usages.isFetchingNextPage}
            onMore={() => void usages.fetchNextPage()}
          />
        </>
      )}
    </Drawer>
  );
}
