import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ProviderDetailPage } from '@/features/whatsapp-providers/components/provider-detail-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('whatsapp-providers.detail');
  return { title: t('title') };
}

export default async function OperatorWhatsappProviderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProviderDetailPage id={id} />;
}
