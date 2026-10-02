import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { UsagePage } from '@/features/ai-keys-usage-admin/workspace/usage-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ai-keys-usage-admin.usage');
  return { title: t('title') };
}

export default function AiUsageRoute() {
  return <UsagePage />;
}
