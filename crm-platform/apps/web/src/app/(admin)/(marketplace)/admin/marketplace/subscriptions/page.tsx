import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SubscriptionsPage } from '@/features/marketplace/operator/components/subscriptions-page';
import { appFromSearchParam } from '@/features/marketplace/operator/lib/subscriptions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketplace.operator.subscriptions');
  return { title: t('title') };
}

/** `?app=` opens the list on one app (its slug or uuid); the pricing panel and the catalogue link here with it. */
export default async function OperatorMarketplaceSubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ app?: string | string[] }>;
}) {
  const { app } = await searchParams;
  return <SubscriptionsPage initialApp={appFromSearchParam(app)} />;
}
