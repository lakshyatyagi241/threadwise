import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PlansPicker } from '@/features/plans-subscriptions-trials/components/plans-picker';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('plans-subscriptions-trials.plans');
  return { title: t('title') };
}

/** The destination of every "upgrade" in the app (WD-PLAN-011): the real plan picker for this workspace. */
export default function PlansPage() {
  return <PlansPicker />;
}
