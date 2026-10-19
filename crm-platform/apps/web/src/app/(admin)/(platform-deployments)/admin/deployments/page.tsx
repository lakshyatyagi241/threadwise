import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DeploymentsPage } from '@/features/platform-deployments/components/deployments-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('platform-deployments');
  return { title: t('title') };
}

export default function AdminDeploymentsPage() {
  return <DeploymentsPage />;
}
