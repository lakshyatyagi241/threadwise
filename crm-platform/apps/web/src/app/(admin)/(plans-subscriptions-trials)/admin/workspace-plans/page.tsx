import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WorkspacePlansPage } from '@/features/plans-subscriptions-trials/operator/workspace-plans-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('plans-subscriptions-trials.operator');
  return { title: t('title') };
}

export default function OperatorWorkspacePlansPage() {
  return <WorkspacePlansPage />;
}
