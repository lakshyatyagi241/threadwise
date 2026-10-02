import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PermissionCreatePage } from '@/features/roles-permissions/permission-create';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('roles-permissions.permissionNew');
  return { title: `${t('titleLead')} ${t('titleAccent')}` };
}

export default function OperatorPermissionNewPage() {
  return <PermissionCreatePage />;
}
