import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ListingDetailPage } from '@/features/marketplace/operator/components/listing-detail-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketplace.operator.detail');
  return { title: t('title') };
}

/** `ref` is the listing's slug or its uuid. */
export default async function OperatorMarketplaceListingPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;
  return <ListingDetailPage appRef={ref} />;
}
