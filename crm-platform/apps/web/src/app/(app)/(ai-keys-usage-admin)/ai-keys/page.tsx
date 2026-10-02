import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WorkspaceKeysPage } from '@/features/ai-keys-usage-admin/workspace/keys-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ai-keys-usage-admin.own');
  return { title: t('title') };
}

export default function AiKeysRoute() {
  return <WorkspaceKeysPage />;
}
