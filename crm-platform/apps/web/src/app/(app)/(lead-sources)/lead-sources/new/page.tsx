import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { NewSourcePage } from '@/features/lead-sources/components/new-source-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('lead-sources.wizard');
  return { title: t('title') };
}

export default function NewLeadSourcePage() {
  return <NewSourcePage />;
}
