import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { BillingAnalyticsPage } from '@/features/platform-payment-gateways/components/billing/analytics-pages';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('platform-payment-gateways.billing.billingAnalytics');
  return { title: t('title') };
}

export default function OperatorBillingAnalyticsPage() {
  return (
    <Suspense>
      <BillingAnalyticsPage />
    </Suspense>
  );
}
