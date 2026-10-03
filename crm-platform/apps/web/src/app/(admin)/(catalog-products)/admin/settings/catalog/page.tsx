import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CatalogAdminSettings } from '@/features/catalog-products/components/admin-settings';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('catalogProducts.admin');
  return { title: t('pageTitle') };
}

export default function OperatorCatalogSettingsPage() {
  return <CatalogAdminSettings />;
}
