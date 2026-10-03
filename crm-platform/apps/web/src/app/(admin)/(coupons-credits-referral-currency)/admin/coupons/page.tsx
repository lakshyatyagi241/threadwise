import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { CouponsPage } from '@/features/coupons-credits-referral-currency/components/coupons-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('coupons-credits-referral-currency.coupons');
  return { title: t('title') };
}

export default function OperatorCouponsPage() {
  return (
    <Suspense>
      <CouponsPage />
    </Suspense>
  );
}
