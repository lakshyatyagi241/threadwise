import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AnnouncementForm } from '@/features/marketing-site-cms/admin/announcement-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketing-site-cms');
  return { title: t('announcements.form.titleNew') };
}

export default function Page() {
  return <AnnouncementForm />;
}
