import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LanguagesPage } from '@/features/localization-translation/platform/languages-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('localization-translation.languages');
  return { title: t('title') };
}

export default function Page() {
  return <LanguagesPage />;
}
