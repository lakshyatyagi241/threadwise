import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OverviewPage } from '@/features/wallet-message-billing/components/admin/overview-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('wallet-message-billing.admin.nav');
  return { title: t('overview') };
}

export default function OperatorOverviewPageRoute() {
  return <OverviewPage />;
}
