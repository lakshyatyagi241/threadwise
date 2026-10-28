import type { Metadata } from 'next';
import { pageMeta } from '@/features/marketing-site-cms/geta/seo';
import { ChannelsHubPage } from '@/features/marketing-site-cms/geta/pages/channels-hub';

export const generateMetadata = (): Promise<Metadata> =>
  pageMeta({
    path: '/products/channels',
    title: 'Channels: WhatsApp, email, SMS, Instagram and more',
    description:
      'Bring WhatsApp, email, SMS, voice calls, Instagram, Facebook, Telegram and web chat into one Geta.ai inbox with one contact record per person.',
  });

export default ChannelsHubPage;
