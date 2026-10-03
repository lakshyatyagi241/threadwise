import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Announcements } from '@/features/marketing-site-cms/admin/announcements';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketing-site-cms');
  return { title: t('announcements.title') };
}

export default function Page() {
  return <Announcements />;
}
