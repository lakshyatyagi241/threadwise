import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ProviderWizard } from '@/features/whatsapp-providers/components/provider-wizard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('whatsapp-providers.wizard');
  return { title: t('title') };
}

export default function OperatorNewWhatsappProviderPage() {
  return <ProviderWizard />;
}
