import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CouponFormPage } from '@/features/coupons-credits-referral-currency/components/coupon-form-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('coupons-credits-referral-currency.coupons');
  return { title: t('new') };
}

export default function NewCouponPage() {
  return <CouponFormPage />;
}
