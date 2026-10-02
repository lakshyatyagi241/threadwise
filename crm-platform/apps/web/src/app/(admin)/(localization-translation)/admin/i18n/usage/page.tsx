import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { UsagePage } from '@/features/localization-translation/platform/usage-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('localization-translation.usage');
  return { title: t('title') };
}

export default function Page() {
  return <UsagePage />;
}
