import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { GuidebookAdmin } from '@/features/marketing-site-cms/admin/guidebook-admin';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketing-site-cms');
  return { title: t('guidebookAdmin.title') };
}

export default function Page() {
  return <GuidebookAdmin />;
}
