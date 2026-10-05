import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CataloguePage } from '@/features/marketplace/operator/components/catalogue-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketplace.operator.list');
  return { title: t('title') };
}

export default function OperatorMarketplaceCataloguePage() {
  return <CataloguePage />;
}
