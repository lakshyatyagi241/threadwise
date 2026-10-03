import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { isLegalSlug } from '@crm/contracts';
import { LegalEdit } from '@/features/marketing-site-cms/admin/legal-edit';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketing-site-cms');
  return { title: t('legal.title') };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isLegalSlug(slug)) notFound();
  return <LegalEdit slug={slug} />;
}
