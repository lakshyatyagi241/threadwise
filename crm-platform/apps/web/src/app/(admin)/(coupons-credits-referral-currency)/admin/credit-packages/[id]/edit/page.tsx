import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CreditPackageFormPage } from '@/features/coupons-credits-referral-currency/components/credit-package-form-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('coupons-credits-referral-currency.packages.editor');
  return { title: t('saveChanges') };
}

export default async function EditCreditPackagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CreditPackageFormPage packageId={id} />;
}
