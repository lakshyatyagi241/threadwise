import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { LeadSourcesScreen } from '@/features/lead-sources/components/lead-sources-screen';
import { parseTab } from '@/features/lead-sources/lib/source-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('lead-sources.page');
  return { title: t('title') };
}

export default async function LeadSourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { tab } = await searchParams;
  return (
    <Suspense>
      <LeadSourcesScreen tab={parseTab(Array.isArray(tab) ? tab[0] : tab)} />
    </Suspense>
  );
}
