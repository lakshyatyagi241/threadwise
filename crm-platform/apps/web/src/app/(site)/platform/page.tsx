import type { Metadata } from 'next';
import { pageMeta } from '@/features/marketing-site-cms/geta/seo';
import { PlatformPage } from '@/features/marketing-site-cms/geta/pages/platform';

export const generateMetadata = (): Promise<Metadata> =>
  pageMeta({
    path: '/platform',
    title: 'Platform overview: AI agents, inbox and CRM',
    description:
      'See how Geta.ai brings AI agents, a shared inbox, campaigns, a CRM and integrations into one workspace with one contact record.',
  });

export default PlatformPage;
