import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { StaffPage } from '@/features/roles-permissions/staff-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('roles-permissions.nav');
  return { title: t('staff') };
}

export default function OperatorStaffRolesPage() {
  return <StaffPage />;
}
