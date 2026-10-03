import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { uuidSchema } from '@crm/contracts';
import { ManagePage } from '@/features/marketplace/components/manage-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketplace.meta');
  return { title: t('manage') };
}

export default async function MarketplaceManagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  return <ManagePage id={id} />;
}
