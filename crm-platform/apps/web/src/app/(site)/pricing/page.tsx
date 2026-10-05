import type { Metadata } from 'next';
import { loadSiteContent } from '@/features/marketing-site-cms/public/load';
import { pageMetadata } from '@/features/marketing-site-cms/site/page-meta';
import { SitePage } from '@/features/marketing-site-cms/site/site-page';

export const generateMetadata = (): Promise<Metadata> => pageMetadata('pricing');

/** Composed from the editable sections; the plan cards inside come from the plan catalogue. */
export default async function Page() {
  return <SitePage page="pricing" content={await loadSiteContent()} />;
}
