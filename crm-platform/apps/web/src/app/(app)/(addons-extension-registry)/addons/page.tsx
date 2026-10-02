import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WorkspaceAddonsPage } from '@/features/addons-extension-registry/components/workspace-addons-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('addons-extension-registry.workspace');
  return { title: t('title') };
}

export default function AddonsPage() {
  return <WorkspaceAddonsPage />;
}
