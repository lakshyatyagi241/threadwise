import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { MARKET_SLUG_RE } from '@crm/contracts';
import { InstallPage } from '@/features/marketplace/components/install-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketplace.meta');
  return { title: t('install') };
}

export default async function MarketplaceInstallPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!MARKET_SLUG_RE.test(slug)) notFound();
  return <InstallPage slug={slug} />;
}
