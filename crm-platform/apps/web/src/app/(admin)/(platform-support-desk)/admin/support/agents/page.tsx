import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AgentsPage } from '@/features/platform-support-desk/operator/agents-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('platform-support-desk.nav');
  return { title: t('agents') };
}

export default function Page() {
  return <AgentsPage />;
}
