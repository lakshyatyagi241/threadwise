import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { FaqsPage } from '@/features/plans-subscriptions-trials/operator/faqs-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('plans-subscriptions-trials.operator.faqs');
  return { title: t('title') };
}

export default function OperatorPricingFaqsPage() {
  return <FaqsPage />;
}
