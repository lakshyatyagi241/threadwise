import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { OrderHistoryPage } from '@/features/platform-payment-gateways/components/billing/order-history-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('platform-payment-gateways.billing.orders');
  return { title: t('title') };
}

export default function OperatorOrderHistoryPage() {
  return (
    <Suspense>
      <OrderHistoryPage />
    </Suspense>
  );
}
