import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { FrontendEditor } from '@/features/marketing-site-cms/admin/frontend-editor';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketing-site-cms');
  return { title: t('frontend.title') };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const page = (await searchParams).page;
  return <FrontendEditor initialPage={Array.isArray(page) ? page[0] : page} />;
}
