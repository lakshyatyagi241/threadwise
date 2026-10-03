import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { BillingSettingsPage } from '@/features/platform-payment-gateways/components/billing/billing-settings-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('platform-payment-gateways.billing.settings');
  return { title: t('title') };
}

export default function OperatorBillingSettingsPage() {
  return (
    <Suspense>
      <BillingSettingsPage />
    </Suspense>
  );
}
