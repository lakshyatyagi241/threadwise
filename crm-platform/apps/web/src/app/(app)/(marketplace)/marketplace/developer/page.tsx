import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DeveloperPage } from '@/features/marketplace/components/developer-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketplace.meta');
  return { title: t('developer') };
}

export default function MarketplaceDeveloperPage() {
  return <DeveloperPage />;
}
