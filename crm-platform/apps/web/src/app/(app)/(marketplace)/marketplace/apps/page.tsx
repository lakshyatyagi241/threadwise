import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { BrowsePage } from '@/features/marketplace/components/browse-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketplace.meta');
  return { title: t('apps') };
}

export default function MarketplaceAppsPage() {
  // The screen reads the address (`useSearchParams`), which needs a Suspense boundary.
  return (
    <Suspense>
      <BrowsePage kind="mini_app" />
    </Suspense>
  );
}
