import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DashboardPage } from '@/features/bsp-billing-engine/components/dashboard-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('bsp-billing-engine.nav');
  return { title: t('income') };
}

export default function OperatorBspDashboardPage() {
  return <DashboardPage />;
}
