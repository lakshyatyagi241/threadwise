import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PlanSettingsPage } from '@/features/plans-subscriptions-trials/operator/plan-settings-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('plans-subscriptions-trials.operator.settings');
  return { title: t('title') };
}

export default function OperatorPlanSettingsPage() {
  return <PlanSettingsPage />;
}
