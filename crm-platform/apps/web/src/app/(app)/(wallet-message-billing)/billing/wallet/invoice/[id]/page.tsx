import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LegacyInvoicePage } from '@/features/wallet-message-billing/components/customer/legacy-invoice-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('wallet-message-billing.legacyInvoice');
  return { title: t('title') };
}

export default async function BillingWalletInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LegacyInvoicePage id={id} />;
}
