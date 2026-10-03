import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { OrderAnalyticsPage } from '@/features/platform-payment-gateways/components/billing/analytics-pages';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('platform-payment-gateways.billing.orderAnalytics');
  return { title: t('title') };
}

export default function OperatorOrderAnalyticsPage() {
  return (
    <Suspense>
      <OrderAnalyticsPage />
    </Suspense>
  );
}
