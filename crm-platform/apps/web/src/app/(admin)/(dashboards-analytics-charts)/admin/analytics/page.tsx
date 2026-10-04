import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { adminAnalyticsQuerySchema } from '@crm/contracts';
import { AdminAnalyticsScreen } from '@/features/dashboards-analytics-charts/components/admin-analytics-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboards-analytics-charts.admin.analytics');
  return { title: t('title') };
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { days } = await searchParams;
  // the same clamp the API applies: 1..365, default 30
  return <AdminAnalyticsScreen days={adminAnalyticsQuerySchema.parse({ days }).days} />;
}
