import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ProvidersPage } from '@/features/localization-translation/platform/providers-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('localization-translation.providers');
  return { title: t('title') };
}

export default function Page() {
  return <ProvidersPage />;
}
