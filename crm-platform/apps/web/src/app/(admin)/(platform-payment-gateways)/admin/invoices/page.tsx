import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { InvoicesPage } from '@/features/platform-payment-gateways/components/billing/invoices-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('platform-payment-gateways.billing.invoices');
  return { title: t('title') };
}

export default function OperatorInvoicesPage() {
  return (
    <Suspense>
      <InvoicesPage />
    </Suspense>
  );
}
