import type { Metadata } from 'next';
import { pageMeta } from '@/features/marketing-site-cms/geta/seo';
import { DeleteAccountPage } from '@/features/marketing-site-cms/geta/pages/delete-account';

export const generateMetadata = (): Promise<Metadata> =>
  pageMeta({
    path: '/delete-account',
    title: 'How to delete your account',
    description:
      'Delete your Geta.ai account from Account, Delete account: what you need, what is removed, what stays with the workspace and how to close a workspace.',
  });

export default DeleteAccountPage;
