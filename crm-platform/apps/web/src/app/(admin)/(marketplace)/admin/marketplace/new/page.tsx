import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ListingNewPage } from '@/features/marketplace/operator/components/listing-new-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketplace.operator.new');
  return { title: t('title') };
}

export default function OperatorMarketplaceNewListingPage() {
  return <ListingNewPage />;
}
