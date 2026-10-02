import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WorkspaceRoleCreatePage } from '@/features/roles-permissions/workspace/role-editor';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('roles-permissions-workspace.editor');
  return { title: t('crumbNew') };
}

export default function WorkspaceRoleNewRoute() {
  return <WorkspaceRoleCreatePage />;
}
