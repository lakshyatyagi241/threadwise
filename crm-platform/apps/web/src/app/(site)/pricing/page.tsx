import type { Metadata } from 'next';
import { pageMeta } from '@/features/marketing-site-cms/geta/seo';
import { PricingPage } from '@/features/marketing-site-cms/geta/pages/pricing';

export const generateMetadata = (): Promise<Metadata> =>
  pageMeta({
    path: '/pricing',
    title: 'Plans: built around what you turn on',
    description:
      'Start with the Geta.ai modules you need and add more as you grow: shared inbox, WhatsApp, AI agents, campaigns and CRM. Contact us for a quote.',
  });

export default PricingPage;
