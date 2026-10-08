import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { GetaSettingsScreen } from '@/features/flow-builder-editor/geta-publish/settings-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('flb.geta.settings');
  return { title: t('title') };
}

export default function GetaPublishingPage() {
  return <GetaSettingsScreen />;
}
