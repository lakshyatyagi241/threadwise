import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LegalPages } from '@/features/marketing-site-cms/admin/legal-pages';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketing-site-cms');
  return { title: t('legal.title') };
}

export default function Page() {
  return <LegalPages />;
}
