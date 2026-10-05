import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RequestsPage } from '@/features/marketplace/operator/components/requests-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketplace.operator.requests');
  return { title: t('title') };
}

export default function OperatorMarketplaceRequestsPage() {
  return <RequestsPage />;
}
