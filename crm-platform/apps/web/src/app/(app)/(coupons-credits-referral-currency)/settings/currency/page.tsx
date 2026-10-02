import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WorkspaceCurrencyPage } from '@/features/coupons-credits-referral-currency/currencies/components/workspace-currency-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('coupons-credits-referral-currency.currencies.workspace');
  return { title: t('title') };
}

export default function WorkspaceCurrencyRoute() {
  return <WorkspaceCurrencyPage />;
}
