'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { fetchOrderInvoice, orderInvoiceKey } from '../api';
import { InvoiceDocument } from './billing/invoice-view-page';

/** My purchases > one order > invoice (TW-PAYGW-036): the same printable document the operator sees, minus the gateway. */
export function BuyerInvoicePage({ id }: { id: string }) {
  const t = useTranslations('platform-payment-gateways.orders');
  const q = useQuery({
    queryKey: orderInvoiceKey(id),
    queryFn: ({ signal }) => fetchOrderInvoice(id, signal),
    refetchOnWindowFocus: false,
  });
  if (q.isPending) {
    return (
      <LoadingBlock className="flex min-h-64 items-center justify-center text-muted-foreground" />
    );
  }
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <div className="mx-auto max-w-5xl p-4">
      <InvoiceDocument
        v={q.data}
        crumb={[{ label: t('title'), href: '/billing/orders' }, { label: q.data.number }]}
      />
    </div>
  );
}
