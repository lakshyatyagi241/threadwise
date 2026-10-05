'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Fragment, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { PaygwOrderItem, PaygwOrderStatus } from '@crm/contracts';
import { Alert, Badge, Button, EmptyState, Spinner } from '@crm/ui';
import { ORDERS_KEY, fetchOrders } from '../api';
import { formatMoney } from '../lib/money';
import { parseOutcome } from '../lib/next-action';
import { ProofForm } from './proof-form';

const NS = 'platform-payment-gateways.orders';
const TONE: Record<PaygwOrderStatus, 'success' | 'danger' | 'warning' | 'neutral'> = {
  paid: 'success',
  failed: 'danger',
  refunded: 'danger',
  cancelled: 'neutral',
  pending: 'warning',
  awaiting_approval: 'warning',
};

/** My purchases (TW-PAYGW-035): plans and wallet top-ups, newest first, with what I have spent in total and the result of a payment I just made. */
export function OrdersPage() {
  const t = useTranslations(NS);
  const locale = useLocale();
  const params = useSearchParams();
  const outcome = parseOutcome(params.get('payment'));
  const justPaid = params.get('order');
  const queryClient = useQueryClient();
  const [proofFor, setProofFor] = useState<string | null>(null);

  const q = useInfiniteQuery({
    queryKey: ORDERS_KEY,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => fetchOrders(pageParam, signal),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    refetchOnWindowFocus: false,
  });

  const items: PaygwOrderItem[] = q.data?.pages.flatMap((p) => p.data) ?? [];
  const spend = q.data?.pages[0]?.lifetimeSpend ?? [];
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        {spend.length > 0 && (
          <p className="text-sm text-muted-foreground" data-testid="lifetime-spend">
            {t('lifetime', {
              total: spend.map((s) => formatMoney(s.total, s.currency, locale)).join(' + '),
            })}
          </p>
        )}
      </header>

      {outcome && (
        <Alert
          tone={
            outcome === 'success' || outcome === 'proof'
              ? 'success'
              : outcome === 'pending'
                ? 'info'
                : 'danger'
          }
        >
          {t(`outcome.${outcome}`, { order: justPaid ?? '' })}
        </Alert>
      )}

      {q.isPending ? (
        <div className="flex min-h-40 items-center justify-center text-muted-foreground">
          <Spinner label={t('loading')} />
        </div>
      ) : q.isError ? (
        <Alert tone="danger">{t('loadFailed')}</Alert>
      ) : items.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          message={t('emptyMessage')}
          actions={
            <Link className="text-sm underline" href="/account/plans">
              {t('browsePlans')}
            </Link>
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-start text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start">{t('col.order')}</th>
                  <th className="px-3 py-2 text-start">{t('col.item')}</th>
                  <th className="px-3 py-2 text-start">{t('col.date')}</th>
                  <th className="px-3 py-2 text-end">{t('col.amount')}</th>
                  <th className="px-3 py-2 text-start">{t('col.status')}</th>
                  <th className="px-3 py-2 text-end">{t('col.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((o) => (
                  <Fragment key={o.id}>
                    <tr className="border-t border-border" data-testid="order-row">
                      <td className="px-3 py-2 font-mono text-xs">{o.orderNumber}</td>
                      <td className="px-3 py-2">
                        {o.itemName}
                        {o.couponCode && <Badge className="ms-2">{o.couponCode}</Badge>}
                      </td>
                      <td className="px-3 py-2">{date(o.createdAt)}</td>
                      <td className="px-3 py-2 text-end tabular-nums">
                        {formatMoney(o.amount, o.currency, locale)}
                        {Number(o.discountAmount) > 0 && (
                          <span className="block text-xs text-muted-foreground">
                            −{formatMoney(o.discountAmount, o.currency, locale)}
                          </span>
                        )}
                        {Number(o.taxAmount) > 0 && (
                          <span className="block text-xs text-muted-foreground">
                            +{formatMoney(o.taxAmount, o.currency, locale)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={TONE[o.status]}>{t(`status.${o.status}`)}</Badge>
                        {o.failureReason && o.status === 'failed' && (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {o.failureReason}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-end">
                        <span className="inline-flex gap-3">
                          {o.acceptsProof && (
                            <button
                              type="button"
                              className="text-sm underline"
                              onClick={() => setProofFor(proofFor === o.id ? null : o.id)}
                            >
                              {t('uploadProof')}
                            </button>
                          )}
                          <Link
                            className="text-sm underline"
                            href={`/billing/orders/${o.id}/invoice`}
                          >
                            {t('invoice')}
                          </Link>
                        </span>
                      </td>
                    </tr>
                    {proofFor === o.id && (
                      <tr className="border-t border-border bg-muted/30">
                        <td colSpan={6} className="px-3 py-4">
                          <div className="max-w-lg">
                            <ProofForm
                              orderId={o.id}
                              onDone={() => {
                                setProofFor(null);
                                void queryClient.invalidateQueries({ queryKey: ORDERS_KEY });
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {q.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                disabled={q.isFetchingNextPage}
                onClick={() => void q.fetchNextPage()}
              >
                {t('loadMore')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
