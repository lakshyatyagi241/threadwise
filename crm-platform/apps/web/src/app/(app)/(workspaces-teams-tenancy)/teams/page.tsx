import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { TeamsScreen } from '@/features/workspaces-teams-tenancy';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('workspaces-teams-tenancy.teams');
  return { title: t('pageTitle') };
}

export default function TeamsPage() {
  return <TeamsScreen />;
}
