import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { MARKET_SLUG_RE } from '@crm/contracts';
import { AppDetailPage } from '@/features/marketplace/components/app-detail-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketplace.meta');
  return { title: t('app') };
}

export default async function MarketplaceAppPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!MARKET_SLUG_RE.test(slug)) notFound();
  return <AppDetailPage slug={slug} />;
}
