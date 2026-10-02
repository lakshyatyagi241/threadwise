import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CouponsPage } from '@/features/coupons-credits-referral-currency/coupons/components/coupons-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('coupons-credits-referral-currency.coupons.nav');
  return { title: t('coupons') };
}

export default function CouponsRoute() {
  return <CouponsPage />;
}
