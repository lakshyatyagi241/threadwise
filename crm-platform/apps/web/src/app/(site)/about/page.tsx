import type { Metadata } from 'next';
import { pageMeta } from '@/features/marketing-site-cms/geta/seo';
import { getSiteConfig } from '@/features/platform-settings-branding-storage/site/site-config';
import { DEFAULT_BRAND } from '@/features/marketing-site-cms/geta/data/site';
import { AboutPage } from '@/features/marketing-site-cms/geta/pages/company';

export const generateMetadata = (): Promise<Metadata> =>
  pageMeta({
    path: '/about',
    title: 'About Geta.ai: AI agents and CRM for growing teams',
    description:
      'Geta.ai helps small and growing teams answer every customer on WhatsApp, email and web chat with AI agents, a shared inbox and a built-in CRM.',
  });

export default async function Page() {
  const site = await getSiteConfig();
  return <AboutPage brand={site?.brand.name || DEFAULT_BRAND} />;
}
