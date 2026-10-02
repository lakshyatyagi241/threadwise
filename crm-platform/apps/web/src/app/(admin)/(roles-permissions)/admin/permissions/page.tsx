import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PermissionsPage } from '@/features/roles-permissions/permissions-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('roles-permissions.nav');
  return { title: t('permissions') };
}

export default function OperatorPermissionsPage() {
  return <PermissionsPage />;
}
