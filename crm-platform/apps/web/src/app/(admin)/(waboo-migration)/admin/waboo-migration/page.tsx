import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WabooMigrationPage } from '@/features/waboo-migration';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('waboo-migration.page');
  return { title: t('title') };
}

export default function OperatorWabooMigrationPage() {
  return <WabooMigrationPage />;
}
