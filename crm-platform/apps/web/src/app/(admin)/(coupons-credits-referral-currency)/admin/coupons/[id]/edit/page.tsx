import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CouponFormPage } from '@/features/coupons-credits-referral-currency/components/coupon-form-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('coupons-credits-referral-currency.coupons.editor');
  return { title: t('saveChanges') };
}

export default async function EditCouponPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CouponFormPage couponId={id} />;
}
