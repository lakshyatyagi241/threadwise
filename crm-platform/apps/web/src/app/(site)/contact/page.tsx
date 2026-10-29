import type { Metadata } from 'next';
import { pageMeta } from '@/features/marketing-site-cms/geta/seo';
import { ContactPage } from '@/features/marketing-site-cms/geta/pages/contact';

export const generateMetadata = (): Promise<Metadata> =>
  pageMeta({
    path: '/contact',
    title: 'Contact Geta.ai: talk to our team',
    description:
      'Questions about plans, setup, security or partnerships? Send us a message and the Geta.ai team will reply within one working day.',
  });

export default function Page() {
  return <ContactPage />;
}
