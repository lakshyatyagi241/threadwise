import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { InstalledPage } from '@/features/marketplace/components/installed-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketplace.meta');
  return { title: t('installed') };
}

export default function MarketplaceInstalledPage() {
  return <InstalledPage />;
}
