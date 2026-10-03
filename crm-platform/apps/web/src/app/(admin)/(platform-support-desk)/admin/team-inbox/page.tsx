import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PlatformInboxPage } from '@/features/platform-support-desk/operator/platform-inbox-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('platform-support-desk.nav');
  return { title: t('platformInbox') };
}

export default function Page() {
  return <PlatformInboxPage />;
}
