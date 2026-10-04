import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { RequestsPage } from '@/features/marketplace/components/requests-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketplace.meta');
  return { title: t('requests') };
}

export default function MarketplaceRequestsPage() {
  // The form prefills from the address (`?name=`, `?kind=`), which needs a Suspense boundary.
  return (
    <Suspense>
      <RequestsPage />
    </Suspense>
  );
}
