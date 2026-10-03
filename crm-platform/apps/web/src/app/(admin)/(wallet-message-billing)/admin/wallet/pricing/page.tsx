import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PricingPage } from '@/features/wallet-message-billing/components/admin/pricing-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('wallet-message-billing.admin.nav');
  return { title: t('pricing') };
}

export default function OperatorPricingPageRoute() {
  return <PricingPage />;
}
