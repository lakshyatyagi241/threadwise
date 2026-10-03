import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { InvoiceViewPage } from '@/features/platform-payment-gateways/components/billing/invoice-view-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('platform-payment-gateways.billing.invoice');
  return { title: t('title') };
}

export default async function OperatorInvoiceViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InvoiceViewPage id={id} />;
}
