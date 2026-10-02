import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ContactForm } from '@/features/marketing-site-cms/public/contact-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketing-site-cms.site');
  return { title: t('contactTitle') };
}

export default async function ContactPage() {
  const t = await getTranslations('marketing-site-cms.site');
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t('contactTitle')}</h1>
        <p className="text-muted-foreground">{t('contactLead')}</p>
      </header>
      <ContactForm />
    </div>
  );
}
