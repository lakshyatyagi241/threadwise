import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { HealthScreen } from '@/features/dashboards-analytics-charts/components/health-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboards-analytics-charts.health');
  return { title: t('title') };
}

export default function SystemHealthPage() {
  return <HealthScreen />;
}
