import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WorkspaceRoleEditPage } from '@/features/roles-permissions/workspace/role-editor';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('roles-permissions-workspace.list');
  return { title: t('crumb') };
}

export default async function WorkspaceRoleEditRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WorkspaceRoleEditPage roleId={id} />;
}
