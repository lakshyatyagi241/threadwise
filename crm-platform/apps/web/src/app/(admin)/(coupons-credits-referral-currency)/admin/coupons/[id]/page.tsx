import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CouponFormPage } from '@/features/coupons-credits-referral-currency/coupons/components/coupon-form-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('coupons-credits-referral-currency.coupons.nav');
  return { title: t('coupons') };
}

export default async function EditCouponRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CouponFormPage id={id} />;
}
