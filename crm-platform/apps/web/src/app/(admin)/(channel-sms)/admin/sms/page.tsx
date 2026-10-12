import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SmsPlatformPage } from '@/features/channel-sms/operator/sms-platform-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('sms.operator');
  return { title: t('title') };
}

export default function OperatorSmsPage() {
  return <SmsPlatformPage />;
}
