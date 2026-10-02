import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WorkspaceRolesPage } from '@/features/roles-permissions/workspace/roles-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('roles-permissions-workspace.list');
  return { title: t('crumb') };
}

export default function WorkspaceRolesRoute() {
  return <WorkspaceRolesPage />;
}
