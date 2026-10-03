import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { FinancialPage } from '@/features/plans-subscriptions-trials/operator/financial-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('plans-subscriptions-trials.operator.financial');
  return { title: t('title') };
}

export default function OperatorFinancialPage() {
  return <FinancialPage />;
}
