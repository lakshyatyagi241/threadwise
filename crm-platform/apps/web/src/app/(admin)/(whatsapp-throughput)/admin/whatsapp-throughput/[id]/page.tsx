import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { NumberDetailPage } from '@/features/whatsapp-throughput/components/number-detail-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('whatsapp-throughput.detail');
  return { title: t('title') };
}

export default async function OperatorWhatsappThroughputNumberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <NumberDetailPage id={id} />;
}
