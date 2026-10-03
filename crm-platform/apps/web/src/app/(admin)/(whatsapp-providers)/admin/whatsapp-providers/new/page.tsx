import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ProviderNewPage } from '@/features/whatsapp-providers/components/provider-new-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('whatsapp-providers.new');
  return { title: t('title') };
}

export default function OperatorWhatsappProviderNewPage() {
  return <ProviderNewPage />;
}
