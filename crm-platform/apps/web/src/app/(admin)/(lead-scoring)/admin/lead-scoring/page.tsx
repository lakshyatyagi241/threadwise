import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LeadScoringPage } from '@/features/lead-scoring/platform/lead-scoring-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('lead-scoring-admin.page');
  return { title: t('title') };
}

export default function OperatorLeadScoringPage() {
  return <LeadScoringPage />;
}
