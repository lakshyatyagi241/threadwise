import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { BillingHistoryPage } from '@/features/platform-payment-gateways/components/billing/billing-history-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('platform-payment-gateways.billing.history');
  return { title: t('title') };
}

export default function OperatorBillingHistoryPage() {
  return (
    <Suspense>
      <BillingHistoryPage />
    </Suspense>
  );
}
