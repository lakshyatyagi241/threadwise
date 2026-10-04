import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { GuidebookForm } from '@/features/marketing-site-cms/admin/guidebook-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketing-site-cms');
  return { title: t('guidebookAdmin.form.titleNew') };
}

export default function Page() {
  return <GuidebookForm />;
}
