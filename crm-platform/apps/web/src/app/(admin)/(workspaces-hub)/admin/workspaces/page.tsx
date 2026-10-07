import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WorkspacesPage } from '@/features/workspaces-hub';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('workspaces-hub.list');
  return { title: t('title') };
}

export default function OperatorWorkspacesRoute() {
  return <WorkspacesPage />;
}
