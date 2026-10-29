import type { Metadata } from 'next';
import { pageMeta } from '@/features/marketing-site-cms/geta/seo';
import { SecurityPage } from '@/features/marketing-site-cms/geta/pages/company';

export const generateMetadata = (): Promise<Metadata> =>
  pageMeta({
    path: '/security',
    title: 'Security: isolation, permissions and audit trail',
    description:
      'Geta.ai separates every workspace, controls access with roles and permissions, supports two-step sign-in and logs sensitive actions.',
  });

export default SecurityPage;
