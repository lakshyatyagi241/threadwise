import type { ReactNode } from 'react';
import { loadSiteContent } from '@/features/marketing-site-cms/public/load';
import { SiteFrame } from '@/features/marketing-site-cms/site/site-frame';

/** The public site frame: ticker, navigation, footer and the editable theme (TW-CMS-007). */
export default async function SiteLayout({ children }: { children: ReactNode }) {
  return <SiteFrame content={await loadSiteContent()}>{children}</SiteFrame>;
}
