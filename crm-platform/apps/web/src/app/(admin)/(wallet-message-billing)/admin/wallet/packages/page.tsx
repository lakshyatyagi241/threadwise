import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PackagesPage } from '@/features/wallet-message-billing/components/admin/packages-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('wallet-message-billing.admin.nav');
  return { title: t('packages') };
}

export default function PackagesPageRoute() {
  return <PackagesPage />;
}
