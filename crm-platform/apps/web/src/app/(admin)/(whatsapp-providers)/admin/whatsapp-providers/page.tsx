import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ProvidersPage } from '@/features/whatsapp-providers/components/providers-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('whatsapp-providers.list');
  return { title: t('title') };
}

export default function OperatorWhatsappProvidersPage() {
  return <ProvidersPage />;
}
