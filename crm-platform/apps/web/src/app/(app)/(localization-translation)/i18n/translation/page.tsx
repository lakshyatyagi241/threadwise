import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { TranslationSettingsView } from '@/features/localization-translation/workspace/translation-settings-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('localization-translation.settings');
  return { title: t('title') };
}

export default function Page() {
  return <TranslationSettingsView />;
}
