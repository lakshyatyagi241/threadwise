import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { SourceDetailPage } from '@/features/lead-sources/components/source-detail-page';
import { isUuid } from '@/features/lead-sources/lib/source-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('lead-sources.detail');
  return { title: t('pageTitle') };
}

export default async function LeadSourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ events?: string | string[] }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { events } = await searchParams;
  return <SourceDetailPage id={id} initialEvents={Array.isArray(events) ? events[0] : events} />;
}
