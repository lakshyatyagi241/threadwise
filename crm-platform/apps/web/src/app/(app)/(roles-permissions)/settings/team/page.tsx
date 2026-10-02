import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { WorkspaceMembersPage } from '@/features/roles-permissions/workspace/members-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('roles-permissions-workspace.team');
  return { title: t('crumb') };
}

export default function TeamMembersRoute() {
  return (
    <Suspense>
      <WorkspaceMembersPage />
    </Suspense>
  );
}
