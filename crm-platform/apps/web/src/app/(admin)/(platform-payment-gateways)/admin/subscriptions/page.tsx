import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { SubscriptionsPage } from '@/features/platform-payment-gateways/components/billing/subscriptions-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('platform-payment-gateways.billing.subscriptions');
  return { title: t('title') };
}

export default function OperatorSubscriptionsPage() {
  return (
    <Suspense>
      <SubscriptionsPage />
    </Suspense>
  );
}
