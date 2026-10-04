import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PlaybooksPage } from '@/features/platform-support-desk/operator/playbooks-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('platform-support-desk.nav');
  return { title: t('playbooks') };
}

export default function Page() {
  return <PlaybooksPage />;
}
