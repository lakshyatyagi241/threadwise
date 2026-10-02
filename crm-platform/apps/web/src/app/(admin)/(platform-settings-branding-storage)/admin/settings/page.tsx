import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SettingsHubPage } from '@/features/platform-settings-branding-storage/components/settings-hub';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('platform-settings-branding-storage.hub');
  return { title: t('title') };
}

export default function SettingsHub() {
  return <SettingsHubPage />;
}
