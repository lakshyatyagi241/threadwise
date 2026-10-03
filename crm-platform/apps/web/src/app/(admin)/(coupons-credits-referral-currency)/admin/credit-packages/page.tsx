import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { CreditPackagesPage } from '@/features/coupons-credits-referral-currency/components/credit-packages-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('coupons-credits-referral-currency.packages');
  return { title: t('title') };
}

export default function OperatorCreditPackagesPage() {
  return (
    <Suspense>
      <CreditPackagesPage />
    </Suspense>
  );
}
