import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { MembersScreen } from '@/features/workspaces-teams-tenancy';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('workspaces-teams-tenancy.members');
  return { title: t('pageTitle') };
}

export default function TeamMembersPage() {
  return <MembersScreen />;
}
