import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CreditPackageFormPage } from '@/features/coupons-credits-referral-currency/components/credit-package-form-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('coupons-credits-referral-currency.packages');
  return { title: t('new') };
}

export default function NewCreditPackagePage() {
  return <CreditPackageFormPage />;
}
