import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DashboardPage } from '@/features/ai-keys-usage-admin/platform/dashboard-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ai-keys-usage-admin.dashboard');
  return { title: t('title') };
}

export default function OperatorAiDashboardPage() {
  return <DashboardPage />;
}
