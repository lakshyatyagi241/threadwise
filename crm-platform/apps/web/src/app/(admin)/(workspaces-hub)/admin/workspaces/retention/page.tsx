import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RetentionPage } from '@/features/workspaces-hub';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('workspaces-hub.retention');
  return { title: t('title') };
}

export default function OperatorWorkspaceRetentionRoute() {
  return <RetentionPage />;
}
