import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ThroughputPage } from '@/features/whatsapp-throughput/components/throughput-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('whatsapp-throughput');
  return { title: t('title') };
}

export default function OperatorWhatsappThroughputPage() {
  return <ThroughputPage />;
}
