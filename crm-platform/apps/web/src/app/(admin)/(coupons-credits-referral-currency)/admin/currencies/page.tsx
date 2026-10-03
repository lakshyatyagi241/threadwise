import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { CurrenciesPage } from '@/features/coupons-credits-referral-currency/components/currencies-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('coupons-credits-referral-currency.currencies');
  return { title: t('title') };
}

export default function OperatorCurrenciesPage() {
  return (
    <Suspense>
      <CurrenciesPage />
    </Suspense>
  );
}
