import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AddonsPage } from '@/features/marketplace/components/addons-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketplace.meta');
  return { title: t('addons') };
}

export default function MarketplaceAddonsPage() {
  return <AddonsPage />;
}
