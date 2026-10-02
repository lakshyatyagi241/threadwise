import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SupportScreen } from '@/features/platform-support-desk/customer/support-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('platform-support-desk.nav');
  return { title: t('support') };
}

export default function SupportPage() {
  return <SupportScreen />;
}
