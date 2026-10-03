import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PremiumPage } from '@/features/plans-subscriptions-trials/operator/premium-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('plans-subscriptions-trials.operator.premium');
  return { title: t('title') };
}

export default function OperatorPremiumPage() {
  return <PremiumPage />;
}
