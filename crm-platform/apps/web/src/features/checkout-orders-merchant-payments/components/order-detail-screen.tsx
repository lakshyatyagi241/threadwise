'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import type { StoreOrderDetail } from '@crm/contracts';
import { Alert, Button, ConfirmDialog, useToast } from '@crm/ui';
import { StoreShell } from '@/features/storefront-builder';
import { useDeleteOrder, useOrder } from '../api/hooks';
import { displayPhone, formatMoney, formatWhen, withShop } from '../lib/format';
import {
  PAYMENT_KINDS,
  TIMELINE_ACTORS,
  TIMELINE_KINDS,
  isKnown,
  rtoTone,
  sortPayments,
  sortTimeline,
} from '../lib/orders-detail';
import { OrderInvoiceCard, OrderPaymentActions, CopyButton } from './order-payment-actions';
import { OrderStatusForm } from './order-status-form';
import {
  ErrorPanel,
  Eyebrow,
  LinkButton,
  NoAccess,
  OrderStatusBadge,
  PaymentStatusBadge,
  Skeleton,
  SourceBadge,
  ToneBadge,
  useErrorLine,
  useShopParam,
  useStoreCan,
} from './parts';

/** `/store/orders/[id]`: one order, its status form, payment links, invoice, timeline and payments. */
export function OrderDetailScreen({ id }: { id: string }) {
  return (
    <StoreShell>
      <OrderDetailContent id={id} />
    </StoreShell>
  );
}

/** The page without the store frame (what the render tests exercise). */
export function OrderDetailContent({ id }: { id: string }) {
  const t = useTranslations('checkout-orders-merchant-payments.orderDetail');
  const can = useStoreCan('orders');
  const shop = useShopParam();
  const order = useOrder(id);
  if (!can.read) return <NoAccess />;

  return (
    <>
      <BackLink shop={shop} />
      {order.isPending ? (
        <div role="status" aria-label={t('loading')} className="space-y-4">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
          <Skeleton className="h-40" />
        </div>
      ) : order.isError ? (
        <ErrorPanel error={order.error} onRetry={() => void order.refetch()} />
      ) : (
        <OrderBody
          order={order.data}
          shop={shop}
          canManage={can.manage}
          canDelete={can.delete}
          onReload={() => void order.refetch()}
        />
      )}
    </>
  );
}

function BackLink({ shop }: { shop: string | undefined }) {
  const t = useTranslations('checkout-orders-merchant-payments.orderDetail');
  return (
    <Link
      href={withShop('/store/orders', shop)}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <svg
        viewBox="0 0 16 16"
        className="size-3.5 rtl:rotate-180"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M10 3 5 8l5 5" />
      </svg>
      {t('back')}
    </Link>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-background p-4 sm:p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function OrderBody({
  order,
  shop,
  canManage,
  canDelete,
  onReload,
}: {
  order: StoreOrderDetail;
  shop: string | undefined;
  canManage: boolean;
  canDelete: boolean;
  onReload: () => void;
}) {
  const t = useTranslations('checkout-orders-merchant-payments.orderDetail');
  const tc = useTranslations('checkout-orders-merchant-payments.common');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const router = useRouter();
  const { toast } = useToast();
  const errLine = useErrorLine();
  const del = useDeleteOrder();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const doDelete = () =>
    del.mutate(order.id, {
      onSuccess: () => {
        toast(t('delete.deleted', { no: order.orderNo }));
        router.push(withShop('/store/orders', shop));
      },
      onError: (e) => {
        setConfirmDelete(false);
        toast(errLine(e), 'danger');
      },
    });

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <Eyebrow>{t('placed', { when: formatWhen(order.createdAt, locale, timeZone) })}</Eyebrow>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {t('title', { no: order.orderNo })}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusBadge status={order.status} />
            <PaymentStatusBadge status={order.paymentStatus} />
            <SourceBadge source={order.source} />
          </div>
        </div>
        {canDelete && (
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            {t('delete.confirm')}
          </Button>
        )}
      </div>

      {!canManage && <Alert tone="info">{t('readOnly')}</Alert>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <ItemsCard order={order} locale={locale} />
          {canManage && (
            <OrderStatusForm key={order.rowVersion} order={order} onReload={onReload} />
          )}
          <OrderPaymentActions order={order} shop={shop} canManage={canManage} />
          <TimelineCard order={order} locale={locale} />
        </div>
        <aside className="min-w-0 space-y-5">
          <CustomerCard order={order} />
          <OrderInvoiceCard order={order} canManage={canManage} />
          <MetaCard order={order} locale={locale} />
          <PaymentsCard order={order} locale={locale} />
        </aside>
      </div>

      {canDelete && (
        <ConfirmDialog
          open={confirmDelete}
          title={t('delete.title', { no: order.orderNo })}
          message={t('delete.message')}
          confirmLabel={t('delete.confirm')}
          cancelLabel={tc('cancel')}
          tone="danger"
          busy={del.isPending}
          onConfirm={doDelete}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}

function ItemsCard({ order, locale }: { order: StoreOrderDetail; locale: string }) {
  const t = useTranslations('checkout-orders-merchant-payments.orderDetail');
  const cur = order.currencyCode;
  const money = (n: number) => formatMoney(n, cur, locale);
  return (
    <Card title={t('items.title')}>
      {order.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('items.empty')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {order.items.map((l, i) => (
            <li key={`${l.productId ?? 'x'}-${i}`} className="flex items-center gap-3 py-3">
              {l.image ? (
                <img
                  src={l.image}
                  alt=""
                  loading="lazy"
                  className="size-12 shrink-0 rounded-md border border-border object-cover"
                />
              ) : (
                <div aria-hidden="true" className="size-12 shrink-0 rounded-md bg-muted" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{l.name}</div>
                {l.variantTitle && (
                  <div className="truncate text-xs text-muted-foreground">{l.variantTitle}</div>
                )}
                <div className="text-xs text-muted-foreground">
                  {t('items.qty', { qty: l.qty })} ·{' '}
                  {t('items.unit', { price: money(l.priceMinor) })}
                  {l.retailerId && (
                    <>
                      {' · '}
                      <span dir="ltr" className="font-mono">
                        {t('items.retailerId', { id: l.retailerId })}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-sm font-semibold">{money(l.lineTotalMinor)}</div>
            </li>
          ))}
        </ul>
      )}
      <dl className="space-y-1.5 border-t border-border pt-3 text-sm">
        <Row label={t('totals.subtotal')} value={money(order.subtotalMinor)} />
        <Row label={t('totals.shipping')} value={money(order.shippingMinor)} />
        <Row
          label={
            <>
              {t('totals.tax')}
              {order.taxInclusive && (
                <span className="ms-1 text-xs text-muted-foreground">
                  ({t('totals.taxInclusive')})
                </span>
              )}
            </>
          }
          value={money(order.taxMinor)}
        />
        {order.discountMinor > 0 && (
          <Row
            label={
              order.couponCode
                ? t('totals.discountCoupon', { code: order.couponCode })
                : t('totals.discount')
            }
            value={`-${money(order.discountMinor)}`}
          />
        )}
        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2 text-base font-semibold">
          <dt>{t('totals.total')}</dt>
          <dd>{money(order.totalMinor)}</dd>
        </div>
      </dl>
    </Card>
  );
}

function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function CustomerCard({ order }: { order: StoreOrderDetail }) {
  const t = useTranslations('checkout-orders-merchant-payments.orderDetail');
  const tc = useTranslations('checkout-orders-merchant-payments.common');
  const phone = displayPhone(order.customerPhone);
  return (
    <Card title={t('customer.title')}>
      <div className="space-y-3 text-sm">
        <div className="font-medium">{order.customerName || t('customer.anonymous')}</div>
        <dl className="space-y-2">
          {phone && (
            <div>
              <dt className="text-xs text-muted-foreground">{t('customer.phone')}</dt>
              <dd dir="ltr" className="text-start font-mono">
                {phone}
              </dd>
            </div>
          )}
          {order.customerEmail && (
            <div>
              <dt className="text-xs text-muted-foreground">{t('customer.email')}</dt>
              <dd className="break-all">{order.customerEmail}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-muted-foreground">{t('customer.address')}</dt>
            <dd className="whitespace-pre-line">
              {order.customerAddress?.trim() ? (
                order.customerAddress
              ) : (
                <span className="text-muted-foreground">{t('customer.noAddress')}</span>
              )}
            </dd>
          </div>
          {order.notes && (
            <div>
              <dt className="text-xs text-muted-foreground">{t('customer.notes')}</dt>
              <dd className="whitespace-pre-line">{order.notes}</dd>
            </div>
          )}
        </dl>
        {order.contactId && (
          <LinkButton variant="secondary" href={`/contacts/${order.contactId}`}>
            {tc('viewContact')}
          </LinkButton>
        )}
        {order.rtoScore !== null && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <span className="text-xs text-muted-foreground">{t('rto.title')}</span>
            <ToneBadge tone={rtoTone(order.rtoBand)}>
              {t('rto.summary', {
                band:
                  order.rtoBand && t.has(`rto.${order.rtoBand}`)
                    ? t(`rto.${order.rtoBand}`)
                    : (order.rtoBand ?? '-'),
                score: order.rtoScore,
              })}
            </ToneBadge>
          </div>
        )}
      </div>
    </Card>
  );
}

function MetaCard({ order, locale }: { order: StoreOrderDetail; locale: string }) {
  const timeZone = useTimeZone();
  const t = useTranslations('checkout-orders-merchant-payments.orderDetail.meta');
  return (
    <Card title={t('title')}>
      <dl className="space-y-1.5 text-sm">
        <Row label={t('orderId')} value={<span className="font-mono">#{order.orderNo}</span>} />
        <Row label={t('source')} value={<SourceBadge source={order.source} />} />
        {order.storefrontName && <Row label={t('shop')} value={order.storefrontName} />}
        <Row
          label={t('paymentMethod')}
          value={<span className="uppercase">{order.paymentMethod}</span>}
        />
        <Row label={t('updated')} value={formatWhen(order.updatedAt, locale, timeZone)} />
      </dl>
    </Card>
  );
}

function TimelineCard({ order, locale }: { order: StoreOrderDetail; locale: string }) {
  const timeZone = useTimeZone();
  const t = useTranslations('checkout-orders-merchant-payments.orderDetail.timeline');
  const entries = sortTimeline(order.timeline);
  return (
    <Card title={t('title')}>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ol className="space-y-4 border-s border-border ps-4">
          {entries.map((e, i) => (
            <li key={`${e.at}-${i}`} className="relative">
              <span
                aria-hidden="true"
                className="absolute -start-[21px] top-1.5 size-2.5 rounded-full border-2 border-background bg-primary"
              />
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-sm font-medium">
                  {isKnown(TIMELINE_KINDS, e.kind) ? t(`kind.${e.kind}`) : e.kind}
                </span>
                <time dateTime={e.at} className="text-xs text-muted-foreground">
                  {formatWhen(e.at, locale, timeZone)}
                </time>
              </div>
              {e.detail && (
                <p className="mt-0.5 whitespace-pre-line text-sm text-muted-foreground">
                  {e.detail}
                </p>
              )}
              <p className="mt-0.5 text-xs text-muted-foreground">
                {isKnown(TIMELINE_ACTORS, e.actor) ? t(`actor.${e.actor}`) : e.actor}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function PaymentsCard({ order, locale }: { order: StoreOrderDetail; locale: string }) {
  const timeZone = useTimeZone();
  const t = useTranslations('checkout-orders-merchant-payments.orderDetail.payments');
  const payments = sortPayments(order.payments);
  return (
    <Card title={t('title')}>
      {payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {payments.map((p, i) => (
            <li key={`${p.reference ?? 'p'}-${i}`} className="space-y-1 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  {isKnown(PAYMENT_KINDS, p.kind) ? t(`kind.${p.kind}`) : p.kind}
                  {p.gateway && <span className="ms-1 text-muted-foreground">({p.gateway})</span>}
                </span>
                <span className="text-sm font-semibold">
                  {formatMoney(p.amountMinor, p.currencyCode, locale)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <PaymentStatusBadge status={p.status} />
                {p.at && <time dateTime={p.at}>{formatWhen(p.at, locale, timeZone)}</time>}
              </div>
              {p.reference && (
                <div
                  dir="ltr"
                  className="break-all text-start font-mono text-xs text-muted-foreground"
                >
                  {t('reference', { ref: p.reference })}
                </div>
              )}
              {p.url && (
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    {t('openLink')}
                  </a>
                  <CopyButton value={p.url} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
