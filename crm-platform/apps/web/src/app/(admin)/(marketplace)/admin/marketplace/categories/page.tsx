import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CategoriesPage } from '@/features/marketplace/operator/components/categories-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketplace.operator.categories');
  return { title: t('title') };
}

export default function OperatorMarketplaceCategoriesPage() {
  return <CategoriesPage />;
}
