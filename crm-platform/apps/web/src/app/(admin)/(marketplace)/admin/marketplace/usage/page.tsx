import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { UsagePage } from '@/features/marketplace/operator/components/usage-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketplace.operator.usage');
  return { title: t('title') };
}

export default function OperatorMarketplaceUsagePage() {
  return <UsagePage />;
}
