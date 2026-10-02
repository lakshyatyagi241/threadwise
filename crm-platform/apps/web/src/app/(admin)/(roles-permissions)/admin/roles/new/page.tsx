import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RoleCreatePage } from '@/features/roles-permissions/role-editor';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('roles-permissions.editor');
  return { title: `${t('titleLead')} ${t('titleAccent')}` };
}

export default function OperatorRoleNewPage() {
  return <RoleCreatePage />;
}
