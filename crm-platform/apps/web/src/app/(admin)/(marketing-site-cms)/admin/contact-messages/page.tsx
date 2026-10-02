import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ContactInbox } from '@/features/marketing-site-cms/admin/contact-inbox';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketing-site-cms');
  return { title: t('contact.title') };
}

export default function Page() {
  return <ContactInbox />;
}
