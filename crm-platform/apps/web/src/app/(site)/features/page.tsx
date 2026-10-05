import type { Metadata } from 'next';
import { loadSiteContent } from '@/features/marketing-site-cms/public/load';
import { pageMetadata } from '@/features/marketing-site-cms/site/page-meta';
import { SitePage } from '@/features/marketing-site-cms/site/site-page';

export const generateMetadata = (): Promise<Metadata> => pageMetadata('features');

export default async function Page() {
  return <SitePage page="features" content={await loadSiteContent()} />;
}
