import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RoleEditPage } from '@/features/roles-permissions/role-editor';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('roles-permissions.editor');
  return { title: t('eyebrowEdit') };
}

export default async function OperatorRoleEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ duplicated?: string }>;
}) {
  const [{ id }, { duplicated }] = await Promise.all([params, searchParams]);
  return <RoleEditPage roleId={id} duplicated={duplicated === '1'} />;
}
