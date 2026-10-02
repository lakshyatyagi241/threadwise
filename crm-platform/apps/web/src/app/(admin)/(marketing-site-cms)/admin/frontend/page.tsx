import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { FrontendEditor } from '@/features/marketing-site-cms/admin/frontend-editor';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketing-site-cms');
  return { title: t('frontend.title') };
}

export default function Page() {
  return <FrontendEditor />;
}
