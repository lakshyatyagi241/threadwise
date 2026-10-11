import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { FaqEnginePage } from '@/features/faq-knowledge/platform/faq-engine-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('faq-knowledge-admin.page');
  return { title: t('title') };
}

export default function OperatorFaqPage() {
  return <FaqEnginePage />;
}
