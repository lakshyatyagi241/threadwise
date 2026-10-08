import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ReportsPage } from '@/features/report-copilot';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('report-copilot.page');
  return { title: t('title') };
}

export default function ReportsRoute() {
  return <ReportsPage scope="workspace" />;
}
