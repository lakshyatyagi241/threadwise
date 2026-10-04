import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { BrowsePage } from '@/features/marketplace/components/browse-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketplace.meta');
  return { title: t('integrations') };
}

export default function MarketplaceIntegrationsPage() {
  return (
    <Suspense>
      <BrowsePage kind="integration" />
    </Suspense>
  );
}
