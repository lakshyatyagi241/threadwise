import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PackageFormPage } from '@/features/wallet-message-billing/components/admin/package-form-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('wallet-message-billing.admin.nav');
  return { title: t('packages') };
}

export default async function OperatorWalletPackageEditRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PackageFormPage id={id} />;
}
