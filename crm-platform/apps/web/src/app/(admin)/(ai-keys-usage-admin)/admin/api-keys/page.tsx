import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { KeysPage } from '@/features/ai-keys-usage-admin/platform/keys-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ai-keys-usage-admin.keys');
  return { title: t('title') };
}

export default function OperatorAiKeysPage() {
  return <KeysPage />;
}
