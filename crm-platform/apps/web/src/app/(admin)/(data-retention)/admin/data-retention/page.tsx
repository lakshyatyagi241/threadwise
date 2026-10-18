import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DataRetentionPage } from '@/features/data-retention/data-retention-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('data-retention.page');
  return { title: t('title') };
}

export default function OperatorDataRetentionPage() {
  return <DataRetentionPage />;
}
