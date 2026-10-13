'use client';

import Link from 'next/link';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import type { StoreCustomer } from '@crm/contracts';
import { Button } from '@crm/ui';
import { useCustomer } from '../api/hooks';
import { ordersHref } from '../lib/customer-form';
import { displayPhone, formatDay, formatMoney, formatWhen, withShop } from '../lib/format';
import { Drawer, ErrorPanel, Eyebrow, LinkButton, OrderStatusBadge, Skeleton } from './parts';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** One customer (saved, or known from orders only): profile, lifetime totals per currency, the CRM contact and the latest orders. */
export function CustomerDetailDrawer({
  customer,
  shopId,
  canManage,
  onEdit,
  onDelete,
  onClose,
}: {
  /** The list row that was opened (shown while the detail loads); null keeps the drawer closed. */
  customer: StoreCustomer | null;
  shopId: string | undefined;
  canManage: boolean;
  onEdit: (c: StoreCustomer) => void;
  onDelete: (c: StoreCustomer) => void;
  onClose: () => void;
}) {
  const t = useTranslations('checkout-orders-merchant-payments.customers');
  const tc = useTranslations('checkout-orders-merchant-payments.common');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const detail = useCustomer(customer?.id ?? null);
  const c = detail.data ?? customer;

  return (
    <Drawer
      open={customer !== null}
      onClose={onClose}
      eyebrow={t('detailEyebrow')}
      title={c ? c.name || displayPhone(c.phone) : ''}
      closeLabel={tc('close')}
      footer={
        c && canManage ? (
          <>
            <Button variant="secondary" onClick={() => onEdit(c)}>
              {tc('edit')}
            </Button>
            {c.hasProfile && (
              <Button variant="danger" onClick={() => onDelete(c)}>
                {tc('delete')}
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {c && (
        <div className="space-y-6">
          <section aria-label={t('profile')}>
            <Eyebrow>{t('profile')}</Eyebrow>
            <dl className="mt-1 divide-y divide-border">
              <Row label={t('phone')}>
                <span dir="ltr">{displayPhone(c.phone)}</span>
              </Row>
              <Row label={t('name')}>{c.name || <Muted />}</Row>
              <Row label={t('company')}>{c.company || <Muted />}</Row>
              <Row label={t('address')}>
                {c.address ? (
                  <span className="whitespace-pre-line">{c.address}</span>
                ) : (
                  <span className="text-muted-foreground">{t('noSavedAddress')}</span>
                )}
              </Row>
              <Row label={t('crmContact')}>
                {c.contactId ? (
                  <Link
                    href={`/contacts/${c.contactId}`}
                    className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {tc('viewContact')}
                  </Link>
                ) : (
                  <Muted />
                )}
              </Row>
              <Row label={t('customerSince')}>{formatDay(c.createdAt, locale, timeZone)}</Row>
            </dl>
          </section>

          <section aria-label={t('lifetime')}>
            <Eyebrow>{t('lifetime')}</Eyebrow>
            <div className="mt-2">
              <Totals customer={c} locale={locale} />
            </div>
          </section>

          <section aria-label={t('recentOrders')}>
            <div className="flex items-center justify-between gap-2">
              <Eyebrow>{t('recentOrders')}</Eyebrow>
              {c.orderCount > 0 && (
                <LinkButton
                  variant="ghost"
                  className="h-8 px-2"
                  href={withShop(ordersHref(c.phone), shopId)}
                >
                  {t('viewAllOrders')}
                </LinkButton>
              )}
            </div>
            {detail.isPending ? (
              <div role="status" aria-label={tc('loading')} className="mt-2 space-y-2">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : detail.isError ? (
              <div className="mt-2">
                <ErrorPanel error={detail.error} onRetry={() => void detail.refetch()} />
              </div>
            ) : detail.data.recentOrders.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{t('noRecentOrders')}</p>
            ) : (
              <ul className="mt-2 divide-y divide-border rounded-md border border-border">
                {detail.data.recentOrders.map((o) => (
                  <li
                    key={o.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <Link
                        href={withShop(`/store/orders/${o.id}`, shopId)}
                        className="font-mono font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        #{o.orderNo}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {formatWhen(o.createdAt, locale, timeZone)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="whitespace-nowrap font-medium">
                        {formatMoney(o.totalMinor, o.currencyCode, locale)}
                      </span>
                      <OrderStatusBadge status={o.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}

function Muted() {
  return <span className="text-muted-foreground">—</span>;
}

/** Lifetime totals: one line per currency (minor units of different currencies are never added), or "no orders yet". */
export function Totals({ customer, locale }: { customer: StoreCustomer; locale: string }) {
  const t = useTranslations('checkout-orders-merchant-payments.customers');
  if (customer.lifetimeTotals.length === 0) {
    return <span className="text-sm text-muted-foreground">{t('noOrdersYet')}</span>;
  }
  return (
    <ul className="space-y-0.5">
      {customer.lifetimeTotals.map((x) => (
        <li key={x.currencyCode} className="whitespace-nowrap text-sm">
          <span className="font-medium">{formatMoney(x.totalMinor, x.currencyCode, locale)}</span>
          <span className="ms-1.5 text-xs text-muted-foreground">
            {t('ordersCount', { count: x.orders })}
          </span>
        </li>
      ))}
    </ul>
  );
}
