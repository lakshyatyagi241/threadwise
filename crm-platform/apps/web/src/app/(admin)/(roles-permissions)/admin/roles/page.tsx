import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RolesPage } from '@/features/roles-permissions/roles-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('roles-permissions.list');
  return { title: t('crumb') };
}

export default function OperatorRolesPage() {
  return <RolesPage />;
}
