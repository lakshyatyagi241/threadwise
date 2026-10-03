import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { adminOverviewWindowSchema } from '@crm/contracts';
import { AdminOverviewScreen } from '@/features/dashboards-analytics-charts/components/admin-overview-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboards-analytics-charts.admin.overview');
  return { title: t('title') };
}

/**
 * The console landing page is Reference's admin overview (TW-DASH-034): the dashboards domain draws it. The menu rail already lists every
 * area the old card map listed, so the map is gone; the window rides in the URL (`?window=`), unknown values read as 7 days.
 */
export default async function AdminHome({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const { window } = await searchParams;
  return <AdminOverviewScreen window={adminOverviewWindowSchema.parse(window)} />;
}
