import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SystemView } from '@/features/install-update-licensing/system/system-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('install-update-licensing.system');
  return { title: t('title') };
}

export default function SystemPage() {
  return <SystemView />;
}
