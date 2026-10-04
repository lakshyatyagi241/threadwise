import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SlaPage } from '@/features/platform-support-desk/operator/sla-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('platform-support-desk.nav');
  return { title: t('sla') };
}

export default function Page() {
  return <SlaPage />;
}
