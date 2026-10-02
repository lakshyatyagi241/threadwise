import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CurrenciesPage } from '@/features/coupons-credits-referral-currency/currencies/components/currencies-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('coupons-credits-referral-currency.currencies.admin');
  return { title: t('title') };
}

export default function CurrenciesPageRoute() {
  return <CurrenciesPage />;
}
