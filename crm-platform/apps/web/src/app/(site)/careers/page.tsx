import type { Metadata } from 'next';
import { pageMeta } from '@/features/marketing-site-cms/geta/seo';
import { CareersPage } from '@/features/marketing-site-cms/geta/pages/company';

export const generateMetadata = (): Promise<Metadata> =>
  pageMeta({
    path: '/careers',
    title: 'Careers at Geta.ai: build customer engagement software',
    description:
      'Join a growing team building AI agents, a shared inbox and a CRM for businesses that talk to customers on WhatsApp and other channels.',
  });

export default function Page() {
  return <CareersPage />;
}
